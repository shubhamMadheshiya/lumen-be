/**
 * Explore and Metrics for Lumen AI's tools: the model names things in words ("weakness",
 * "dairy", "Hydroxychloroquine", "sleep"), so these resolve names to keys and return compact data.
 */
import mongoose from 'mongoose';
import { ensureFresh } from './freshness';
import { readRows } from './metricsService';
import { loadLabels } from './labels';
import { BUILT_IN_METRICS, firstSeenDay } from './metricCatalog';
import { summarise } from './metricsSummary';
import { runExplore, ExploreQuestion } from './exploreService';
import { compactExplore } from './exploreCompact';
import { ExploreTarget } from './explore';
import { shiftDayKey } from '../../utils/dayKey';

const norm = (s: string) => s.toLowerCase().replace(/\(any\)|\(archived\)/g, '').replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();

async function catalogFor(userId: string) {
  const uid = new mongoose.Types.ObjectId(userId);
  const fresh = await ensureFresh(userId);
  const rows = fresh.firstDay ? await readRows(uid, fresh.firstDay, fresh.today) : [];
  const labels = await loadLabels(uid, rows);
  const days = new Map<string, { days: number; outcome: boolean }>();
  for (const r of rows) for (const it of r.items ?? []) {
    const d = days.get(it.key) ?? { days: 0, outcome: false };
    if (it.count > 0) d.days++;
    d.outcome = d.outcome || it.outcome;
    days.set(it.key, d);
  }
  const items = [...days.entries()].map(([key, d]) => ({ key, label: labels.item(key), ...d }));
  return { uid, fresh, rows, labels, items };
}

/** Best item for a name: exact label, then starts-with, then contains; symptoms and busier items first. */
function matchItem(items: Array<{ key: string; label: string; days: number; outcome: boolean }>, name: string) {
  const n = norm(name);
  if (!n) return { match: null, options: [] as string[] };
  const score = (label: string) => {
    const l = norm(label);
    if (l === n) return 3;
    if (l.startsWith(n) || n.startsWith(l)) return 2;
    if (l.includes(n) || n.includes(l)) return 1;
    return 0;
  };
  const ranked = items
    .map(i => ({ ...i, s: score(i.label) }))
    .filter(i => i.s > 0)
    .sort((a, b) => b.s - a.s || Number(b.outcome) - Number(a.outcome) || Number(a.key.startsWith('cat_')) - Number(b.key.startsWith('cat_')) || b.days - a.days);
  return { match: ranked[0] ?? null, options: ranked.slice(0, 6).map(r => r.label) };
}

export interface ExploreToolArgs {
  target?: string;
  item?: string;
  medicine?: string;
  metric?: string;
  op?: string;
  value?: number;
  min_severity?: number;
  from?: string;
  to?: string;
  direction?: string;
  range?: string;
}

export async function exploreForAi(userId: string, args: ExploreToolArgs): Promise<Record<string, unknown>> {
  const cat = await catalogFor(userId);
  const kind = String(args.target ?? 'item');
  let target: ExploreTarget | null = null;

  if (kind === 'flare') target = { kind: 'flare' };
  else if (kind === 'period') {
    const ok = (d?: string) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!ok(args.from) || !ok(args.to) || args.from! > args.to!) return { ok: false, reason: 'A period needs from and to as YYYY-MM-DD.' };
    target = { kind: 'period', from: args.from!, to: args.to! };
  } else if (kind === 'skipped_medicine' || kind === 'took_medicine') {
    const want = norm(String(args.medicine ?? ''));
    const med = cat.labels.meds.find(m => norm(m.name) === want) ?? cat.labels.meds.find(m => norm(m.name).includes(want) && want);
    if (!med) return { ok: false, reason: 'No medicine with that name.', medicines: cat.labels.meds.map(m => m.name) };
    target = { kind: 'dose', medicationId: med.id, status: kind === 'skipped_medicine' ? 'skipped' : 'taken' };
  } else if (kind === 'metric') {
    const def = BUILT_IN_METRICS.find(d => d.id === args.metric || norm(d.label) === norm(String(args.metric ?? '')));
    if (!def || typeof args.value !== 'number' || (args.op !== 'below' && args.op !== 'above')) {
      return { ok: false, reason: 'A metric target needs metric, op ("below" or "above") and value.', metrics: BUILT_IN_METRICS.map(d => `${d.id} (${d.label}, ${d.unit})`) };
    }
    target = { kind: 'metric', id: def.id, op: args.op === 'below' ? 'lt' : 'gt', value: args.value };
  } else {
    const name = String(args.item ?? '');
    if (kind === 'rise' && /^(symptoms?|severity|worst symptom)$/i.test(name.trim())) target = { kind: 'rise', key: 'symptom_max' };
    else {
      const { match, options } = matchItem(cat.items, name);
      if (!match) return { ok: false, reason: `Nothing logged matches "${name}".`, someLoggedItems: cat.items.sort((a, b) => b.days - a.days).slice(0, 30).map(i => i.label) };
      target = kind === 'rise'
        ? { kind: 'rise', key: match.key }
        : { kind: 'item', key: match.key, ...(typeof args.min_severity === 'number' ? { minSev: Math.max(0, Math.min(10, args.min_severity)) } : {}) };
      if (options.length > 1) (args as Record<string, unknown>).__alternatives = options;
    }
  }

  const q: ExploreQuestion = {
    target: target!,
    direction: args.direction === 'after' ? 'after' : 'before',
    range: args.range === '90d' || args.range === '180d' || args.range === 'all' ? args.range : '365d',
  };
  const result = await runExplore(userId, q);
  const alts = (args as Record<string, unknown>).__alternatives as string[] | undefined;
  return { ok: true, ...compactExplore(result, q), ...(alts ? { otherMatchingItems: alts.slice(1) } : {}) };
}

export async function metricsForAi(userId: string, names: string[], range: string): Promise<Record<string, unknown>> {
  const cat = await catalogFor(userId);
  const m = /^(\d{1,3})d$/.exec(range);
  const n = Math.max(7, Math.min(365, m ? parseInt(m[1], 10) : 30));
  const to = cat.fresh.today;
  const from = shiftDayKey(to, -(n - 1));
  const prevFrom = shiftDayKey(from, -n);
  const pick = (x: string) => cat.rows.filter(r => r.dayKey >= x);
  const cur = cat.rows.filter(r => r.dayKey >= from && r.dayKey <= to);
  const prev = cat.rows.filter(r => r.dayKey >= prevFrom && r.dayKey < from);
  void pick;

  const wanted = names.length ? names : ['sleep_hours', 'steps', 'walk_min', 'exercise_min', 'water_ml', 'energy', 'stress', 'mood', 'overall', 'symptom_max', 'flare_days'];
  const out: Record<string, unknown>[] = [];
  const unknown: string[] = [];
  for (const raw of wanted.slice(0, 20)) {
    let def = cat.labels.metric(raw) ?? BUILT_IN_METRICS.find(d => norm(d.label) === norm(raw)) ?? null;
    if (!def) {
      const med = cat.labels.meds.find(x => norm(x.name) === norm(raw));
      if (med) def = cat.labels.metric(`dose:${med.id}`);
    }
    if (!def) {
      const { match } = matchItem(cat.items, raw);
      if (match) def = cat.labels.metric(`item:${match.key}:count`);
    }
    if (!def) { unknown.push(raw); continue; }
    const s = summarise(def, padDays(cur, from, to), prev.length ? padDays(prev, prevFrom, shiftDayKey(from, -1)) : null, firstSeenDay(def, cat.rows), def.id === 'water_ml' ? cat.labels.waterGoal : null);
    out.push({
      metric: s.label, unit: s.unit, scale: s.scaleNote, summary: s.summary === 'share' ? '% of logged days' : 'average per day with a value',
      value: s.value, median: s.median, min: s.min, max: s.max, basedOnDays: `${s.covered} of ${s.total}`,
      previousPeriod: s.prev, change: s.change, trend: s.trend, goal: s.goal, goalHit: s.goalRate,
    });
  }
  return {
    ok: true, from, to, previousFrom: prevFrom, metrics: out,
    ...(unknown.length ? { notFound: unknown, available: BUILT_IN_METRICS.map(d => `${d.id} (${d.label})`) } : {}),
    note: 'Averages only count days that have a value (see basedOnDays); a day with no logging is never counted as zero for sleep, energy, stress or weather.',
  };
}

function padDays<T extends { dayKey: string }>(rows: T[], from: string, to: string): T[] {
  const by = new Map(rows.map(r => [r.dayKey, r]));
  const out: T[] = [];
  for (let d = from; d <= to; d = shiftDayKey(d, 1)) {
    out.push(by.get(d) ?? ({ dayKey: d, logged: { any: false, entryCount: 0, symptomBasis: 'none' }, items: [], doses: [], metrics: {} } as unknown as T));
  }
  return out;
}
