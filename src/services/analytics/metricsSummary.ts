/**
 * Summaries for the Metrics screen: average, median, range, how many days it is based on,
 * change from the previous period, weekday pattern, goal hit rate and the weekly trend.
 * Pure functions.
 */
import { DayMetricRow } from './dayMetrics';
import { dailyValues, MetricDef } from './metricCatalog';
import { hodgesLehmannShift, mannKendall, mannWhitneyU, median, theilSenSlope } from '../insights/stats';
import { weekdayOfKey } from '../../utils/dayKey';

export type ChangeWord = 'higher' | 'lower' | 'similar' | 'not_enough';
export type TrendWord = 'rising' | 'falling' | 'steady' | 'not_enough';

export interface MetricSummary {
  id: string;
  label: string;
  unit: string;
  decimals: number;
  better: 'higher' | 'lower' | null;
  scaleNote?: string;
  summary: 'average' | 'share';
  /** Average of the days with a value (or % of days that were "yes" for a share). */
  value: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  covered: number;
  total: number;
  prev: { value: number | null; covered: number } | null;
  change: ChangeWord;
  /** Typical shift vs the previous period (Hodges-Lehmann), in the metric's unit. */
  shift: number | null;
  goal: number | null;
  goalRate: { hit: number; of: number } | null;
  trend: TrendWord;
  series: Array<{ day: string; v: number | null }>;
}

export interface MetricDetail extends MetricSummary {
  /** Average per weekday, Sunday first; null unless every weekday has at least 3 values. */
  weekday: Array<number | null> | null;
  /** Up to 8 equal-width bins of the daily values. */
  histogram: Array<{ from: number; to: number; count: number }>;
  best: Array<{ day: string; v: number }>;
  worst: Array<{ day: string; v: number }>;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Need this many days with a value in each period before calling a change. */
const MIN_FOR_CHANGE = 5;

function summaryValue(def: MetricDef, vals: number[]): number | null {
  if (vals.length === 0) return null;
  if (def.summary === 'share') return round((vals.filter(v => v > 0).length / vals.length) * 100, 0);
  return round(avg(vals)!, def.decimals);
}

/** Weekly averages (Monday-anchored chunks of 7 days in order), skipping weeks with < 3 values. */
function weeklyMeans(values: Array<number | null>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 7) {
    const chunk = values.slice(i, i + 7).filter((v): v is number => v !== null);
    if (chunk.length >= 3) out.push(avg(chunk)!);
  }
  return out;
}

export function trendOf(values: Array<number | null>): TrendWord {
  const weeks = weeklyMeans(values);
  if (weeks.length < 4) return 'not_enough';
  const { p } = mannKendall(weeks);
  const change = theilSenSlope(weeks) * (weeks.length - 1);
  const base = Math.abs(median(weeks)) || 1;
  if (p < 0.1 && Math.abs(change) >= 0.1 * base) return change > 0 ? 'rising' : 'falling';
  return 'steady';
}

export function summarise(def: MetricDef, rows: DayMetricRow[], prevRows: DayMetricRow[] | null, firstSeen: string | null, goal?: number | null): MetricSummary {
  const daily = dailyValues(def, rows, firstSeen);
  const vals = daily.filter((v): v is number => v !== null);
  let prev: MetricSummary['prev'] = null;
  let change: ChangeWord = 'not_enough';
  let shift: number | null = null;
  if (prevRows) {
    const pv = dailyValues(def, prevRows, firstSeen).filter((v): v is number => v !== null);
    prev = { value: summaryValue(def, pv), covered: pv.length };
    if (vals.length >= MIN_FOR_CHANGE && pv.length >= MIN_FOR_CHANGE) {
      shift = round(hodgesLehmannShift(pv, vals), def.decimals);
      const { p } = mannWhitneyU(vals, pv);
      // Only called a change when it is unlikely by chance AND not tiny.
      const scale = Math.max(Math.abs(avg(pv) ?? 0), 1e-9);
      const big = def.summary === 'share' ? Math.abs((summaryValue(def, vals) ?? 0) - (prev.value ?? 0)) >= 10 : Math.abs(shift) >= 0.05 * scale;
      change = p < 0.05 && big && shift !== 0 ? (shift > 0 ? 'higher' : 'lower') : 'similar';
      if (def.summary === 'share' && change !== 'similar') change = (summaryValue(def, vals) ?? 0) > (prev.value ?? 0) ? 'higher' : 'lower';
    }
  }
  const g = goal ?? def.goal ?? null;
  return {
    id: def.id, label: def.label, unit: def.unit, decimals: def.decimals, better: def.better, scaleNote: def.scaleNote, summary: def.summary,
    value: summaryValue(def, vals),
    median: vals.length ? round(median(vals), def.decimals) : null,
    min: vals.length ? round(Math.min(...vals), def.decimals) : null,
    max: vals.length ? round(Math.max(...vals), def.decimals) : null,
    covered: vals.length,
    total: rows.length,
    prev, change, shift,
    goal: g,
    goalRate: g !== null && vals.length ? { hit: vals.filter(v => (def.better === 'lower' ? v <= g : v >= g)).length, of: vals.length } : null,
    trend: trendOf(daily),
    series: rows.map((r, i) => ({ day: r.dayKey, v: daily[i] === null ? null : round(daily[i] as number, def.decimals) })),
  };
}

export function detail(def: MetricDef, rows: DayMetricRow[], prevRows: DayMetricRow[] | null, firstSeen: string | null, goal?: number | null): MetricDetail {
  const s = summarise(def, rows, prevRows, firstSeen, goal);
  const points = s.series.filter((p): p is { day: string; v: number } => p.v !== null);

  const byWeekday: number[][] = Array.from({ length: 7 }, () => []);
  for (const p of points) byWeekday[weekdayOfKey(p.day)].push(p.v);
  const weekday = byWeekday.every(w => w.length >= 3) ? byWeekday.map(w => round(avg(w)!, def.decimals)) : null;

  let histogram: MetricDetail['histogram'] = [];
  if (points.length >= 5 && s.min !== null && s.max !== null && s.max > s.min) {
    const bins = Math.min(8, Math.max(3, Math.round(Math.sqrt(points.length))));
    const width = (s.max - s.min) / bins;
    histogram = Array.from({ length: bins }, (_, i) => ({ from: round(s.min! + i * width, def.decimals), to: round(s.min! + (i + 1) * width, def.decimals), count: 0 }));
    for (const p of points) histogram[Math.min(bins - 1, Math.floor((p.v - s.min) / width))].count++;
  }

  const sorted = [...points].sort((a, b) => a.v - b.v);
  const lowFirst = def.better === 'lower';
  const best = (lowFirst ? sorted : [...sorted].reverse()).slice(0, 3);
  const worst = (lowFirst ? [...sorted].reverse() : sorted).slice(0, 3);
  return { ...s, weekday, histogram, best: def.better ? best : [], worst: def.better ? worst : [] };
}
