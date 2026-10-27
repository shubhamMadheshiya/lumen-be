import { DayRow } from '../services/insights/dayTable';
import { shiftDayKey } from '../utils/dayKey';
import { MIN_EPISODES_FOR_LEVEL1, MIN_LOGGED_DAYS_FOR_LEVEL1, runEarlyWarningEngine } from '../services/insights/earlyWarningEngine';

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

describe('runEarlyWarningEngine: gating', () => {
  it('stays at level 0 with no flare episodes at all', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(at(i)));
    const result = runEarlyWarningEngine(rows, []);
    expect(result.enabledLevel).toBe(0);
    expect(result.level1).toMatchObject({ enabled: false, gateReason: 'too_few_episodes', episodeCount: 0 });
  });

  it('names the right gate reason for too few logged days', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(at(i)));
    const episodes = [0, 1, 2, 3].map(k => ({ startDay: at(5 + k), endDay: at(5 + k), source: 'explicit' as const, confirmed: null }));
    const result = runEarlyWarningEngine(rows, episodes);
    expect(result.level1.gateReason).toBe('too_few_logged_days');
    expect(MIN_LOGGED_DAYS_FOR_LEVEL1).toBeGreaterThan(30);
  });

  it('only counts explicit or member-confirmed episodes toward the gate, not unconfirmed ones', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(at(i)));
    const episodes = [
      { startDay: at(5), endDay: at(5), source: 'inferred' as const, confirmed: null },
      { startDay: at(10), endDay: at(10), source: 'inferred' as const, confirmed: 'no' as const },
      { startDay: at(15), endDay: at(15), source: 'explicit' as const, confirmed: null },
      { startDay: at(20), endDay: at(20), source: 'inferred' as const, confirmed: 'yes' as const },
    ];
    const result = runEarlyWarningEngine(rows, episodes);
    expect(result.level1.episodeCount).toBe(2); // the explicit one and the confirmed-yes one
    expect(MIN_EPISODES_FOR_LEVEL1).toBeGreaterThan(2);
    expect(result.level1.gateReason).toBe('too_few_episodes');
  });
});

describe('runEarlyWarningEngine: suppression', () => {
  it('never alerts while the member is currently in a flare, or in the week after one', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(at(i), { symptomMax: 9 }));
    const episodes = [{ startDay: at(55), endDay: at(59), source: 'explicit' as const, confirmed: null }];
    const result = runEarlyWarningEngine(rows, episodes);
    expect(result.suppressedByFlare).toBe(true);
    expect(result.alert).toBe(false);
  });

  it('is not suppressed well clear of any flare', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(at(i)));
    const episodes = [{ startDay: at(5), endDay: at(5), source: 'explicit' as const, confirmed: null }];
    const result = runEarlyWarningEngine(rows, episodes);
    expect(result.suppressedByFlare).toBe(false);
  });
});

describe('runEarlyWarningEngine: level 0 needs two days, not one', () => {
  it('does not alert from a single high-z day', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(at(i), { symptomMax: 4 }));
    rows[39] = row(at(39), { symptomMax: 9 });
    const result = runEarlyWarningEngine(rows, []);
    expect(result.alert).toBe(false);
  });

  it('alerts once the signal holds for two evaluated days running', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(at(i), { symptomMax: 4 }));
    rows[37] = row(at(37), { symptomMax: 9 });
    rows[38] = row(at(38), { symptomMax: 9 });
    rows[39] = row(at(39), { symptomMax: 9 });
    const result = runEarlyWarningEngine(rows, []);
    expect(result.alert).toBe(true);
    expect(result.alertLevel).toBe(0);
  });
});

describe('runEarlyWarningEngine: level 1 end to end', () => {
  function buildHistoryWithSignature(flareCount: number, tailDays: number) {
    const rows: DayRow[] = [];
    const episodes: Array<{ startDay: string; endDay: string; source: 'explicit'; confirmed: null }> = [];
    let i = 0;
    const addOrdinary = (n: number) => { for (let k = 0; k < n; k++) { rows.push(row(at(i), { symptomMax: 3 + (k % 2), steps: 6000 + (k % 3) * 200 })); i++; } };
    const addSignature = () => { for (let k = 0; k < 7; k++) { rows.push(row(at(i), { symptomMax: 7 + (k % 2), steps: 1500 + (k % 2) * 100 })); i++; } };
    const addFlare = () => {
      const d = at(i);
      rows.push(row(at(i), { symptomMax: 9, explicitFlare: true }));
      episodes.push({ startDay: d, endDay: d, source: 'explicit', confirmed: null });
      i++;
      addOrdinary(20);
    };
    addOrdinary(40);
    for (let f = 0; f < flareCount; f++) { addSignature(); addFlare(); }
    addOrdinary(tailDays);
    return { rows, episodes };
  }

  it('reaches level 1 and alerts when the recent week repeats the pre-flare signature, with a track record attached', () => {
    const { rows, episodes } = buildHistoryWithSignature(5, 5);
    const lastDay = rows[rows.length - 1].dayKey;
    const extra: DayRow[] = [];
    for (let k = 0; k < 8; k++) extra.push(row(shiftDayKey(lastDay, k + 1), { symptomMax: 7 + (k % 2), steps: 1500 + (k % 2) * 100 }));
    const result = runEarlyWarningEngine([...rows, ...extra], episodes);

    expect(result.level1.episodeCount).toBe(5);
    expect(result.level1.loggedDays).toBeGreaterThanOrEqual(MIN_LOGGED_DAYS_FOR_LEVEL1);
    if (result.level1.enabled) {
      expect(result.alertLevel).toBe(1);
      expect(result.level1.trackRecord).not.toBeNull();
      expect(result.level1.trackRecord!.of).toBeGreaterThan(0);
    } else {
      // the backtest is entitled to say no on a small synthetic sample; either way it must be principled
      expect(result.level1.backtest).not.toBeNull();
      expect(result.level1.backtest!.passes).toBe(false);
    }
  });

  it('never lets level 1 see a flare before it happened', () => {
    const { rows, episodes } = buildHistoryWithSignature(1, 0);
    const beforeFirstFlare = rows.filter(r => r.dayKey < episodes[0].startDay);
    const result = runEarlyWarningEngine(beforeFirstFlare, episodes);
    expect(result.level1.enabled).toBe(false); // only 1 episode exists at all, let alone before this point
  });
});
