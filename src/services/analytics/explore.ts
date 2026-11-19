/**
 * Explore: pick one thing (a symptom, a flare, a skipped medicine, "sleep under 6 h", a bad
 * stretch of days…) and see what else tends to show up before or after it.
 *
 * Honest by construction — the same rules as the Insights engine:
 * - Only days the member was logging count; a silent day is never read as "didn't happen".
 * - Counts are plain ("6 of 9 days after X, vs 8 of 51 other days").
 * - Every comparison in one question goes into one Benjamini-Hochberg pool, so asking about
 *   more things makes the bar higher, and the number of things checked is shown.
 * - Effects are shrunk toward "no difference", adjusted for how busy the day's logging was,
 *   and "consistent" also needs a circular-shift check and both halves of the history to agree.
 * - In "what came before", things logged within 3 h after a symptom are left out (a painkiller
 *   taken for the pain is not a cause of the pain).
 * - Flags: "logged together" (same hour, same entry), "already higher the day before".
 *
 * Pure functions.
 */
import { DayMetricRow, ItemDay } from './dayMetrics';
import { BUILT_IN_METRICS, dailyValues, firstSeenDay, MetricDef } from './metricCatalog';
import { benjaminiHochberg, fisherGreater, hodgesLehmannShift, mannWhitneyU, mean, median, scaledMad, variance } from '../insights/stats';

// ── Questions ────────────────────────────────────────────────────────────────

export type ExploreTarget =
  | { kind: 'item'; key: string; minSev?: number }
  | { kind: 'flare' }
  | { kind: 'dose'; medicationId: string; status: 'skipped' | 'taken' }
  | { kind: 'metric'; id: string; op: 'lt' | 'gt'; value: number }
  | { kind: 'rise'; key: string }
  | { kind: 'period'; from: string; to: string };

export type Direction = 'before' | 'after';
export type LagKey = 0 | 1 | 2 | 'w3';

export interface ExploreSpec {
  target: ExploreTarget;
  direction: Direction;
}

export interface ExploreConfig {
  lags: LagKey[];
  minPairs: number;
  minExposedDays: number;
  minUnexposedDays: number;
  minOutcomeDays: number;
  minCandidateDays: number;
  minNumericPerGroup: number;
  engagementStrata: number;
  possible: { q: number; shrunkRR: number };
  consistent: { q: number; circularP: number };
  circularMinShift: number;
  minHalfDays: number;
  defaultTau2: number;
  minTau2: number;
}

/** Looser than the background engine (the member asked this question), stricter bar via BH. */
export const EXPLORE_CONFIG: ExploreConfig = {
  lags: [0, 1, 2, 'w3'],
  minPairs: 20,
  minExposedDays: 5,
  minUnexposedDays: 5,
  minOutcomeDays: 3,
  minCandidateDays: 4,
  minNumericPerGroup: 6,
  engagementStrata: 4,
  possible: { q: 0.1, shrunkRR: 1.5 },
  consistent: { q: 0.01, circularP: 0.1 },
  circularMinShift: 7,
  minHalfDays: 10,
  defaultTau2: 0.25,
  minTau2: 0.05,
};

// ── Results ──────────────────────────────────────────────────────────────────

export type Tier = 'consistent' | 'possible' | 'none';
export type Flag = 'logged_together' | 'already_before' | 'often_after_symptom' | 'weak_days';

export interface BinaryFinding {
  key: string;
  label: string;
  type: 'item' | 'flare' | 'dose';
  lag: LagKey;
  /** 'more' = the target shows up more often (before) / the item shows up more often (after). */
  way: 'more' | 'less';
  a: number; b: number; c: number; d: number;
  rateWith: number;
  rateOther: number;
  shrunkRR: number;
  q: number;
  tier: Tier;
  flags: Flag[];
}

export interface NumericFinding {
  id: string;
  label: string;
  unit: string;
  lag: 0 | 1;
  medianWith: number;
  medianOther: number;
  shift: number;
  nWith: number;
  nOther: number;
  q: number;
  tier: Tier;
}

export interface ExploreResult {
  target: { label: string; days: number; observedDays: number; firstDay: string | null; lastDay: string | null };
  direction: Direction;
  findings: BinaryFinding[];
  numeric: NumericFinding[];
  /** Checked, nothing clear (shown collapsed). */
  unclear: Array<{ key: string; label: string; lag: LagKey; rateWith: number; rateOther: number; a: number; b: number; c: number; d: number }>;
  notEnough: Array<{ key: string; label: string; days: number }>;
  checkedCount: number;
  caveats: string[];
  /** For period questions: this stretch vs the same length just before it. */
  period?: { from: string; to: string; prevFrom: string; prevTo: string };
}

export interface LabelLookup {
  item(key: string): string;
  med(id: string): string | null;
  metric(id: string): MetricDef | null;
}

// ── Day series ───────────────────────────────────────────────────────────────

interface Point { observed: boolean; hit: boolean; other: number; hours?: number[]; reactive?: boolean }

const findItem = (r: DayMetricRow, key: string): ItemDay | undefined => r.items?.find(i => i.key === key);
const symptomObserved = (r: DayMetricRow) => r.logged?.symptomBasis !== 'none';

/** "Was this observed / did it happen" for each day, for the thing the member picked. */
export function targetSeries(rows: DayMetricRow[], t: ExploreTarget, lookup: LabelLookup): Point[] {
  switch (t.kind) {
    case 'item': {
      const outcome = rows.some(r => findItem(r, t.key)?.outcome);
      return rows.map(r => {
        const it = findItem(r, t.key);
        const hit = !!it && it.count > 0 && (t.minSev === undefined || (it.maxSev ?? -1) >= t.minSev);
        return { observed: outcome ? symptomObserved(r) : !!r.logged?.any, hit, other: r.logged?.entryCount ?? 0, hours: it?.hours };
      });
    }
    case 'flare':
      return rows.map(r => ({ observed: !!r.logged?.any || !!r.metrics?.flareDay, hit: !!r.metrics?.flareDay, other: r.logged?.entryCount ?? 0 }));
    case 'dose':
      return rows.map(r => doseObservation(r, t.medicationId, t.status));
    case 'metric': {
      const def = lookup.metric(t.id);
      if (!def) return rows.map(() => ({ observed: false, hit: false, other: 0 }));
      const vals = dailyValues(def, rows, firstSeenDay(def, rows));
      return vals.map((v, i) => ({ observed: v !== null, hit: v !== null && (t.op === 'lt' ? v < t.value : v > t.value), other: rows[i].logged?.entryCount ?? 0 }));
    }
    case 'rise':
      return riseSeries(rows, t.key);
    case 'period':
      return rows.map(r => ({ observed: !!r.logged?.any, hit: r.dayKey >= t.from && r.dayKey <= t.to, other: r.logged?.entryCount ?? 0 }));
  }
}

/** A skipped-dose day vs a day when every planned dose was taken; unmarked days count as neither. */
function doseObservation(r: DayMetricRow, medicationId: string, status: 'skipped' | 'taken'): Point {
  const d = r.doses?.find(x => x.medicationId === medicationId);
  const other = r.logged?.entryCount ?? 0;
  if (!d || d.scheduled === 0) {
    // An unplanned explicit Skip still counts; nothing else is known.
    return d && d.skipped > 0 && status === 'skipped' ? { observed: true, hit: true, other } : { observed: false, hit: false, other };
  }
  const skipped = d.skipped > 0;
  const allTaken = d.unmarked === 0 && !skipped && d.taken >= d.scheduled;
  if (!skipped && !allTaken) return { observed: false, hit: false, other };
  return { observed: true, hit: status === 'skipped' ? skipped : allTaken, other };
}

/**
 * Days when a symptom (or the day's worst severity, key "symptom_max") was clearly above the
 * member's own recent level: at least the median of the previous 14 recorded days plus
 * max(1.5 × spread, 2 points). Needs 5 earlier values; days before that are not observed.
 */
export function riseSeries(rows: DayMetricRow[], key: string): Point[] {
  const value = (r: DayMetricRow): number | null => {
    if (key === 'symptom_max') return r.metrics?.symptomMax ?? (symptomObserved(r) ? 0 : null);
    const it = findItem(r, key);
    if (it) return it.maxSev ?? (it.count > 0 ? 1 : 0);
    return symptomObserved(r) ? 0 : null;
  };
  const history: number[] = [];
  return rows.map(r => {
    const v = value(r);
    const other = r.logged?.entryCount ?? 0;
    if (v === null) return { observed: false, hit: false, other };
    const recent = history.slice(-14);
    history.push(v);
    if (recent.length < 5) return { observed: false, hit: false, other };
    const base = median(recent);
    const bar = base + Math.max(1.5 * scaledMad(recent), 2);
    return { observed: true, hit: v >= bar, other };
  });
}

// ── Candidates ───────────────────────────────────────────────────────────────

interface Candidate { key: string; label: string; type: 'item' | 'flare' | 'dose'; series: Point[]; days: number; group?: string }

function sameThing(target: ExploreTarget, targetGroup: string | undefined, c: Candidate): boolean {
  if (target.kind === 'item' || target.kind === 'rise') {
    const tKey = target.key;
    if (c.key === tKey) return true;
    // An option and its own category are the same log ("Weakness" and "Neuro symptoms").
    if (targetGroup && c.group === targetGroup && (c.key.startsWith('cat_') || tKey.startsWith('cat_'))) return true;
  }
  if (target.kind === 'flare' && c.type === 'flare') return true;
  if (target.kind === 'dose' && c.key === `dose_skip:${target.medicationId}`) return true;
  return false;
}

function itemCandidates(rows: DayMetricRow[], direction: Direction, lookup: LabelLookup): Candidate[] {
  const meta = new Map<string, { group: string; outcome: boolean; days: number }>();
  for (const r of rows) for (const it of r.items ?? []) {
    const m = meta.get(it.key) ?? { group: it.group, outcome: it.outcome, days: 0 };
    if (it.count > 0) m.days++;
    m.outcome = m.outcome || it.outcome;
    meta.set(it.key, m);
  }
  return [...meta.entries()].map(([key, m]) => ({
    key, label: lookup.item(key), type: 'item' as const, group: m.group, days: m.days,
    series: rows.map(r => {
      const it = findItem(r, key);
      // Before: a log made as a response to a symptom is not counted as "came before".
      const count = it ? (direction === 'before' ? it.count - it.reactive : it.count) : 0;
      return {
        observed: m.outcome ? symptomObserved(r) : !!r.logged?.any,
        hit: count > 0,
        other: Math.max(0, (r.logged?.entryCount ?? 0) - (it?.count ?? 0)),
        hours: it?.hours,
        reactive: !!it && it.reactive > 0 && it.reactive === it.count,
      };
    }),
  }));
}

function extraCandidates(rows: DayMetricRow[], lookup: LabelLookup): Candidate[] {
  const out: Candidate[] = [];
  const flare = rows.map(r => ({ observed: !!r.logged?.any || !!r.metrics?.flareDay, hit: !!r.metrics?.flareDay, other: r.logged?.entryCount ?? 0 }));
  out.push({ key: 'flare', label: 'Flare day', type: 'flare', series: flare, days: flare.filter(p => p.hit).length });
  const meds = new Set<string>();
  for (const r of rows) for (const d of r.doses ?? []) meds.add(d.medicationId);
  for (const id of meds) {
    const series = rows.map(r => doseObservation(r, id, 'skipped'));
    out.push({ key: `dose_skip:${id}`, label: `Skipped ${lookup.med(id) ?? 'medicine'}`, type: 'dose', series, days: series.filter(p => p.hit).length });
  }
  return out;
}

// ── Pairing and counting ─────────────────────────────────────────────────────

interface Pair { exposed: boolean; outcome: boolean; other: number; together: boolean; index: number }

/**
 * `x` is what may come first, `y` what may follow. Lag L pairs x on day i with y on day i + L;
 * 'w3' pairs "x on any of the 3 days before" with y on day i.
 */
function buildPairs(x: Point[], y: Point[], lag: LagKey): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < y.length; i++) {
    let exposed = false;
    let observed = false;
    let together = false;
    let other = 0;
    if (lag === 'w3') {
      for (let k = 1; k <= 3; k++) {
        const p = x[i - k];
        if (!p || !p.observed) continue;
        observed = true;
        other = Math.max(other, p.other);
        if (p.hit) exposed = true;
      }
    } else {
      const p = x[i - lag];
      if (!p || !p.observed) continue;
      observed = true;
      exposed = p.hit;
      other = p.other;
      if (lag === 0 && p.hit && y[i].hit && p.hours && y[i].hours) together = p.hours.some(h => y[i].hours!.includes(h));
    }
    if (!observed || !y[i].observed) continue;
    pairs.push({ exposed, outcome: y[i].hit, other, together, index: i });
  }
  return pairs;
}

function counts(pairs: Pair[]) {
  let a = 0, b = 0, c = 0, d = 0;
  for (const p of pairs) {
    if (p.exposed) { if (p.outcome) a++; else b++; } else if (p.outcome) c++; else d++;
  }
  return { a, b, c, d };
}

const rate = (hit: number, n: number) => (n > 0 ? hit / n : 0);
const rd = (a: number, b: number, c: number, d: number) => rate(a, a + b) - rate(c, c + d);

function adjustedRD(pairs: Pair[], bands: number): number {
  if (pairs.length === 0) return 0;
  const sorted = pairs.map(p => p.other).sort((x, y) => x - y);
  const cuts = Array.from({ length: bands - 1 }, (_, i) => sorted[Math.floor(((i + 1) * sorted.length) / bands)]);
  const strata: Pair[][] = Array.from({ length: bands }, () => []);
  for (const p of pairs) strata[cuts.filter(c => p.other >= c).length].push(p);
  let weighted = 0, weights = 0;
  for (const s of strata) {
    const { a, b, c, d } = counts(s);
    const n1 = a + b, n0 = c + d;
    if (n1 === 0 || n0 === 0) continue;
    const w = (n1 * n0) / (n1 + n0);
    weighted += w * rd(a, b, c, d);
    weights += w;
  }
  return weights > 0 ? weighted / weights : 0;
}

function circularP(x: Point[], y: Point[], lag: LagKey, observedRD: number, minShift: number): number | null {
  const n = x.length;
  if (n < 2 * minShift + 2) return null;
  let atLeast = 0, total = 0;
  for (let s = minShift; s <= n - minShift; s++) {
    const shifted = x.map((_, i) => x[(i + s) % n]);
    const { a, b, c, d } = counts(buildPairs(shifted, y, lag));
    if (a + b === 0 || c + d === 0) continue;
    total++;
    const v = rd(a, b, c, d);
    if (observedRD >= 0 ? v >= observedRD - 1e-12 : v <= observedRD + 1e-12) atLeast++;
  }
  return total === 0 ? null : (1 + atLeast) / (1 + total);
}

function halvesAgree(pairs: Pair[], minHalf: number, positive: boolean): boolean | null {
  if (pairs.length < 2 * minHalf) return null;
  const mid = Math.floor(pairs.length / 2);
  return [pairs.slice(0, mid), pairs.slice(mid)].every(h => {
    const { a, b, c, d } = counts(h);
    if (a + b === 0 || c + d === 0) return false;
    const v = rd(a, b, c, d);
    return positive ? v > 0 : v < 0;
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface Test {
  cand: Candidate;
  lag: LagKey;
  pairs: Pair[];
  x: Point[];
  y: Point[];
  a: number; b: number; c: number; d: number;
  p: number;
  way: 'more' | 'less';
  logRR: number;
  se2: number;
  shrunkRR: number;
  q: number;
}

const SYMPTOM_METRICS = new Set(['overall', 'symptom_max', 'mood']);
const NUMERIC_IDS = ['sleep_hours', 'sleep_quality', 'steps', 'walk_min', 'exercise_min', 'water_ml', 'energy', 'stress', 'mood', 'overall', 'symptom_max',
  'temp_max', 'temp_min', 'humidity', 'pressure', 'pressure_change', 'uv', 'rain'];

function targetLabel(t: ExploreTarget, lookup: LabelLookup): string {
  switch (t.kind) {
    case 'item': return t.minSev !== undefined ? `${lookup.item(t.key)} (severity ${t.minSev}+)` : lookup.item(t.key);
    case 'flare': return 'Flare days';
    case 'dose': return `${t.status === 'skipped' ? 'Skipped' : 'Took all of'} ${lookup.med(t.medicationId) ?? 'medicine'}`;
    case 'metric': {
      const def = lookup.metric(t.id);
      return `${def?.label ?? t.id} ${t.op === 'lt' ? 'under' : 'over'} ${t.value}${def?.unit ? ` ${def.unit}` : ''}`;
    }
    case 'rise': return `${t.key === 'symptom_max' ? 'Symptoms' : lookup.item(t.key)} higher than usual`;
    case 'period': return `${t.from} to ${t.to}`;
  }
}

export function explore(rowsIn: DayMetricRow[], spec: ExploreSpec, lookup: LabelLookup, config: ExploreConfig = EXPLORE_CONFIG): ExploreResult {
  const rows = [...rowsIn].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const { target, direction } = spec;
  const caveats: string[] = ['together_not_cause'];

  if (target.kind === 'period') return explorePeriod(rows, target, lookup);

  const tSeries = targetSeries(rows, target, lookup);
  const hitDays = rows.filter((_, i) => tSeries[i].hit).map(r => r.dayKey);
  const targetInfo = {
    label: targetLabel(target, lookup),
    days: hitDays.length,
    observedDays: tSeries.filter(p => p.observed).length,
    firstDay: hitDays[0] ?? null,
    lastDay: hitDays[hitDays.length - 1] ?? null,
  };
  if (target.kind === 'rise') caveats.push('rise_baseline');
  if (target.kind === 'dose') caveats.push('unmarked_left_out');

  const targetGroup = target.kind === 'item' || target.kind === 'rise'
    ? rows.flatMap(r => r.items ?? []).find(i => i.key === target.key)?.group
    : undefined;

  const candidates = [...itemCandidates(rows, direction, lookup), ...extraCandidates(rows, lookup)]
    .filter(c => !sameThing(target, targetGroup, c));
  const notEnough: ExploreResult['notEnough'] = [];

  const tests: Test[] = [];
  for (const cand of candidates) {
    if (cand.days < config.minCandidateDays) {
      if (cand.days > 0) notEnough.push({ key: cand.key, label: cand.label, days: cand.days });
      continue;
    }
    // before: candidate first, target after. after: target first, candidate after.
    const x = direction === 'before' ? cand.series : tSeries;
    const y = direction === 'before' ? tSeries : cand.series;
    let anyEligible = false;
    for (const lag of config.lags) {
      const pairs = buildPairs(x, y, lag);
      const { a, b, c, d } = counts(pairs);
      if (pairs.length < config.minPairs || a + b < config.minExposedDays || c + d < config.minUnexposedDays || a + c < config.minOutcomeDays) continue;
      anyEligible = true;
      const pMore = fisherGreater(a, b, c, d);
      const pLess = fisherGreater(c, d, a, b);
      const way: 'more' | 'less' = pMore <= pLess ? 'more' : 'less';
      const p1 = (a + 0.5) / (a + b + 1);
      const p0 = (c + 0.5) / (c + d + 1);
      tests.push({
        cand, lag, pairs, x, y, a, b, c, d,
        p: Math.min(1, 2 * Math.min(pMore, pLess)),
        way,
        logRR: Math.log(p1 / p0),
        se2: 1 / (a + 0.5) - 1 / (a + b + 1) + 1 / (c + 0.5) - 1 / (c + d + 1),
        shrunkRR: 1, q: 1,
      });
    }
    if (!anyEligible) notEnough.push({ key: cand.key, label: cand.label, days: cand.days });
  }

  const symptomTarget = target.kind === 'flare' || target.kind === 'rise'
    || (target.kind === 'item' && rows.some(r => findItem(r, target.key)?.outcome));
  // Numbers on the target days vs other days (sleep the night before, steps, weather…).
  const numericTests: Array<{ def: MetricDef; lag: 0 | 1; with: number[]; other: number[]; p: number }> = [];
  for (const id of NUMERIC_IDS) {
    if (target.kind === 'metric' && target.id === id) continue;
    const def = lookup.metric(id);
    if (!def) continue;
    const vals = dailyValues(def, rows, firstSeenDay(def, rows));
    for (const lag of [0, 1] as const) {
      // Same-day symptom numbers on a symptom question are the question itself, not something around it.
      if (lag === 0 && symptomTarget && SYMPTOM_METRICS.has(id)) continue;
      const w: number[] = [];
      const o: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        if (!tSeries[i].observed) continue;
        // before: the number on the day of (lag 0) or the day before (lag 1) the target day.
        // after: the number on the target day (lag 0) or the day after it (lag 1).
        const j = direction === 'before' ? i - lag : i + lag;
        const v = vals[j];
        if (v === null || v === undefined) continue;
        (tSeries[i].hit ? w : o).push(v);
      }
      if (w.length < config.minNumericPerGroup || o.length < config.minNumericPerGroup) continue;
      numericTests.push({ def, lag, with: w, other: o, p: mannWhitneyU(w, o).p });
    }
  }

  // One pool for everything asked in this question.
  const q = benjaminiHochberg([...tests.map(t => t.p), ...numericTests.map(t => t.p)]);
  tests.forEach((t, i) => { t.q = q[i]; });

  const tau2 = tests.length >= 3
    ? Math.max(config.minTau2, variance(tests.map(t => t.logRR)) - mean(tests.map(t => t.se2)))
    : config.defaultTau2;
  for (const t of tests) t.shrunkRR = Math.exp(t.logRR * (tau2 / (tau2 + t.se2)));

  const findings: BinaryFinding[] = [];
  const unclear: ExploreResult['unclear'] = [];
  for (const t of tests) {
    const raw = rd(t.a, t.b, t.c, t.d);
    const adj = adjustedRD(t.pairs, config.engagementStrata);
    const survives = raw !== 0 && Math.sign(adj) === Math.sign(raw) && Math.abs(adj) >= 0.5 * Math.abs(raw);
    const big = t.way === 'more' ? t.shrunkRR >= config.possible.shrunkRR : t.shrunkRR <= 1 / config.possible.shrunkRR;
    let tier: Tier = 'none';
    if (t.q < config.possible.q && big && survives) {
      tier = 'possible';
      const cp = circularP(t.x, t.y, t.lag, raw, config.circularMinShift);
      const halves = halvesAgree(t.pairs, config.minHalfDays, raw > 0);
      if (t.q < config.consistent.q && cp !== null && cp < config.consistent.circularP && halves === true) tier = 'consistent';
    }
    const base = {
      key: t.cand.key, label: t.cand.label, lag: t.lag,
      a: t.a, b: t.b, c: t.c, d: t.d,
      rateWith: Math.round(rate(t.a, t.a + t.b) * 1000) / 1000,
      rateOther: Math.round(rate(t.c, t.c + t.d) * 1000) / 1000,
    };
    if (tier === 'none') { unclear.push(base); continue; }

    const flags: Flag[] = [];
    if (t.lag === 0 && t.a > 0 && t.pairs.filter(p => p.exposed && p.outcome && p.together).length >= 0.5 * t.a) flags.push('logged_together');
    if (direction === 'after' && t.lag !== 'w3') {
      // Was the item already more common the day BEFORE the target days? Then the target
      // probably isn't what came first.
      const dayBefore = t.y.map((_, i) => t.y[i - 1] ?? { observed: false, hit: false, other: 0 });
      const before = counts(buildPairs(t.x, dayBefore, 0));
      if (before.a + before.b > 0 && before.c + before.d > 0 && rd(before.a, before.b, before.c, before.d) >= 0.5 * raw && raw > 0) flags.push('already_before');
    }
    if (direction === 'before' && t.cand.series.filter(p => p.reactive).length >= 0.5 * t.cand.days) flags.push('often_after_symptom');
    findings.push({ ...base, type: t.cand.type, way: t.way, shrunkRR: Math.round(t.shrunkRR * 100) / 100, q: Math.round(t.q * 10000) / 10000, tier, flags });
  }

  // Keep the strongest lag per item; order consistent first, then by q.
  const best = new Map<string, BinaryFinding>();
  for (const f of findings) {
    const prev = best.get(f.key);
    if (!prev || tierRank(f.tier) > tierRank(prev.tier) || (tierRank(f.tier) === tierRank(prev.tier) && f.q < prev.q)) best.set(f.key, f);
  }
  // A whole category ("Food & Drink (any)") repeats what its own option already shows: keep the option.
  const groupOf = new Map(candidates.map(c => [c.key, c.group]));
  for (const [key, f] of [...best.entries()]) {
    if (!key.startsWith('cat_')) continue;
    const covered = [...best.keys()].some(k => k !== key && k.startsWith('opt_') && groupOf.get(k) === groupOf.get(key));
    if (covered) {
      best.delete(key);
      unclear.push({ key: f.key, label: f.label, lag: f.lag, a: f.a, b: f.b, c: f.c, d: f.d, rateWith: f.rateWith, rateOther: f.rateOther });
    }
  }
  const sortedFindings = [...best.values()].sort((x, y) => tierRank(y.tier) - tierRank(x.tier) || x.q - y.q);
  const shownKeys = new Set(sortedFindings.map(f => f.key));
  const unclearBest = new Map<string, ExploreResult['unclear'][number]>();
  for (const u of unclear) if (!shownKeys.has(u.key) && !unclearBest.has(u.key)) unclearBest.set(u.key, u);

  const numeric: NumericFinding[] = numericTests.map((t, i) => {
    const qq = q[tests.length + i];
    const shift = hodgesLehmannShift(t.other, t.with);
    const tier: Tier = qq < config.consistent.q ? 'consistent' : qq < config.possible.q ? 'possible' : 'none';
    return {
      id: t.def.id, label: t.def.label, unit: t.def.unit, lag: t.lag,
      medianWith: round(median(t.with), t.def.decimals), medianOther: round(median(t.other), t.def.decimals),
      shift: round(shift, t.def.decimals), nWith: t.with.length, nOther: t.other.length,
      q: Math.round(qq * 10000) / 10000, tier,
    };
  });
  // One row per metric: the lag with the smaller q.
  const numBest = new Map<string, NumericFinding>();
  for (const n of numeric) { const p = numBest.get(n.id); if (!p || n.q < p.q) numBest.set(n.id, n); }

  if (tests.length + numericTests.length >= 20) caveats.push('many_checked');
  if (targetInfo.days < 8) caveats.push('few_target_days');

  return {
    target: targetInfo,
    direction,
    findings: sortedFindings,
    numeric: [...numBest.values()].sort((x, y) => tierRank(y.tier) - tierRank(x.tier) || x.q - y.q),
    unclear: [...unclearBest.values()].slice(0, 40),
    notEnough: notEnough.sort((x, y) => y.days - x.days).slice(0, 20),
    checkedCount: tests.length + numericTests.length,
    caveats,
  };
}

const tierRank = (t: Tier) => (t === 'consistent' ? 2 : t === 'possible' ? 1 : 0);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** A chosen stretch of days vs the same number of days just before it. */
function explorePeriod(rows: DayMetricRow[], t: { from: string; to: string }, lookup: LabelLookup): ExploreResult {
  const inP = rows.filter(r => r.dayKey >= t.from && r.dayKey <= t.to);
  const len = inP.length;
  const firstIdx = rows.findIndex(r => r.dayKey >= t.from);
  const prev = firstIdx > 0 ? rows.slice(Math.max(0, firstIdx - len), firstIdx) : [];
  const caveats = ['together_not_cause', 'period_rtm'];
  const period = { from: t.from, to: t.to, prevFrom: prev[0]?.dayKey ?? t.from, prevTo: prev[prev.length - 1]?.dayKey ?? t.from };

  const loggedIn = inP.filter(r => r.logged?.any);
  const loggedPrev = prev.filter(r => r.logged?.any);
  const keys = new Map<string, { group?: string }>();
  for (const r of [...inP, ...prev]) for (const it of r.items ?? []) keys.set(it.key, { group: it.group });

  type T = { key: string; label: string; a: number; b: number; c: number; d: number; p: number; way: 'more' | 'less' };
  const tests: T[] = [];
  for (const key of keys.keys()) {
    const a = loggedIn.filter(r => (findItem(r, key)?.count ?? 0) > 0).length;
    const c = loggedPrev.filter(r => (findItem(r, key)?.count ?? 0) > 0).length;
    const b = loggedIn.length - a;
    const d = loggedPrev.length - c;
    if (a + c < 4 || loggedIn.length < 5 || loggedPrev.length < 5) continue;
    const pMore = fisherGreater(a, b, c, d);
    const pLess = fisherGreater(c, d, a, b);
    tests.push({ key, label: lookup.item(key), a, b, c, d, p: Math.min(1, 2 * Math.min(pMore, pLess)), way: pMore <= pLess ? 'more' : 'less' });
  }
  const numericTests: Array<{ def: MetricDef; w: number[]; o: number[]; p: number }> = [];
  for (const def of BUILT_IN_METRICS) {
    const all = [...prev, ...inP];
    const vals = dailyValues(def, all, firstSeenDay(def, all));
    const o = vals.slice(0, prev.length).filter((v): v is number => v !== null);
    const w = vals.slice(prev.length).filter((v): v is number => v !== null);
    if (w.length < 5 || o.length < 5) continue;
    numericTests.push({ def, w, o, p: mannWhitneyU(w, o).p });
  }
  const q = benjaminiHochberg([...tests.map(x => x.p), ...numericTests.map(x => x.p)]);
  const findings: BinaryFinding[] = [];
  const unclear: ExploreResult['unclear'] = [];
  tests.forEach((x, i) => {
    const base = { key: x.key, label: x.label, lag: 0 as LagKey, a: x.a, b: x.b, c: x.c, d: x.d, rateWith: round(rate(x.a, x.a + x.b), 3), rateOther: round(rate(x.c, x.c + x.d), 3) };
    const tier: Tier = q[i] < 0.01 ? 'consistent' : q[i] < 0.1 ? 'possible' : 'none';
    if (tier === 'none') unclear.push(base);
    else findings.push({ ...base, type: 'item', way: x.way, shrunkRR: round((x.a + 0.5) / (x.a + x.b + 1) / ((x.c + 0.5) / (x.c + x.d + 1)), 2), q: round(q[i], 4), tier, flags: [] });
  });
  const numeric: NumericFinding[] = numericTests.map((x, i) => {
    const qq = q[tests.length + i];
    return {
      id: x.def.id, label: x.def.label, unit: x.def.unit, lag: 0,
      medianWith: round(median(x.w), x.def.decimals), medianOther: round(median(x.o), x.def.decimals),
      shift: round(hodgesLehmannShift(x.o, x.w), x.def.decimals), nWith: x.w.length, nOther: x.o.length,
      q: round(qq, 4), tier: qq < 0.01 ? 'consistent' : qq < 0.1 ? 'possible' : 'none',
    };
  });
  return {
    target: { label: `${t.from} to ${t.to}`, days: len, observedDays: loggedIn.length, firstDay: inP[0]?.dayKey ?? null, lastDay: inP[len - 1]?.dayKey ?? null },
    direction: 'before',
    findings: findings.sort((x, y) => tierRank(y.tier) - tierRank(x.tier) || x.q - y.q),
    numeric: numeric.sort((x, y) => tierRank(y.tier) - tierRank(x.tier) || x.q - y.q),
    unclear: unclear.slice(0, 40),
    notEnough: [],
    checkedCount: tests.length + numericTests.length,
    caveats,
    period,
  };
}

// ── Detail for one finding: both day rows, and the days where they lined up ─────

export type DayState = 'hit' | 'none' | 'unknown';

export interface FindingDays {
  days: string[];
  target: DayState[];
  item: DayState[];
  /** Target days that had the item at the finding's lag (before) / item days after the target (after). */
  matches: Array<{ targetDay: string; itemDay: string }>;
}

export function findingDays(rowsIn: DayMetricRow[], spec: ExploreSpec, key: string, lag: LagKey, lookup: LabelLookup): FindingDays | null {
  const rows = [...rowsIn].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const t = targetSeries(rows, spec.target, lookup);
  const cand = [...itemCandidates(rows, spec.direction, lookup), ...extraCandidates(rows, lookup)].find(c => c.key === key);
  if (!cand) return null;
  const state = (p: Point): DayState => (!p.observed ? 'unknown' : p.hit ? 'hit' : 'none');
  const matches: FindingDays['matches'] = [];
  const offsets = lag === 'w3' ? [1, 2, 3] : [lag];
  for (let i = 0; i < rows.length; i++) {
    for (const off of offsets) {
      if (spec.direction === 'before') {
        // item on day i - off, target on day i
        if (t[i].hit && cand.series[i - off]?.hit) { matches.push({ targetDay: rows[i].dayKey, itemDay: rows[i - off].dayKey }); break; }
      } else if (t[i].hit && cand.series[i + off]?.hit) {
        matches.push({ targetDay: rows[i].dayKey, itemDay: rows[i + off].dayKey });
        break;
      }
    }
  }
  return { days: rows.map(r => r.dayKey), target: t.map(state), item: cand.series.map(state), matches: matches.slice(-60).reverse() };
}
