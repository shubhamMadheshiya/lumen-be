import { DayRow } from '../services/insights/dayTable';
import { shiftDayKey } from '../utils/dayKey';
import {
  allBlockOrders, analyseExperiment, Block, blockWindows, experimentEndDay, experimentProgress, MIN_P_VALUE,
  randomBlockOrder, severityValues, tallyBlock, BLOCKS, BLOCKS_WITH, BLOCK_DAYS,
} from '../services/insights/experiments';

const START = '2026-01-05';

describe('randomBlockOrder', () => {
  it('always gives exactly 3 "with" and 3 "without", in some order', () => {
    const rand = (() => { let s = 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; })();
    for (let i = 0; i < 20; i++) {
      const order = randomBlockOrder(rand);
      expect(order).toHaveLength(BLOCKS);
      expect(order.filter(b => b === 'with')).toHaveLength(BLOCKS_WITH);
      expect(order.filter(b => b === 'without')).toHaveLength(BLOCKS - BLOCKS_WITH);
    }
  });

  it('is deterministic for a given generator', () => {
    const seq = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7];
    const freshRand = () => { let i = 0; return () => seq[i++ % seq.length]; };
    expect(randomBlockOrder(freshRand())).toEqual(randomBlockOrder(freshRand()));
  });
});

describe('allBlockOrders', () => {
  it('gives exactly C(6,3) = 20 distinct labellings, each with 3 of each', () => {
    const orders = allBlockOrders();
    expect(orders).toHaveLength(20);
    const keys = new Set(orders.map(o => o.join(',')));
    expect(keys.size).toBe(20);
    for (const o of orders) {
      expect(o.filter(b => b === 'with')).toHaveLength(3);
    }
  });
});

describe('blockWindows and experimentEndDay', () => {
  it('lays out 6 blocks of 7 days each, dropping the washout at the start of each', () => {
    const order: Block[] = ['with', 'without', 'with', 'without', 'with', 'without'];
    const windows = blockWindows(START, order, 2);
    expect(windows).toHaveLength(6);
    expect(windows[0]).toMatchObject({ block: 'with', analysisDays: [shiftDayKey(START, 2), shiftDayKey(START, 3), shiftDayKey(START, 4), shiftDayKey(START, 5), shiftDayKey(START, 6)] });
    expect(windows[1].analysisDays[0]).toBe(shiftDayKey(START, 7 + 2));
    expect(windows.every(w => w.analysisDays.length === BLOCK_DAYS - 2)).toBe(true);
  });

  it('ends 42 days after it starts', () => {
    expect(experimentEndDay(START)).toBe(shiftDayKey(START, BLOCKS * BLOCK_DAYS - 1));
  });
});

describe('experimentProgress', () => {
  const order: Block[] = ['with', 'without', 'with', 'without', 'with', 'without'];

  it('is not started before the schedule begins', () => {
    const p = experimentProgress(START, order, shiftDayKey(START, -1));
    expect(p).toMatchObject({ currentBlockIndex: null, readyForAnalysis: false });
  });

  it('names the current block and day within it', () => {
    const p = experimentProgress(START, order, shiftDayKey(START, 8)); // day index 8 -> block 1, day 2
    expect(p).toMatchObject({ currentBlockIndex: 1, currentBlock: 'without', dayInBlock: 2 });
  });

  it('is ready for analysis exactly on and after the last scheduled day', () => {
    const almostDone = experimentProgress(START, order, shiftDayKey(START, BLOCKS * BLOCK_DAYS - 2));
    expect(almostDone.readyForAnalysis).toBe(false);
    const lastDay = experimentProgress(START, order, shiftDayKey(START, BLOCKS * BLOCK_DAYS - 1));
    expect(lastDay.readyForAnalysis).toBe(true);
    expect(lastDay.currentBlockIndex).toBe(5); // still within the schedule's final day
    expect(lastDay.daysRemaining).toBe(1);

    const dayAfter = experimentProgress(START, order, shiftDayKey(START, BLOCKS * BLOCK_DAYS));
    expect(dayAfter.currentBlockIndex).toBeNull();
    expect(dayAfter.daysRemaining).toBe(0);
  });
});

function row(dayKey: string, over: Partial<DayRow> = {}): DayRow {
  return {
    dayKey, symptomObserved: true, observedBasis: 'symptom_entry', exposureObserved: true,
    entryCount: 1, distinctHours: 1, engagement: 0, nonSymptomEntries: 0, symptoms: [], exposures: [], reactiveCount: 0,
    symptomPresent: false, symptomMax: null, symptomMean: null, patientGlobal: null, noSymptomsCheckIn: false,
    explicitFlare: false, steps: null, walkMinutes: null, wakeTime: null, sleepTime: null, sleepHours: null,
    ...over,
  };
}

describe('tallyBlock', () => {
  it('counts days with the outcome present, out of logged days in the window', () => {
    const rows = [
      row(shiftDayKey(START, 0), { symptoms: [{ key: 'cat_a', label: 'Headache', present: true, max: 5 }] }),
      row(shiftDayKey(START, 1), { symptoms: [] }), // logged, outcome absent
      row(shiftDayKey(START, 2), { symptomObserved: false }), // not logged at all
    ];
    const days = [shiftDayKey(START, 0), shiftDayKey(START, 1), shiftDayKey(START, 2)];
    expect(tallyBlock(rows, 'cat_a', days)).toEqual({ count: 1, total: 2 });
  });
});

describe('severityValues', () => {
  it('reads the day composite for each logged day in the window', () => {
    const rows = [row(shiftDayKey(START, 0), { symptomMax: 6 }), row(shiftDayKey(START, 1), { symptomObserved: false, symptomMax: null })];
    expect(severityValues(rows, [shiftDayKey(START, 0), shiftDayKey(START, 1)])).toEqual([6]);
  });
});

/** Builds 6 blocks' worth of day rows where the outcome appears on `rate` share of each "with" block's days. */
function buildExperimentRows(order: Block[], withRate: number, withoutRate: number): DayRow[] {
  const windows = blockWindows(START, order, 2);
  const rows: DayRow[] = [];
  for (const w of windows) {
    const rate = w.block === 'with' ? withRate : withoutRate;
    w.analysisDays.forEach((d, i) => {
      const present = i < Math.round(rate * w.analysisDays.length);
      rows.push(row(d, { symptoms: present ? [{ key: 'cat_out', label: 'Headache', present: true, max: 6 }] : [] }));
    });
    // washout days are also logged, but should be ignored by the analysis window
    for (let i = 0; i < 2; i++) rows.push(row(shiftDayKey(w.analysisDays[0], -(i + 1)), { symptoms: [{ key: 'cat_out', label: 'Headache', present: true, max: 9 }] }));
  }
  return rows;
}

describe('analyseExperiment', () => {
  it('finds a clear difference when the outcome is far more common in "with" blocks', () => {
    const order: Block[] = ['with', 'without', 'with', 'without', 'with', 'without'];
    const windows = blockWindows(START, order, 2);
    const rows = buildExperimentRows(order, 0.9, 0.1);
    const tallies = windows.map(w => tallyBlock(rows, 'cat_out', w.analysisDays));
    const result = analyseExperiment(windows, tallies);

    expect(result.statistic).toBeGreaterThan(0.5);
    expect(result.pValue).toBeLessThanOrEqual(MIN_P_VALUE + 1e-9);
    expect(result.withCount).toBeGreaterThan(result.withoutCount);
  });

  it('never drops below a p-value of 1/20, however strong the effect', () => {
    const order: Block[] = ['with', 'with', 'with', 'without', 'without', 'without'];
    const windows = blockWindows(START, order, 2);
    const rows = buildExperimentRows(order, 1, 0);
    const tallies = windows.map(w => tallyBlock(rows, 'cat_out', w.analysisDays));
    const result = analyseExperiment(windows, tallies);
    expect(result.pValue).toBeCloseTo(MIN_P_VALUE, 9);
  });

  it('gives a high p-value when there is no real difference', () => {
    const order: Block[] = ['with', 'without', 'without', 'with', 'with', 'without'];
    const windows = blockWindows(START, order, 2);
    const rows = buildExperimentRows(order, 0.5, 0.5);
    const tallies = windows.map(w => tallyBlock(rows, 'cat_out', w.analysisDays));
    const result = analyseExperiment(windows, tallies);
    expect(result.pValue).toBeGreaterThan(0.3);
  });

  it('ignores washout days: a spike only in the washout period does not count', () => {
    const order: Block[] = ['with', 'without', 'with', 'without', 'with', 'without'];
    const windows = blockWindows(START, order, 2);
    // every analysis day is outcome-free; only washout days (already seeded at rate 0 here) carry it
    const rows = buildExperimentRows(order, 0, 0);
    // add a strong signal ONLY in the washout days of "with" blocks (already done by buildExperimentRows,
    // which always seeds washout days as present:true) -> if washout leaked in, withCount would be high
    const tallies = windows.map(w => tallyBlock(rows, 'cat_out', w.analysisDays));
    const result = analyseExperiment(windows, tallies);
    expect(result.withCount).toBe(0);
  });

  it('flags a block as thin when too few of its analysis days were logged', () => {
    const order: Block[] = ['with', 'without', 'with', 'without', 'with', 'without'];
    const windows = blockWindows(START, order, 2);
    const tallies = windows.map((w, i) => (i === 0 ? { count: 0, total: 1 } : { count: 2, total: w.analysisDays.length }));
    const result = analyseExperiment(windows, tallies);
    expect(result.thinBlocks).toBe(1);
  });
});
