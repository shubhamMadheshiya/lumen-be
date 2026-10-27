import { labelFlares, median, scaledMad } from '../services/insights/flareLabels';
import { DayRow } from '../services/insights/dayTable';
import { shiftDayKey } from '../utils/dayKey';

const START = '2026-09-01';

function row(dayKey: string, over: Partial<DayRow> = {}): DayRow {
  return {
    dayKey, symptomObserved: true, observedBasis: 'symptom_entry', exposureObserved: true,
    entryCount: 1, distinctHours: 1, engagement: 0, nonSymptomEntries: 0, symptoms: [], exposures: [], reactiveCount: 0,
    symptomPresent: true, symptomMax: 3, symptomMean: 3, patientGlobal: null, noSymptomsCheckIn: false,
    explicitFlare: false, steps: null, walkMinutes: null, wakeTime: null, sleepTime: null, sleepHours: null,
    ...over,
  };
}

/** A calm month (severity 3 with a little wobble), then whatever the test appends. */
function calm(days: number): DayRow[] {
  return Array.from({ length: days }, (_, i) => row(shiftDayKey(START, i), { symptomMax: 3 + (i % 3 === 0 ? 1 : 0) }));
}
const at = (i: number) => shiftDayKey(START, i);

describe('labelFlares: explicit', () => {
  it('turns "Flare now" taps into episodes and merges taps within 72 hours', () => {
    const rows = calm(20);
    rows[5] = row(at(5), { explicitFlare: true });
    rows[7] = row(at(7), { explicitFlare: true }); // 2 days later: same episode
    rows[15] = row(at(15), { explicitFlare: true });
    expect(labelFlares(rows).filter(e => e.source === 'explicit')).toEqual([
      { startDay: at(5), endDay: at(7), source: 'explicit', rule: 'flare_tap' },
      { startDay: at(15), endDay: at(15), source: 'explicit', rule: 'flare_tap' },
    ]);
  });
});

describe('labelFlares: inferred', () => {
  it('finds two high days against the member\'s own 28-day baseline', () => {
    const rows = calm(40);
    rows[35] = row(at(35), { symptomMax: 8 });
    rows[36] = row(at(36), { symptomMax: 9 });
    const found = labelFlares(rows);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: 'inferred', startDay: at(35), endDay: at(36) });
  });

  it('does not call a single bad day a flare', () => {
    const rows = calm(40);
    rows[35] = row(at(35), { symptomMax: 9 });
    expect(labelFlares(rows)).toEqual([]);
  });

  it('does not call ordinary wobble a flare', () => {
    const rows = calm(40).map((r, i) => ({ ...r, symptomMax: 3 + (i % 4) }));
    expect(labelFlares(rows)).toEqual([]);
  });

  it('needs enough baseline days before it will guess', () => {
    const rows = calm(8);
    rows[6] = row(at(6), { symptomMax: 9 });
    rows[7] = row(at(7), { symptomMax: 9 });
    expect(labelFlares(rows)).toEqual([]);
  });

  it('waits out a refractory week and keeps flare days out of the baseline', () => {
    const rows = calm(60);
    [35, 36, 37, 38, 39, 40].forEach(i => { rows[i] = row(at(i), { symptomMax: 9 }); });
    const found = labelFlares(rows);
    // one episode through day 37, then the refractory week hides the tail instead of starting another
    expect(found.filter(e => e.source === 'inferred')).toHaveLength(1);
  });

  it('leaves days with no severity out of the run, since silence is not evidence', () => {
    const rows = calm(40);
    rows[35] = row(at(35), { symptomMax: 9 });
    rows[36] = row(at(36), { symptomMax: null, symptomPresent: false, observedBasis: 'none', symptomObserved: false });
    rows[37] = row(at(37), { symptomMax: 9 });
    // day 37 has only one high day among the two before it (35), so it still counts as two of three
    expect(labelFlares(rows).filter(e => e.source === 'inferred')).toHaveLength(1);
  });

  it('does not infer a second episode on top of an explicit one', () => {
    const rows = calm(40);
    rows[35] = row(at(35), { symptomMax: 9, explicitFlare: true });
    rows[36] = row(at(36), { symptomMax: 9 });
    expect(labelFlares(rows).map(e => e.source)).toEqual(['explicit']);
  });
});

describe('robust statistics', () => {
  it('median and scaled MAD ignore a single outlier', () => {
    expect(median([1, 2, 3, 4, 100])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(scaledMad([2, 3, 3, 3, 4, 50])).toBeCloseTo(0.7413, 3);
  });
});
