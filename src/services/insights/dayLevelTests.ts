/**
 * Compares days WITH an exposure to days WITHOUT it, one exposure and one symptom at a time.
 *
 * For lag L, the pairs are (exposure on day d, symptom on day d + L). A pair is used only when
 * the member was logging on both days (`exposureObserved` on d, `symptomObserved` on d + L), so a
 * silent day is never read as "no symptom". Each test reports counts a/b/c/d, a risk difference,
 * a shrunken risk ratio, and the evidence measures the tiers are decided from.
 */
import { DayRow } from './dayTable';
import { InsightConfig } from './insightConfig';
import { benjaminiHochberg, fisherGreater, mean, probabilityHigher, variance } from './stats';

export type Tier = 'still_learning' | 'possible' | 'consistent';

export interface TestResult {
  exposureKey: string;
  exposureLabel: string;
  outcomeKey: string;
  outcomeLabel: string;
  lagDays: number;
  /** exposed & symptom, exposed & none, unexposed & symptom, unexposed & none */
  a: number; b: number; c: number; d: number;
  pairs: number;
  prevalence: number;
  riskDifference: number;
  logRR: number;
  se2: number;
  shrunkRR: number;
  fisherP: number;
  /** Probability the symptom rate really is higher on exposure days; null when screened out. */
  pHigher: number | null;
  q: number;
  /** Risk difference after matching on how much else was logged that day. */
  adjustedRD: number;
  survivesAdjustment: boolean;
  circularP: number | null;
  halvesAgree: boolean | null;
  weakShare: number;
  tier: Tier;
}

interface Pair { exposed: boolean; outcome: boolean; other: number; weak: boolean; index: number }

const labelOf = (m: Map<string, string>, key: string) => m.get(key) ?? key;

/** Days where this exposure happened, among days the member logged anything. */
function exposureSeries(rows: DayRow[], key: string) {
  return rows.map(r => {
    const hit = r.exposures.find(e => e.key === key);
    return {
      observed: r.exposureObserved,
      exposed: !!hit && hit.count > 0,
      // Entries other than this exposure's own, so busy-day logging is compared fairly
      other: Math.max(0, r.nonSymptomEntries - (hit ? hit.count + hit.afterSymptomCount : 0)),
    };
  });
}

function outcomeSeries(rows: DayRow[], key: string) {
  return rows.map(r => ({
    observed: r.symptomObserved,
    present: r.symptoms.some(s => s.key === key && s.present),
    weak: r.observedBasis === 'weak',
  }));
}

function buildPairs(
  expo: ReturnType<typeof exposureSeries>,
  out: ReturnType<typeof outcomeSeries>,
  lag: number,
): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i + lag < expo.length; i++) {
    const e = expo[i];
    const o = out[i + lag];
    if (!e.observed || !o.observed) continue;
    pairs.push({ exposed: e.exposed, outcome: o.present, other: e.other, weak: o.weak, index: i });
  }
  return pairs;
}

function counts(pairs: Pair[]) {
  let a = 0, b = 0, c = 0, d = 0;
  for (const p of pairs) {
    if (p.exposed) { if (p.outcome) a++; else b++; }
    else if (p.outcome) c++; else d++;
  }
  return { a, b, c, d };
}

const rate = (hit: number, n: number) => (n > 0 ? hit / n : 0);
const riskDifference = (a: number, b: number, c: number, d: number) => rate(a, a + b) - rate(c, c + d);

/** Mantel-Haenszel risk difference across bands of "other things logged that day". */
function adjustedRiskDifference(pairs: Pair[], bands: number): number {
  if (pairs.length === 0) return 0;
  const sorted = pairs.map(p => p.other).sort((x, y) => x - y);
  const cuts = Array.from({ length: bands - 1 }, (_, i) => sorted[Math.floor(((i + 1) * sorted.length) / bands)]);
  const strata: Pair[][] = Array.from({ length: bands }, () => []);
  for (const p of pairs) strata[cuts.filter(c => p.other >= c).length].push(p);

  let weighted = 0;
  let weights = 0;
  for (const s of strata) {
    const { a, b, c, d } = counts(s);
    const n1 = a + b, n0 = c + d, n = n1 + n0;
    if (n1 === 0 || n0 === 0) continue;
    const w = (n1 * n0) / n;
    weighted += w * riskDifference(a, b, c, d);
    weights += w;
  }
  return weights > 0 ? weighted / weights : 0;
}

/** How often a shifted copy of the exposure pattern does at least as well (autocorrelation-safe). */
function circularShiftP(
  expo: ReturnType<typeof exposureSeries>,
  out: ReturnType<typeof outcomeSeries>,
  lag: number,
  observedRD: number,
  minShift: number,
): number | null {
  const n = expo.length;
  if (n < 2 * minShift + 2) return null;
  let atLeast = 0;
  let total = 0;
  for (let s = minShift; s <= n - minShift; s++) {
    const shifted = expo.map((_, i) => expo[(i + s) % n]);
    const { a, b, c, d } = counts(buildPairs(shifted, out, lag));
    if (a + b === 0 || c + d === 0) continue;
    total++;
    if (riskDifference(a, b, c, d) >= observedRD - 1e-12) atLeast++;
  }
  return total === 0 ? null : (1 + atLeast) / (1 + total);
}

/** Does the association point the same way in the first and second half of the paired days? */
function halvesAgree(pairs: Pair[], minHalfDays: number): boolean | null {
  if (pairs.length < 2 * minHalfDays) return null;
  const mid = Math.floor(pairs.length / 2);
  const result = [pairs.slice(0, mid), pairs.slice(mid)].map(half => {
    const { a, b, c, d } = counts(half);
    return a + b > 0 && c + d > 0 ? riskDifference(a, b, c, d) > 0 : false;
  });
  return result[0] && result[1];
}

function shrink(results: TestResult[], config: InsightConfig): void {
  // Pull each log risk ratio toward 0 by how noisy it is, with the spread estimated per symptom
  const byOutcome = new Map<string, TestResult[]>();
  for (const r of results) byOutcome.set(r.outcomeKey, [...(byOutcome.get(r.outcomeKey) ?? []), r]);
  for (const group of byOutcome.values()) {
    const tau2 = group.length >= 3
      ? Math.max(config.minTau2, variance(group.map(g => g.logRR)) - mean(group.map(g => g.se2)))
      : config.defaultTau2;
    for (const r of group) r.shrunkRR = Math.exp(r.logRR * (tau2 / (tau2 + r.se2)));
  }
}

function decideTier(r: TestResult, config: InsightConfig): Tier {
  const p = config.possible;
  const possible = r.pHigher !== null && r.pHigher >= p.pSuperior && r.shrunkRR >= p.shrunkRR && r.q < p.q && r.survivesAdjustment;
  if (!possible) return 'still_learning';
  const c = config.consistent;
  const consistent = (r.pHigher as number) >= c.pSuperior && r.q < c.q
    && r.circularP !== null && r.circularP < c.circularP && r.halvesAgree === true;
  return consistent ? 'consistent' : 'possible';
}

export function analyseDays(
  rowsIn: DayRow[],
  config: InsightConfig,
): { results: TestResult[]; eligibleTests: number } {
  const rows = [...rowsIn].sort((x, y) => x.dayKey.localeCompare(y.dayKey));
  const exposureLabels = new Map<string, string>();
  const outcomeLabels = new Map<string, string>();
  for (const r of rows) {
    r.exposures.forEach(e => exposureLabels.set(e.key, e.label));
    r.symptoms.forEach(s => outcomeLabels.set(s.key, s.label));
  }

  const outcomes = new Map<string, ReturnType<typeof outcomeSeries>>();
  for (const key of outcomeLabels.keys()) {
    const series = outcomeSeries(rows, key);
    if (series.filter(s => s.present).length >= config.minOutcomeDays) outcomes.set(key, series);
  }

  const results: TestResult[] = [];
  const keep = new Map<TestResult, { expo: ReturnType<typeof exposureSeries>; out: ReturnType<typeof outcomeSeries>; pairs: Pair[] }>();

  for (const exposureKey of exposureLabels.keys()) {
    const expo = exposureSeries(rows, exposureKey);
    for (const [outcomeKey, out] of outcomes) {
      if (outcomeKey === exposureKey) continue;
      for (const lag of config.lags) {
        const pairs = buildPairs(expo, out, lag);
        const { a, b, c, d } = counts(pairs);
        const exposedDays = a + b;
        const unexposedDays = c + d;
        const prevalence = pairs.length ? exposedDays / pairs.length : 0;
        if (
          pairs.length < config.minPairs
          || exposedDays < config.minExposedDays
          || unexposedDays < config.minUnexposedDays
          || a + c < config.minOutcomeDays
          || prevalence < config.minPrevalence
          || prevalence > config.maxPrevalence
        ) continue;

        const p1 = (a + 0.5) / (exposedDays + 1);
        const p0 = (c + 0.5) / (unexposedDays + 1);
        const result: TestResult = {
          exposureKey, exposureLabel: labelOf(exposureLabels, exposureKey),
          outcomeKey, outcomeLabel: labelOf(outcomeLabels, outcomeKey),
          lagDays: lag, a, b, c, d, pairs: pairs.length, prevalence,
          riskDifference: riskDifference(a, b, c, d),
          logRR: Math.log(p1 / p0),
          se2: 1 / (a + 0.5) - 1 / (exposedDays + 1) + 1 / (c + 0.5) - 1 / (unexposedDays + 1),
          shrunkRR: 1,
          fisherP: fisherGreater(a, b, c, d),
          pHigher: null, q: 1,
          adjustedRD: 0, survivesAdjustment: false,
          circularP: null, halvesAgree: null,
          weakShare: pairs.filter(p => p.weak).length / pairs.length,
          tier: 'still_learning',
        };
        results.push(result);
        keep.set(result, { expo, out, pairs });
      }
    }
  }

  // Every test in the run counts toward the correction, so more tests means a stricter bar
  const q = benjaminiHochberg(results.map(r => r.fisherP));
  results.forEach((r, i) => { r.q = q[i]; });
  shrink(results, config);

  for (const r of results) {
    const ctx = keep.get(r)!;
    if (r.fisherP > config.screenFisherP) continue;
    r.pHigher = probabilityHigher(r.a, r.a + r.b, r.c, r.c + r.d);
    r.adjustedRD = adjustedRiskDifference(ctx.pairs, config.engagementStrata);
    r.survivesAdjustment = r.adjustedRD > 0 && r.adjustedRD >= 0.5 * r.riskDifference;

    const wouldBePossible = r.pHigher >= config.possible.pSuperior && r.shrunkRR >= config.possible.shrunkRR
      && r.q < config.possible.q && r.survivesAdjustment;
    if (wouldBePossible) {
      r.circularP = circularShiftP(ctx.expo, ctx.out, r.lagDays, r.riskDifference, config.circularMinShift);
      r.halvesAgree = halvesAgree(ctx.pairs, config.minHalfDays);
    }
    r.tier = decideTier(r, config);
  }

  return { results, eligibleTests: results.length };
}
