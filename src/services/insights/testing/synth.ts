/**
 * Deterministic fake members for testing the Insights engine. They are deliberately awkward in the
 * ways real logs are: unlogged days, busy days where more of everything gets logged, symptoms that
 * come in runs, and optionally one planted link. A "null" member has no real link at all, so any
 * finding on one is a false alarm.
 */
import { DayRow } from '../dayTable';
import { shiftDayKey } from '../../../utils/dayKey';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Planted { exposure: number; outcome: number; lag: number; rr: number }

export interface SynthOptions {
  days: number;
  seed: number;
  exposures?: number;
  outcomes?: number;
  /** Share of days with no logging at all. */
  unloggedShare?: number;
  /** How strongly busy logging days lift BOTH exposures and symptoms logged (0 = not at all). */
  busyStrength?: number;
  /** Chance an exposure is eaten on an average day. */
  exposureRate?: number;
  /** Chance a symptom is present on an average day. */
  symptomRate?: number;
  /** One or more planted links: exposure on day d raises the outcome on day d + lag by rr. */
  planted?: Planted | Planted[];
  start?: string;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function syntheticDays(opts: SynthOptions): DayRow[] {
  const rand = mulberry32(opts.seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const nExp = opts.exposures ?? 10;
  const nOut = opts.outcomes ?? 5;
  const unlogged = opts.unloggedShare ?? 0.2;
  const expRate = opts.exposureRate ?? 0.4;
  const symRate = opts.symptomRate ?? 0.25;
  const strength = opts.busyStrength ?? 0.3;
  const start = opts.start ?? '2026-01-01';

  // How busy the member's logging is on each day: it lifts exposures AND symptoms logged together
  const busy: number[] = [];
  let z = 0;
  for (let d = 0; d < opts.days; d++) { z = 0.7 * z + 0.7 * normal(); busy.push(Math.exp(strength * z)); }

  const logged = Array.from({ length: opts.days }, () => rand() >= unlogged);
  const exposed = Array.from({ length: opts.days }, (_, d) =>
    Array.from({ length: nExp }, () => logged[d] && rand() < clamp(expRate * busy[d], 0, 0.9)));

  const plants: Planted[] = opts.planted ? (Array.isArray(opts.planted) ? opts.planted : [opts.planted]) : [];
  const present: boolean[][] = [];
  for (let d = 0; d < opts.days; d++) {
    present.push(Array.from({ length: nOut }, (_, k) => {
      if (!logged[d]) return false;
      let p = symRate * busy[d];
      if (d > 0 && present[d - 1][k]) p *= 1.6; // symptoms come in runs
      for (const plant of plants) {
        if (plant.outcome === k && d - plant.lag >= 0 && exposed[d - plant.lag][plant.exposure]) p *= plant.rr;
      }
      return rand() < clamp(p, 0, 0.95);
    }));
  }

  return Array.from({ length: opts.days }, (_, d): DayRow => {
    const symptoms = present[d].map((on, k) => (on ? { key: `cat_o${k}`, label: `Symptom ${k}`, present: true, max: null } : null))
      .filter((s): s is NonNullable<typeof s> => s !== null);
    const exposures = exposed[d].map((on, j) => (on
      ? { key: `opt_e${j}`, label: `Exposure ${j}`, count: 1, afterSymptomCount: 0, firstAt: new Date(0), lastAt: new Date(0) }
      : null)).filter((e): e is NonNullable<typeof e> => e !== null);
    const nonSymptom = logged[d] ? 1 + exposures.length + Math.max(0, Math.round(busy[d] * 2 - 1)) + Math.floor(rand() * 3) : 0;
    return {
      dayKey: shiftDayKey(start, d),
      symptomObserved: logged[d],
      observedBasis: logged[d] ? (symptoms.length ? 'symptom_entry' : 'check_in') : 'none',
      exposureObserved: logged[d],
      entryCount: nonSymptom + symptoms.length,
      distinctHours: logged[d] ? 3 : 0,
      engagement: Math.log(1 + nonSymptom),
      nonSymptomEntries: nonSymptom,
      symptoms, exposures,
      reactiveCount: 0,
      symptomPresent: symptoms.length > 0,
      symptomMax: null, symptomMean: null, patientGlobal: null,
      noSymptomsCheckIn: false, explicitFlare: false,
      steps: null, walkMinutes: null, wakeTime: null, sleepTime: null, sleepHours: null,
    };
  });
}
