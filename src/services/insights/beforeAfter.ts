/**
 * "Did my change help?": compares a fixed window before an event (a new medicine, cutting out a
 * food) with a window after it, skipping a washout period. Two honest caveats are checked
 * automatically, because a plain before/after comparison is easy to over-read: regression to the
 * mean (things often improve on their own right after a bad patch) and a trend that was already
 * under way before the change.
 */
import { DayRow } from './dayTable';
import { dailyComposite, weekKeyOf } from './progress';
import { shiftDayKey, daysBetween } from '../../utils/dayKey';
import { hodgesLehmannShift, mannKendall, median, theilSenSlope } from './stats';
import { percentile } from '../flareModeService';

export const PRE_WINDOW_DAYS = 28;
export const POST_WINDOW_DAYS = 28;
export const DEFAULT_WASHOUT_DAYS = 7;
export const MIN_OBSERVED_PER_SIDE = 14;
export const BOOTSTRAP_RESAMPLES = 1000;
export const BLOCK_DAYS = 7;

export type CompareReason =
  | 'not_enough_pre_data'
  | 'not_enough_post_data'
  | 'event_too_recent';

export interface CompareOutcome {
  /** post - pre; negative means fewer/lower on the outcome after the change. */
  value: number;
  ci95: [number, number];
}

export interface CompareResult {
  ready: true;
  eventDay: string;
  washoutDays: number;
  preDays: number;
  postDays: number;
  preFlares: number;
  postFlares: number;
  symptomDayRate: CompareOutcome;
  medianShift: CompareOutcome;
  flaresPer28: CompareOutcome;
  startedDuringRoughPatch: boolean;
  alreadyImproving: boolean;
}

export interface CompareNotReady {
  ready: false;
  reason: CompareReason;
  preDays: number;
  postDays: number;
  needed: number;
}

interface Period { composite: number[]; symptomDay: boolean[]; flares: number; days: number }

function periodStats(rows: DayRow[], from: string, to: string, flareCount: number): Period {
  const inWindow = rows.filter(r => r.dayKey >= from && r.dayKey <= to && r.symptomObserved);
  return {
    composite: inWindow.map(dailyComposite).filter((v): v is number => v !== null),
    symptomDay: inWindow.map(r => r.symptomPresent),
    flares: flareCount,
    days: inWindow.length,
  };
}

/** A deterministic seed from the inputs, so the same request gives the same bootstrap interval. */
function seedFrom(eventDay: string, washoutDays: number, preN: number, postN: number): number {
  const s = `${eventDay}|${washoutDays}|${preN}|${postN}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Resamples `n` days as whole 7-day blocks (with replacement) from `source`, to keep day-to-day autocorrelation. */
function blockResample<T>(source: T[], n: number, rand: () => number): T[] {
  if (source.length === 0) return [];
  const out: T[] = [];
  while (out.length < n) {
    const start = Math.floor(rand() * source.length);
    for (let i = 0; i < BLOCK_DAYS && out.length < n; i++) out.push(source[(start + i) % source.length]);
  }
  return out;
}

const rate = (bits: boolean[]) => (bits.length ? bits.filter(Boolean).length / bits.length : 0);

function bootstrapCi(
  pre: Period, post: Period, statOf: (p: Period, q: Period) => number, rand: () => number,
): [number, number] {
  const draws: number[] = [];
  for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) {
    const preComposite = blockResample(pre.composite, pre.composite.length || 1, rand);
    const postComposite = blockResample(post.composite, post.composite.length || 1, rand);
    const preSymptom = blockResample(pre.symptomDay, pre.symptomDay.length || 1, rand);
    const postSymptom = blockResample(post.symptomDay, post.symptomDay.length || 1, rand);
    draws.push(statOf(
      { composite: preComposite, symptomDay: preSymptom, flares: pre.flares, days: pre.days },
      { composite: postComposite, symptomDay: postSymptom, flares: post.flares, days: post.days },
    ));
  }
  draws.sort((a, b) => a - b);
  const lo = draws[Math.floor(0.025 * draws.length)];
  const hi = draws[Math.ceil(0.975 * draws.length) - 1];
  return [lo, hi];
}

/**
 * @param rows the member's day table
 * @param eventDay the Lumen day the change happened (e.g. a new medicine, or cutting out a food)
 * @param flareDaysInRange count of flare episodes starting within [from, to], supplied by the caller
 */
export function compareAroundEvent(
  rows: DayRow[],
  eventDay: string,
  countFlares: (from: string, to: string) => number,
  washoutDays = DEFAULT_WASHOUT_DAYS,
  now: string = rows.length ? rows[rows.length - 1].dayKey : eventDay,
): CompareResult | CompareNotReady {
  const preFrom = shiftDayKey(eventDay, -PRE_WINDOW_DAYS);
  const preTo = shiftDayKey(eventDay, -1);
  const washoutEnd = shiftDayKey(eventDay, washoutDays - 1);
  const postFrom = shiftDayKey(eventDay, washoutDays);
  const postTo = shiftDayKey(eventDay, washoutDays + POST_WINDOW_DAYS - 1);

  const pre = periodStats(rows, preFrom, preTo, countFlares(preFrom, preTo));
  if (pre.days < MIN_OBSERVED_PER_SIDE) {
    return { ready: false, reason: 'not_enough_pre_data', preDays: pre.days, postDays: 0, needed: MIN_OBSERVED_PER_SIDE };
  }
  if (daysBetween(washoutEnd, now) < 0) {
    return { ready: false, reason: 'event_too_recent', preDays: pre.days, postDays: 0, needed: washoutDays };
  }
  const post = periodStats(rows, postFrom, postTo <= now ? postTo : now, countFlares(postFrom, postTo));
  if (post.days < MIN_OBSERVED_PER_SIDE) {
    return { ready: false, reason: 'not_enough_post_data', preDays: pre.days, postDays: post.days, needed: MIN_OBSERVED_PER_SIDE };
  }

  const rand = mulberry32(seedFrom(eventDay, washoutDays, pre.days, post.days));
  const symptomRateStat = (a: Period, b: Period) => rate(b.symptomDay) - rate(a.symptomDay);
  const medianShiftStat = (a: Period, b: Period) => hodgesLehmannShift(a.composite, b.composite);
  const flaresStat = (a: Period, b: Period) => (b.flares * 28) / Math.max(1, b.days) - (a.flares * 28) / Math.max(1, a.days);

  const symptomDayRate: CompareOutcome = { value: symptomRateStat(pre, post), ci95: bootstrapCi(pre, post, symptomRateStat, rand) };
  const medianShift: CompareOutcome = { value: medianShiftStat(pre, post), ci95: bootstrapCi(pre, post, medianShiftStat, rand) };
  const flaresPer28: CompareOutcome = { value: flaresStat(pre, post), ci95: bootstrapCi(pre, post, flaresStat, rand) };

  // Regression to the mean: did the change happen right after an unusually bad week?
  const last7 = rows.filter(r => r.dayKey >= shiftDayKey(eventDay, -7) && r.dayKey <= preTo && r.symptomObserved)
    .map(dailyComposite).filter((v): v is number => v !== null);
  const startedDuringRoughPatch = last7.length >= 3 && pre.composite.length >= 8
    && median(last7) > percentile(pre.composite, 0.75);

  // Was the pre-period already trending down on its own?
  const preWeekly = weeklyFromDays(rows.filter(r => r.dayKey >= preFrom && r.dayKey <= preTo));
  const alreadyImproving = preWeekly.length >= 3 && (() => {
    const { p } = mannKendall(preWeekly);
    return p < 0.1 && theilSenSlope(preWeekly) < 0;
  })();

  return {
    ready: true,
    eventDay, washoutDays,
    preDays: pre.days, postDays: post.days,
    preFlares: pre.flares, postFlares: post.flares,
    symptomDayRate, medianShift, flaresPer28,
    startedDuringRoughPatch, alreadyImproving,
  };
}

/** Weekly medians of the composite for a short window, used only for the "already improving" caveat. */
function weeklyFromDays(rows: DayRow[]): number[] {
  const byWeek = new Map<string, number[]>();
  for (const r of rows) {
    const v = dailyComposite(r);
    if (v === null) continue;
    const key = weekKeyOf(r.dayKey);
    byWeek.set(key, [...(byWeek.get(key) ?? []), v]);
  }
  return Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, values]) => median(values));
}
