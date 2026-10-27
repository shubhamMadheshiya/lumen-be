/**
 * Turns the member's logs into the text and small series the one-page doctor summary is printed
 * from. Pure and fully testable: it only picks, ranks and formats; `reportGenerator.ts` lays the
 * result out on the page. No AI writes any of this text, and nothing here is interpreted against
 * a clinical threshold — it is a record, not a diagnosis.
 */
import { DayRow } from './dayTable';
import { dailyComposite, weekKeyOf, WeeklyPoint, TrendResult } from './progress';
import { daysBetween, shiftDayKey } from '../../utils/dayKey';
import { median } from './stats';
import { percentile } from '../flareModeService';

export type DayMark = 'good' | 'harder' | 'mid' | 'unlogged';

export interface MedicationInfo {
  name: string;
  dose?: string;
  unit?: string;
  active: boolean;
  startedOn?: string;
  stoppedOn?: string;
}

export interface FlareEpisodeInfo {
  startDay: string;
  endDay: string;
  source: 'explicit' | 'inferred';
  confirmed: 'yes' | 'no' | null;
}

export interface RedFlagEventInfo {
  dayKey: string;
  title: string;
  level: 'today' | 'now';
}

export interface FindingInfo {
  exposureLabel: string;
  outcomeLabel: string;
  lagDays: number;
  counts: { exposedWith: number; exposedTotal: number; otherWith: number; otherTotal: number };
  tier: 'possible' | 'consistent';
}

export interface SummaryModelInput {
  from: string; // YYYY-MM-DD, inclusive
  to: string;
  /** The member's day table; ideally covers well before `from`, so the trend has context. */
  rows: DayRow[];
  medications: MedicationInfo[];
  trend: TrendResult;
  flareEpisodes: FlareEpisodeInfo[];
  redFlagEvents: RedFlagEventInfo[];
  findings: FindingInfo[];
  notesForDoctor?: string;
  maxListLines?: number;
}

export interface SummaryModel {
  periodLine: string;
  completenessLine: string;
  medicationLines: string[];
  medicationsTruncated: number;
  trendLine: string;
  weeklySeries: Array<{ label: string; values: number[] }>;
  calendar: Array<{ dayKey: string; mark: DayMark }>;
  calendarLegend: string;
  flareLines: string[];
  flaresTruncated: number;
  redFlagLines: string[];
  redFlagsTruncated: number;
  patternLines: string[];
  patternsTruncated: number;
  notesForDoctor: string | null;
}

const DEFAULT_MAX_LIST_LINES = 4;
/** How many recent days the calendar strip shows. */
const CALENDAR_DAYS = 28;
/** How many days of baseline the good/harder cutoffs are computed from. */
const BASELINE_WINDOW_DAYS = 90;
const MIN_BASELINE_VALUES = 6;

// Fixed abbreviations rather than Intl, so the wording never depends on the Node build's ICU data
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDay(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function fmtDayShort(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "1–27 Oct 2026", or "28 Sep – 3 Oct 2026" across a month boundary. */
export function periodLine(from: string, to: string): string {
  const a = new Date(`${from}T12:00:00Z`);
  const b = new Date(`${to}T12:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${from} – ${to}`;
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const month = (d: Date) => MONTHS[d.getUTCMonth()];
  const year = b.getUTCFullYear();
  return sameMonth
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${month(b)} ${year}`
    : `${a.getUTCDate()} ${month(a)} – ${b.getUTCDate()} ${month(b)} ${year}`;
}

export function completenessLine(rows: DayRow[], from: string, to: string): string {
  const total = daysBetween(from, to) + 1;
  const logged = rows.filter(r => r.dayKey >= from && r.dayKey <= to && r.symptomObserved).length;
  return `Logged ${logged} of ${total} day${total === 1 ? '' : 's'} in this period.`;
}

function medicationLine(m: MedicationInfo): string {
  const parts = [m.name];
  if (m.dose) parts.push(`${m.dose}${m.unit ? ` ${m.unit}` : ''}`);
  const status = m.stoppedOn
    ? `stopped ${fmtDay(m.stoppedOn)}`
    : m.active
      ? (m.startedOn ? `active, started ${fmtDay(m.startedOn)}` : 'active')
      : 'not currently active';
  return `${parts.join(', ')} — ${status}`;
}

const TREND_LINES: Record<TrendResult['state'], string> = {
  improving: 'A real, noticeable improvement over the recent weeks.',
  worsening: 'A real, noticeable rise over the recent weeks, worth discussing.',
  steady: 'Holding steady over the recent weeks.',
  mixed: 'No clear direction over the recent weeks.',
  not_enough_data: 'Not enough weeks of logging yet for a trend.',
};

function flareLine(f: FlareEpisodeInfo): string {
  const span = f.startDay === f.endDay ? fmtDayShort(f.startDay) : `${fmtDayShort(f.startDay)}–${fmtDayShort(f.endDay)}`;
  if (f.source === 'explicit') return `${span} (the member's own "Flare now" entry)`;
  return f.confirmed === 'yes' ? `${span} (confirmed by the member)` : `${span} (pattern in the logs, not confirmed)`;
}

function redFlagLine(e: RedFlagEventInfo): string {
  return `${fmtDayShort(e.dayKey)} — ${e.title}${e.level === 'now' ? ' (urgent)' : ''}`;
}

function patternLine(f: FindingInfo): string {
  const { exposedWith, exposedTotal, otherWith, otherTotal } = f.counts;
  const lead = f.lagDays <= 0 ? 'on' : f.lagDays === 1 ? 'the day after' : 'two days after';
  return `${f.exposureLabel} → ${f.outcomeLabel}: ${lead} ${exposedWith} of ${exposedTotal} days, vs ${otherWith} of ${otherTotal} other days (${f.tier}).`;
}

/** Caps a list to `max` lines, returning what overflowed. */
function capped<T>(items: T[], max: number): { shown: T[]; truncated: number } {
  return { shown: items.slice(0, max), truncated: Math.max(0, items.length - max) };
}

/** Weekly medians of one symptom's own severity (not the day's overall composite). */
export function weeklySeriesForSymptom(rows: DayRow[], symptomKey: string, minLoggedDays = 2): number[] {
  const byWeek = new Map<string, number[]>();
  for (const r of rows) {
    const s = r.symptoms.find(x => x.key === symptomKey && x.present && x.max !== null);
    if (!s || s.max === null) continue;
    const k = weekKeyOf(r.dayKey);
    byWeek.set(k, [...(byWeek.get(k) ?? []), s.max]);
  }
  return Array.from(byWeek.entries())
    .filter(([, vs]) => vs.length >= minLoggedDays)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, vs]) => median(vs));
}

/** The symptoms logged most often within [from, to], most frequent first. */
export function topSymptomKeys(rows: DayRow[], from: string, to: string, n = 3): Array<{ key: string; label: string }> {
  const counts = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    if (r.dayKey < from || r.dayKey > to) continue;
    for (const s of r.symptoms) {
      // A whole category (e.g. "Symptoms") is too generic for a doctor summary; the specific
      // option (e.g. "Fatigue") the day table also records is what is worth naming.
      if (!s.present || s.key.startsWith('cat_')) continue;
      const prev = counts.get(s.key);
      counts.set(s.key, { label: prev?.label ?? s.label, count: (prev?.count ?? 0) + 1 });
    }
  }
  return Array.from(counts.entries())
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, n)
    .map(([key, v]) => ({ key, label: v.label }));
}

function calendarStrip(rows: DayRow[], to: string, flareDayKeys: ReadonlySet<string>): { calendar: SummaryModel['calendar']; legend: string } {
  const sorted = [...rows].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const baselineStart = shiftDayKey(to, -BASELINE_WINDOW_DAYS);
  const baselineValues = sorted
    .filter(r => r.dayKey >= baselineStart && r.dayKey <= to && r.symptomObserved)
    .map(dailyComposite)
    .filter((v): v is number => v !== null);

  const haveCutoffs = baselineValues.length >= MIN_BASELINE_VALUES;
  const goodCutoff = haveCutoffs ? percentile(baselineValues, 0.25) : null;
  const badCutoff = haveCutoffs ? percentile(baselineValues, 0.75) : null;

  const start = shiftDayKey(to, -CALENDAR_DAYS + 1);
  const byDay = new Map(sorted.map(r => [r.dayKey, r]));
  const calendar: SummaryModel['calendar'] = [];
  for (let d = start; d <= to; d = shiftDayKey(d, 1)) {
    const row = byDay.get(d);
    let mark: DayMark = 'unlogged';
    if (row?.symptomObserved) {
      const flare = flareDayKeys.has(d);
      const v = dailyComposite(row);
      if (flare || (v !== null && badCutoff !== null && v >= badCutoff)) mark = 'harder';
      else if (!flare && v !== null && goodCutoff !== null && v <= goodCutoff) mark = 'good';
      else mark = 'mid';
    }
    calendar.push({ dayKey: d, mark });
  }
  return { calendar, legend: 'G = good day · M = in between · H = harder day (or a flare) · blank = not logged' };
}

export function buildSummaryModel(input: SummaryModelInput, flareDayKeys: ReadonlySet<string> = new Set()): SummaryModel {
  const maxLines = input.maxListLines ?? DEFAULT_MAX_LIST_LINES;

  const meds = capped(input.medications, maxLines);
  const flares = capped(
    input.flareEpisodes.filter(f => f.confirmed !== 'no').sort((a, b) => b.startDay.localeCompare(a.startDay)),
    maxLines,
  );
  const redFlags = capped([...input.redFlagEvents].sort((a, b) => b.dayKey.localeCompare(a.dayKey)), maxLines);
  const patterns = capped(
    [...input.findings].sort((a, b) => Number(b.tier === 'consistent') - Number(a.tier === 'consistent')),
    maxLines,
  );

  const topSymptoms = topSymptomKeys(input.rows, input.from, input.to, 3);
  const weeklySeries: SummaryModel['weeklySeries'] = [
    { label: 'Overall', values: input.trend.weeks.map(w => w.medianValue) },
    ...topSymptoms.map(s => ({ label: s.label, values: weeklySeriesForSymptom(input.rows, s.key) })),
  ].filter(s => s.values.length > 1);

  const { calendar, legend } = calendarStrip(input.rows, input.to, flareDayKeys);

  return {
    periodLine: periodLine(input.from, input.to),
    completenessLine: completenessLine(input.rows, input.from, input.to),
    medicationLines: meds.shown.map(medicationLine),
    medicationsTruncated: meds.truncated,
    trendLine: TREND_LINES[input.trend.state],
    weeklySeries,
    calendar,
    calendarLegend: legend,
    flareLines: flares.shown.map(flareLine),
    flaresTruncated: flares.truncated,
    redFlagLines: redFlags.shown.map(redFlagLine),
    redFlagsTruncated: redFlags.truncated,
    patternLines: patterns.shown.map(patternLine),
    patternsTruncated: patterns.truncated,
    notesForDoctor: input.notesForDoctor?.trim() || null,
  };
}

// Re-exported so callers only need one import for building the model and its weekly inputs
export type { WeeklyPoint };
