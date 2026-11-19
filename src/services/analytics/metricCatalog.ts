/**
 * Every number the Metrics and Explore screens can show, and how a missing day is read.
 *
 * Absence rules (the most common way averages go wrong):
 * - `missing`: no value means "not recorded" (sleep, energy, severity, weather). Never 0.
 * - `zero_if_logged`: on a day the member logged anything, no entry really means 0 (water,
 *   exercise minutes, how many times an item was logged) — but only from the first day the
 *   number was ever recorded. On a day with no logging at all it stays missing.
 * - `zero_if_steps`: walking minutes are 0 when the phone counted steps but no walk was recorded.
 */
import type { DayMetricRow, DayMetrics } from './dayMetrics';

export type Absence = 'missing' | 'zero_if_logged' | 'zero_if_steps';
/** How a range is summed up: the average of daily values, or the share of days that were "yes". */
export type Summary = 'average' | 'share';
export type MetricGroup = 'sleep' | 'activity' | 'body' | 'symptoms' | 'weather' | 'medicines' | 'items';

export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  decimals: number;
  absence: Absence;
  summary: Summary;
  better: 'higher' | 'lower' | null;
  group: MetricGroup;
  goal?: number;
  /**
   * For `zero_if_logged`: count zeros only from the first day with a value (an item started being
   * tracked) or from any logged day (symptom logs and flare days: none logged really means none).
   */
  zeroFrom?: 'first_value' | 'any_log';
  /** Shown next to the number so a 0–10 scale is never misread. */
  scaleNote?: string;
  /** Raw daily value (before the absence rule). */
  read(row: DayMetricRow): number | null;
}

const m = (key: keyof DayMetrics) => (row: DayMetricRow) => {
  const v = row.metrics?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export const BUILT_IN_METRICS: MetricDef[] = [
  { id: 'sleep_hours', label: 'Sleep', unit: 'h', decimals: 1, absence: 'missing', summary: 'average', better: 'higher', group: 'sleep', read: m('sleepHours') },
  { id: 'sleep_quality', label: 'Sleep quality', unit: '/4', decimals: 1, absence: 'missing', summary: 'average', better: 'higher', group: 'sleep', scaleNote: '1 poor · 4 restful', read: m('sleepQuality') },
  { id: 'steps', label: 'Steps', unit: 'steps', decimals: 0, absence: 'missing', summary: 'average', better: 'higher', group: 'activity', read: m('steps') },
  { id: 'walk_min', label: 'Walking', unit: 'min', decimals: 0, absence: 'zero_if_steps', summary: 'average', better: 'higher', group: 'activity', read: m('walkMin') },
  { id: 'exercise_min', label: 'Exercise', unit: 'min', decimals: 0, absence: 'zero_if_logged', summary: 'average', better: 'higher', group: 'activity', read: m('exerciseMin') },
  { id: 'water_ml', label: 'Water', unit: 'ml', decimals: 0, absence: 'zero_if_logged', summary: 'average', better: 'higher', group: 'body', read: m('waterMl') },
  { id: 'energy', label: 'Energy', unit: '/10', decimals: 1, absence: 'missing', summary: 'average', better: 'higher', group: 'body', scaleNote: '10 = most energy', read: m('energy') },
  { id: 'stress', label: 'Stress', unit: '/10', decimals: 1, absence: 'missing', summary: 'average', better: 'lower', group: 'body', scaleNote: '10 = most stressed', read: m('stress') },
  { id: 'mood', label: 'Mood', unit: '/5', decimals: 1, absence: 'missing', summary: 'average', better: 'higher', group: 'body', scaleNote: '1 flare · 5 great', read: m('mood') },
  { id: 'overall', label: 'Overall (how bad)', unit: '/10', decimals: 1, absence: 'missing', summary: 'average', better: 'lower', group: 'symptoms', scaleNote: '10 = worst', read: m('patientGlobal') },
  { id: 'symptom_max', label: 'Worst symptom', unit: '/10', decimals: 1, absence: 'missing', summary: 'average', better: 'lower', group: 'symptoms', scaleNote: 'highest severity that day', read: m('symptomMax') },
  { id: 'symptom_count', label: 'Symptom logs', unit: 'logs', decimals: 1, absence: 'zero_if_logged', zeroFrom: 'any_log', summary: 'average', better: 'lower', group: 'symptoms', read: r => (r.metrics?.symptomCount ? r.metrics.symptomCount : null) },
  { id: 'flare_days', label: 'Flare days', unit: '%', decimals: 0, absence: 'zero_if_logged', zeroFrom: 'any_log', summary: 'share', better: 'lower', group: 'symptoms', read: r => (r.metrics?.flareDay ? 1 : null) },
  { id: 'temp_max', label: 'Max temperature', unit: '°C', decimals: 1, absence: 'missing', summary: 'average', better: null, group: 'weather', read: m('tMaxC') },
  { id: 'temp_min', label: 'Min temperature', unit: '°C', decimals: 1, absence: 'missing', summary: 'average', better: null, group: 'weather', read: m('tMinC') },
  { id: 'humidity', label: 'Humidity', unit: '%', decimals: 0, absence: 'missing', summary: 'average', better: null, group: 'weather', read: m('humidity') },
  { id: 'pressure', label: 'Air pressure', unit: 'hPa', decimals: 0, absence: 'missing', summary: 'average', better: null, group: 'weather', read: m('pressureHpa') },
  { id: 'pressure_change', label: 'Pressure change', unit: 'hPa', decimals: 1, absence: 'missing', summary: 'average', better: null, group: 'weather', scaleNote: 'vs the day before', read: m('pressureDelta') },
  { id: 'uv', label: 'UV index', unit: '', decimals: 1, absence: 'missing', summary: 'average', better: null, group: 'weather', read: m('uvMax') },
  { id: 'rain', label: 'Rain', unit: 'mm', decimals: 1, absence: 'missing', summary: 'average', better: null, group: 'weather', read: m('precipMm') },
];

export const BUILT_IN_BY_ID = new Map(BUILT_IN_METRICS.map(d => [d.id, d]));

/** Share of MARKED planned doses taken that day, in % (unmarked doses are left out). */
export function doseMetric(medicationId: string, name: string): MetricDef {
  return {
    id: `dose:${medicationId}`, label: `${name} taken`, unit: '%', decimals: 0, absence: 'missing', summary: 'average',
    better: 'higher', group: 'medicines', scaleNote: 'of the doses you marked',
    read: row => {
      const d = row.doses?.find(x => x.medicationId === medicationId);
      if (!d || d.scheduled === 0) return null;
      const marked = d.scheduled - d.unmarked;
      return marked > 0 ? Math.round((Math.min(d.taken, marked) / marked) * 100) : null;
    },
  };
}

export type ItemMeasure = 'count' | 'qty' | 'sev';

/** Metrics generated for one logged item: times logged per day, amount per day, severity. */
export function itemMetric(key: string, label: string, measure: ItemMeasure, unit?: string | null): MetricDef {
  const base = { group: 'items' as const, better: null };
  if (measure === 'count') {
    return { ...base, id: `item:${key}:count`, label: `${label} (times)`, unit: 'times', decimals: 1, absence: 'zero_if_logged', summary: 'average', read: r => r.items?.find(i => i.key === key)?.count ?? null };
  }
  if (measure === 'qty') {
    const shown = unit === 's' ? 'min' : unit ?? '';
    return {
      ...base, id: `item:${key}:qty`, label: `${label} (amount)`, unit: shown, decimals: unit === 's' ? 0 : 1, absence: 'zero_if_logged', summary: 'average',
      read: r => {
        const it = r.items?.find(i => i.key === key);
        if (!it || it.qty === null || it.mixedUnits) return null;
        return unit === 's' ? it.qty / 60 : it.qty;
      },
    };
  }
  return { ...base, id: `item:${key}:sev`, label: `${label} (severity)`, unit: '/10', decimals: 1, absence: 'missing', summary: 'average', better: 'lower', read: r => r.items?.find(i => i.key === key)?.maxSev ?? null };
}

/** Resolves a metric id (built-in, dose:<id>, item:<key>:<measure>) given live labels. */
export function resolveMetric(id: string, labels: { item(key: string): string; med(id: string): string | null; itemUnit(key: string): string | null }): MetricDef | null {
  const built = BUILT_IN_BY_ID.get(id);
  if (built) return built;
  const dose = /^dose:([0-9a-f]{24})$/.exec(id);
  if (dose) {
    const name = labels.med(dose[1]);
    return name ? doseMetric(dose[1], name) : null;
  }
  const item = /^item:((?:opt|cat|qa|feel)_[^:]+):(count|qty|sev)$/.exec(id);
  if (item) return itemMetric(item[1], labels.item(item[1]), item[2] as ItemMeasure, labels.itemUnit(item[1]));
  return null;
}

/**
 * Daily values with the absence rule applied. `rows` must be every day of the range, in order;
 * `firstSeen` is the first day this number was ever recorded (for `zero_if_logged`).
 */
export function dailyValues(def: MetricDef, rows: DayMetricRow[], firstSeen: string | null): Array<number | null> {
  return rows.map(r => {
    const v = def.read(r);
    if (v !== null) return v;
    if (def.absence === 'zero_if_logged') {
      if (!r.logged?.any) return null;
      if (def.zeroFrom === 'any_log') return 0;
      return firstSeen !== null && r.dayKey >= firstSeen ? 0 : null;
    }
    if (def.absence === 'zero_if_steps') return typeof r.metrics?.steps === 'number' && r.metrics.steps > 0 ? 0 : null;
    return null;
  });
}

/** First day the metric had a real value, across all rows given. */
export function firstSeenDay(def: MetricDef, rows: DayMetricRow[]): string | null {
  for (const r of rows) if (def.read(r) !== null) return r.dayKey;
  return null;
}
