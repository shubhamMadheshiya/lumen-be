import { DayRow } from '../services/insights/dayTable';
import { shiftDayKey } from '../utils/dayKey';
import { cusum, robustZ } from '../services/insights/earlyWarningFeatures';
import { evaluateLevel0Series } from '../services/insights/earlyWarningLevel0';

const START = '2026-06-01';
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

describe('robustZ', () => {
  it('is null with too little baseline', () => {
    expect(robustZ(9, [1, 2, 3])).toBeNull();
  });

  it('scores a clear outlier high against a steady baseline', () => {
    const baseline = Array.from({ length: 20 }, (_, i) => 4 + (i % 2));
    expect(robustZ(9, baseline)).toBeGreaterThan(2.5);
    expect(robustZ(4, baseline)).toBeLessThan(1);
  });

  it('never divides by zero on a perfectly flat baseline', () => {
    const flat = Array.from({ length: 15 }, () => 4);
    expect(robustZ(4, flat)).toBe(0);
    expect(Number.isFinite(robustZ(10, flat) as number)).toBe(true);
  });
});

describe('cusum', () => {
  it('stays at 0 for a flat or negative series', () => {
    const out = cusum([0, -0.2, 0.1, -0.5, 0.3]);
    expect(out.every(o => !o.alert)).toBe(true);
  });

  it('fires once a sustained rise accumulates past h, then resets', () => {
    const out = cusum([1.5, 1.5, 1.5, 1.5, 1.5], { k: 0.5, h: 3 });
    const firstAlert = out.findIndex(o => o.alert);
    expect(firstAlert).toBeGreaterThan(0);
    expect(out[firstAlert].s).toBeGreaterThan(3); // the value that crossed h
    expect(out[firstAlert + 1]?.s).toBeLessThan(2); // starts fresh again afterwards, not still elevated
  });

  it('ignores a single spike that is not sustained', () => {
    const out = cusum([0, 0, 3, 0, 0, 0], { k: 0.5, h: 4 });
    expect(out.every(o => !o.alert)).toBe(true);
  });

  it('passes null values through without breaking the running sum', () => {
    const out = cusum([1, null, 1, null, 1], { k: 0.3, h: 100 });
    // s: 0.7 (z=1), 0.7 (null, unchanged), 1.4 (z=1), 1.4 (null), 2.1 (z=1)
    expect(out.map(o => Math.round(o.s * 10) / 10)).toEqual([0.7, 0.7, 1.4, 1.4, 2.1]);
  });
});

describe('evaluateLevel0Series', () => {
  it('does not alert until the baseline has enough logged days', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(at(i), { symptomMax: 4 }));
    const days = evaluateLevel0Series(rows);
    expect(days.slice(0, 10).every(d => d.z === null)).toBe(true);
  });

  it('says nothing for a steady member (a wobble, not a trend)', () => {
    // several distinct values on a short period, so even a partial early baseline stays well-spread
    const cycle = [3, 4, 5, 4];
    const rows = Array.from({ length: 80 }, (_, i) => row(at(i), { symptomMax: cycle[i % cycle.length] }));
    const days = evaluateLevel0Series(rows);
    // the first ~10-13 days, before a full baseline exists, can see a spurious reading from the
    // small, possibly-unbalanced sample; judge steady-state behaviour from day 28 (a full baseline) on
    expect(days.filter(d => d.dayKey >= at(28)).every(d => !d.alert)).toBe(true);
  });

  it('raises a z-alert on two high days out of the last three', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(at(i), { symptomMax: 4 }));
    rows[38] = row(at(38), { symptomMax: 9 });
    rows[39] = row(at(39), { symptomMax: 9 });
    const days = evaluateLevel0Series(rows);
    expect(days[days.length - 1]).toMatchObject({ zAlert: true, alert: true });
  });

  it('does not raise it from a single high day', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(at(i), { symptomMax: 4 }));
    rows[39] = row(at(39), { symptomMax: 9 });
    const days = evaluateLevel0Series(rows);
    expect(days[days.length - 1].zAlert).toBe(false);
  });

  it('catches a slow drift earlier than the single-day z threshold would', () => {
    // a gentle, sustained climb, each step well under the z >= 2.5 bar on its own
    const rows = Array.from({ length: 50 }, (_, i) => row(at(i), { symptomMax: 4 }));
    for (let i = 30; i < 50; i++) rows[i] = row(at(i), { symptomMax: 4 + (i - 29) * 0.15 });
    const days = evaluateLevel0Series(rows);
    const firstCusum = days.findIndex(d => d.cusumAlert);
    const firstZ = days.findIndex(d => d.zAlert);
    expect(firstCusum).toBeGreaterThanOrEqual(0);
    expect(firstZ === -1 || firstCusum < firstZ).toBe(true);
  });

  it('skips unobserved days entirely rather than treating them as zero', () => {
    const rows = [
      ...Array.from({ length: 15 }, (_, i) => row(at(i), { symptomMax: 4 })),
      row(at(15), { symptomObserved: false, symptomPresent: false, symptomMax: null, observedBasis: 'none' }),
      row(at(16), { symptomMax: 4 }),
    ];
    const days = evaluateLevel0Series(rows);
    expect(days.map(d => d.dayKey)).not.toContain(at(15));
  });
});
