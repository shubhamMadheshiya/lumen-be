import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { isExpoPushToken, sendToUser, setPushTransportForTesting } from '../services/push/pushService';
import { PushToken } from '../models/PushToken';
import { notificationPolicyRouter } from '../routes/notificationPolicy';
import { aiRouter } from '../routes/ai';
import { logsRouter } from '../routes/logs';
import { User } from '../models/User';
import { AiNotification } from '../models/AiNotification';
import { LogEntry } from '../models/LogEntry';
import { deliverAiNote, reactToNewEntries } from '../services/aiNotify/run';

jest.mock('../services/aiNotify/run', () => ({ deliverAiNote: jest.fn(), reactToNewEntries: jest.fn() }));

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const userId = new mongoose.Types.ObjectId();
const jwtToken = jwt.sign({ sub: userId.toString(), type: 'access' }, config.jwt.accessSecret);

const app = express();
app.use(express.json());
app.use('/notification-policy', notificationPolicyRouter);
app.use('/ai', aiRouter);
app.use('/logs', logsRouter);
app.use((err: { statusCode?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.statusCode || 500).json({ success: false, message: err.message });
});
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${jwtToken}`);

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});
afterAll(() => setPushTransportForTesting(null));

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('pushService', () => {
  const tokens = (list: string[]) => jest.spyOn(PushToken, 'find').mockReturnValue({ select: () => ({ lean: async () => list.map(token => ({ token })) }) } as never);

  it('recognises Expo push tokens', () => {
    expect(isExpoPushToken(TOKEN_A)).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[x]')).toBe(true);
    expect(isExpoPushToken('fcm-raw-token')).toBe(false);
  });

  it('sends to every token of the member with title, body, data and channel', async () => {
    tokens([TOKEN_A, TOKEN_B]);
    const f = jest.fn().mockResolvedValue(json({ data: [{ status: 'ok', id: 'r1' }, { status: 'ok', id: 'r2' }] }));
    const later = jest.fn();
    setPushTransportForTesting(f as unknown as typeof fetch, later);
    const res = await sendToUser(userId, { title: 'T', body: 'B', channelId: 'lumen_ai_v1', data: { route: '/ai/1' } });
    expect(res).toEqual({ ok: true, sent: 2 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(JSON.parse(init.body)).toEqual([
      expect.objectContaining({ to: TOKEN_A, title: 'T', body: 'B', channelId: 'lumen_ai_v1', data: { route: '/ai/1' }, priority: 'high' }),
      expect.objectContaining({ to: TOKEN_B }),
    ]);
    expect(later).toHaveBeenCalledWith(expect.any(Function), 30 * 60_000);
  });

  it('forgets tokens Expo says are no longer registered (ticket or receipt)', async () => {
    tokens([TOKEN_A, TOKEN_B]);
    const del = jest.spyOn(PushToken, 'deleteMany').mockResolvedValue({} as never);
    let receiptCheck: () => void = () => undefined;
    const f = jest.fn()
      .mockResolvedValueOnce(json({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'ok', id: 'r2' }] }))
      .mockResolvedValueOnce(json({ data: { r2: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }));
    setPushTransportForTesting(f as unknown as typeof fetch, fn => { receiptCheck = fn; });
    expect(await sendToUser(userId, { title: 'T', body: 'B' })).toEqual({ ok: true, sent: 1 });
    expect(del).toHaveBeenCalledWith({ token: { $in: [TOKEN_A] } });
    receiptCheck();
    await new Promise(r => setTimeout(r, 10));
    expect(f.mock.calls[1][0]).toBe('https://exp.host/--/api/v2/push/getReceipts');
    expect(del).toHaveBeenLastCalledWith({ token: { $in: [TOKEN_B] } });
  });

  it('reports no_token when the member has no phone registered', async () => {
    tokens([]);
    expect(await sendToUser(userId, { title: 'T', body: 'B' })).toEqual({ ok: false, reason: 'no_token' });
  });
});

describe('push token routes', () => {
  it('registers a token for this member and rejects junk', async () => {
    const up = jest.spyOn(PushToken, 'findOneAndUpdate').mockResolvedValue({} as never);
    expect((await auth(request(app).post('/notification-policy/push-token').send({ token: TOKEN_A, platform: 'android' }))).status).toBe(200);
    expect(up).toHaveBeenCalledWith({ token: TOKEN_A }, { $set: expect.objectContaining({ userId, platform: 'android' }) }, expect.objectContaining({ upsert: true }));
    expect((await auth(request(app).post('/notification-policy/push-token').send({ token: 'nope' }))).status).toBe(400);
  });

  it('removes only this member\'s token on logout', async () => {
    const del = jest.spyOn(PushToken, 'deleteOne').mockResolvedValue({} as never);
    await auth(request(app).delete('/notification-policy/push-token').send({ token: TOKEN_A }));
    expect(del).toHaveBeenCalledWith({ token: TOKEN_A, userId });
  });
});

describe('AI notification routes', () => {
  beforeEach(() => {
    jest.spyOn(User, 'findById').mockReturnValue({ select: () => ({ lean: async () => ({ preferences: { aiFullAccess: true } }) }) } as never);
  });

  it('lists recent AI notifications for the app', async () => {
    const find = jest.spyOn(AiNotification, 'find').mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => [{ _id: 'n1', kind: 'briefing', title: 'Hi', body: 'B', route: '/ai/c1', conversationId: 'c1', pushed: false, reason: 'budget', dateKey: '2026-11-16', createdAt: new Date() }] }) }),
    } as never);
    const res = await auth(request(app).get('/ai/notifications?since=2026-11-15T00:00:00Z'));
    expect(res.body.data[0]).toMatchObject({ id: 'n1', kind: 'briefing', route: '/ai/c1', pushed: false, reason: 'budget' });
    expect(find).toHaveBeenCalledWith({ userId: String(userId), createdAt: { $gt: new Date('2026-11-15T00:00:00Z') } });
  });

  it('sends a test, and says when the daily test limit is reached', async () => {
    (deliverAiNote as jest.Mock).mockResolvedValueOnce({ status: 'saved', notification: { _id: 'n2', kind: 'test', title: 'T', body: 'B', route: '/ai/c', pushed: true, dateKey: 'd', createdAt: new Date() } });
    const ok = await auth(request(app).post('/ai/notifications/test'));
    expect(deliverAiNote).toHaveBeenCalledWith(String(userId), 'briefing', { test: true });
    expect(ok.body.data).toMatchObject({ notification: { id: 'n2', pushed: true }, error: null });
    (deliverAiNote as jest.Mock).mockResolvedValueOnce({ status: 'limit' });
    expect((await auth(request(app).post('/ai/notifications/test'))).status).toBe(429);
  });
});

describe('POST /logs', () => {
  it('asks Lumen AI to look at the new entry after answering', async () => {
    jest.spyOn(LogEntry, 'findOne').mockResolvedValue(null as never);
    const doc = { _id: 'e1', toObject: () => ({ _id: 'e1', occurredAt: new Date(), answers: [] }) };
    jest.spyOn(LogEntry, 'create').mockResolvedValue(doc as never);
    jest.spyOn(LogEntry, 'find').mockReturnValue({ select: () => ({ lean: async () => [] }) } as never);
    const body = {
      clientId: '7d9c3f1e-2b4a-4c8d-9e1f-0a2b3c4d5e6f', categoryId: new mongoose.Types.ObjectId().toString(),
      occurredAt: new Date().toISOString(), answers: [], source: 'quick_log', timezone: 'Asia/Kolkata',
    };
    const res = await auth(request(app).post('/logs').send(body));
    expect(res.status).toBe(201);
    expect(reactToNewEntries).toHaveBeenCalledWith(String(userId), [expect.objectContaining({ _id: 'e1' })], []);
  });
});

describe('PUT /notification-policy (Lumen AI fields)', () => {
  it('saves the AI toggles and quarter-hour times, rejecting other times', async () => {
    const { NotificationPolicy } = jest.requireActual('../models/NotificationPolicy');
    const doc = new NotificationPolicy({ userId });
    jest.spyOn(doc, 'save').mockResolvedValue(doc);
    jest.spyOn(NotificationPolicy, 'findOne').mockResolvedValue(doc);

    const ok = await auth(request(app).put('/notification-policy').send({ capabilities: { aiNudge: false }, aiTimes: { briefing: '07:30', checkIn: '21:15' } }));
    expect(ok.status).toBe(200);
    expect(ok.body.data.capabilities).toMatchObject({ aiNudge: false, aiBriefing: true, aiCheckIn: true, aiLogReply: true });
    expect(ok.body.data.aiTimes).toEqual({ briefing: '07:30', nudge: '13:30', checkIn: '21:15' });

    const bad = await auth(request(app).put('/notification-policy').send({ aiTimes: { nudge: '13:20' } }));
    expect(bad.status).toBe(400);
  });
});
