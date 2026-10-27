import mongoose from 'mongoose';
import { ActivitySession } from '../models/ActivitySession';
import { LogEntry } from '../models/LogEntry';
import { DailyActivity } from '../models/DailyActivity';
import { autoWalkNote, cleanAutoWalks, cleanDailySteps, overlaps, saveAutoWalks, saveDailySteps } from '../services/autoActivity';

jest.mock('../models/ActivitySession', () => ({ ActivitySession: { find: jest.fn(), create: jest.fn() } }));
jest.mock('../models/LogEntry', () => ({ LogEntry: { create: jest.fn() } }));
jest.mock('../models/DailyActivity', () => ({ DailyActivity: { bulkWrite: jest.fn() } }));

const sessions = ActivitySession as unknown as { find: jest.Mock; create: jest.Mock };
const logs = LogEntry as unknown as { create: jest.Mock };
const daily = DailyActivity as unknown as { bulkWrite: jest.Mock };

const NOW = new Date('2026-10-27T12:00:00.000Z').getTime();
const MIN = 60000;
const walk = (over: Record<string, unknown> = {}) => ({
  clientId: 'auto:ios:2026-10-27T10:00',
  startTime: new Date(NOW - 120 * MIN).toISOString(),
  endTime: new Date(NOW - 105 * MIN).toISOString(),
  steps: 1500,
  distanceMeters: 1050,
  timezone: 'Asia/Kolkata',
  ...over,
});

describe('cleanAutoWalks', () => {
  it('keeps a well-formed walk', () => {
    const [w] = cleanAutoWalks([walk()], NOW);
    expect(w.clientId).toBe('auto:ios:2026-10-27T10:00');
    expect(w.steps).toBe(1500);
    expect(w.timezone).toBe('Asia/Kolkata');
  });

  it('drops malformed, implausible or duplicate walks and keeps the rest', () => {
    const out = cleanAutoWalks([
      walk({ clientId: 'manual-123' }), // must be an auto id
      walk({ clientId: 'auto:a', endTime: walk().startTime }), // zero length
      walk({ clientId: 'auto:b', startTime: new Date(NOW - 10 * 60 * MIN).toISOString(), endTime: new Date(NOW - MIN).toISOString(), steps: 99999 }),
      walk({ clientId: 'auto:c', startTime: new Date(NOW + 10 * MIN).toISOString(), endTime: new Date(NOW + 30 * MIN).toISOString() }), // future
      walk({ clientId: 'auto:d', startTime: new Date(NOW - 40 * 24 * 60 * MIN).toISOString(), endTime: new Date(NOW - 40 * 24 * 60 * MIN + 15 * MIN).toISOString() }), // too old
      walk({ clientId: 'auto:e', steps: 'many' }),
      walk(),
      walk(), // same id twice
    ], NOW);
    expect(out.map(w => w.clientId)).toEqual(['auto:ios:2026-10-27T10:00']);
  });

  it('ignores a body that is not a list', () => {
    expect(cleanAutoWalks(undefined, NOW)).toEqual([]);
    expect(cleanAutoWalks({ walks: [] }, NOW)).toEqual([]);
  });
});

describe('cleanDailySteps', () => {
  it('keeps valid days, last one wins for a repeated date', () => {
    expect(cleanDailySteps([
      { date: '2026-10-26', steps: 4000, source: 'ios_motion' },
      { date: '2026-10-26', steps: 4200.4, source: 'ios_motion' },
      { date: '26/10/2026', steps: 10, source: 'ios_motion' },
      { date: '2026-10-25', steps: -1, source: 'ios_motion' },
      { date: '2026-10-24', steps: 10, source: 'fitbit' },
    ])).toEqual([{ date: '2026-10-26', steps: 4200, source: 'ios_motion' }]);
  });
});

describe('autoWalkNote', () => {
  it('reads plainly on the timeline', () => {
    const [w] = cleanAutoWalks([walk()], NOW);
    expect(autoWalkNote(w)).toBe('Walk (auto-detected): 1.1 km in 15 min, about 1,500 steps');
  });
});

describe('saveAutoWalks', () => {
  const userId = new mongoose.Types.ObjectId();
  beforeEach(() => {
    jest.clearAllMocks();
    sessions.create.mockImplementation(async (doc: Record<string, unknown>) => ({ ...doc, _id: new mongoose.Types.ObjectId(), save: jest.fn() }));
    logs.create.mockImplementation(async () => ({ _id: new mongoose.Types.ObjectId() }));
  });

  it('creates a completed AUTO walk and a timeline entry for a new walk', async () => {
    sessions.find.mockResolvedValue([]);
    const created = await saveAutoWalks(userId, cleanAutoWalks([walk()], NOW));
    expect(created).toHaveLength(1);
    expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'AUTO', status: 'COMPLETED', activityType: 'WALKING', steps: 1500, distanceMeters: 1050,
      totalDurationSeconds: 900, hasRouteData: false,
    }));
    expect(logs.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'activity', clientId: 'log:auto:ios:2026-10-27T10:00', timezone: 'Asia/Kolkata',
    }));
  });

  it('never re-creates a walk that already exists, including one the user removed', async () => {
    sessions.find.mockResolvedValueOnce([{ clientId: 'auto:ios:2026-10-27T10:00' }]).mockResolvedValueOnce([]);
    const created = await saveAutoWalks(userId, cleanAutoWalks([walk()], NOW));
    expect(created).toEqual([]);
    expect(sessions.create).not.toHaveBeenCalled();
    expect(logs.create).not.toHaveBeenCalled();
  });

  it('skips a walk the member already timed with Start walking', async () => {
    const [w] = cleanAutoWalks([walk()], NOW);
    sessions.find.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { startTime: new Date(w.startTime.getTime() - 2 * MIN), endTime: new Date(w.endTime.getTime() + MIN) },
    ]);
    await expect(saveAutoWalks(userId, [w])).resolves.toEqual([]);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('treats a duplicate-key race as already saved', async () => {
    sessions.find.mockResolvedValue([]);
    sessions.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    await expect(saveAutoWalks(userId, cleanAutoWalks([walk()], NOW))).resolves.toEqual([]);
  });

  it('does nothing for an empty batch', async () => {
    await expect(saveAutoWalks(userId, [])).resolves.toEqual([]);
    expect(sessions.find).not.toHaveBeenCalled();
  });
});

describe('overlaps', () => {
  const [w] = cleanAutoWalks([walk()], NOW);
  it('spots shared time, including a manual walk still running', () => {
    expect(overlaps(w, new Date(w.startTime.getTime() + MIN), new Date(w.endTime.getTime() + 30 * MIN))).toBe(true);
    expect(overlaps(w, new Date(w.startTime.getTime() - 60 * MIN), null)).toBe(true);
    expect(overlaps(w, new Date(w.endTime.getTime()), new Date(w.endTime.getTime() + 10 * MIN))).toBe(false);
    expect(overlaps(w, new Date(w.startTime.getTime() - 30 * MIN), new Date(w.startTime.getTime()))).toBe(false);
  });
});

describe('saveDailySteps', () => {
  it('upserts one row per day', async () => {
    daily.bulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 1 });
    const userId = new mongoose.Types.ObjectId();
    const n = await saveDailySteps(userId, [
      { date: '2026-10-26', steps: 4000, source: 'health_connect' },
      { date: '2026-10-27', steps: 1200, source: 'health_connect' },
    ]);
    expect(n).toBe(2);
    const ops = daily.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne).toMatchObject({ filter: { userId, date: '2026-10-26' }, upsert: true });
  });
});
