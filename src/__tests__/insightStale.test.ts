import mongoose from 'mongoose';
import { computeInsights } from '../services/insightService';
import { InsightResult } from '../models/InsightResult';
import { InsightRun } from '../models/InsightRun';
import { InsightFinding } from '../models/InsightFinding';
import { rebuildDayTable } from '../services/insights/dayTableService';
import { runInsightEngine } from '../services/insights/insightEngine';
import { syntheticDays } from '../services/insights/testing/synth';

jest.mock('../models/InsightResult', () => ({ InsightResult: { deleteMany: jest.fn(), insertMany: jest.fn() } }));
jest.mock('../models/InsightRun', () => ({ InsightRun: { findOne: jest.fn(), create: jest.fn() } }));
jest.mock('../models/InsightFinding', () => ({ InsightFinding: { find: jest.fn(), bulkWrite: jest.fn(), countDocuments: jest.fn() } }));
jest.mock('../services/insights/dayTableService', () => ({ rebuildDayTable: jest.fn() }));
// Early warning has its own dedicated tests; here it only needs to not hit a real database
jest.mock('../services/insights/earlyWarningService', () => ({ runAndStoreEarlyWarning: jest.fn().mockResolvedValue(undefined) }));

const uid = String(new mongoose.Types.ObjectId());
const makeBuilt = (seed: number, planted = true) => ({
  rows: syntheticDays({
    days: 150, seed, ...(planted ? { planted: { exposure: 0, outcome: 0, lag: 1, rr: 4 } } : {}),
  }),
  timeZone: 'Asia/Kolkata',
  boundaryHour: 4,
});

/** A tiny in-memory stand-in for the findings collection, so two runs can see each other. */
function fakeFindingStore() {
  const store = new Map<string, Record<string, unknown>>();
  (InsightFinding.find as jest.Mock).mockImplementation(async () => Array.from(store.values()));
  (InsightFinding.bulkWrite as jest.Mock).mockImplementation(async (ops: Array<{ updateOne: { filter: Record<string, unknown>; update: { $set: Record<string, unknown> } } }>) => {
    for (const { updateOne } of ops) {
      const f = updateOne.filter;
      const key = `${f.exposureKey}|${f.outcomeKey}|${f.lagDays}`;
      store.set(key, { ...(store.get(key) ?? { exposureKey: f.exposureKey, outcomeKey: f.outcomeKey, lagDays: f.lagDays }), ...updateOne.update.$set });
    }
  });
  return store;
}

const shownCount = () => {
  const calls = (InsightResult.insertMany as jest.Mock).mock.calls;
  return calls.length ? calls[calls.length - 1][0].length : 0;
};

describe('runInsightEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (InsightRun.findOne as jest.Mock).mockReturnValue({ sort: () => ({ lean: async () => null }) });
    (InsightRun.create as jest.Mock).mockImplementation(async (d: Record<string, unknown>) => ({ ...d, _id: new mongoose.Types.ObjectId() }));
    (InsightFinding.countDocuments as jest.Mock).mockResolvedValue(0);
  });

  it('does not show a finding on its first run, and shows it after a second day', async () => {
    fakeFindingStore();
    const built = makeBuilt(11);
    const day1 = new Date('2026-06-10T08:00:00Z');
    const first = await runInsightEngine(uid, built, day1);
    expect(first.shown).toEqual({ possible: 0, consistent: 0 });
    expect(InsightResult.insertMany).not.toHaveBeenCalled();

    const second = await runInsightEngine(uid, built, new Date('2026-06-11T08:00:00Z'));
    expect(second.shown.possible + second.shown.consistent).toBeGreaterThan(0);
    expect(shownCount()).toBeGreaterThan(0);
  });

  it('clears the old screen results when nothing may be shown, instead of leaving stale ones', async () => {
    fakeFindingStore();
    await runInsightEngine(uid, makeBuilt(12, false), new Date('2026-06-10T08:00:00Z'));
    expect(InsightResult.deleteMany).toHaveBeenCalledTimes(1);
    expect(InsightResult.insertMany).not.toHaveBeenCalled();
  });

  it('a finding that stops being supported leaves after two days, not one', async () => {
    fakeFindingStore();
    const planted = makeBuilt(13);
    await runInsightEngine(uid, planted, new Date('2026-06-10T08:00:00Z'));
    await runInsightEngine(uid, planted, new Date('2026-06-11T08:00:00Z'));
    expect(shownCount()).toBeGreaterThan(0);

    const noise = makeBuilt(13, false);
    await runInsightEngine(uid, noise, new Date('2026-06-12T08:00:00Z'));
    expect(shownCount()).toBeGreaterThan(0); // one weaker day is not enough
    const writesAfterOneWeakDay = (InsightResult.insertMany as jest.Mock).mock.calls.length;

    await runInsightEngine(uid, noise, new Date('2026-06-13T08:00:00Z'));
    // after two weaker days the screen results are cleared and nothing is written back
    expect((InsightResult.insertMany as jest.Mock).mock.calls.length).toBe(writesAfterOneWeakDay);
    expect(InsightResult.deleteMany).toHaveBeenCalledTimes(4);
  });

  it('skips the work when the data, day and engine are unchanged', async () => {
    fakeFindingStore();
    const built = makeBuilt(14);
    const day = new Date('2026-06-10T08:00:00Z');
    await runInsightEngine(uid, built, day);
    const { hashDays } = await import('../services/insights/insightEngine');
    (InsightRun.findOne as jest.Mock).mockReturnValue({
      sort: () => ({ lean: async () => ({ dataHash: hashDays(built.rows), dayKey: '2026-06-10', engineVersion: 1, eligibleTests: 7 }) }),
    });
    (InsightRun.create as jest.Mock).mockClear();
    const again = await runInsightEngine(uid, built, day);
    expect(again.skipped).toBe(true);
    expect(InsightRun.create).not.toHaveBeenCalled();
  });
});

describe('computeInsights', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (InsightRun.findOne as jest.Mock).mockReturnValue({ sort: () => ({ lean: async () => null }) });
    (InsightRun.create as jest.Mock).mockImplementation(async (d: Record<string, unknown>) => ({ ...d, _id: new mongoose.Types.ObjectId() }));
    (InsightFinding.find as jest.Mock).mockResolvedValue([]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('rebuilds the day table on every run and then analyses it', async () => {
    (rebuildDayTable as jest.Mock).mockResolvedValue(makeBuilt(15, false));
    await computeInsights(uid);
    expect(rebuildDayTable).toHaveBeenCalledWith(uid);
    expect(InsightRun.create).toHaveBeenCalledTimes(1);
  });

  it('keeps what was shown before when the day table cannot be built', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    (rebuildDayTable as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(computeInsights(uid)).resolves.toBeUndefined();
    expect(InsightRun.create).not.toHaveBeenCalled();
    expect(InsightResult.deleteMany).not.toHaveBeenCalled();
  });
});
