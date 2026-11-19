/**
 * Insights › Explore and Metrics. Every read first folds in changes since the last build
 * (ensureFresh), so a log made a minute ago is already counted.
 */
import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../utils/errors';
import { User } from '../models/User';
import { shiftDayKey, daysBetween } from '../utils/dayKey';
import { ensureFresh, rebuildAllMetrics } from '../services/analytics/freshness';
import { readRows } from '../services/analytics/metricsService';
import { loadLabels } from '../services/analytics/labels';
import { BUILT_IN_METRICS, dailyValues, firstSeenDay, MetricDef } from '../services/analytics/metricCatalog';
import { detail, summarise } from '../services/analytics/metricsSummary';
import { ExploreSpecSchema, decodeSpecToken, encodeSpecToken, runExplore, runFindingDays } from '../services/analytics/exploreService';
import { spearman } from '../services/analytics/correlation';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);

const oid = (req: AuthRequest) => new mongoose.Types.ObjectId(req.userId!);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_PINS = ['sleep_hours', 'steps', 'walk_min', 'exercise_min', 'water_ml', 'energy', 'stress', 'symptom_max'];
const MAX_PINS = 12;

/** "7d" / "30d" / "90d" / "365d" or from/to → the range and the same-length range before it. */
function rangeOf(q: Record<string, unknown>, today: string, _firstDay: string | null) {
  let to = today;
  let from: string;
  if (typeof q.from === 'string' && DAY.test(q.from) && typeof q.to === 'string' && DAY.test(q.to) && q.from <= q.to) {
    from = q.from;
    to = q.to > today ? today : q.to;
  } else {
    const m = /^(\d{1,4})d$/.exec(String(q.range ?? '30d'));
    const n = Math.max(1, Math.min(3 * 365, m ? parseInt(m[1], 10) : 30));
    from = shiftDayKey(today, -(n - 1));
  }
  const len = daysBetween(from, to) + 1;
  return { from, to, prevFrom: shiftDayKey(from, -len), prevTo: shiftDayKey(from, -1) };
}

/** Pads stored rows so every day in [from, to] is present (days before any data are empty). */
function fill(rows: Awaited<ReturnType<typeof readRows>>, from: string, to: string) {
  const by = new Map(rows.map(r => [r.dayKey, r]));
  const out: typeof rows = [];
  for (let d = from; d <= to; d = shiftDayKey(d, 1)) {
    out.push(by.get(d) ?? {
      dayKey: d, logged: { any: false, entryCount: 0, symptomBasis: 'none' }, items: [], doses: [],
      metrics: {
        sleepHours: null, sleepSource: null, sleepQuality: null, steps: null, walkMin: null, exerciseMin: null, waterMl: null,
        energy: null, stress: null, mood: null, patientGlobal: null, symptomMax: null, symptomCount: 0, flareDay: false,
        tMaxC: null, tMinC: null, humidity: null, pressureHpa: null, pressureDelta: null, uvMax: null, precipMm: null,
      },
    });
  }
  return out;
}

async function context(req: AuthRequest) {
  const uid = oid(req);
  const fresh = await ensureFresh(String(uid));
  const all = fresh.firstDay ? await readRows(uid, fresh.firstDay, fresh.today) : [];
  const labels = await loadLabels(uid, all);
  return { uid, fresh, all, labels };
}

const goalFor = (def: MetricDef, waterGoal: number | null) => (def.id === 'water_ml' ? waterGoal : null);

// GET /analytics/catalog — what can be shown/explored, with how many days each has.
analyticsRouter.get('/catalog', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { uid, fresh, all, labels } = await context(req);
    const user = await User.findById(uid).select('preferences.analyticsPins').lean();
    const metrics = BUILT_IN_METRICS.map(def => {
      const vals = dailyValues(def, all, firstSeenDay(def, all));
      return { id: def.id, label: def.label, unit: def.unit, group: def.group, scaleNote: def.scaleNote ?? null, days: vals.filter(v => v !== null).length };
    });
    const itemStats = new Map<string, { days: number; lastSeen: string; hasQty: boolean; unit: string | null; hasSev: boolean; outcome: boolean }>();
    for (const r of all) for (const it of r.items ?? []) {
      if (it.count <= 0) continue;
      const s = itemStats.get(it.key) ?? { days: 0, lastSeen: r.dayKey, hasQty: false, unit: null, hasSev: false, outcome: false };
      s.days++;
      s.lastSeen = r.dayKey;
      if (it.qty !== null && !it.mixedUnits) { s.hasQty = true; s.unit = it.unit; }
      if (it.maxSev !== null) s.hasSev = true;
      if (it.outcome) s.outcome = true;
      itemStats.set(it.key, s);
    }
    const items = [...itemStats.entries()].map(([key, s]) => {
      const meta = labels.itemMeta(key);
      return { key, label: meta.label, icon: meta.icon ?? null, groupLabel: meta.groupLabel ?? null, kind: meta.kind, archived: meta.archived, ...s };
    }).sort((a, b) => Number(b.outcome) - Number(a.outcome) || b.days - a.days);
    const medications = labels.meds.map(m => {
      let planned = 0, skipped = 0;
      for (const r of all) for (const d of r.doses ?? []) if (d.medicationId === m.id) { planned += d.scheduled; skipped += d.skipped; }
      return { ...m, plannedDoses: planned, skippedDoses: skipped };
    });
    res.json({
      success: true,
      data: {
        firstDay: fresh.firstDay, today: fresh.today,
        loggedDays: all.filter(r => r.logged?.any).length,
        metrics, items, medications,
        pins: user?.preferences?.analyticsPins?.length ? user.preferences.analyticsPins : DEFAULT_PINS,
      },
    });
  } catch (err) { next(err); }
});

// GET /analytics/metrics?ids=a,b&range=30d (or from/to) — summaries vs the previous period.
analyticsRouter.get('/metrics', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fresh, all, labels, uid } = await context(req);
    let ids = typeof req.query.ids === 'string' && req.query.ids.trim() ? req.query.ids.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (ids.length === 0) {
      const user = await User.findById(uid).select('preferences.analyticsPins').lean();
      ids = user?.preferences?.analyticsPins?.length ? user.preferences.analyticsPins : DEFAULT_PINS;
    }
    ids = ids.slice(0, 24);
    const r = rangeOf(req.query, fresh.today, fresh.firstDay);
    const cur = fill(all.filter(x => x.dayKey >= r.from && x.dayKey <= r.to), r.from, r.to);
    const prev = fill(all.filter(x => x.dayKey >= r.prevFrom && x.dayKey <= r.prevTo), r.prevFrom, r.prevTo);
    const out = ids.map(id => {
      const def = labels.metric(id);
      if (!def) return null;
      return summarise(def, cur, prev, firstSeenDay(def, all), goalFor(def, labels.waterGoal));
    }).filter(Boolean);
    res.json({ success: true, data: { from: r.from, to: r.to, prevFrom: r.prevFrom, prevTo: r.prevTo, metrics: out } });
  } catch (err) { next(err); }
});

// GET /analytics/metrics/:id?range=90d — one metric in detail.
analyticsRouter.get('/metrics/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fresh, all, labels } = await context(req);
    const def = labels.metric(req.params.id);
    if (!def) throw AppError.notFound('Unknown metric');
    const r = rangeOf({ range: '90d', ...req.query }, fresh.today, fresh.firstDay);
    const cur = fill(all.filter(x => x.dayKey >= r.from && x.dayKey <= r.to), r.from, r.to);
    const prev = fill(all.filter(x => x.dayKey >= r.prevFrom && x.dayKey <= r.prevTo), r.prevFrom, r.prevTo);
    res.json({ success: true, data: { from: r.from, to: r.to, metric: detail(def, cur, prev, firstSeenDay(def, all), goalFor(def, labels.waterGoal)) } });
  } catch (err) { next(err); }
});

// GET /analytics/scatter?x=&y=&lag=0|1&range=90d — two numbers against each other.
analyticsRouter.get('/scatter', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fresh, all, labels } = await context(req);
    const dx = labels.metric(String(req.query.x ?? ''));
    const dy = labels.metric(String(req.query.y ?? ''));
    if (!dx || !dy) throw AppError.badRequest('Pick two metrics');
    const lag = req.query.lag === '1' ? 1 : 0;
    const r = rangeOf({ range: '90d', ...req.query }, fresh.today, fresh.firstDay);
    const rows = fill(all.filter(x => x.dayKey >= shiftDayKey(r.from, -1) && x.dayKey <= r.to), shiftDayKey(r.from, -1), r.to);
    const xs = dailyValues(dx, rows, firstSeenDay(dx, all));
    const ys = dailyValues(dy, rows, firstSeenDay(dy, all));
    const points: Array<{ day: string; x: number; y: number }> = [];
    for (let i = 1; i < rows.length; i++) {
      const x = xs[i - lag];
      const y = ys[i];
      if (x !== null && y !== null) points.push({ day: rows[i].dayKey, x, y });
    }
    const rho = points.length >= 8 ? spearman(points.map(p => p.x), points.map(p => p.y)) : null;
    res.json({
      success: true,
      data: {
        x: { id: dx.id, label: dx.label, unit: dx.unit }, y: { id: dy.id, label: dy.label, unit: dy.unit },
        lag, from: r.from, to: r.to, points, n: points.length, rho: rho ? { value: Math.round(rho.rho * 100) / 100, p: rho.p } : null,
      },
    });
  } catch (err) { next(err); }
});

const PinsSchema = z.object({ pins: z.array(z.string().min(1).max(80)).max(MAX_PINS) });

analyticsRouter.get('/pins', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(oid(req)).select('preferences.analyticsPins').lean();
    res.json({ success: true, data: { pins: user?.preferences?.analyticsPins?.length ? user.preferences.analyticsPins : DEFAULT_PINS } });
  } catch (err) { next(err); }
});

analyticsRouter.put('/pins', validate(PinsSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pins = Array.from(new Set((req.body as z.infer<typeof PinsSchema>).pins));
    await User.updateOne({ _id: oid(req) }, { $set: { 'preferences.analyticsPins': pins } });
    res.json({ success: true, data: { pins } });
  } catch (err) { next(err); }
});

// POST /analytics/explore { target, direction, range } — or { token } from a shared/AI link.
analyticsRouter.post('/explore', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body?.token === 'string' ? decodeSpecToken(req.body.token) : ExploreSpecSchema.safeParse(req.body);
    if (!body || !body.success) throw AppError.badRequest('That question could not be read.');
    const result = await runExplore(String(oid(req)), body.data);
    res.json({ success: true, data: { ...result, token: encodeSpecToken(body.data) } });
  } catch (err) { next(err); }
});

// POST /analytics/explore/days { token, key, lag } — both day rows behind one finding.
analyticsRouter.post('/explore/days', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = decodeSpecToken(String(req.body?.token ?? ''));
    if (!parsed || !parsed.success) throw AppError.badRequest('That question could not be read.');
    const key = String(req.body?.key ?? '');
    const rawLag = String(req.body?.lag ?? '0');
    const lag = rawLag === 'w3' ? 'w3' : ([0, 1, 2] as const).find(l => String(l) === rawLag);
    if (lag === undefined || !key || key.length > 120) throw AppError.badRequest('Pick a finding.');
    const days = await runFindingDays(String(oid(req)), parsed.data, key, lag);
    if (!days) throw AppError.notFound('That item is no longer in this range.');
    res.json({ success: true, data: days });
  } catch (err) { next(err); }
});

// POST /analytics/rebuild — rebuild every day from scratch (after a big import or a fix).
analyticsRouter.post('/rebuild', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const r = await rebuildAllMetrics(String(oid(req)));
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
});
