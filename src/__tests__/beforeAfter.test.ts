import { DayRow } from '../services/insights/dayTable';
import { shiftDayKey } from '../utils/dayKey';
import { compareAroundEvent, CompareResult, DEFAULT_WASHOUT_DAYS } from '../services/insights/beforeAfter';

function row(dayKey: string, over: Partial<DayRow> = {}): DayRow {
  return {
    dayKey, symptomObserved: true, observedBasis: 'symptom_entry', exposureObserved: true,
    entryCount: 1, distinctHours: 1, engagement: 0, nonSymptomEntries: 0, symptoms: [], exposures: [], reactiveCount: 0,
    symptomPresent: true, symptomMax: 4, symptomMean: 4, patientGlobal: null, noSymptomsCheckIn: false,
    explicitFlare: false, steps: null, walkMinutes: null, wakeTime: null, sleepTime: null, sleepHours: null,
    ...over,
  };
}

const EVENT = '2026-06-01';
const noFlares = () => 0;

/** `preDays`/`postDays` of rows ending the day before EVENT and starting `washout` days after it. */
function scenario({
  preDays = 28, postDays = 28, preValue = 7, postValue = 3, preSymptomRate = 1, postSymptomRate = 1,
  washout = DEFAULT_WASHOUT_DAYS, lastDay,
}: {
  preDays?: number; postDays?: number; preValue?: number; postValue?: number;
  preSymptomRate?: number; postSymptomRate?: number; washout?: number; lastDay?: string;
} = {}): DayRow[] {
  const rows: DayRow[] = [];
  for (let i = preDays; i >= 1; i--) {
    const present = (i % Math.round(1 / Math.max(preSymptomRate, 0.01))) !== 0 || preSymptomRate >= 1;
    rows.push(row(shiftDayKey(EVENT, -i), { symptomMax: preValue, symptomPresent: preSymptomRate >= 1 ? true : present }));
  }
  for (let i = 0; i < postDays; i++) {
    const present = (i % Math.round(1 / Math.max(postSymptomRate, 0.01))) !== 0 || postSymptomRate >= 1;
    rows.push(row(shiftDayKey(EVENT, washout + i), { symptomMax: postValue, symptomPresent: postSymptomRate >= 1 ? true : present }));
  }
  return rows;
}

const lastDayOf = (rows: DayRow[]) => rows[rows.length - 1].dayKey;

describe('compareAroundEvent: readiness gates', () => {
  it('is not ready with too little data before the event', () => {
    const rows = scenario({ preDays: 5 });
    const r = compareAroundEvent(rows, EVENT, noFlares, DEFAULT_WASHOUT_DAYS, lastDayOf(rows));
    expect(r).toMatchObject({ ready: false, reason: 'not_enough_pre_data', preDays: 5 });
  });

  it('is not ready while still inside the washout period', () => {
    const rows = scenario();
    const tooSoon = shiftDayKey(EVENT, 2); // washout is 7 days
    const r = compareAroundEvent(rows, EVENT, noFlares, DEFAULT_WASHOUT_DAYS, tooSoon);
    expect(r).toMatchObject({ ready: false, reason: 'event_too_recent' });
  });

  it('is not ready with too little data after the washout', () => {
    const rows = scenario({ postDays: 5 });
    const r = compareAroundEvent(rows, EVENT, noFlares, DEFAULT_WASHOUT_DAYS, lastDayOf(rows));
    expect(r).toMatchObject({ ready: false, reason: 'not_enough_post_data', preDays: 28, postDays: 5 });
  });
});

describe('compareAroundEvent: a clear, large improvement', () => {
  const rows = scenario({ preValue: 8, postValue: 2 });
  const result = compareAroundEvent(rows, EVENT, noFlares, DEFAULT_WASHOUT_DAYS, lastDayOf(rows)) as CompareResult;

  it('is ready and reports the right window sizes', () => {
    expect(result.ready).toBe(true);
    expect(result).toMatchObject({ eventDay: EVENT, washoutDays: DEFAULT_WASHOUT_DAYS, preDays: 28, postDays: 28 });
  });

  it('the median shift is negative and its interval does not cross zero', () => {
    expect(result.medianShift.value).toBeCloseTo(-6, 0);
    expect(result.medianShift.ci95[0]).toBeLessThanOrEqual(result.medianShift.value);
    expect(result.medianShift.ci95[1]).toBeGreaterThanOrEqual(result.medianShift.value);
    expect(result.medianShift.ci95[1]).toBeLessThan(0);
  });

  it('is deterministic: the same inputs give the same interval every time', () => {
    const again = compareAroundEvent(rows, EVENT, noFlares, DEFAULT_WASHOUT_DAYS, lastDayOf(rows)) as CompareResult;
    expect(again.medianShift.ci95).toEqual(result.medianShift.ci95);
    expect(again.symptomDayRate.ci95).toEqual(result.symptomDayRate.ci95);
  });
});

describe('compareAroundEvent: symptom-day rate and flares', () => {
  it('reads a drop in how many days had any symptom logged', () => {
    const rows = scenario({ preSymptomRate: 1, postSymptomRate: 0.2 });
    const r = compareAroundEvent(rows, EVENT, noFlares, DEFAULT_WASHOUT_DAYS, lastDayOf(rows)) as CompareResult;
    expect(r.symptomDayRate.value).toBeLessThan(0);
  });

  it('scales flare counts to a per-28-day rate using the caller\'s counts', () => {
    const rows = scenario();
    const countFlares = (from: string, to: string) => (from < EVENT ? 4 : 1); // 4 pre-event, 1 post-event
    const r = compareAroundEvent(rows, EVENT, countFlares, DEFAULT_WASHOUT_DAYS, lastDayOf(rows)) as CompareResult;
    expect(r.preFlares).toBe(4);
    expect(r.postFlares).toBe(1);
    expect(r.flaresPer28.value).toBeLessThan(0);
  });
});

describe('compareAroundEvent: honesty caveats', () => {
  it('flags starting during a rough patch', () => {
    const rows = scenario({ preValue: 4 });
    // the week right before the event was much worse than the rest of the pre-period
    for (let i = 1; i <= 6; i++) {
      const key = shiftDayKey(EVENT, -i);
      const idx = rows.findIndex(r => r.dayKey === key);
      rows[idx] = { ...rows[idx], symptomMax: 9 };
    }
    const r = compareAroundEvent(rows, EVENT, noFlares, DEFAULT_WASHOUT_DAYS, lastDayOf(rows)) as CompareResult;
    expect(r.startedDuringRoughPatch).toBe(true);
  });

  it('does not flag a rough patch when the pre-period was steady', () => {
    const rows = scenario({ preValue: 5 });
    const r = compareAroundEvent(rows, EVENT, noFlares, DEFAULT_WASHOUT_DAYS, lastDayOf(rows)) as CompareResult;
    expect(r.startedDuringRoughPatch).toBe(false);
  });

  it('flags a pre-period that was already improving on its own', () => {
    const rows: DayRow[] = [];
    for (let i = 28; i >= 1; i--) rows.push(row(shiftDayKey(EVENT, -i), { symptomMax: Math.max(1, 9 - Math.floor((28 - i) / 3)) }));
    for (let i = 0; i < 28; i++) rows.push(row(shiftDayKey(EVENT, DEFAULT_WASHOUT_DAYS + i), { symptomMax: 2 }));
    const r = compareAroundEvent(rows, EVENT, noFlares, DEFAULT_WASHOUT_DAYS, lastDayOf(rows)) as CompareResult;
    expect(r.alreadyImproving).toBe(true);
  });

  it('does not flag a flat pre-period as already improving', () => {
    const rows = scenario();
    const r = compareAroundEvent(rows, EVENT, noFlares, DEFAULT_WASHOUT_DAYS, lastDayOf(rows)) as CompareResult;
    expect(r.alreadyImproving).toBe(false);
  });
});

describe('compareAroundEvent: washout', () => {
  it('a longer washout moves the post window later, and days inside it are not counted', () => {
    const rows = scenario({ washout: 14, postDays: 28 });
    const r = compareAroundEvent(rows, EVENT, noFlares, 14, lastDayOf(rows)) as CompareResult;
    expect(r.ready).toBe(true);
    expect(r.washoutDays).toBe(14);
  });
});
