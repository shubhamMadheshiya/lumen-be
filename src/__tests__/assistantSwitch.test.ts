import mongoose from 'mongoose';
import { config } from '../config';
import { runAssistant, failureText } from '../services/llm/assistant/assistant';
import { getProvider } from '../services/llm/assistant/providers';
import { runTool } from '../services/llm/assistant/dataTools';

jest.mock('../services/llm/assistant/providers', () => ({ getProvider: jest.fn() }));
jest.mock('../services/llm/assistant/dataTools', () => ({ runTool: jest.fn(), TOOL_DECLARATIONS: [{ name: 'search_logs', description: 'x' }] }));
jest.mock('../services/llm/assistant/mediaBytes', () => ({ getPhotoForAi: jest.fn() }));

let prefs: Record<string, unknown> = {};
jest.mock('../models/User', () => ({
  User: { findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ name: 'S', conditions: [], preferences: { timezone: 'Asia/Kolkata', ...prefs } }) }) })) },
}));

const cfg = config as unknown as { anthropic: { apiKey: string }; gemini: { apiKey: string } };
const ME = new mongoose.Types.ObjectId().toString();

function fakeProvider(steps: unknown[]) {
  const session = { next: jest.fn(), addToolResults: jest.fn(), addUserText: jest.fn() };
  for (const s of steps) session.next.mockResolvedValueOnce(s);
  const startSession = jest.fn(() => session);
  (getProvider as jest.Mock).mockReturnValue({ startSession });
  return { session, startSession };
}

const saved = { a: cfg.anthropic.apiKey, g: cfg.gemini.apiKey };
beforeEach(() => {
  jest.clearAllMocks();
  prefs = {};
  cfg.gemini.apiKey = 'g';
  cfg.anthropic.apiKey = 'a';
  (runTool as jest.Mock).mockResolvedValue({ response: { entries: [] } });
});
afterAll(() => { cfg.anthropic.apiKey = saved.a; cfg.gemini.apiKey = saved.g; });

describe('runAssistant provider switch', () => {
  it('runs on the Claude model the member picked and adds up token usage across rounds', async () => {
    prefs = { aiProvider: 'claude', aiModel: 'claude-sonnet-5-5' };
    const { session, startSession } = fakeProvider([
      { ok: true, text: '', calls: [{ id: 't1', name: 'search_logs', args: {} }], usage: { inputTokens: 10, outputTokens: 5 } },
      { ok: true, text: 'Answer.', calls: [], usage: { inputTokens: 20, outputTokens: 7, cacheReadTokens: 3 } },
    ]);
    const res = await runAssistant({ userId: ME, history: [], message: 'hi' });
    expect(getProvider).toHaveBeenCalledWith('claude');
    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5-5', effort: 'medium' }));
    expect(session.addToolResults).toHaveBeenCalledWith([{ id: 't1', name: 'search_logs', response: { entries: [] }, images: [] }]);
    expect(res).toMatchObject({ text: 'Answer.', provider: 'claude', model: 'claude-sonnet-5-5', fellBack: false, requests: 2 });
    expect(res.usage).toEqual({ inputTokens: 30, outputTokens: 12, cacheReadTokens: 3, cacheWriteTokens: 0 });
  });

  it('falls back to Gemini (and says so) when Claude has no key', async () => {
    cfg.anthropic.apiKey = '';
    prefs = { aiProvider: 'claude', aiModel: 'claude-opus-5-5' };
    fakeProvider([{ ok: true, text: 'Hi', calls: [] }]);
    const res = await runAssistant({ userId: ME, history: [], message: 'hi' });
    expect(getProvider).toHaveBeenCalledWith('gemini');
    expect(res).toMatchObject({ provider: 'gemini', model: 'gemini-3.1-flash-lite', fellBack: true });
  });

  it('asks for a short spoken reply with low effort in voice mode', async () => {
    const { startSession } = fakeProvider([{ ok: true, text: 'Seven hours.', calls: [] }]);
    await runAssistant({ userId: ME, history: [], message: 'neend kaisi rahi?', voice: true });
    const opts = (startSession.mock.calls[0] as unknown as [{ system: string; effort: string }])[0];
    expect(opts.system).toContain('spoken aloud');
    expect(opts.effort).toBe('low');
  });

  it('withholds tools on the last round after nudging once', async () => {
    const call = { ok: true, text: '', calls: [{ id: 't', name: 'search_logs', args: {} }] };
    const { session } = fakeProvider(Array.from({ length: 8 }, () => call).concat([{ ok: true, text: 'Best guess.', calls: [] }] as never[]));
    const res = await runAssistant({ userId: ME, history: [], message: 'everything' });
    expect(res.text).toBe('Best guess.');
    expect(session.addUserText).toHaveBeenCalledTimes(1);
    expect(session.next.mock.calls.at(-1)[0].withTools).toBe(false);
  });

  it('gives a provider-specific message for a bad Claude key and does not retry it', async () => {
    prefs = { aiModel: 'claude-haiku-5-5' };
    const { session } = fakeProvider([{ ok: false, error: 'bad_key' }]);
    const res = await runAssistant({ userId: ME, history: [], message: 'hi' });
    expect(session.next).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ error: 'bad_key', text: failureText('bad_key', 'claude') });
    expect(res.text).toContain('console.anthropic.com');
  });
});
