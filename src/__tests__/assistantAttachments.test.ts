/**
 * Chat attachments ("refs"): each kind resolves from the member's own data only, files sit right
 * after their label, data is capped, and history keeps just kind/id/title.
 */
import mongoose from 'mongoose';
import { resolveRef, clipJson, MAX_REF_CHARS } from '../services/llm/assistant/attachments';
import { attachmentParts, historyText } from '../services/llm/assistant/assistant';
import { runTool, type ToolContext } from '../services/llm/assistant/dataTools';
import { getFileForAi, getPhotoForAi } from '../services/llm/assistant/mediaBytes';
import { presentFindings } from '../services/insightPresenter';

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
jest.mock('../models/TaskList', () => ({ TaskList: mockModel('TaskList') }));
jest.mock('../models/Medication', () => ({ Medication: mockModel('Medication') }));
jest.mock('../models/HealthRecord', () => ({ HealthRecord: mockModel('HealthRecord') }));
jest.mock('../models/DaySession', () => ({ DaySession: mockModel('DaySession') }));
jest.mock('../models/FlareEpisode', () => ({ FlareEpisode: mockModel('FlareEpisode') }));
jest.mock('../models/Experiment', () => ({ Experiment: mockModel('Experiment') }));
jest.mock('../models/InsightFinding', () => ({ InsightFinding: mockModel('InsightFinding') }));
jest.mock('../models/AiWeeklyReport', () => ({ AiWeeklyReport: mockModel('AiWeeklyReport') }));
jest.mock('../services/insights/dayTableService', () => ({
  loadPersistedDayRows: jest.fn().mockResolvedValue([]),
  loadFlareDayKeys: jest.fn().mockResolvedValue(new Set()),
}));
jest.mock('../services/insightPresenter', () => ({ presentFindings: jest.fn().mockResolvedValue([]), presentProgress: jest.fn() }));
jest.mock('../services/llm/assistant/mediaBytes', () => ({ getPhotoForAi: jest.fn(), getFileForAi: jest.fn() }));

const ME = new mongoose.Types.ObjectId().toString();
const id = () => new mongoose.Types.ObjectId().toString();
const ctx: ToolContext = { userId: ME, timeZone: 'Asia/Kolkata', boundaryHour: 4, photoAccess: true, today: '2026-11-19' };
const photo = (mimeType = 'application/pdf') => ({ mimeType, base64: 'PDF', takenAt: new Date('2026-11-01'), sensitive: true });

beforeEach(() => {
  mockCalls.length = 0;
  for (const k of Object.keys(mockData)) delete mockData[k];
  (getPhotoForAi as jest.Mock).mockReset().mockResolvedValue({ ok: true, photo: photo() });
  (getFileForAi as jest.Mock).mockReset().mockResolvedValue({ ok: true, file: photo() });
});

const everyQueryIsMine = () => {
  expect(mockCalls.length).toBeGreaterThan(0);
  for (const c of mockCalls) if (c.model !== 'Category') expect(String(c.filter.userId)).toBe(ME);
};

describe('resolveRef', () => {
  it('reads a note as markdown/plain text, only the member\'s own', async () => {
    const nid = id();
    mockData.Note = [{ _id: nid, title: 'Doctor visit', plainText: 'Ask about methotrexate.', updatedAt: new Date() }];
    const res = await resolveRef(ctx, { kind: 'note', id: nid });
    expect(res).toMatchObject({ ok: true, data: { id: nid, title: 'Doctor visit', text: 'Ask about methotrexate.' }, files: [] });
    expect(mockCalls[0].filter).toMatchObject({ _id: nid, deletedAt: null });
    everyQueryIsMine();
  });

  it('says not_found for a missing item and invalid for a bad id', async () => {
    expect(await resolveRef(ctx, { kind: 'note', id: id() })).toEqual({ ok: false, reason: 'not_found' });
    expect(await resolveRef(ctx, { kind: 'task', id: 'temp_1' })).toEqual({ ok: false, reason: 'invalid' });
    expect(await resolveRef(ctx, { kind: 'day', id: '19-11-2026' })).toEqual({ ok: false, reason: 'invalid' });
    expect(await resolveRef(ctx, { kind: 'pattern', id: 'only-one-part' })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reads a task with its steps and list name', async () => {
    const tid = id();
    mockData.Task = [{ _id: tid, title: 'Book blood test', isCompleted: false, isImportant: true, inMyDay: false, listId: 'l1', dueDate: '2026-11-21', steps: [{ title: 'Call lab', completed: true }] }];
    mockData.TaskList = [{ _id: 'l1', name: 'Health' }];
    const res = await resolveRef(ctx, { kind: 'task', id: tid });
    expect(res).toMatchObject({ ok: true, data: { id: tid, title: 'Book blood test', important: true, due: '2026-11-21', steps: ['[x] Call lab'], list: 'Health' } });
    everyQueryIsMine();
  });

  it('reads a list with open and recently completed tasks', async () => {
    const lid = id();
    mockData.TaskList = [{ _id: lid, name: 'Health' }];
    mockData.Task = [{ _id: 't1', title: 'Physio', isCompleted: false, isImportant: false, inMyDay: false }];
    const res = await resolveRef(ctx, { kind: 'list', id: lid });
    expect(res).toMatchObject({ ok: true, data: { name: 'Health', openTasks: [{ title: 'Physio' }] } });
    everyQueryIsMine();
  });

  it('reads a day through get_day', async () => {
    const res = await resolveRef(ctx, { kind: 'day', id: '2026-11-17' });
    expect(res).toMatchObject({ ok: true, data: { date: '2026-11-17', entries: [] } });
    everyQueryIsMine();
  });

  it('includes a health record\'s documents only with photo access', async () => {
    const rid = id();
    const m1 = id();
    mockData.HealthRecord = [{ _id: rid, title: 'CBC', type: 'blood_test', date: new Date('2026-11-01'), mediaIds: [m1], fileNames: ['cbc.pdf'], biomarkers: [{ name: 'Hb', value: 11.2 }] }];
    const on = await resolveRef(ctx, { kind: 'record', id: rid });
    expect(on).toMatchObject({ ok: true, data: { title: 'CBC', documents: 1 }, files: [{ mediaId: m1, mimeType: 'application/pdf', label: 'Document 1 of health record "CBC" (cbc.pdf):' }] });
    expect(getPhotoForAi).toHaveBeenCalledWith(ME, m1, true);

    (getPhotoForAi as jest.Mock).mockResolvedValue({ ok: false, reason: 'photo_access_off' });
    const off = await resolveRef({ ...ctx, photoAccess: false }, { kind: 'record', id: rid });
    expect(off).toMatchObject({ ok: true, files: [], data: { documentsNotice: expect.stringContaining('photo access') } });
  });

  it('reads medicines, flares, experiments and weekly reviews', async () => {
    mockData.Medication = [{ _id: 'm', name: 'Methotrexate', dose: '15', unit: 'mg', active: true, changes: [{ at: '2026-10-01', kind: 'dose_changed' }] }];
    mockData.FlareEpisode = [{ _id: 'f', startDay: '2026-11-02', endDay: '2026-11-05', source: 'inferred', rule: 'r', confirmed: 'yes' }];
    mockData.Experiment = [{ _id: 'e', exposureLabel: 'Dairy', outcomeLabel: 'Bloating', startDay: '2026-10-01', washoutDays: 2, blockOrder: [], status: 'running', isMedicineRelated: false }];
    mockData.AiWeeklyReport = [{ _id: 'w', weekStart: '2026-11-09', weekEnd: '2026-11-15', text: 'Calmer week.' }];
    expect(await resolveRef(ctx, { kind: 'medication', id: id() })).toMatchObject({ ok: true, data: { name: 'Methotrexate', changes: [{ kind: 'dose_changed' }] } });
    expect(await resolveRef(ctx, { kind: 'flare', id: id() })).toMatchObject({ ok: true, data: { start: '2026-11-02', confirmed: 'yes' } });
    expect(await resolveRef(ctx, { kind: 'experiment', id: id() })).toMatchObject({ ok: true, data: { testing: 'Dairy', status: 'running' } });
    expect(await resolveRef(ctx, { kind: 'weekly_report', id: id() })).toMatchObject({ ok: true, data: { text: 'Calmer week.' } });
    everyQueryIsMine();
  });

  it('reads an insight pattern by its exposure|outcome|lag id', async () => {
    mockData.InsightFinding = [{ _id: 'i' }];
    (presentFindings as jest.Mock).mockResolvedValueOnce([{
      id: 'opt_a|opt_b|1', exposure: { optionLabel: 'Dairy' }, outcome: { optionLabel: 'Bloating' }, lagDays: 1, tier: 'strong',
      counts: { exposedWith: 6, exposedTotal: 8, otherWith: 2, otherTotal: 20 }, noLongerSeen: false,
    }]);
    const res = await resolveRef(ctx, { kind: 'pattern', id: 'opt_a|opt_b|1' });
    expect(res).toMatchObject({ ok: true, data: { exposure: 'Dairy', outcome: 'Bloating', daysWithExposure: '6 of 8' } });
    expect(mockCalls[0].filter).toMatchObject({ exposureKey: 'opt_a', outcomeKey: 'opt_b', lagDays: 1 });
    everyQueryIsMine();
  });

  it('reads an attached PDF through getFileForAi and passes its refusal on', async () => {
    const fid = id();
    expect(await resolveRef(ctx, { kind: 'file', id: fid })).toMatchObject({ ok: true, files: [{ mediaId: fid, mimeType: 'application/pdf' }] });
    expect(getFileForAi).toHaveBeenCalledWith(ME, fid);
    (getFileForAi as jest.Mock).mockResolvedValue({ ok: false, reason: 'too_large' });
    expect(await resolveRef(ctx, { kind: 'file', id: fid })).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('attachment parts and history', () => {
  it('puts each file right after its label and notes the ones that failed', async () => {
    const nid = id();
    const fid = id();
    mockData.Note = [{ _id: nid, title: 'Visit', plainText: 'hi', updatedAt: new Date() }];
    const parts = await attachmentParts(ctx, [
      { kind: 'note', id: nid, title: 'Visit' },
      { kind: 'file', id: fid, title: 'cbc.pdf' },
      { kind: 'task', id: 'bad', title: 'Gone' },
    ]);
    expect(parts.map(p => p.type)).toEqual(['text', 'text', 'image', 'text']);
    expect((parts[0] as { text: string }).text).toMatch(/^Attached note "Visit" \[note:.+\]:\n\{/);
    expect((parts[1] as { text: string }).text).toContain('file "cbc.pdf"');
    expect(parts[2]).toMatchObject({ mimeType: 'application/pdf', base64: 'PDF' });
    expect((parts[3] as { text: string }).text).toContain('could not be read');
  });

  it('caps the data of one attachment', () => {
    const big = { text: 'x'.repeat(MAX_REF_CHARS * 2) };
    const out = clipJson(big, MAX_REF_CHARS);
    expect(out.length).toBeLessThan(MAX_REF_CHARS + 200);
    expect(out).toContain('(cut:');
  });

  it('keeps only kind, id and title of earlier attachments in history', () => {
    const text = historyText({ role: 'user', text: 'What do you think?', mediaIds: ['p1'], refs: [{ kind: 'note', id: 'n1', title: 'Visit' }] });
    expect(text).toBe('What do you think?\n(attached photo ids: p1)\n(attached: note "Visit" [note:n1] — use open_attachment to read one again)');
    expect(historyText({ role: 'user', text: '' })).toBe('(attachment)');
  });

  it('open_attachment re-reads an attachment and returns its files', async () => {
    const fid = id();
    const res = await runTool(ctx, 'open_attachment', { kind: 'file', id: fid });
    expect(res.response).toMatchObject({ ok: true, kind: 'file', id: fid });
    expect(res.images).toEqual([expect.objectContaining({ mediaId: fid, mimeType: 'application/pdf' })]);
    expect((await runTool(ctx, 'open_attachment', { kind: 'wallet', id: '1' })).response).toMatchObject({ ok: false });
  });
});
