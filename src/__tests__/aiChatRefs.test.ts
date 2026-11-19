/** POST /ai/chat with attachments ("refs"), and GET /ai/attachables for the pickers. */
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { aiRouter } from '../routes/ai';
import { User } from '../models/User';
import { AiConversation } from '../models/AiConversation';
import { runAssistant } from '../services/llm/assistant/assistant';
import { listAttachables } from '../services/llm/assistant/attachables';

jest.mock('../services/llm/assistant/assistant', () => ({ runAssistant: jest.fn() }));
jest.mock('../services/llm/assistant/attachables', () => ({
  ...jest.requireActual('../services/llm/assistant/attachables'),
  listAttachables: jest.fn(),
}));

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
beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  prefs = { aiFullAccess: true };
  jest.spyOn(User, 'findById').mockImplementation((() => ({
    select: () => {
      const doc = { _id: userId, preferences: prefs };
      const q = Promise.resolve(doc) as Promise<typeof doc> & { lean: () => Promise<unknown> };
      q.lean = async () => ({ ...doc });
      return q;
    },
  })) as never);
  jest.spyOn(AiConversation.prototype, 'save').mockImplementation(async function (this: unknown) { return this; } as never);
  (runAssistant as jest.Mock).mockResolvedValue({ text: 'Your Hb is a little low.', requests: 2, toolCalls: [], provider: 'gemini', model: 'gemini-3.1-flash-lite', usage: { inputTokens: 1, outputTokens: 1 }, fellBack: false, artifacts: [] });
});

describe('POST /ai/chat with refs', () => {
  it('passes refs to the assistant, stores them on the message and returns them', async () => {
    const nid = oid();
    const fid = oid();
    const refs = [{ kind: 'note', id: nid, title: 'Doctor visit' }, { kind: 'file', id: fid, title: 'cbc.pdf' }];
    const res = await auth(request(app).post('/ai/chat').send({ message: '', refs }));
    expect(res.status).toBe(200);
    expect(runAssistant).toHaveBeenCalledWith(expect.objectContaining({ userId: String(userId), message: '', mediaIds: [], refs }));
    const conv = res.body.data.conversation;
    expect(conv.title).toBe('Doctor visit');
    expect(conv.messages[0]).toMatchObject({ role: 'user', refs });
    expect(conv.messages[1]).toMatchObject({ role: 'assistant', refs: [] });
  });

  it('gives earlier refs to the assistant as history', async () => {
    const conv = new AiConversation({ userId, title: 't', messages: [{ role: 'user', text: 'look', mediaIds: [], refs: [{ kind: 'day', id: '2026-11-17', title: 'Mon, 17 Nov' }] }, { role: 'assistant', text: 'ok', mediaIds: [] }] });
    jest.spyOn(AiConversation, 'findOne').mockResolvedValue(conv as never);
    await auth(request(app).post('/ai/chat').send({ conversationId: String(conv._id), message: 'and the next day?' }));
    const { history } = (runAssistant as jest.Mock).mock.calls[0][0];
    expect(history[0]).toMatchObject({ role: 'user', text: 'look', refs: [expect.objectContaining({ kind: 'day', id: '2026-11-17' })] });
  });

  it('refuses unknown kinds, too many refs or files, and an empty message', async () => {
    const send = (body: object) => auth(request(app).post('/ai/chat').send(body));
    expect((await send({ message: 'x', refs: [{ kind: 'wallet', id: '1', title: 'w' }] })).status).toBe(400);
    expect((await send({ message: 'x', refs: Array.from({ length: 6 }, (_, i) => ({ kind: 'note', id: oid(), title: `n${i}` })) })).status).toBe(400);
    expect((await send({ message: 'x', refs: Array.from({ length: 3 }, () => ({ kind: 'file', id: oid(), title: 'a.pdf' })) })).status).toBe(400);
    expect((await send({ message: '  ' })).status).toBe(400);
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it('does not store a failed turn', async () => {
    (runAssistant as jest.Mock).mockResolvedValue({ text: 'busy', requests: 1, toolCalls: [], provider: 'gemini', model: 'm', usage: { inputTokens: 0, outputTokens: 0 }, fellBack: false, artifacts: [], error: 'busy' });
    const res = await auth(request(app).post('/ai/chat').send({ message: 'hi', refs: [{ kind: 'note', id: oid(), title: 'n' }] }));
    expect(res.body.data).toMatchObject({ conversation: null, error: 'busy' });
  });
});

describe('GET /ai/attachables', () => {
  it('lists one kind for the member', async () => {
    (listAttachables as jest.Mock).mockResolvedValue([{ id: 'n1', title: 'Doctor visit' }]);
    const res = await auth(request(app).get('/ai/attachables?kind=note&q=doc'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'n1', title: 'Doctor visit' }]);
    expect(listAttachables).toHaveBeenCalledWith(String(userId), 'note', 'doc', 50);
  });

  it('refuses an unknown kind and needs full access', async () => {
    expect((await auth(request(app).get('/ai/attachables?kind=wallet'))).status).toBe(400);
    prefs = { aiFullAccess: false };
    expect((await auth(request(app).get('/ai/attachables?kind=note'))).status).toBe(403);
  });
});
