import { DayRow } from '../services/insights/dayTable';
import { shiftDayKey } from '../utils/dayKey';
import {
  classifyTrend, dailyComposite, goodBadDays, regimeShifts, weeklyMedians, weekKeyOf,
  MIN_WEEKS_FOR_TREND,
} from '../services/insights/progress';

const START = '2026-01-05'; // a Monday

function row(dayKey: string, over: Partial<DayRow> = {}): DayRow {
  return {
    dayKey, symptomObserved: true, observedBasis: 'symptom_entry', exposureObserved: true,
    entryCount: 1, distinctHours: 1, engagement: 0, nonSymptomEntries: 0, symptoms: [], exposures: [], reactiveCount: 0,
    symptomPresent: true, symptomMax: 4, symptomMean: 4, patientGlobal: null, noSymptomsCheckIn: false,
    explicitFlare: false, steps: null, walkMinutes: null, wakeTime: null, sleepTime: null, sleepHours: null,
    ...over,
  };
}
const at = (i: number) => shiftDayKey(START, i);

describe('dailyComposite', () => {
  it('prefers the member\'s own overall score over the worst symptom', () => {
    expect(dailyComposite(row(at(0), { patientGlobal: 6, symptomMax: 9 }))).toBe(6);
    expect(dailyComposite(row(at(0), { patientGlobal: null, symptomMax: 7 }))).toBe(7);
    expect(dailyComposite(row(at(0), { patientGlobal: null, symptomMax: null }))).toBeNull();
  });
});

describe('weekKeyOf', () => {
  it('always resolves to the Monday of that week', () => {
    expect(weekKeyOf('2026-10-27')).toBe('2026-10-26'); // Tuesday -> Monday
    expect(weekKeyOf('2026-10-26')).toBe('2026-10-26'); // already Monday
    expect(weekKeyOf('2026-11-01')).toBe('2026-10-26'); // Sunday -> the Monday before
  });
});

describe('weeklyMedians', () => {
  it('only counts weeks with enough logged days, and takes the median of each', () => {
    const rows = [
      row(at(0), { symptomMax: 2 }), row(at(1), { symptomMax: 4 }), row(at(2), { symptomMax: 6 }), // week 1: 3 days
      row(at(7), { symptomMax: 8 }), row(at(8), { symptomMax: 8 }), // week 2: only 2 days
    ];
    const weeks = weeklyMedians(rows);
    expect(weeks).toEqual([{ weekKey: at(0), medianValue: 4, loggedDays: 3 }]);
  });

  it('ignores days with no composite value', () => {
    const rows = [row(at(0), { symptomMax: 3 }), row(at(1), { symptomPresent: false, symptomMax: null }), row(at(2), { symptomMax: 5 })];
    expect(weeklyMedians(rows, 2)).toEqual([{ weekKey: at(0), medianValue: 4, loggedDays: 2 }]);
  });
});

/** `perWeek` scores repeated across each week's logged days (Mon-Wed), oldest week first. */
function weeksOfRows(perWeek: number[]): DayRow[] {
  const rows: DayRow[] = [];
  perWeek.forEach((v, w) => {
    for (let d = 0; d < 3; d++) rows.push(row(at(w * 7 + d), { symptomMax: v }));
  });
  return rows;
}

describe('classifyTrend', () => {
  it('says there is not enough data under the minimum number of weeks', () => {
    const r = classifyTrend(weeklyMedians(weeksOfRows([5, 5, 5])));
    expect(r.state).toBe('not_enough_data');
    expect(r.weeksNeeded).toBe(MIN_WEEKS_FOR_TREND - 3);
  });

  it('calls it improving for a real, big drop', () => {
    const r = classifyTrend(weeklyMedians(weeksOfRows([8, 7, 6.5, 5, 4, 3, 2, 1])));
    expect(r.state).toBe('improving');
    expect(r.pValue).toBeLessThan(0.1);
    expect(r.estimatedChange).toBeLessThan(-2);
  });

  it('calls it worsening for a real, big rise', () => {
    const r = classifyTrend(weeklyMedians(weeksOfRows([1, 2, 3, 4, 5, 6, 7, 8])));
    expect(r.state).toBe('worsening');
  });

  it('calls a flat series steady', () => {
    const r = classifyTrend(weeklyMedians(weeksOfRows([4, 4.5, 4, 3.5, 4, 4.5, 4, 4])));
    expect(r.state).toBe('steady');
  });

  it('does not call a significant but tiny change improving', () => {
    // steadily falling, but by well under the 2-point / 30% bar
    const r = classifyTrend(weeklyMedians(weeksOfRows([4, 3.95, 3.9, 3.85, 3.8, 3.75, 3.7, 3.65])));
    expect(r.state).toBe('mixed');
  });

  it('does not call a noisy, directionless series steady', () => {
    const r = classifyTrend(weeklyMedians(weeksOfRows([2, 8, 2, 8, 2, 8, 2, 8])));
    expect(r.state).toBe('mixed');
  });

  it('only looks at the most recent weeks when more are given', () => {
    // an old rising run further back than the 12-week window, then 12 recent flat weeks
    const old = weeksOfRows([1, 2, 3, 4]);
    const recent = weeksOfRows(Array(12).fill(5)).map(r => ({ ...r, dayKey: shiftDayKey(r.dayKey, 28) }));
    const r = classifyTrend(weeklyMedians([...old, ...recent]));
    expect(r.weeks).toHaveLength(12);
    expect(r.state).toBe('steady');
  });
});

describe('goodBadDays', () => {
  it('needs a baseline before it will classify anything', () => {
    const rows = [row(at(0)), row(at(1))];
    expect(goodBadDays(rows, new Set())).toEqual({ good: 0, bad: 0, observed: 0, windowDays: 28, goodCutoff: null, badCutoff: null });
  });

  it('judges days against the member\'s own 25th/75th percentile, and always calls a flare day bad', () => {
    // 90-day baseline cycling 2,4,6,8 (p25 roughly 3.5, p75 roughly 6.5), ending with a trailing 28-day window
    const baseline: DayRow[] = Array.from({ length: 90 }, (_, i) => row(shiftDayKey('2026-01-01', i), { symptomMax: [2, 4, 6, 8][i % 4] }));
    const flareDay = baseline[baseline.length - 1].dayKey;
    const result = goodBadDays(baseline, new Set([flareDay]));
    expect(result.goodCutoff).not.toBeNull();
    expect(result.badCutoff).not.toBeNull();
    expect(result.observed).toBeGreaterThan(0);
    expect(result.bad).toBeGreaterThanOrEqual(1); // the flare day counts as bad whatever its score
  });

  it('a low composite score on a flare day is still bad, not good', () => {
    const baseline: DayRow[] = Array.from({ length: 90 }, (_, i) => row(shiftDayKey('2026-01-01', i), { symptomMax: 5 }));
    const last = baseline[baseline.length - 1];
    baseline[baseline.length - 1] = { ...last, symptomMax: 1 };
    const result = goodBadDays(baseline, new Set([last.dayKey]));
    expect(result.bad).toBeGreaterThanOrEqual(1);
  });
});

describe('regimeShifts', () => {
  it('finds nothing in too short a series', () => {
    expect(regimeShifts(weeksOfRows([4]))).toEqual([]);
  });

  it('labels a clear, sustained shift to a higher level', () => {
    const low = Array.from({ length: 40 }, (_, i) => row(at(i), { symptomMax: i % 2 ? 2 : 3 }));
    const high = Array.from({ length: 30 }, (_, i) => row(at(40 + i), { symptomMax: i % 2 ? 8 : 9 }));
    const shifts = regimeShifts([...low, ...high]);
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts.some(s => s.direction === 'up' && s.dayKey >= at(38) && s.dayKey <= at(46))).toBe(true);
  });

  it('labels a shift down the same way', () => {
    const high = Array.from({ length: 40 }, (_, i) => row(at(i), { symptomMax: i % 2 ? 8 : 9 }));
    const low = Array.from({ length: 30 }, (_, i) => row(at(40 + i), { symptomMax: i % 2 ? 2 : 3 }));
    const shifts = regimeShifts([...high, ...low]);
    expect(shifts.some(s => s.direction === 'down')).toBe(true);
  });

  it('says nothing for a steady series', () => {
    const steady = Array.from({ length: 60 }, (_, i) => row(at(i), { symptomMax: i % 2 ? 4 : 5 }));
    expect(regimeShifts(steady)).toEqual([]);
  });
});
