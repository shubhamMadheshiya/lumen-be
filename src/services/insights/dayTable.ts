/**
 * Turns raw logs into one row per Lumen day: what was observed, which exposures happened, which
 * symptoms were present, and passive context. Every Insights feature reads this table, so the
 * rules about silence, reactive taps and day boundaries live in exactly one place.
 *
 * Pure functions only; `dayTableService.ts` does the database work.
 */
import { AnalysisKind } from './analysisKind';
import { dayKeysBetween, resolveTimeZone, shiftDayKey, trackingDayKey } from '../../utils/dayKey';

export const DAY_TABLE_VERSION = 1;

/** Option ids of the evening check-in (also written by the app). */
export const NO_SYMPTOMS_OPTION_ID = 'checkin:no_symptoms';
export const PATIENT_GLOBAL_OPTION_ID = 'checkin:global';
/** The feeling card's "Flare" face counts as the member saying they are flaring. */
export const FEELING_FLARE_OPTION_ID = 'feeling:flare';

const FLARE_TAP_LABEL = /\bflare\b/i;

/** A tap or entry logged this soon after a symptom is treated as a response to it, not a cause. */
export const REACTIVE_WINDOW_MS = 3 * 3600000;
/** Weaker evidence that the member was logging on a day: this many entries over this many hours. */
const WEAK_MIN_ENTRIES = 2;
const WEAK_MIN_HOURS = 2;

export interface EntryInput {
  occurredAt: Date;
  timezone?: string;
  source?: string;
  categoryId?: string;
  quickActionId?: string;
  answers: Array<{
    optionId: string;
    optionLabelSnapshot: string;
    values?: Array<{ dataType: string; value?: unknown; canonicalValue?: number }>;
  }>;
}

export interface ItemInfo {
  label: string;
  kind: AnalysisKind;
}

export interface DayTableInput {
  entries: EntryInput[];
  /** Keyed by category id / quick action id. */
  categories: Map<string, ItemInfo>;
  quickActions: Map<string, ItemInfo>;
  /** Steps per tracking day (DailyActivity.date). */
  steps: Map<string, number>;
  /** Walking minutes per tracking day. */
  walkMinutes: Map<string, number>;
  /** DaySession per sessionDate. */
  sessions: Map<string, { wakeTime?: Date; sleepTime?: Date }>;
  timeZone: string;
  boundaryHour: number;
  /** Inclusive range to emit rows for; defaults to first..last entry day. */
  from?: string;
  to?: string;
}

export interface ExposureRow { key: string; label: string; count: number; afterSymptomCount: number; firstAt: Date; lastAt: Date }
export interface SymptomRow { key: string; label: string; present: boolean; max: number | null }

export type ObservedBasis = 'symptom_entry' | 'check_in' | 'weak' | 'none';

export interface DayRow {
  dayKey: string;
  /** True when "no symptom logged" can be read as "no symptom" for this day. */
  symptomObserved: boolean;
  observedBasis: ObservedBasis;
  exposureObserved: boolean;
  entryCount: number;
  distinctHours: number;
  /** log(1 + entries that are not symptoms): how busy the member's logging was, for adjustment. */
  engagement: number;
  /** Entries that are not symptoms, so an exposure test can leave out its own entries. */
  nonSymptomEntries: number;
  symptoms: SymptomRow[];
  exposures: ExposureRow[];
  reactiveCount: number;
  symptomPresent: boolean;
  symptomMax: number | null;
  symptomMean: number | null;
  patientGlobal: number | null;
  noSymptomsCheckIn: boolean;
  explicitFlare: boolean;
  steps: number | null;
  walkMinutes: number | null;
  wakeTime: Date | null;
  sleepTime: Date | null;
  sleepHours: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

interface Classified {
  at: Date;
  day: string;
  hour: number;
  isSymptom: boolean;
  isReactive: boolean;
  isExposure: boolean;
  symptoms: Array<{ key: string; label: string; max: number | null }>;
  exposureKeys: Array<{ key: string; label: string }>;
  severities: number[];
  noSymptoms: boolean;
  patientGlobal: number | null;
  explicitFlare: boolean;
}

function classify(e: EntryInput, input: DayTableInput): Classified {
  const zone = resolveTimeZone(e.timezone, input.timeZone);
  const at = new Date(e.occurredAt);
  const day = trackingDayKey(at, zone, input.boundaryHour);
  const cat = e.categoryId ? input.categories.get(e.categoryId) : undefined;
  const qa = e.quickActionId ? input.quickActions.get(e.quickActionId) : undefined;
  const kinds = [cat?.kind, qa?.kind].filter((k): k is AnalysisKind => !!k);

  const out: Classified = {
    at, day,
    hour: Math.floor(at.getTime() / 3600000),
    isSymptom: kinds.includes('outcome'),
    isReactive: kinds.includes('reactive') && !kinds.includes('outcome'),
    isExposure: kinds.includes('exposure') && !kinds.includes('outcome') && !kinds.includes('reactive'),
    symptoms: [], exposureKeys: [], severities: [],
    noSymptoms: false, patientGlobal: null, explicitFlare: false,
  };

  const severities: number[] = [];
  // The "Flare now" quick tap is the member saying they are flaring
  if (out.isSymptom && qa && FLARE_TAP_LABEL.test(qa.label)) out.explicitFlare = true;
  for (const a of e.answers ?? []) {
    if (a.optionId === NO_SYMPTOMS_OPTION_ID) out.noSymptoms = true;
    if (a.optionId === FEELING_FLARE_OPTION_ID) out.explicitFlare = true;
    const range = (a.values ?? []).find(v => v.dataType === 'range');
    if (a.optionId === PATIENT_GLOBAL_OPTION_ID) {
      const g = range ? num(range.canonicalValue ?? range.value) : null;
      if (g !== null) out.patientGlobal = Math.min(10, Math.max(0, g));
    }
    if (out.isSymptom) {
      const sev = range ? num(range.canonicalValue ?? range.value) : null;
      if (sev !== null) severities.push(sev);
      if (!a.optionId.includes(':')) out.symptoms.push({ key: `opt_${a.optionId}`, label: a.optionLabelSnapshot, max: sev });
    }
    if (out.isExposure && !a.optionId.includes(':')) out.exposureKeys.push({ key: `opt_${a.optionId}`, label: a.optionLabelSnapshot });
  }
  out.severities = severities;

  if (out.isSymptom && cat && e.categoryId) {
    out.symptoms.push({ key: `cat_${e.categoryId}`, label: cat.label, max: severities.length ? Math.max(...severities) : null });
  }
  if (out.isSymptom && qa && e.quickActionId) {
    out.symptoms.push({ key: `qa_${e.quickActionId}`, label: qa.label, max: severities.length ? Math.max(...severities) : null });
  }
  if (out.isExposure) {
    if (qa && e.quickActionId) out.exposureKeys.push({ key: `qa_${e.quickActionId}`, label: qa.label });
    if (cat && e.categoryId) out.exposureKeys.push({ key: `cat_${e.categoryId}`, label: cat.label });
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function buildDayRows(input: DayTableInput): DayRow[] {
  const classified = input.entries.map(e => classify(e, input)).sort((a, b) => a.at.getTime() - b.at.getTime());
  if (classified.length === 0 && !input.from) return [];

  const first = input.from ?? classified[0].day;
  const last = input.to ?? classified[classified.length - 1].day;
  if (first > last) return [];

  const byDay = new Map<string, Classified[]>();
  for (const c of classified) byDay.set(c.day, [...(byDay.get(c.day) ?? []), c]);
  const symptomTimes = classified.filter(c => c.isSymptom).map(c => c.at.getTime());

  // Whether a symptom was logged within the reactive window before `t`
  const followsSymptom = (t: number) => symptomTimes.some(s => s <= t && t - s <= REACTIVE_WINDOW_MS);

  return dayKeysBetween(first, last).map(dayKey => {
    const items = byDay.get(dayKey) ?? [];
    const hours = new Set(items.map(i => i.hour));

    const symptomItems = items.filter(i => i.isSymptom);
    const severities = symptomItems.flatMap(i => i.severities);
    const symptomMap = new Map<string, SymptomRow>();
    for (const i of symptomItems) {
      for (const s of i.symptoms) {
        const prev = symptomMap.get(s.key);
        const max = s.max === null ? prev?.max ?? null : Math.max(prev?.max ?? -Infinity, s.max);
        symptomMap.set(s.key, { key: s.key, label: s.label, present: true, max });
      }
    }

    const exposureMap = new Map<string, ExposureRow>();
    let reactiveCount = items.filter(i => i.isReactive).length;
    for (const i of items.filter(x => x.isExposure)) {
      const reactive = followsSymptom(i.at.getTime());
      for (const k of i.exposureKeys) {
        const prev = exposureMap.get(k.key) ?? { key: k.key, label: k.label, count: 0, afterSymptomCount: 0, firstAt: i.at, lastAt: i.at };
        if (reactive) prev.afterSymptomCount++; else prev.count++;
        if (i.at < prev.firstAt) prev.firstAt = i.at;
        if (i.at > prev.lastAt) prev.lastAt = i.at;
        exposureMap.set(k.key, prev);
      }
      if (reactive) reactiveCount++;
    }
    // An item only taken in response to symptoms is not an exposure that day
    const exposures = Array.from(exposureMap.values()).filter(x => x.count > 0);

    const noSymptomsCheckIn = items.some(i => i.noSymptoms);
    const globals = items.map(i => i.patientGlobal).filter((g): g is number => g !== null);
    const patientGlobal = globals.length ? globals[globals.length - 1] : null;

    const session = input.sessions.get(dayKey);
    const weak = !!session && items.length >= WEAK_MIN_ENTRIES && hours.size >= WEAK_MIN_HOURS;
    const explicitFlare = items.some(i => i.explicitFlare);
    let observedBasis: ObservedBasis = 'none';
    if (symptomItems.length > 0) observedBasis = 'symptom_entry';
    else if (noSymptomsCheckIn || patientGlobal !== null || explicitFlare) observedBasis = 'check_in';
    else if (weak) observedBasis = 'weak';

    const prev = input.sessions.get(shiftDayKey(dayKey, -1));
    const wake = session?.wakeTime ?? null;
    let sleepHours: number | null = null;
    if (prev?.sleepTime && wake) {
      const h = (new Date(wake).getTime() - new Date(prev.sleepTime).getTime()) / 3600000;
      if (h >= 2 && h <= 16) sleepHours = Math.round(h * 100) / 100;
    }

    return {
      dayKey,
      symptomObserved: observedBasis !== 'none',
      observedBasis,
      // Any logging at all means exposures that day were being recorded
      exposureObserved: items.length > 0,
      entryCount: items.length,
      distinctHours: hours.size,
      engagement: Math.log(1 + items.filter(i => !i.isSymptom).length),
      nonSymptomEntries: items.filter(i => !i.isSymptom).length,
      symptoms: Array.from(symptomMap.values()),
      exposures,
      reactiveCount,
      symptomPresent: symptomItems.length > 0 || explicitFlare,
      symptomMax: severities.length ? Math.max(...severities) : null,
      symptomMean: severities.length ? Math.round(mean(severities) * 100) / 100 : null,
      patientGlobal,
      noSymptomsCheckIn,
      explicitFlare,
      steps: input.steps.get(dayKey) ?? null,
      walkMinutes: input.walkMinutes.get(dayKey) ?? null,
      wakeTime: wake ? new Date(wake) : null,
      sleepTime: session?.sleepTime ? new Date(session.sleepTime) : null,
      sleepHours,
    };
  });
}
