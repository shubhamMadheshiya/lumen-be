import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { aiRouter } from '../routes/ai';
import { User } from '../models/User';
import { AiConversation } from '../models/AiConversation';
import { UpdateProfileSchema } from '../shared/schemas';
import { resetTtsQuotaForTesting, setTtsFetchForTesting } from '../services/llm/tts';

const app = express();
app.use(express.json());
app.use('/ai', aiRouter);
app.use((err: { statusCode?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.statusCode || 500).json({ success: false, message: err.message });
});

const userId = new mongoose.Types.ObjectId();
const token = jwt.sign({ sub: userId.toString(), type: 'access' }, config.jwt.accessSecret);
const cfg = config as unknown as { anthropic: { apiKey: string }; gemini: { apiKey: string } };

type Prefs = Record<string, unknown>;
let prefs: Prefs;
const save = jest.fn();

/** User.findById(...).select(...) is awaited directly (a document) or with .lean() (plain). */
function mockUser() {
  jest.spyOn(User, 'findById').mockImplementation((() => ({
    select: () => {
      const doc = { _id: userId, preferences: prefs, photoPinHash: undefined, markModified: jest.fn(), save };
      const q = Promise.resolve(doc) as Promise<typeof doc> & { lean: () => Promise<unknown> };
      q.lean = async () => ({ ...doc });
      return q;
    },
  })) as never);
}

const saved = { a: cfg.anthropic.apiKey, g: cfg.gemini.apiKey };
beforeEach(() => {
  jest.restoreAllMocks();
  save.mockReset();
  prefs = { aiFullAccess: true, timezone: 'Asia/Kolkata' };
  cfg.gemini.apiKey = 'g';
  cfg.anthropic.apiKey = '';
  resetTtsQuotaForTesting();
  mockUser();
});
afterAll(() => { cfg.anthropic.apiKey = saved.a; cfg.gemini.apiKey = saved.g; setTtsFetchForTesting(null); });

const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

describe('GET /ai/models', () => {
  it('lists Gemini and Claude, with Claude unavailable until its key is set', async () => {
    const res = await auth(request(app).get('/ai/models'));
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.data.models.map((m: { id: string }) => [m.id, m]));
    expect(byId['gemini-3.1-flash-lite']).toMatchObject({ provider: 'gemini', available: true });
    expect(byId['claude-opus-5-5']).toMatchObject({ provider: 'claude', available: false, inputPerM: 4, outputPerM: 20 });
    expect(res.body.data.current).toMatchObject({ provider: 'gemini', model: 'gemini-3.1-flash-lite' });
    expect(res.body.data.voices.length).toBeGreaterThan(5);
  });
});

describe('PATCH /ai/settings', () => {
  it('needs Lumen AI full access', async () => {
    prefs = { aiFullAccess: false };
    const res = await auth(request(app).patch('/ai/settings').send({ model: 'gemini-3.5-flash-lite' }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AI_ACCESS_OFF');
  });

  it('switches Gemini models', async () => {
    const res = await auth(request(app).patch('/ai/settings').send({ model: 'gemini-3.5-flash-lite' }));
    expect(res.status).toBe(200);
    expect(prefs).toMatchObject({ aiProvider: 'gemini', aiModel: 'gemini-3.5-flash-lite' });
    expect(res.body.data).toMatchObject({ provider: 'gemini', model: 'gemini-3.5-flash-lite', modelLabel: 'Gemini 3.5 Flash-Lite' });
    expect(save).toHaveBeenCalled();
  });

  it('refuses unknown models and Claude without a server key', async () => {
    expect((await auth(request(app).patch('/ai/settings').send({ model: 'gpt-9' }))).body.code).toBe('UNKNOWN_MODEL');
    const res = await auth(request(app).patch('/ai/settings').send({ model: 'claude-opus-5-5', acknowledgeClaude: true }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(prefs.aiModel).toBeUndefined();
  });

  it('needs the Claude notice accepted once before switching to Claude', async () => {
    cfg.anthropic.apiKey = 'a';
    const first = await auth(request(app).patch('/ai/settings').send({ model: 'claude-haiku-5-5' }));
    expect(first.body.code).toBe('CLAUDE_ACK_REQUIRED');
    const ok = await auth(request(app).patch('/ai/settings').send({ model: 'claude-haiku-5-5', acknowledgeClaude: true }));
    expect(ok.status).toBe(200);
    expect(prefs).toMatchObject({ aiProvider: 'claude', aiModel: 'claude-haiku-5-5', aiClaudeAcknowledgedAt: expect.any(Date) });
    expect(ok.body.data).toMatchObject({ provider: 'claude', claudeAcknowledged: true });
    // Once accepted, later switches don't ask again.
    expect((await auth(request(app).patch('/ai/settings').send({ model: 'claude-opus-5-5' }))).status).toBe(200);
  });

  it('saves voice settings and rejects unknown voices', async () => {
    const res = await auth(request(app).patch('/ai/settings').send({ voice: { ttsVoice: 'Puck', natural: false, sttLang: 'hi-IN' } }));
    expect(res.status).toBe(200);
    expect(res.body.data.voice).toEqual({ ttsVoice: 'Puck', natural: false, sttLang: 'hi-IN' });
    expect((await auth(request(app).patch('/ai/settings').send({ voice: { ttsVoice: 'Bogus' } }))).status).toBe(400);
  });

  it('cannot be reached through PATCH /auth/me', () => {
    const parsed = UpdateProfileSchema.parse({ preferences: { aiModel: 'claude-opus-5-5', aiProvider: 'claude', aiVoice: { natural: false }, theme: 'dark' } });
    expect(parsed.preferences).toEqual({ theme: 'dark' });
  });
});

describe('POST /ai/tts', () => {
  it('returns WAV audio in the member\'s voice', async () => {
    prefs = { aiFullAccess: true, aiVoice: { ttsVoice: 'Charon' } };
    const f = jest.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: 'UklGRg==' } }] } }] }) });
    setTtsFetchForTesting(f as unknown as typeof fetch);
    const res = await auth(request(app).post('/ai/tts').send({ text: 'Namaste' }));
    expect(res.body.data).toEqual({ fallback: false, mimeType: 'audio/wav', base64: 'UklGRg==' });
    expect(JSON.parse(f.mock.calls[0][1].body).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Charon');
  });

  it('tells the app to use the phone voice when Gemini TTS fails', async () => {
    setTtsFetchForTesting(jest.fn().mockResolvedValue({ status: 429, ok: false }) as unknown as typeof fetch);
    const res = await auth(request(app).post('/ai/tts').send({ text: 'hi' }));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ fallback: true, reason: 'rate_limited' });
  });

  it('rejects empty or very long text', async () => {
    expect((await auth(request(app).post('/ai/tts').send({ text: '  ' }))).status).toBe(400);
    expect((await auth(request(app).post('/ai/tts').send({ text: 'a'.repeat(1201) }))).status).toBe(400);
  });
});

describe('GET /ai/usage', () => {
  it('prices Claude tokens per model and keeps it to the member', async () => {
    const agg = jest.spyOn(AiConversation, 'aggregate').mockResolvedValue([
      { _id: 'claude-opus-5-5', replies: 3, inputTokens: 100_000, outputTokens: 10_000, cacheReadTokens: 100_000, cacheWriteTokens: 0 },
      { _id: 'gemini-3.1-flash-lite', replies: 9, inputTokens: 50_000, outputTokens: 5_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ] as never);
    const res = await auth(request(app).get('/ai/usage?month=2026-11'));
    expect(res.status).toBe(200);
    const pipeline = agg.mock.calls[0][0] as { $match?: { userId?: unknown } }[];
    expect(String(pipeline[0].$match?.userId)).toBe(String(userId));
    // Opus: (100k + 0.1 × 100k) × $4/M + 10k × $20/M = 0.44 + 0.2
    expect(res.body.data.models[0]).toMatchObject({ model: 'claude-opus-5-5', replies: 3, estimatedUsd: 0.64 });
    expect(res.body.data.models[1]).toMatchObject({ provider: 'gemini', estimatedUsd: 0 });
    expect(res.body.data.totalUsd).toBe(0.64);
  });
});
