/**
 * "Am I getting better?": a weekly trend, a good-day/bad-day count, and labelled regime shifts.
 *
 * Daily severity is noisy, so everything here works on weekly medians, not single days, and a
 * trend is only called "improving" when it is both statistically real (Mann-Kendall) and big
 * enough to matter (at least 2 points or 30%, the pain-scale "noticeable change" bar). Reusing
 * that bar for fatigue or brain fog is an extrapolation, so the wording stays soft.
 */
import { DayRow } from './dayTable';
import { shiftDayKey, weekdayOfKey } from '../../utils/dayKey';
import { logGamma, mannKendall, median, theilSenSlope } from './stats';
import { percentile } from '../flareModeService';

export const MIN_WEEKS_FOR_TREND = 6;
export const MAX_WEEKS_FOR_TREND = 12;
export const MIN_LOGGED_DAYS_PER_WEEK = 3;
export const TREND_P_THRESHOLD = 0.1;
/** The Farrar et al. pain-scale "noticeable change" bar, reused here as a rough guide. */
export const MIN_MEANINGFUL_POINTS = 2;
export const MIN_MEANINGFUL_FRACTION = 0.3;
export const STEADY_IQR_MAX = 2;
export const GOOD_BAD_WINDOW_DAYS = 28;
export const BASELINE_WINDOW_DAYS = 90;

export type TrendState = 'improving' | 'worsening' | 'steady' | 'mixed' | 'not_enough_data';

export interface WeeklyPoint { weekKey: string; medianValue: number; loggedDays: number }

export interface TrendResult {
  state: TrendState;
  weeks: WeeklyPoint[];
  pValue: number | null;
  /** Negative = composite fell (better) across the window; positive = it rose. */
  estimatedChange: number | null;
  baseline: number | null;
  weeksNeeded: number;
}

export interface GoodBadDays {
  good: number;
  bad: number;
  observed: number;
  windowDays: number;
  goodCutoff: number | null;
  badCutoff: number | null;
}

export interface RegimeShift { dayKey: string; direction: 'up' | 'down' }

/** The single number a trend is computed on: the member's own 0-10 rating, or the worst symptom that day. */
export function dailyComposite(row: DayRow): number | null {
  if (row.patientGlobal !== null) return row.patientGlobal;
  if (row.symptomMax !== null) return row.symptomMax;
  return null;
}

/** The Monday that starts the week `dayKey` falls in. */
export function weekKeyOf(dayKey: string): string {
  const weekday = weekdayOfKey(dayKey); // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7;
  return shiftDayKey(dayKey, -sinceMonday);
}

/** One median per week that has at least `minLoggedDays` days with a composite value. */
export function weeklyMedians(rows: DayRow[], minLoggedDays = MIN_LOGGED_DAYS_PER_WEEK): WeeklyPoint[] {
  const byWeek = new Map<string, number[]>();
  for (const r of rows) {
    const v = dailyComposite(r);
    if (v === null) continue;
    const k = weekKeyOf(r.dayKey);
    byWeek.set(k, [...(byWeek.get(k) ?? []), v]);
  }
  return Array.from(byWeek.entries())
    .filter(([, values]) => values.length >= minLoggedDays)
    .map(([weekKey, values]) => ({ weekKey, medianValue: median(values), loggedDays: values.length }))
    .sort((a, b) => a.weekKey.localeCompare(b.weekKey));
}

function iqr(values: number[]): number {
  if (values.length < 4) return 0;
  return percentile(values, 0.75) - percentile(values, 0.25);
}

/**
 * Classifies the trend over the most recent `maxWeeks` weeks of data (at least `minWeeks` needed).
 * "Improving"/"worsening" need a real, Mann-Kendall-significant trend AND a big enough estimated
 * change; "steady" needs no real trend and a tight spread; anything else is reported as "mixed"
 * rather than forcing a label onto a shape that doesn't fit either.
 */
export function classifyTrend(
  allWeeks: WeeklyPoint[],
  minWeeks = MIN_WEEKS_FOR_TREND,
  maxWeeks = MAX_WEEKS_FOR_TREND,
): TrendResult {
  const weeks = allWeeks.slice(-maxWeeks);
  if (weeks.length < minWeeks) {
    return { state: 'not_enough_data', weeks, pValue: null, estimatedChange: null, baseline: null, weeksNeeded: minWeeks - weeks.length };
  }
  const values = weeks.map(w => w.medianValue);
  const { p } = mannKendall(values);
  const slope = theilSenSlope(values);
  const estimatedChange = slope * (values.length - 1);
  const baseline = median(values);
  const threshold = Math.max(MIN_MEANINGFUL_POINTS, MIN_MEANINGFUL_FRACTION * baseline);

  let state: TrendState;
  if (p < TREND_P_THRESHOLD) {
    if (estimatedChange <= -threshold) state = 'improving';
    else if (estimatedChange >= threshold) state = 'worsening';
    else state = 'mixed';
  } else {
    state = iqr(values) < STEADY_IQR_MAX ? 'steady' : 'mixed';
  }
  return { state, weeks, pValue: p, estimatedChange, baseline, weeksNeeded: 0 };
}

/**
 * Good and bad days in the trailing window, judged against the member's own recent spread
 * (25th/75th percentile of their last `baselineWindowDays`), not a fixed number. A flare day is
 * always "bad", whatever its composite score was.
 */
export function goodBadDays(
  rows: DayRow[],
  flareDayKeys: ReadonlySet<string>,
  windowDays = GOOD_BAD_WINDOW_DAYS,
  baselineWindowDays = BASELINE_WINDOW_DAYS,
): GoodBadDays {
  const sorted = [...rows].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const lastDay = sorted[sorted.length - 1]?.dayKey;
  if (!lastDay) return { good: 0, bad: 0, observed: 0, windowDays, goodCutoff: null, badCutoff: null };

  const baselineStart = shiftDayKey(lastDay, -baselineWindowDays);
  const baselineValues = sorted
    .filter(r => r.dayKey >= baselineStart && r.symptomObserved)
    .map(dailyComposite)
    .filter((v): v is number => v !== null);
  if (baselineValues.length < MIN_LOGGED_DAYS_PER_WEEK * 2) {
    return { good: 0, bad: 0, observed: 0, windowDays, goodCutoff: null, badCutoff: null };
  }
  const goodCutoff = percentile(baselineValues, 0.25);
  const badCutoff = percentile(baselineValues, 0.75);

  const windowStart = shiftDayKey(lastDay, -windowDays + 1);
  const windowRows = sorted.filter(r => r.dayKey >= windowStart && r.symptomObserved);

  let good = 0, bad = 0;
  for (const r of windowRows) {
    const flare = flareDayKeys.has(r.dayKey);
    const v = dailyComposite(r);
    if (flare || (v !== null && v >= badCutoff)) bad++;
    else if (!flare && v !== null && v <= goodCutoff) good++;
  }
  return { good, bad, observed: windowRows.length, windowDays, goodCutoff, badCutoff };
}

/**
 * Bayesian online change-point detection (Adams & MacKay 2007) on the daily composite, with a
 * Normal-Gamma conjugate prior. Used only to LABEL a shift in the member's own normal ("since
 * about 10 Oct your fatigue has run higher"); it is never an alert and has no notification budget.
 */
export function regimeShifts(
  rows: DayRow[],
  hazard = 1 / 30,
  maxRunLength = 120,
): RegimeShift[] {
  const points = rows
    .map(r => ({ dayKey: r.dayKey, value: dailyComposite(r) }))
    .filter((p): p is { dayKey: string; value: number } => p.value !== null);
  if (points.length < 10) return [];

  // Normal-Gamma hyperparameters per hypothesised run length: (mu0, kappa0, alpha0, beta0)
  let mu0 = 0, kappa0 = 1, alpha0 = 1, beta0 = 1;
  const seed = points.slice(0, Math.min(10, points.length)).map(p => p.value);
  mu0 = median(seed);
  beta0 = Math.max(0.25, variance0(seed));

  let runLenProbs = [1];
  let mus = [mu0], kappas = [kappa0], alphas = [alpha0], betas = [beta0];
  const shifts: RegimeShift[] = [];

  for (let t = 0; t < points.length; t++) {
    const x = points[t].value;
    const pred = runLenProbs.map((_, r) => studentTPdf(x, mus[r], (betas[r] * (kappas[r] + 1)) / (alphas[r] * kappas[r]), 2 * alphas[r]));

    const growth = runLenProbs.map((p, r) => p * pred[r] * (1 - hazard));
    const cpMass = runLenProbs.reduce((acc, p, r) => acc + p * pred[r] * hazard, 0);

    let nextProbs = [cpMass, ...growth];
    const total = nextProbs.reduce((a, b) => a + b, 0) || 1;
    nextProbs = nextProbs.map(p => p / total);

    // Update sufficient statistics for every surviving run length, plus a fresh one for run length 0
    const nextMus = [mu0, ...mus.map((mu, r) => (kappas[r] * mu + x) / (kappas[r] + 1))];
    const nextKappas = [kappa0, ...kappas.map(k => k + 1)];
    const nextAlphas = [alpha0, ...alphas.map(a => a + 0.5)];
    const nextBetas = [beta0, ...betas.map((b, r) => b + (kappas[r] * (x - mus[r]) ** 2) / (2 * (kappas[r] + 1)))];

    if (nextProbs.length > maxRunLength + 1) {
      nextProbs = nextProbs.slice(0, maxRunLength + 1);
      nextMus.length = maxRunLength + 1; nextKappas.length = maxRunLength + 1;
      nextAlphas.length = maxRunLength + 1; nextBetas.length = maxRunLength + 1;
    }

    // Most likely run length right now; a sharp drop to near 0 means "today looks like a new regime"
    let maxAt = 0;
    for (let r = 1; r < nextProbs.length; r++) if (nextProbs[r] > nextProbs[maxAt]) maxAt = r;
    if (t > 0 && maxAt <= 1 && nextProbs[maxAt] > 0.2) {
      const prevMean = mus[Math.min(runLenProbs.indexOf(Math.max(...runLenProbs)), mus.length - 1)];
      shifts.push({ dayKey: points[t].dayKey, direction: x > prevMean ? 'up' : 'down' });
    }

    runLenProbs = nextProbs; mus = nextMus; kappas = nextKappas; alphas = nextAlphas; betas = nextBetas;
  }
  return shifts;
}

function variance0(xs: number[]): number {
  if (xs.length < 2) return 1;
  const m = mean0(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
}
const mean0 = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Student-t density, the Normal-Gamma predictive distribution's closed form. */
function studentTPdf(x: number, mu: number, scale2: number, dof: number): number {
  const scale = Math.sqrt(Math.max(scale2, 1e-9));
  const t = (x - mu) / scale;
  const num = gammaRatio(dof);
  return (num / (Math.sqrt(dof * Math.PI) * scale)) * Math.pow(1 + (t * t) / dof, -(dof + 1) / 2);
}

/** Gamma((v+1)/2) / Gamma(v/2), via logGamma to stay numerically stable for larger v. */
function gammaRatio(v: number): number {
  return Math.exp(logGamma((v + 1) / 2) - logGamma(v / 2));
}
