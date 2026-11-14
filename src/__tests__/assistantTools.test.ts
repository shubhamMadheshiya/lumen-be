/**
 * Lumen AI tools read the member's own data only. Every model query each tool makes is recorded
 * and must carry the caller's userId; caps keep a tool reply small.
 */
import mongoose from 'mongoose';
import { runTool, TOOL_DECLARATIONS, TOOL_NAMES, type ToolContext } from '../services/llm/assistant/dataTools';
import { getPhotoForAi } from '../services/llm/assistant/mediaBytes';
import { loadPersistedDayRows, loadFlareDayKeys } from '../services/insights/dayTableService';

type Call = { model: string; method: string; filter: Record<string, unknown> };
const mockCalls: Call[] = [];
const mockData: Record<string, unknown[]> = {};

function mockModel(name: string) {
  const chain = (result: () => unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ['sort', 'limit', 'select']) q[m] = () => q;
    q.lean = async () => result();
    q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
    return q;
  };
  return {
    find: (filter: Record<string, unknown>) => { mockCalls.push({ model: name, method: 'find', filter }); return chain(() => mockData[name] ?? []); },
    findOne: (filter: Record<string, unknown>) => { mockCalls.push({ model: name, method: 'findOne', filter }); return chain(() => (mockData[name] ?? [])[0] ?? null); },
  };
}

jest.mock('../models/LogEntry', () => ({ LogEntry: mockModel('LogEntry') }));
jest.mock('../models/Category', () => ({ Category: mockModel('Category') }));
jest.mock('../models/Note', () => ({ Note: mockModel('Note') }));
jest.mock('../models/Task', () => ({ Task: mockModel('Task') }));
jest.mock('../models/Medication', () => ({ Medication: mockModel('Medication') }));
jest.mock('../models/HealthRecord', () => ({ HealthRecord: mockModel('HealthRecord') }));
jest.mock('../models/DaySession', () => ({ DaySession: mockModel('DaySession') }));
jest.mock('../models/DailyActivity', () => ({ DailyActivity: mockModel('DailyActivity') }));
jest.mock('../models/ActivitySession', () => ({ ActivitySession: mockModel('ActivitySession') }));
jest.mock('../models/FlareEpisode', () => ({ FlareEpisode: mockModel('FlareEpisode') }));
jest.mock('../models/Experiment', () => ({ Experiment: mockModel('Experiment') }));
jest.mock('../models/InsightFinding', () => ({ InsightFinding: mockModel('InsightFinding') }));
jest.mock('../models/Media', () => ({ Media: mockModel('Media') }));
jest.mock('../services/insights/dayTableService', () => ({
  loadPersistedDayRows: jest.fn().mockResolvedValue([]),
  loadFlareDayKeys: jest.fn().mockResolvedValue(new Set()),
}));
jest.mock('../services/insightPresenter', () => ({
  presentFindings: jest.fn().mockResolvedValue([]),
  presentProgress: jest.fn().mockReturnValue({ trend: { state: 'steady' } }),
}));
jest.mock('../services/llm/assistant/mediaBytes', () => ({ getPhotoForAi: jest.fn() }));

const ME = new mongoose.Types.ObjectId().toString();
const photoId = new mongoose.Types.ObjectId().toString();
const ctx: ToolContext = { userId: ME, timeZone: 'Asia/Kolkata', boundaryHour: 4, photoAccess: true, today: '2026-11-12' };

const entry = (i: number) => ({
  _id: `e${i}`, occurredAt: new Date('2026-11-10T08:00:00Z'), categoryId: 'c1', note: `note ${i}`,
  answers: [{ optionLabelSnapshot: 'Rash', values: [{ fieldKey: 'severity', dataType: 'range', value: 6 }, { fieldKey: 'photo', dataType: 'image', value: [photoId] }] }],
  mediaIds: [],
});

const userIdOf = (filter: Record<string, unknown>) => (filter.userId == null ? undefined : String(filter.userId));

beforeEach(() => {
  mockCalls.length = 0;
  for (const k of Object.keys(mockData)) delete mockData[k];
  mockData.Category = [{ _id: 'c1', name: 'Skin' }];
  mockData.LogEntry = [entry(1)];
  mockData.Media = [{ _id: photoId, sensitive: true, mimeType: 'image/jpeg' }];
  (getPhotoForAi as jest.Mock).mockResolvedValue({ ok: true, photo: { mimeType: 'image/jpeg', base64: 'AAA', takenAt: new Date('2026-11-10'), sensitive: true } });
});

describe('Lumen AI data tools', () => {
  it('declares exactly the tools it can run', () => {
    expect(TOOL_DECLARATIONS.map(d => d.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it.each(TOOL_NAMES)('%s only ever queries the calling member\'s data', async name => {
    const args = name === 'get_day' ? { date: '2026-11-10' } : name === 'view_photo' ? { mediaId: photoId } : {};
    await runTool(ctx, name, args);
    for (const call of mockCalls) {
      expect({ model: call.model, userId: userIdOf(call.filter) }).toEqual({ model: call.model, userId: ME });
    }
    for (const fn of [loadPersistedDayRows, loadFlareDayKeys] as jest.Mock[]) {
      for (const [uid] of fn.mock.calls) expect(String(uid)).toBe(ME);
      fn.mockClear();
    }
    if (name === 'view_photo') expect(getPhotoForAi).toHaveBeenCalledWith(ME, photoId, true);
  });

  it('caps search_logs at 300 entries however many are asked for', async () => {
    mockData.LogEntry = Array.from({ length: 500 }, (_, i) => entry(i));
    const res = await runTool(ctx, 'search_logs', { limit: 5000 });
    expect(res.response).toMatchObject({ total: 500, returned: 300 });
    expect((res.response.entries as unknown[]).length).toBe(300);
  });

  it('caps a date range at about 400 days', async () => {
    const res = await runTool(ctx, 'search_logs', { from: '2015-01-01', to: '2026-11-12' });
    expect(res.response.from).toBe('2025-10-08');
  });

  it('shows entry values, notes and photo ids, but not photo values as text', async () => {
    const res = await runTool(ctx, 'search_logs', {});
    const [e] = res.response.entries as Array<{ items: Array<{ values: string[] }>; note: string; photoIds: string[]; category: string }>;
    expect(e.category).toBe('Skin');
    expect(e.items[0].values).toEqual(['severity=6']);
    expect(e.note).toBe('note 1');
    expect(e.photoIds).toEqual([photoId]);
  });

  it('lists sensitive photos and says when photo viewing is off', async () => {
    const res = await runTool({ ...ctx, photoAccess: false }, 'list_photos', { text: 'rash' });
    expect(res.response).toMatchObject({ photoAccess: false, total: 1 });
    expect((res.response.photos as Array<{ sensitive: boolean }>)[0].sensitive).toBe(true);
    expect(res.response.notice).toMatch(/turned off/);
  });

  it('view_photo attaches the image, and explains a refusal without one', async () => {
    const ok = await runTool(ctx, 'view_photo', { mediaId: photoId });
    expect(ok.images).toHaveLength(1);
    (getPhotoForAi as jest.Mock).mockResolvedValue({ ok: false, reason: 'photo_access_off' });
    const refused = await runTool({ ...ctx, photoAccess: false }, 'view_photo', { mediaId: photoId });
    expect(refused.images).toBeUndefined();
    expect(refused.response).toMatchObject({ ok: false });
  });

  it('an unknown tool or a failing query becomes a readable error, not a crash', async () => {
    expect((await runTool(ctx, 'drop_database')).response).toHaveProperty('error');
    (loadPersistedDayRows as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    expect((await runTool(ctx, 'get_day_summaries')).response).toHaveProperty('error');
  });
});
