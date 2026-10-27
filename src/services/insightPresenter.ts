/**
 * Shapes what GET /insights returns: stored pattern results turned into the card format the app
 * shows, and the descriptive "At a glance" stats worked out from the member's own logs.
 * Everything here is descriptive. It never says what caused a symptom.
 *
 * Days are Lumen days: they start at the member's Day Reset Boundary in their time zone.
 */
import mongoose from 'mongoose';
import { LogEntry } from '../models/LogEntry';
import { Category } from '../models/Category';
import { Question } from '../models/Question';
import { Option } from '../models/Option';
import { QuickAction } from '../models/QuickAction';
import { DaySession } from '../models/DaySession';
import { DEFAULT_BOUNDARY_HOUR, resolveTimeZone, trackingDayKey, weekdayOfKey } from '../utils/dayKey';
import type { GoodBadDays, RegimeShift, TrendResult } from './insights/progress';
import type { CompareNotReady, CompareResult } from './insights/beforeAfter';

const DAY_MS = 86400000;

export interface InsightDto {
  _id: string;
  /** Ids the app matches log entries against: `opt_`, `qa_` or `cat_` prefixed. */
  triggerId: string;
  symptomId: string;
  trigger: { categoryName: string; optionLabel: string; categoryIcon?: string };
  symptom: { categoryName: string; optionLabel: string; categoryIcon?: string };
  lagWindow: string;
  lift: number;
  supportCount: number;
  confidence: 'Low' | 'Medium' | 'High';
  computedAt: string;
}

export interface DescriptiveStatDto {
  key: string;
  icon: string;
  title: string;
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | 'flat';
  trendGoodDirection?: 'up' | 'down';
  sparkValues?: number[];
  accentColor?: string;
}

interface StoredInsight {
  _id: unknown;
  triggerId: string;
  triggerLabel: string;
  symptomId: string;
  symptomLabel: string;
  lagWindowHours: number[];
  lift: number;
  occurrences: number;
  confidence: 'low' | 'medium' | 'high';
  computedAt: Date;
}

interface Source { categoryName: string; categoryIcon?: string }

const ROLE_NAME: Record<string, string> = { trigger_candidate: 'Trigger', symptom: 'Symptom', context: 'Context' };

const cap = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)) as 'Low' | 'Medium' | 'High';
const ids = (list: string[]) => list.filter(i => mongoose.isValidObjectId(i));
const suffix = (id: string) => id.slice(id.indexOf('_') + 1);

/** Category name and icon for each stored trigger/symptom id (`qa_`, `cat_` or `opt_` prefixed). */
async function lookupSources(keys: string[]): Promise<Map<string, Source>> {
  const out = new Map<string, Source>();
  const qaIds = ids(keys.filter(k => k.startsWith('qa_')).map(suffix));
  const catIds = ids(keys.filter(k => k.startsWith('cat_')).map(suffix));
  const optIds = ids(keys.filter(k => k.startsWith('opt_')).map(suffix));

  const [quick, cats, options] = await Promise.all([
    qaIds.length ? QuickAction.find({ _id: { $in: qaIds } }).select('icon').lean() : [],
    catIds.length ? Category.find({ _id: { $in: catIds } }).select('icon role').lean() : [],
    optIds.length ? Option.find({ _id: { $in: optIds } }).select('questionId icon').lean() : [],
  ]);

  quick.forEach(q => out.set(`qa_${q._id}`, { categoryName: 'Quick tap', categoryIcon: q.icon }));
  cats.forEach(c => out.set(`cat_${c._id}`, { categoryName: ROLE_NAME[c.role] ?? '', categoryIcon: c.icon }));

  if (options.length) {
    const questions = await Question.find({ _id: { $in: options.map(o => o.questionId) } }).select('categoryId').lean();
    const questionCat = new Map(questions.map(q => [String(q._id), q.categoryId]));
    const catIdsForOptions = Array.from(new Set(questions.map(q => String(q.categoryId))));
    const optionCats = await Category.find({ _id: { $in: catIdsForOptions } }).select('name icon').lean();
    const catById = new Map(optionCats.map(c => [String(c._id), c]));
    options.forEach(o => {
      const cat = catById.get(String(questionCat.get(String(o.questionId))));
      if (cat) out.set(`opt_${o._id}`, { categoryName: cat.name, categoryIcon: cat.icon });
    });
  }
  return out;
}

export async function presentInsights(stored: StoredInsight[]): Promise<InsightDto[]> {
  if (stored.length === 0) return [];
  const sources = await lookupSources(Array.from(new Set(stored.flatMap(s => [s.triggerId, s.symptomId]))));
  const side = (id: string, label: string) => {
    const src = sources.get(id);
    return { categoryName: src?.categoryName ?? '', optionLabel: label, categoryIcon: src?.categoryIcon };
  };
  return stored.map(s => ({
    _id: String(s._id),
    triggerId: s.triggerId,
    symptomId: s.symptomId,
    trigger: side(s.triggerId, s.triggerLabel),
    symptom: side(s.symptomId, s.symptomLabel),
    lagWindow: `${s.lagWindowHours[0]}-${s.lagWindowHours[1]}h`,
    lift: s.lift,
    supportCount: s.occurrences,
    confidence: cap(s.confidence),
    computedAt: new Date(s.computedAt).toISOString(),
  }));
}

// ── Findings from the day-level engine ───────────────────────────────────────

export interface FindingDto {
  id: string;
  exposureKey: string;
  outcomeKey: string;
  exposure: { categoryName: string; optionLabel: string; categoryIcon?: string };
  outcome: { categoryName: string; optionLabel: string; categoryIcon?: string };
  /** 0 = same day, 1 = next day, 2 = two days later. */
  lagDays: number;
  /** Days with the exposure that had the symptom, and without; same for the other days. */
  counts: { exposedWith: number; exposedTotal: number; otherWith: number; otherTotal: number };
  tier: 'possible' | 'consistent';
  /** Once shown, but no longer supported by the latest analyses. */
  noLongerSeen: boolean;
  lastShownDay?: string;
  /** More than a quarter of the days compared only had weak evidence of logging. */
  weakDays: boolean;
}

interface StoredFinding {
  exposureKey: string; outcomeKey: string; exposureLabel: string; outcomeLabel: string; lagDays: number;
  a: number; b: number; c: number; d: number;
  shownTier: 'still_learning' | 'possible' | 'consistent';
  noLongerSeen?: boolean; lastShownDay?: string; weakShare?: number; shrunkRR?: number;
}

/** Strongest first: consistent before possible, then by how much higher the symptom rate was. */
export function rankFindings<T extends { tier: string; counts: FindingDto['counts'] }>(list: T[]): T[] {
  const rate = (w: number, t: number) => (t > 0 ? w / t : 0);
  const gap = (f: T) => rate(f.counts.exposedWith, f.counts.exposedTotal) - rate(f.counts.otherWith, f.counts.otherTotal);
  return [...list].sort((x, y) => (Number(y.tier === 'consistent') - Number(x.tier === 'consistent')) || gap(y) - gap(x));
}

export async function presentFindings(stored: StoredFinding[], weakShareFlag = 0.25): Promise<FindingDto[]> {
  if (stored.length === 0) return [];
  const sources = await lookupSources(Array.from(new Set(stored.flatMap(s => [s.exposureKey, s.outcomeKey]))));
  const side = (key: string, label: string) => {
    const src = sources.get(key);
    return { categoryName: src?.categoryName ?? '', optionLabel: label, categoryIcon: src?.categoryIcon };
  };
  const dtos = stored.map((s): FindingDto => ({
    id: `${s.exposureKey}|${s.outcomeKey}|${s.lagDays}`,
    exposureKey: s.exposureKey,
    outcomeKey: s.outcomeKey,
    exposure: side(s.exposureKey, s.exposureLabel),
    outcome: side(s.outcomeKey, s.outcomeLabel),
    lagDays: s.lagDays,
    counts: { exposedWith: s.a, exposedTotal: s.a + s.b, otherWith: s.c, otherTotal: s.c + s.d },
    tier: s.shownTier === 'consistent' ? 'consistent' : 'possible',
    noLongerSeen: !!s.noLongerSeen && s.shownTier === 'still_learning',
    lastShownDay: s.lastShownDay,
    weakDays: (s.weakShare ?? 0) > weakShareFlag,
  }));
  return rankFindings(dtos);
}

// ── Progress ("am I getting better?") ────────────────────────────────────────

export interface TrendDto {
  state: 'improving' | 'worsening' | 'steady' | 'mixed' | 'not_enough_data';
  weeklyValues: Array<{ weekKey: string; value: number }>;
  pValue: number | null;
  estimatedChange: number | null;
  weeksNeeded: number;
}

export interface GoodBadDaysDto {
  good: number;
  bad: number;
  observed: number;
  windowDays: number;
}

export interface RegimeShiftDto { dayKey: string; direction: 'up' | 'down' }

export interface ProgressDto {
  trend: TrendDto;
  goodBadDays: GoodBadDaysDto;
  /** At most the most recent shift, so this reads as one calm note, not a list of alarms. */
  recentShift: RegimeShiftDto | null;
}

export function presentProgress(trend: TrendResult, gbd: GoodBadDays, shifts: RegimeShift[]): ProgressDto {
  return {
    trend: {
      state: trend.state,
      weeklyValues: trend.weeks.map(w => ({ weekKey: w.weekKey, value: w.medianValue })),
      pValue: trend.pValue,
      estimatedChange: trend.estimatedChange,
      weeksNeeded: trend.weeksNeeded,
    },
    goodBadDays: { good: gbd.good, bad: gbd.bad, observed: gbd.observed, windowDays: gbd.windowDays },
    // shifts are already in day order; the most recent one is the only one worth mentioning
    recentShift: shifts.length ? shifts[shifts.length - 1] : null,
  };
}

// ── "Did it help?" before/after comparison ───────────────────────────────────

export interface CompareDto {
  ready: boolean;
  reason?: string;
  eventDay: string;
  washoutDays: number;
  preDays: number;
  postDays: number;
  needed?: number;
  preFlares?: number;
  postFlares?: number;
  symptomDayRate?: { value: number; ci95: [number, number] };
  medianShift?: { value: number; ci95: [number, number] };
  flaresPer28?: { value: number; ci95: [number, number] };
  startedDuringRoughPatch?: boolean;
  alreadyImproving?: boolean;
}

export function presentCompare(result: CompareResult | CompareNotReady, eventDay: string, washoutDays: number): CompareDto {
  if (!result.ready) {
    return { ready: false, reason: result.reason, eventDay, washoutDays, preDays: result.preDays, postDays: result.postDays, needed: result.needed };
  }
  return {
    ready: true,
    eventDay: result.eventDay,
    washoutDays: result.washoutDays,
    preDays: result.preDays,
    postDays: result.postDays,
    preFlares: result.preFlares,
    postFlares: result.postFlares,
    symptomDayRate: result.symptomDayRate,
    medianShift: result.medianShift,
    flaresPer28: result.flaresPer28,
    startedDuringRoughPatch: result.startedDuringRoughPatch,
    alreadyImproving: result.alreadyImproving,
  };
}

// ── Descriptive stats ─────────────────────────────────────────────────────────

/** Where the member's days start. */
export interface DayPrefs { timeZone: string; boundaryHour: number }
const DEFAULT_DAY_PREFS: DayPrefs = { timeZone: 'UTC', boundaryHour: DEFAULT_BOUNDARY_HOUR };

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function trendOf(current: number, previous: number | null, threshold = 0.3): 'up' | 'down' | 'flat' | undefined {
  if (previous === null) return undefined;
  const diff = current - previous;
  if (diff > threshold) return 'up';
  if (diff < -threshold) return 'down';
  return 'flat';
}

export function formatDuration(hours: number): string {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

interface EntryLite {
  occurredAt: Date;
  timezone?: string;
  categoryId?: unknown;
  answers?: Array<{ optionLabelSnapshot?: string; values?: Array<{ dataType: string; value: unknown }> }>;
}

/** The Lumen day an entry belongs to, in the zone it was logged in. */
function entryDay(e: EntryLite, prefs: DayPrefs): string {
  return trackingDayKey(new Date(e.occurredAt), resolveTimeZone(e.timezone, prefs.timeZone), prefs.boundaryHour);
}

/** Average symptom severity per day, from 0-10 style range answers. */
export function severityByDay(entries: EntryLite[], prefs: DayPrefs = DEFAULT_DAY_PREFS): Map<string, number[]> {
  const byDay = new Map<string, number[]>();
  for (const e of entries) {
    for (const a of e.answers ?? []) {
      for (const v of a.values ?? []) {
        if (v.dataType === 'range' && typeof v.value === 'number' && Number.isFinite(v.value)) {
          const k = entryDay(e, prefs);
          byDay.set(k, [...(byDay.get(k) ?? []), v.value]);
        }
      }
    }
  }
  return byDay;
}

export async function buildDescriptiveStats(
  userId: string,
  now = new Date(),
  prefs: DayPrefs = DEFAULT_DAY_PREFS,
): Promise<DescriptiveStatDto[]> {
  const uid = new mongoose.Types.ObjectId(userId);
  const since60 = new Date(now.getTime() - 60 * DAY_MS);
  const dayOf = (e: EntryLite) => entryDay(e, prefs);
  const dayAt = (d: Date) => trackingDayKey(d, prefs.timeZone, prefs.boundaryHour);
  const [entries, categories] = await Promise.all([
    LogEntry.find({ userId: uid, deletedAt: { $exists: false }, occurredAt: { $gte: since60, $lte: now } })
      .select('occurredAt timezone categoryId answers')
      .lean(),
    Category.find({ userId: uid }).select('role name').lean(),
  ]);
  const symptomCats = new Set(categories.filter(c => c.role === 'symptom').map(c => String(c._id)));
  const catName = new Map(categories.map(c => [String(c._id), c.name]));
  const symptomEntries = (entries as EntryLite[]).filter(e => e.categoryId && symptomCats.has(String(e.categoryId)));
  const within = (e: EntryLite, days: number) => now.getTime() - new Date(e.occurredAt).getTime() <= days * DAY_MS;

  const stats: DescriptiveStatDto[] = [];

  // Days with at least one entry in the last 30 days
  const loggedDays = new Set((entries as EntryLite[]).filter(e => within(e, 30)).map(dayOf));
  if (loggedDays.size > 0) {
    stats.push({ key: 'days-logged', icon: '📅', title: 'Days logged', value: `${loggedDays.size} of 30`, sub: 'days with at least one entry', accentColor: '#007AFF' });
  }

  // Symptom severity: this week against the week before
  const sev = severityByDay(symptomEntries.filter(e => within(e, 14)), prefs);
  const recentDays = Array.from(sev.keys()).sort();
  const weekAgoKey = dayAt(new Date(now.getTime() - 7 * DAY_MS));
  const thisWeek = recentDays.filter(k => k > weekAgoKey).flatMap(k => sev.get(k) ?? []);
  const lastWeek = recentDays.filter(k => k <= weekAgoKey).flatMap(k => sev.get(k) ?? []);
  if (thisWeek.length > 0) {
    const current = avg(thisWeek);
    stats.push({
      key: 'symptom-severity',
      icon: '🩺',
      title: 'Symptom severity',
      value: current.toFixed(1),
      sub: lastWeek.length ? `average this week, ${avg(lastWeek).toFixed(1)} the week before` : 'average this week',
      trend: trendOf(current, lastWeek.length ? avg(lastWeek) : null),
      trendGoodDirection: 'down',
      sparkValues: recentDays.map(k => Math.round(avg(sev.get(k) as number[]) * 10) / 10),
      accentColor: '#FF3B30',
    });
  }

  // Most logged symptom in the last 30 days
  const counts = new Map<string, number>();
  for (const e of symptomEntries.filter(x => within(x, 30))) {
    const labels = (e.answers ?? []).map(a => a.optionLabelSnapshot).filter((l): l is string => !!l);
    for (const l of labels.length ? labels : [catName.get(String(e.categoryId)) ?? 'Symptom']) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (top) {
    stats.push({ key: 'top-symptom', icon: '🔎', title: 'Most logged symptom', value: top[0], sub: `${top[1]} time${top[1] === 1 ? '' : 's'} in 30 days`, accentColor: '#FF9500' });
  }

  // Weekday with the most symptom entries (needs enough entries to mean anything)
  if (symptomEntries.length >= 7) {
    const byWeekday = new Array(7).fill(0) as number[];
    symptomEntries.forEach(e => { byWeekday[weekdayOfKey(dayOf(e))]++; });
    const max = Math.max(...byWeekday);
    const day = byWeekday.indexOf(max);
    if (max >= 2 && byWeekday.filter(n => n === max).length === 1) {
      stats.push({ key: 'busiest-weekday', icon: '🗓️', title: 'Most symptom entries', value: `${WEEKDAYS[day]}s`, sub: `${max} of ${symptomEntries.length} entries in 60 days`, accentColor: '#5856D6' });
    }
  }

  // Average sleep: bedtime on one day to waking on the next
  const sessions = await DaySession.find({ userId: uid, sessionDate: { $gte: dayAt(new Date(now.getTime() - 9 * DAY_MS)) } })
    .select('sessionDate wakeTime sleepTime')
    .sort({ sessionDate: 1 })
    .lean();
  const nights: number[] = [];
  for (let i = 1; i < sessions.length; i++) {
    const bed = sessions[i - 1].sleepTime;
    const wake = sessions[i].wakeTime;
    if (!bed || !wake) continue;
    const hours = (new Date(wake).getTime() - new Date(bed).getTime()) / 3600000;
    if (hours >= 2 && hours <= 16) nights.push(hours);
  }
  if (nights.length >= 3) {
    stats.push({ key: 'sleep', icon: '😴', title: 'Average sleep', value: formatDuration(avg(nights)), sub: `over the last ${nights.length} nights`, sparkValues: nights.map(n => Math.round(n * 10) / 10), accentColor: '#34C759' });
  }

  return stats;
}
