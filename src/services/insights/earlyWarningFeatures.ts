/**
 * The small pieces early warning is built from: a robust z-score against the member's own recent
 * baseline, a one-sided CUSUM for slow drifts a single bad day would miss, and the 7-day feature
 * vector used to judge whether the last week "resembles" the run-up to a past flare.
 *
 * Everything here reads only data up to and including the day being scored, so the exact same
 * function can run live and inside the backtest without a different code path.
 */
import { DayRow } from './dayTable';
import { dailyComposite } from './progress';
import { shiftDayKey } from '../../utils/dayKey';
import { median, scaledMad } from './stats';

export const BASELINE_WINDOW_DAYS = 28;
export const MIN_BASELINE_VALUES = 10;
/** A steady run of identical scores should not look infinitely significant. */
export const MAD_FLOOR = 0.5;

/** (current - median) / scaled MAD, against `baseline`. Null when the baseline is too thin. */
export function robustZ(current: number, baseline: number[]): number | null {
  if (baseline.length < MIN_BASELINE_VALUES) return null;
  const mad = Math.max(scaledMad(baseline), MAD_FLOOR);
  return (current - median(baseline)) / mad;
}

export interface CusumConfig { k: number; h: number }
export const DEFAULT_CUSUM: CusumConfig = { k: 0.5, h: 4.5 };

/**
 * One-sided CUSUM over a z-score series (nulls pass through unchanged). `S` resets to 0 right
 * after firing, so a single sustained drift raises one alert, not one every day it stays high.
 */
export function cusum(zValues: Array<number | null>, config: CusumConfig = DEFAULT_CUSUM): { s: number; alert: boolean }[] {
  let s = 0;
  const out: { s: number; alert: boolean }[] = [];
  for (const z of zValues) {
    if (z === null) { out.push({ s, alert: false }); continue; }
    s = Math.max(0, s + z - config.k);
    const alert = s > config.h;
    out.push({ s, alert });
    if (alert) s = 0;
  }
  return out;
}

/** Day keys of a trailing window of `days` days ending at (and including) `endDay`. */
function trailingWindow(endDay: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => shiftDayKey(endDay, -(days - 1) + i));
}

export interface ResemblanceVector {
  severityMean: number | null;
  severityMax: number | null;
  /** Theil-Sen-free slope proxy: last value minus first, over the window. */
  severitySlope: number | null;
  steps: number | null;
  sleepHours: number | null;
  sleepMidpoint: number | null;
  /** Share of the 7 days that were actually logged — a thin window is a weaker read. */
  loggedShare: number;
}

/** Minutes after local midnight of a wake time, using its own UTC clock face (the day table already localises it). */
function minuteOfDay(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** The raw (unstandardised) 7-day feature vector ending on `endDay`. */
export function featureVector(rows: DayRow[], endDay: string, windowDays = 7): ResemblanceVector {
  const byDay = new Map(rows.map(r => [r.dayKey, r]));
  const days = trailingWindow(endDay, windowDays).map(k => byDay.get(k));

  const severities: Array<{ day: number; value: number }> = [];
  const steps: number[] = [];
  const sleepHours: number[] = [];
  const sleepMid: number[] = [];
  let logged = 0;

  days.forEach((r, i) => {
    if (!r) return;
    if (r.symptomObserved) {
      logged++;
      const v = dailyComposite(r);
      if (v !== null) severities.push({ day: i, value: v });
    }
    if (r.steps !== null) steps.push(r.steps);
    if (r.sleepHours !== null) sleepHours.push(r.sleepHours);
    if (r.wakeTime) sleepMid.push(minuteOfDay(new Date(r.wakeTime)));
  });

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return {
    severityMean: severities.length ? mean(severities.map(s => s.value)) : null,
    severityMax: severities.length ? Math.max(...severities.map(s => s.value)) : null,
    severitySlope: severities.length >= 2 ? severities[severities.length - 1].value - severities[0].value : null,
    steps: mean(steps),
    sleepHours: mean(sleepHours),
    sleepMidpoint: mean(sleepMid),
    loggedShare: logged / windowDays,
  };
}

export const VECTOR_KEYS: Array<keyof ResemblanceVector> = [
  'severityMean', 'severityMax', 'severitySlope', 'steps', 'sleepHours', 'sleepMidpoint',
];

/** Standardises a vector against a set of reference vectors' per-feature median/MAD. Missing features drop out. */
export function standardize(v: ResemblanceVector, reference: ResemblanceVector[]): number[] {
  return VECTOR_KEYS.map(key => {
    const x = v[key];
    if (x === null) return 0; // a missing feature contributes nothing rather than crashing the comparison
    const values = reference.map(r => r[key]).filter((n): n is number => n !== null);
    if (values.length < 5) return 0;
    const mad = Math.max(scaledMad(values), MAD_FLOOR);
    return (x - median(values)) / mad;
  });
}

/** Cosine similarity in standardised feature space; 1 = identical direction and scale, 0 = unrelated. */
export function vectorSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
