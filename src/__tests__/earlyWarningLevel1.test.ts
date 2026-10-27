import { DayRow } from '../services/insights/dayTable';
import { shiftDayKey } from '../utils/dayKey';
import { featureVector, standardize, vectorSimilarity } from '../services/insights/earlyWarningFeatures';
import { DEFAULT_LEVEL1_CONFIG, evaluateLevel1Series } from '../services/insights/earlyWarningLevel1';

const START = '2026-01-01';
function row(dayKey: string, over: Partial<DayRow> = {}): DayRow {
  return {
    dayKey, symptomObserved: true, observedBasis: 'symptom_entry', exposureObserved: true,
    entryCount: 1, distinctHours: 1, engagement: 0, nonSymptomEntries: 0, symptoms: [], exposures: [], reactiveCount: 0,
    symptomPresent: true, symptomMax: 4, symptomMean: 4, patientGlobal: null, noSymptomsCheckIn: false,
    explicitFlare: false, steps: 6000, walkMinutes: null, wakeTime: null, sleepTime: null, sleepHours: 7,
    ...over,
  };
}
const at = (i: number) => shiftDayKey(START, i);

describe('featureVector', () => {
  it('averages severity, steps and sleep over the trailing window, and tracks how much was logged', () => {
    const rows = [
      row(at(0), { symptomMax: 4, steps: 5000, sleepHours: 7 }),
      row(at(1), { symptomMax: 6, steps: 3000, sleepHours: 6 }),
      row(at(2), { symptomObserved: false, symptomPresent: false, symptomMax: null, steps: null, sleepHours: null, observedBasis: 'none' }),
    ];
    const v = featureVector(rows, at(2), 3);
    expect(v.severityMean).toBe(5);
    expect(v.severityMax).toBe(6);
    expect(v.severitySlope).toBe(2); // 6 - 4
    expect(v.steps).toBe(4000);
    expect(v.sleepHours).toBe(6.5);
    expect(v.loggedShare).toBeCloseTo(2 / 3, 5);
  });

  it('is all-null for a window with nothing logged', () => {
    const v = featureVector([], at(10), 7);
    expect(v).toMatchObject({ severityMean: null, steps: null, sleepHours: null, loggedShare: 0 });
  });
});

describe('standardize + vectorSimilarity', () => {
  it('a vector is most similar to itself', () => {
    const ref = [
      { severityMean: 4, severityMax: 5, severitySlope: 0, steps: 6000, sleepHours: 7, sleepMidpoint: 400, loggedShare: 1 },
      { severityMean: 5, severityMax: 6, severitySlope: 1, steps: 5000, sleepHours: 6.5, sleepMidpoint: 410, loggedShare: 1 },
      { severityMean: 6, severityMax: 7, severitySlope: -1, steps: 4000, sleepHours: 6, sleepMidpoint: 420, loggedShare: 1 },
      { severityMean: 3, severityMax: 4, severitySlope: 0, steps: 7000, sleepHours: 7.5, sleepMidpoint: 390, loggedShare: 1 },
      { severityMean: 7, severityMax: 8, severitySlope: 2, steps: 3000, sleepHours: 5.5, sleepMidpoint: 430, loggedShare: 1 },
    ];
    const a = standardize(ref[0], ref);
    expect(vectorSimilarity(a, a)).toBeCloseTo(1, 6);
  });

  it('treats a missing feature as neutral rather than crashing', () => {
    const ref = Array.from({ length: 6 }, (_, i) => ({
      severityMean: 4 + i, severityMax: 5, severitySlope: 0, steps: 5000, sleepHours: 7, sleepMidpoint: 400, loggedShare: 1,
    }));
    const v = { ...ref[0], steps: null };
    expect(() => standardize(v, ref)).not.toThrow();
  });
});

/** Builds a history with ordinary days, plus `flareCount` flares each preceded by the same signature: low steps, high severity. */
function buildHistory(flareCount: number, ordinaryDays = 200): { rows: DayRow[]; flareRanges: Array<{ startDay: string; endDay: string }> } {
  const rows: DayRow[] = [];
  const flareRanges: Array<{ startDay: string; endDay: string }> = [];
  let i = 0;
  const addOrdinary = (n: number) => {
    for (let k = 0; k < n; k++) { rows.push(row(at(i), { symptomMax: 3 + (k % 2), steps: 6000 + (k % 3) * 200 })); i++; }
  };
  const addSignatureWindow = () => {
    for (let k = 0; k < 7; k++) { rows.push(row(at(i), { symptomMax: 7 + (k % 2), steps: 1500 + (k % 2) * 100 })); i++; }
  };
  const addFlare = () => {
    const startDay = at(i);
    rows.push(row(at(i), { symptomMax: 9, explicitFlare: true }));
    const endDay = at(i);
    flareRanges.push({ startDay, endDay });
    i++;
    addOrdinary(30); // refractory + settle, well clear of the next signature window
  };

  addOrdinary(40); // enough history before the first exemplar can be built
  for (let f = 0; f < flareCount; f++) { addSignatureWindow(); addFlare(); }
  addOrdinary(ordinaryDays);
  return { rows, flareRanges };
}

describe('evaluateLevel1Series', () => {
  it('never alerts with no past flares to learn from', () => {
    const rows = Array.from({ length: 60 }, (_, k) => row(at(k)));
    const days = evaluateLevel1Series(rows, []);
    expect(days.every(d => !d.alert && d.bestSimilarity === null)) .toBe(true);
  });

  it('says nothing before a full 7-day window of history exists', () => {
    const rows = Array.from({ length: 5 }, (_, k) => row(at(k)));
    const days = evaluateLevel1Series(rows, []);
    expect(days.every(d => !d.alert)).toBe(true);
  });

  it('flags a day whose trailing week repeats a past pre-flare signature', () => {
    const { rows, flareRanges } = buildHistory(3, 10);
    // Append a fresh window that repeats the same "low steps, high severity" signature
    const lastDay = rows[rows.length - 1].dayKey;
    const extra: DayRow[] = [];
    for (let k = 0; k < 7; k++) { extra.push(row(shiftDayKey(lastDay, k + 1), { symptomMax: 7 + (k % 2), steps: 1500 + (k % 2) * 100 })); }
    const all = [...rows, ...extra];

    const days = evaluateLevel1Series(all, flareRanges);
    const today = days[days.length - 1];
    expect(today.bestSimilarity).not.toBeNull();
    expect(today.alert).toBe(true);
    expect(today.closeExemplars).toBeGreaterThanOrEqual(2);
  });

  it('does not flag an ordinary day among the same history', () => {
    const { rows, flareRanges } = buildHistory(3, 10);
    const days = evaluateLevel1Series(rows, flareRanges);
    const ordinaryDay = days.find(d => d.dayKey === at(39)); // well before any flare, a plain ordinary day
    expect(ordinaryDay?.alert).toBe(false);
  });

  it('never builds an exemplar from a flare that has not happened yet (no lookahead)', () => {
    const { rows, flareRanges } = buildHistory(1, 5);
    // Evaluate only up to just before the single flare: with 0 PRIOR flares, there is nothing to resemble
    const beforeFlare = rows.filter(r => r.dayKey < flareRanges[0].startDay);
    const days = evaluateLevel1Series(beforeFlare, flareRanges);
    expect(days.every(d => !d.alert)).toBe(true);
  });

  it('uses the default export config without crashing on an empty history', () => {
    expect(evaluateLevel1Series([], [], DEFAULT_LEVEL1_CONFIG)).toEqual([]);
  });
});
