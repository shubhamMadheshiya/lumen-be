import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { aiRouter } from '../routes/ai';
import { User } from '../models/User';
import { AiConversation } from '../models/AiConversation';
import { AiWeeklyReport } from '../models/AiWeeklyReport';
import { AiTemplateDraft } from '../models/AiTemplateDraft';
import { Note } from '../models/Note';
import { createAiNote } from '../services/notes/aiNoteWriter';
import { createDoctorVisitNote, runNoteAction } from '../services/notes/aiNoteActions';
import { applyDraft, undoDraft, DraftError } from '../services/templates/aiTemplateDraft';
import { runAssistant } from '../services/llm/assistant/assistant';

jest.mock('../services/notes/aiNoteWriter', () => ({ createAiNote: jest.fn() }));
jest.mock('../services/notes/aiNoteActions', () => ({
  ...jest.requireActual('../services/notes/aiNoteActions'),
  createDoctorVisitNote: jest.fn(), runNoteAction: jest.fn(),
}));
jest.mock('../services/templates/aiTemplateDraft', () => ({
  ...jest.requireActual('../services/templates/aiTemplateDraft'),
  applyDraft: jest.fn(), undoDraft: jest.fn(),
}));
jest.mock('../services/llm/assistant/assistant', () => ({ runAssistant: jest.fn() }));

const app = express();
app.use(express.json());
app.use('/ai', aiRouter);
app.use((err: { statusCode?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.statusCode || 500).json({ success: false, message: err.message });
});
const userId = new mongoose.Types.ObjectId();
const token = jwt.sign({ sub: userId.toString(), type: 'access' }, config.jwt.accessSecret);
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
const oid = () => new mongoose.Types.ObjectId().toString();

let prefs: Record<string, unknown>;
const save = jest.fn();
beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  prefs = { aiFullAccess: true };
  jest.spyOn(User, 'findById').mockImplementation((() => ({
    select: () => {
      const doc = { _id: userId, preferences: prefs, markModified: jest.fn(), save };
      const q = Promise.resolve(doc) as Promise<typeof doc> & { lean: () => Promise<unknown> };
      q.lean = async () => ({ ...doc });
      return q;
    },
  })) as never);
  (createAiNote as jest.Mock).mockResolvedValue({ _id: 'n1', title: 'Saved' });
});

const draftDoc = (over: Record<string, unknown> = {}) => ({
  _id: 'd1', title: 'RA tracking', summary: 's', status: 'draft', categories: [], addOptions: [], quickActions: [], archive: [],
  applied: { created: [], archived: [] }, createdAt: new Date(), ...over,
});

describe('save as note', () => {
  it('saves a chat reply as a note, from the member\'s own conversation only', async () => {
    const mid = new mongoose.Types.ObjectId();
    const find = jest.spyOn(AiConversation, 'findOne').mockResolvedValue({ title: 'Sleep', messages: [{ _id: mid, role: 'assistant', text: '- 7 h average' }] } as never);
    const res = await auth(request(app).post(`/ai/conversations/${oid()}/messages/${mid}/save-note`));
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ noteId: 'n1', title: 'Saved' });
    expect(createAiNote).toHaveBeenCalledWith(String(userId), expect.objectContaining({ title: 'Sleep', markdown: '- 7 h average' }));
    expect(find.mock.calls[0][0]).toMatchObject({ userId: String(userId) });
    expect((await auth(request(app).post(`/ai/conversations/${oid()}/messages/${oid()}/save-note`))).status).toBe(404);
  });

  it('saves a weekly review', async () => {
    jest.spyOn(AiWeeklyReport, 'findOne').mockReturnValue({ lean: async () => ({ weekStart: '2026-11-09', weekEnd: '2026-11-15', text: 'Calmer week.' }) } as never);
    const res = await auth(request(app).post(`/ai/weekly-reports/${oid()}/save-note`));
    expect(res.status).toBe(201);
    expect(createAiNote).toHaveBeenCalledWith(String(userId), expect.objectContaining({ title: 'Weekly review · 2026-11-09 to 2026-11-15', markdown: 'Calmer week.' }));
  });
});

describe('doctor visit and note actions', () => {
  it('writes a doctor-visit note for the chosen weeks', async () => {
    (createDoctorVisitNote as jest.Mock).mockResolvedValue({ ok: true, noteId: 'n5', created: true });
    const res = await auth(request(app).post('/ai/notes/doctor-visit').send({ weeks: 6 }));
    expect(res.body.data).toEqual({ noteId: 'n5', error: null });
    expect(createDoctorVisitNote).toHaveBeenCalledWith(String(userId), 6);
    expect((await auth(request(app).post('/ai/notes/doctor-visit').send({ weeks: 50 }))).status).toBe(400);
  });

  it('runs an action on a note and returns the updated note', async () => {
    (runNoteAction as jest.Mock).mockResolvedValue({ ok: true, noteId: 'n1', created: false });
    jest.spyOn(Note, 'findById').mockReturnValue({ lean: async () => ({ _id: 'n1', title: 'Plan' }) } as never);
    const res = await auth(request(app).post('/ai/notes/n1/action').send({ action: 'summarize' }));
    expect(res.body.data).toMatchObject({ noteId: 'n1', created: false, note: { title: 'Plan' } });
    expect((await auth(request(app).post('/ai/notes/n1/action').send({ action: 'delete_everything' }))).status).toBe(400);
    (runNoteAction as jest.Mock).mockResolvedValue({ ok: false, reason: 'not_found' });
    expect((await auth(request(app).post('/ai/notes/n1/action').send({ action: 'summarize' }))).status).toBe(404);
  });

  it('needs Lumen AI full access', async () => {
    prefs = { aiFullAccess: false };
    expect((await auth(request(app).post('/ai/notes/doctor-visit').send({}))).status).toBe(403);
  });
});

describe('template drafts', () => {
  it('generates a draft from a disease or from the member\'s data', async () => {
    (runAssistant as jest.Mock).mockResolvedValue({ text: 'I proposed RA tracking.', artifacts: [{ type: 'template_draft', id: 'd9', title: 'RA' }] });
    const res = await auth(request(app).post('/ai/template-drafts/generate').send({ request: 'rheumatoid arthritis' }));
    expect(res.body.data).toEqual({ draftId: 'd9', reply: 'I proposed RA tracking.', error: null });
    expect((runAssistant as jest.Mock).mock.calls[0][0].message).toContain('rheumatoid arthritis');
    (runAssistant as jest.Mock).mockResolvedValue({ text: 'Nothing to change.', artifacts: [] });
    const improve = await auth(request(app).post('/ai/template-drafts/generate').send({ mode: 'improve' }));
    expect(improve.body.data).toMatchObject({ draftId: null, error: 'no_draft' });
    expect((runAssistant as jest.Mock).mock.calls[1][0].message).toContain('typing under "Other"');
  });

  it('shows a draft with counts, only to its owner', async () => {
    const find = jest.spyOn(AiTemplateDraft, 'findOne').mockResolvedValue(draftDoc({
      categories: [{ id: 'c1', include: true, questions: [{ id: 'q', include: true, options: [{ id: 'o', include: true }, { id: 'o2', include: true, existingId: 'x' }] }] }],
    }) as never);
    const res = await auth(request(app).get(`/ai/template-drafts/${oid()}`));
    expect(res.body.data).toMatchObject({ id: 'd1', title: 'RA tracking', counts: { categories: 1, options: 1 } });
    expect(find.mock.calls[0][0]).toMatchObject({ userId: String(userId) });
  });

  it('applies with the member\'s edits, undoes, and reports conflicts', async () => {
    (applyDraft as jest.Mock).mockResolvedValue(draftDoc({ status: 'applied', applied: { created: [{ kind: 'category', id: 'c' }], archived: [], at: new Date() } }));
    const ok = await auth(request(app).post(`/ai/template-drafts/${oid()}/apply`).send({ items: { c1: { include: false }, o1: { label: 'Knee' } } }));
    expect(ok.body.data).toMatchObject({ status: 'applied', applied: { created: 1 } });
    expect((applyDraft as jest.Mock).mock.calls[0][2]).toEqual({ c1: { include: false }, o1: { label: 'Knee' } });
    (applyDraft as jest.Mock).mockRejectedValue(new DraftError('NOT_DRAFT', 'This suggestion was already used.'));
    expect((await auth(request(app).post(`/ai/template-drafts/${oid()}/apply`).send({}))).status).toBe(409);
    (undoDraft as jest.Mock).mockResolvedValue(draftDoc({ status: 'undone' }));
    expect((await auth(request(app).post(`/ai/template-drafts/${oid()}/undo`))).body.data.status).toBe('undone');
  });
});

describe('journal setting', () => {
  it('is on by default and can be turned off', async () => {
    expect((await auth(request(app).get('/ai/access'))).body.data.journal).toBe(true);
    const res = await auth(request(app).patch('/ai/settings').send({ journal: false }));
    expect(res.status).toBe(200);
    expect(prefs.aiJournal).toBe(false);
    expect(res.body.data.journal).toBe(false);
  });
});
