/**
 * One row per Lumen day for the Explore and Metrics screens: every logged item (whatever its
 * analysis kind) with its count, amount and severity, plus the day's numbers (sleep, steps,
 * walking, exercise, water, energy, stress, overall, weather) and medicine doses.
 *
 * This is separate from the Insights day table on purpose: that table feeds the tuned pattern
 * engine and must not change; this one can grow with new metrics.
 *
 * Pure functions only; `metricsService.ts` does the database work.
 */
import { AnalysisKind } from '../insights/analysisKind';
import { REACTIVE_WINDOW_MS, NO_SYMPTOMS_OPTION_ID, PATIENT_GLOBAL_OPTION_ID, FEELING_FLARE_OPTION_ID } from '../insights/dayTable';
import { dayKeysBetween, resolveTimeZone, shiftDayKey, trackingDayKey } from '../../utils/dayKey';
import { getBuiltInUnit } from '../../shared/units/builtIn';
import { canonicalFor, normaliseUnit } from '../logs/canonical';
import type { DoseDay } from '../meds/doses';
import type { WeatherRow } from '../weather/weatherDays';

export const METRICS_VERSION = 1;

export const ENERGY_OPTION_ID = 'checkin:energy';
export const STRESS_OPTION_ID = 'checkin:stress';
export const TIMER_OPTION_ID = 'qa:timer';

export type MetricRole = 'water' | 'exercise' | 'walk' | 'sleep';

export interface MetricEntry {
  occurredAt: Date;
  timezone?: string;
  source?: string;
  categoryId?: string;
  questionId?: string;
  quickActionId?: string;
  answers: Array<{
    optionId: string;
    optionLabelSnapshot?: string;
    values?: Array<{ fieldKey?: string; dataType: string; value?: unknown; unit?: string | null; canonicalValue?: number | null }>;
  }>;
}

export interface CategoryInfo { label: string; kind: AnalysisKind }
export interface QuickActionInfo { label: string; kind: AnalysisKind; defaultValue?: number | null; unit?: string | null; metricRole?: MetricRole | null }
export interface QuestionInfo { label: string; categoryId?: string; metricRole?: MetricRole | null }

export interface MetricInput {
  entries: MetricEntry[];
  categories: Map<string, CategoryInfo>;
  quickActions: Map<string, QuickActionInfo>;
  questions: Map<string, QuestionInfo>;
  /** optionId → categoryId, so an option and its own category are known to be the same thing. */
  optionCategory: Map<string, string>;
  /** Duplicate option → the option it is counted as ("Count as the same as…"). */
  optionMerge?: Map<string, string>;
  steps: Map<string, number>;
  walkMinutes: Map<string, number>;
  exerciseMinutes: Map<string, number>;
  sessions: Map<string, { wakeTime?: Date | null; sleepTime?: Date | null }>;
  weather: Map<string, WeatherRow>;
  doses: Map<string, DoseDay[]>;
  flareDays: Set<string>;
  timeZone: string;
  boundaryHour: number;
  from: string;
  to: string;
}

export interface ItemDay {
  key: string;
  label: string;
  /** Category id (or quick tap id) the key belongs to: an option and its category are one thing. */
  group: string;
  count: number;
  /** Of `count`, how many were logged within 3 h after a symptom (likely a response to it). */
  reactive: number;
  qty: number | null;
  unit: string | null;
  mixedUnits: boolean;
  maxSev: number | null;
  /** Absolute hour indexes (ms / 3.6e6) it was logged in, for the "logged together" check. */
  hours: number[];
  outcome: boolean;
}

export type SymptomBasis = 'symptom_entry' | 'check_in' | 'weak' | 'none';
export type SleepSourceTag = 'device' | 'tracker' | 'buttons' | 'manual';

export interface DayMetrics {
  sleepHours: number | null;
  sleepSource: SleepSourceTag | null;
  sleepQuality: number | null;
  steps: number | null;
  walkMin: number | null;
  exerciseMin: number | null;
  waterMl: number | null;
  energy: number | null;
  stress: number | null;
  mood: number | null;
  patientGlobal: number | null;
  symptomMax: number | null;
  symptomCount: number;
  flareDay: boolean;
  tMaxC: number | null;
  tMinC: number | null;
  humidity: number | null;
  pressureHpa: number | null;
  pressureDelta: number | null;
  uvMax: number | null;
  precipMm: number | null;
}

export interface DayMetricRow {
  dayKey: string;
  logged: { any: boolean; entryCount: number; symptomBasis: SymptomBasis };
  items: ItemDay[];
  metrics: DayMetrics;
  doses: DoseDay[];
}

// ── Inferring what a question or quick tap measures ──────────────────────────

const ROLE_BY_TEMPLATE: Record<string, MetricRole> = {
  qa_water: 'water', qa_walk: 'walk', q_exercise: 'exercise', q_sleep_quality: 'sleep',
};

/** The member's / template's explicit role wins (null = "none"); otherwise guessed from the label. */
export function inferMetricRole(explicit: MetricRole | null | undefined, templateKey: string | undefined | null, label: string): MetricRole | null {
  if (explicit !== undefined) return explicit;
  if (templateKey && ROLE_BY_TEMPLATE[templateKey]) return ROLE_BY_TEMPLATE[templateKey];
  if (/\b(water|hydrat\w*)\b/i.test(label)) return 'water';
  if (/\bwalk(s|ing|ed)?\b/i.test(label)) return 'walk';
  if (/\b(exercise|workout|gym|yoga|running|run|cycling|swim\w*|training|physio\w*)\b/i.test(label)) return 'exercise';
  if (/\b(sleep|slept)\b/i.test(label)) return 'sleep';
  return null;
}

const FEELING_SCORE: Record<string, number> = { great: 5, good: 4, okay: 3, low: 2, flare: 1 };
const QUALITY_SCORE: Record<string, number> = { POOR: 1, FAIR: 2, GOOD: 3, RESTFUL: 4, GREAT: 4 };
const SLEEP_RANK: Record<SleepSourceTag, number> = { device: 4, tracker: 3, buttons: 2, manual: 1 };
const FLARE_TAP_LABEL = /\bflare\b/i;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Base unit of a unit symbol (ml for glass, s for min …), or the symbol itself if unknown. */
function baseUnitOf(unit: string | null | undefined, dataType: string): string | null {
  if (dataType === 'duration' && !unit) return 's';
  const u = normaliseUnit(unit);
  if (!u) return null;
  return getBuiltInUnit(u)?.baseUnit ?? (u === '°F' ? '°C' : u);
}

interface Amount { value: number; unit: string | null }

/** The amount an answer records: its first number/duration field, in base units when known. */
function answerAmount(values: MetricEntry['answers'][number]['values']): Amount | null {
  for (const v of values ?? []) {
    if (v.dataType !== 'number' && v.dataType !== 'duration') continue;
    const canonical = typeof v.canonicalValue === 'number' && Number.isFinite(v.canonicalValue) ? v.canonicalValue : canonicalFor(v);
    if (canonical !== undefined) return { value: canonical, unit: baseUnitOf(v.unit, v.dataType) };
    const raw = num(v.value);
    if (raw !== null) return { value: raw, unit: normaliseUnit(v.unit) ?? null };
  }
  return null;
}

function maxRange(values: MetricEntry['answers'][number]['values']): number | null {
  let best: number | null = null;
  for (const v of values ?? []) {
    if (v.dataType !== 'range') continue;
    const n = num(v.canonicalValue ?? v.value);
    if (n !== null) best = best === null ? n : Math.max(best, n);
  }
  return best;
}

function addAmount(item: ItemDay, a: Amount | null) {
  if (!a) return;
  if (item.mixedUnits) return;
  if (item.qty === null) { item.qty = a.value; item.unit = a.unit; return; }
  if (item.unit !== a.unit) { item.mixedUnits = true; item.qty = null; item.unit = null; return; }
  item.qty += a.value;
}

// ── Building rows ────────────────────────────────────────────────────────────

interface Placed { e: MetricEntry; at: Date; day: string; isSymptom: boolean; isReactive: boolean }

export function buildMetricRows(input: MetricInput): DayMetricRow[] {
  if (input.from > input.to) return [];
  const placed: Placed[] = input.entries
    .map(e => {
      const at = new Date(e.occurredAt);
      const cat = e.categoryId ? input.categories.get(e.categoryId) : undefined;
      const qa = e.quickActionId ? input.quickActions.get(e.quickActionId) : undefined;
      const isSymptom = cat?.kind === 'outcome' || qa?.kind === 'outcome';
      return { e, at, day: trackingDayKey(at, resolveTimeZone(e.timezone, input.timeZone), input.boundaryHour), isSymptom, isReactive: false };
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  // Something logged within 3 h after a symptom is probably a response to it (painkiller, rest).
  let lastSymptom = -Infinity;
  for (const p of placed) {
    const t = p.at.getTime();
    if (p.isSymptom) { lastSymptom = t; continue; }
    if (t - lastSymptom <= REACTIVE_WINDOW_MS) p.isReactive = true;
  }

  const byDay = new Map<string, Placed[]>();
  for (const p of placed) {
    if (p.day < input.from || p.day > input.to) continue;
    const list = byDay.get(p.day);
    if (list) list.push(p); else byDay.set(p.day, [p]);
  }

  return dayKeysBetween(input.from, input.to).map(dayKey => buildDay(dayKey, byDay.get(dayKey) ?? [], input));
}

function buildDay(dayKey: string, list: Placed[], input: MetricInput): DayMetricRow {
  const items = new Map<string, ItemDay>();
  const item = (key: string, label: string, group: string, outcome: boolean): ItemDay => {
    let it = items.get(key);
    if (!it) {
      it = { key, label, group, count: 0, reactive: 0, qty: null, unit: null, mixedUnits: false, maxSev: null, hours: [], outcome };
      items.set(key, it);
    }
    return it;
  };
  const touch = (it: ItemDay, p: Placed, sev: number | null) => {
    it.count++;
    if (p.isReactive) it.reactive++;
    if (sev !== null) it.maxSev = it.maxSev === null ? sev : Math.max(it.maxSev, sev);
    const h = Math.floor(p.at.getTime() / 3600000);
    if (!it.hours.includes(h)) it.hours.push(h);
  };

  let water: number | null = null;
  let exercise: number | null = null;
  let walkExtra: number | null = null;
  let manualSleep: number | null = null;
  let manualQuality: number | null = null;
  let logSleep = null as { hours: number; source: SleepSourceTag; quality: number | null } | null;
  let energy: number | null = null;
  let stress: number | null = null;
  let mood: number | null = null;
  let global: number | null = null;
  let noSymptoms = false;
  let explicitFlare = false;
  let checkIn = false;
  const severities: number[] = [];
  let symptomEntries = 0;
  let active = 0;
  const activeHours = new Set<number>();

  const plus = (cur: number | null, add: number) => (cur ?? 0) + add;

  for (const p of list) {
    const e = p.e;
    const cat = e.categoryId ? input.categories.get(e.categoryId) : undefined;
    const qa = e.quickActionId ? input.quickActions.get(e.quickActionId) : undefined;
    const question = e.questionId ? input.questions.get(e.questionId) : undefined;
    const auto = e.source === 'sleep' || e.source === 'activity';
    if (!auto) { active++; activeHours.add(Math.floor(p.at.getTime() / 3600000)); }
    if (p.isSymptom) symptomEntries++;

    // Automatic sleep entry (Health Connect / tracker / day buttons): one per night.
    if (e.source === 'sleep') {
      const a = e.answers?.[0];
      const vals = a?.values ?? [];
      const minutes = num(vals.find(v => v.fieldKey === 'sleep_duration_minutes')?.value);
      const src = String(vals.find(v => v.fieldKey === 'sleep_source')?.value ?? 'buttons') as SleepSourceTag;
      const quality = QUALITY_SCORE[String(vals.find(v => v.fieldKey === 'sleep_quality')?.value ?? '')] ?? null;
      if (minutes !== null) {
        const hours = minutes / 60;
        const tag: SleepSourceTag = SLEEP_RANK[src] ? src : 'buttons';
        if (!logSleep || SLEEP_RANK[tag] > SLEEP_RANK[logSleep.source]) logSleep = { hours, source: tag, quality: quality ?? logSleep?.quality ?? null };
        else if (quality !== null && logSleep.quality === null) logSleep.quality = quality;
      }
      continue;
    }
    if (e.source === 'activity') continue;

    const entrySevs: number[] = [];
    for (const a of e.answers ?? []) {
      const optId = String(a.optionId ?? '');
      const range = maxRange(a.values);
      if (optId === NO_SYMPTOMS_OPTION_ID) { noSymptoms = true; checkIn = true; continue; }
      if (optId === PATIENT_GLOBAL_OPTION_ID) { if (range !== null) global = Math.min(10, Math.max(0, range)); checkIn = true; continue; }
      if (optId === ENERGY_OPTION_ID) { if (range !== null) energy = Math.min(10, Math.max(0, range)); checkIn = true; continue; }
      if (optId === STRESS_OPTION_ID) { if (range !== null) stress = Math.min(10, Math.max(0, range)); checkIn = true; continue; }
      if (optId.startsWith('feeling:')) {
        const face = optId.slice('feeling:'.length);
        if (FEELING_SCORE[face] !== undefined) mood = FEELING_SCORE[face];
        if (optId === FEELING_FLARE_OPTION_ID) explicitFlare = true;
        checkIn = true;
        touch(item(`feel_${face}`, `Feeling ${face}`, 'feeling', false), p, null);
        continue;
      }
      if (optId === TIMER_OPTION_ID) continue; // the quick tap's own amount, counted below
      if (!optId || optId.includes(':')) continue;

      if (p.isSymptom && range !== null) { severities.push(range); entrySevs.push(range); }
      const keyId = input.optionMerge?.get(optId) ?? optId;
      const group = input.optionCategory.get(keyId) ?? input.optionCategory.get(optId) ?? e.categoryId ?? 'none';
      const it = item(`opt_${keyId}`, a.optionLabelSnapshot || 'Item', group, p.isSymptom);
      touch(it, p, p.isSymptom ? range : range);
      const amount = answerAmount(a.values);
      addAmount(it, amount);

      // Daily numbers the question feeds.
      const role = question?.metricRole ?? null;
      if (role === 'water' && amount?.unit === 'ml') water = plus(water, amount.value);
      if (role === 'exercise') exercise = plus(exercise, amount?.unit === 's' ? amount.value / 60 : 0);
      if (role === 'walk' && amount?.unit === 's') walkExtra = plus(walkExtra, amount.value / 60);
      if (role === 'sleep') {
        if (amount?.unit === 's') manualSleep = amount.value / 3600;
        const label = (a.optionLabelSnapshot ?? '').toLowerCase();
        const q = /poor|bad/.test(label) ? 1 : /fair|okay|ok/.test(label) ? 2 : /great|excellent|restful/.test(label) ? 4 : /good/.test(label) ? 3 : null;
        if (q !== null) manualQuality = q;
      }
    }

    if (cat && e.categoryId) {
      const it = item(`cat_${e.categoryId}`, cat.label, e.categoryId, p.isSymptom);
      touch(it, p, entrySevs.length ? Math.max(...entrySevs) : null);
    }
    if (qa && e.quickActionId) {
      const it = item(`qa_${e.quickActionId}`, qa.label, `qa:${e.quickActionId}`, qa.kind === 'outcome');
      touch(it, p, entrySevs.length ? Math.max(...entrySevs) : null);
      if (qa.kind === 'outcome' && FLARE_TAP_LABEL.test(qa.label)) explicitFlare = true;
      // A tap's amount: what it recorded (water ml, timer seconds), else its default amount.
      const timer = e.answers?.find(a => a.optionId === TIMER_OPTION_ID || a.optionId === 'qa:amount');
      let amount = timer ? answerAmount(timer.values) : null;
      if (!amount && (e.answers?.length ?? 0) === 0 && typeof qa.defaultValue === 'number' && qa.defaultValue > 0) {
        const c = canonicalFor({ dataType: 'number', value: qa.defaultValue, unit: qa.unit });
        amount = c !== undefined ? { value: c, unit: baseUnitOf(qa.unit, 'number') } : { value: qa.defaultValue, unit: normaliseUnit(qa.unit) ?? null };
      }
      addAmount(it, amount);
      if (qa.metricRole === 'water' && amount?.unit === 'ml') water = plus(water, amount.value);
      if (qa.metricRole === 'walk' && amount?.unit === 's') walkExtra = plus(walkExtra, amount.value / 60);
      if (qa.metricRole === 'exercise' && amount?.unit === 's') exercise = plus(exercise, amount.value / 60);
    }
  }

  // Sleep: one value per night, best usable source first (phone, tracker, day buttons, typed hours).
  // A night outside 2–16 h is a mistaken tap or a missed bedtime, so the next source is tried.
  const usable = (h: number | null) => h !== null && h >= 2 && h <= 16;
  let sleepHours: number | null = null;
  let sleepSource: SleepSourceTag | null = null;
  if (logSleep && usable(logSleep.hours)) { sleepHours = logSleep.hours; sleepSource = logSleep.source; }
  if (sleepHours === null) {
    const session = input.sessions.get(dayKey);
    const prev = input.sessions.get(shiftDayKey(dayKey, -1));
    if (session?.wakeTime && prev?.sleepTime) {
      const h = (new Date(session.wakeTime).getTime() - new Date(prev.sleepTime).getTime()) / 3600000;
      if (usable(h)) { sleepHours = h; sleepSource = 'buttons'; }
    }
  }
  if (sleepHours === null && usable(manualSleep)) { sleepHours = manualSleep; sleepSource = 'manual'; }

  const walkSessions = input.walkMinutes.get(dayKey);
  const walkMin = walkSessions !== undefined || walkExtra !== null ? (walkSessions ?? 0) + (walkExtra ?? 0) : null;
  const sessionExercise = input.exerciseMinutes.get(dayKey);
  const exerciseMin = sessionExercise !== undefined || exercise !== null ? (sessionExercise ?? 0) + (exercise ?? 0) : null;
  const weather = input.weather.get(dayKey);
  const doses = input.doses.get(dayKey) ?? [];
  const dosesMarked = doses.some(d => d.taken + d.skipped + d.extra > 0);

  let symptomBasis: SymptomBasis = 'none';
  if (symptomEntries > 0) symptomBasis = 'symptom_entry';
  else if (noSymptoms || global !== null || explicitFlare || checkIn) symptomBasis = 'check_in';
  else if (active >= 2 && activeHours.size >= 2) symptomBasis = 'weak';

  return {
    dayKey,
    logged: { any: active > 0 || dosesMarked, entryCount: active, symptomBasis },
    items: [...items.values()].map(i => ({ ...i, qty: i.qty === null ? null : r2(i.qty), hours: i.hours.sort((a, b) => a - b) })),
    metrics: {
      sleepHours: sleepHours === null ? null : r2(sleepHours),
      sleepSource,
      sleepQuality: logSleep?.quality ?? manualQuality,
      steps: input.steps.get(dayKey) ?? null,
      walkMin: walkMin === null ? null : Math.round(walkMin),
      exerciseMin: exerciseMin === null ? null : Math.round(exerciseMin),
      waterMl: water === null ? null : Math.round(water),
      energy, stress, mood,
      patientGlobal: global,
      symptomMax: severities.length ? Math.max(...severities) : null,
      symptomCount: symptomEntries,
      flareDay: explicitFlare || input.flareDays.has(dayKey),
      tMaxC: weather?.tMaxC ?? null,
      tMinC: weather?.tMinC ?? null,
      humidity: weather?.humidity ?? null,
      pressureHpa: weather?.pressureHpa ?? null,
      pressureDelta: weather?.pressureDelta ?? null,
      uvMax: weather?.uvMax ?? null,
      precipMm: weather?.precipMm ?? null,
    },
    doses,
  };
}
