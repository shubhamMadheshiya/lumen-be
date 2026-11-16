import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { claudeProvider, mapClaudeError, setClaudeClientForTesting, toClaudeTools } from '../services/llm/assistant/providers/claude';
import { resolveModel, listModels, estimateUsd, findModel } from '../services/llm/assistant/models';
import { pcmToWav, resetTtsQuotaForTesting, retryDelayMs, setTtsFetchForTesting, synthesizeSpeech } from '../services/llm/tts';
import type { ToolDeclaration } from '../services/llm/assistant/dataTools';

const cfg = config as unknown as { anthropic: { apiKey: string }; gemini: { apiKey: string } };
const TOOLS: ToolDeclaration[] = [
  { name: 'list_categories', description: 'cats' },
  { name: 'view_photo', description: 'look', parameters: { type: 'object', properties: { mediaId: { type: 'string' } }, required: ['mediaId'] } },
];

function fakeClient(responses: unknown[]) {
  const create = jest.fn();
  for (const r of responses) {
    if (r instanceof Error) create.mockRejectedValueOnce(r);
    else create.mockResolvedValueOnce(r);
  }
  return { create, client: { beta: { messages: { create } } } };
}

const reply = (content: unknown[], stop_reason = 'end_turn') => ({
  content, stop_reason, stop_details: null,
  usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
});

const startSession = () => claudeProvider.startSession({
  model: 'claude-haiku-5-5',
  system: 'sys',
  history: [{ role: 'user', text: 'earlier' }, { role: 'assistant', text: 'earlier answer' }],
  userParts: [{ type: 'text', text: 'what is this?' }, { type: 'image', mimeType: 'image/jpeg', base64: 'IMG' }],
  tools: TOOLS,
  effort: 'medium',
});

describe('Claude provider', () => {
  const savedKey = cfg.anthropic.apiKey;
  beforeEach(() => { cfg.anthropic.apiKey = 'test-key'; });
  afterAll(() => { cfg.anthropic.apiKey = savedKey; });

  it('converts tools to Claude tools (object schema, required kept, empty properties for no-arg tools)', () => {
    expect(toClaudeTools(TOOLS)).toEqual([
      { name: 'list_categories', description: 'cats', input_schema: { type: 'object', properties: {} } },
      { name: 'view_photo', description: 'look', input_schema: { type: 'object', properties: { mediaId: { type: 'string' } }, required: ['mediaId'] } },
    ]);
  });

  it('sends history, image before question, effort, caching and default fallbacks', async () => {
    const { create, client } = fakeClient([reply([{ type: 'text', text: 'A red patch.' }])]);
    setClaudeClientForTesting(client);
    const res = await startSession().next({ withTools: true, timeoutMs: 30_000 });
    expect(res).toEqual({ ok: true, text: 'A red patch.', calls: [], usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 10 } });
    const [params, options] = create.mock.calls[0];
    expect(options).toEqual({ timeout: 30_000 });
    expect(params).toMatchObject({
      model: 'claude-haiku-5-5', system: 'sys', max_tokens: 16_000,
      output_config: { effort: 'medium' }, cache_control: { type: 'ephemeral' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    });
    expect(params.thinking).toBeUndefined();
    expect(params.tools).toHaveLength(2);
    expect(params.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(params.messages[2].content.map((b: { type: string }) => b.type)).toEqual(['image', 'text']);
  });

  it('keeps the whole assistant turn (thinking included) and returns tool results with the photo inside', async () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig-1' };
    const toolUse = { type: 'tool_use', id: 'tu_1', name: 'view_photo', input: { mediaId: 'm1' } };
    const { create, client } = fakeClient([reply([thinking, toolUse], 'tool_use'), reply([{ type: 'text', text: 'Bristol type 6.' }])]);
    setClaudeClientForTesting(client);
    const s = startSession();
    const first = await s.next({ withTools: true, timeoutMs: 30_000 });
    expect(first).toMatchObject({ ok: true, calls: [{ id: 'tu_1', name: 'view_photo', args: { mediaId: 'm1' } }] });
    s.addToolResults([{ id: 'tu_1', name: 'view_photo', response: { ok: true }, images: [{ label: 'Photo m1:', mimeType: 'image/jpeg', base64: 'AAA' }] }]);
    await s.next({ withTools: true, timeoutMs: 30_000 });
    const msgs = create.mock.calls[1][0].messages;
    expect(msgs[3]).toEqual({ role: 'assistant', content: [thinking, toolUse] });
    expect(msgs[4].role).toBe('user');
    expect(msgs[4].content).toHaveLength(1);
    expect(msgs[4].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' });
    expect(msgs[4].content[0].content.map((b: { type: string }) => b.type)).toEqual(['text', 'text', 'image']);
  });

  it('keeps the tools declared but sets tool_choice none when it must answer after tool use', async () => {
    const { create, client } = fakeClient([
      reply([{ type: 'tool_use', id: 'tu_1', name: 'list_categories', input: {} }], 'tool_use'),
      reply([{ type: 'text', text: 'Done.' }]),
    ]);
    setClaudeClientForTesting(client);
    const s = startSession();
    await s.next({ withTools: true, timeoutMs: 30_000 });
    s.addToolResults([{ id: 'tu_1', name: 'list_categories', response: { categories: [] } }]);
    s.addUserText('Answer now using what you have found.');
    await s.next({ withTools: false, timeoutMs: 30_000 });
    const params = create.mock.calls[1][0];
    expect(params.tools).toHaveLength(2);
    expect(params.tool_choice).toEqual({ type: 'none' });
    // The nudge rides in the same user turn as the tool results.
    expect(params.messages.at(-1).content.map((b: { type: string }) => b.type)).toEqual(['tool_result', 'text']);
  });

  it('maps a refusal to blocked', async () => {
    const { client } = fakeClient([{ ...reply([]), stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'bio' } }]);
    setClaudeClientForTesting(client);
    expect(await startSession().next({ withTools: true, timeoutMs: 1000 })).toEqual({ ok: false, error: 'blocked', detail: 'bio' });
  });

  it('maps SDK errors to Lumen errors', () => {
    const h = new Headers();
    expect(mapClaudeError(Anthropic.APIError.generate(429, {}, 'slow down', h)).error.error).toBe('rate_limited');
    expect(mapClaudeError(Anthropic.APIError.generate(401, {}, 'bad key', h)).error.error).toBe('bad_key');
    expect(mapClaudeError(Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, undefined, h)).error.error).toBe('bad_key');
    expect(mapClaudeError(Anthropic.APIError.generate(529, {}, 'overloaded', h)).error.error).toBe('busy');
    expect(mapClaudeError(new Anthropic.APIConnectionTimeoutError()).error.error).toBe('timeout');
    expect(mapClaudeError(Anthropic.APIError.generate(400, {}, 'bad request', h)).error.error).toBe('failed');
  });

  it('says not configured when there is no key', async () => {
    cfg.anthropic.apiKey = '';
    expect(await startSession().next({ withTools: true, timeoutMs: 1000 })).toEqual({ ok: false, error: 'not_configured' });
  });
});

describe('model catalog', () => {
  const saved = { a: cfg.anthropic.apiKey, g: cfg.gemini.apiKey };
  afterEach(() => { cfg.anthropic.apiKey = saved.a; cfg.gemini.apiKey = saved.g; });

  it('uses the chosen Claude model only when Claude has a key', () => {
    cfg.anthropic.apiKey = '';
    expect(resolveModel({ aiModel: 'claude-sonnet-5-5' })).toMatchObject({ model: { id: 'gemini-3.1-flash-lite' }, fellBack: true });
    cfg.anthropic.apiKey = 'k';
    expect(resolveModel({ aiModel: 'claude-sonnet-5-5' })).toMatchObject({ model: { id: 'claude-sonnet-5-5', provider: 'claude' }, fellBack: false });
  });

  it('falls back to the Gemini default for an unknown or missing choice', () => {
    cfg.gemini.apiKey = 'g';
    expect(resolveModel({ aiModel: 'gpt-9' })).toMatchObject({ model: { provider: 'gemini' }, fellBack: true });
    expect(resolveModel(undefined)).toMatchObject({ model: { id: 'gemini-3.1-flash-lite' }, fellBack: false });
  });

  it('lists both providers and prices Claude per million tokens', () => {
    const ids = listModels().map(m => m.id);
    expect(ids).toEqual(expect.arrayContaining(['gemini-3.1-flash-lite', 'claude-opus-5-5', 'claude-haiku-5-5']));
    expect(estimateUsd(findModel('claude-opus-5-5')!, 1_000_000, 100_000)).toBeCloseTo(6);
    expect(estimateUsd(findModel('gemini-3.1-flash-lite')!, 1_000_000, 100_000)).toBe(0);
  });
});

describe('Gemini TTS', () => {
  const savedKey = cfg.gemini.apiKey;
  beforeEach(() => { cfg.gemini.apiKey = 'g'; resetTtsQuotaForTesting(); });
  afterAll(() => { cfg.gemini.apiKey = savedKey; setTtsFetchForTesting(null); });

  const audioResponse = (mimeType: string, data: string, status = 200) => ({
    status, ok: status < 400,
    json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }] }),
  }) as unknown as Response;

  it('writes a valid WAV header around PCM', () => {
    const wav = pcmToWav(Buffer.alloc(480), 24_000);
    expect(wav.length).toBe(44 + 480);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt32LE(40)).toBe(480);
  });

  it('passes WAV through and asks for the chosen voice', async () => {
    const f = jest.fn().mockResolvedValue(audioResponse('audio/wav', 'UklGRg=='));
    setTtsFetchForTesting(f as unknown as typeof fetch);
    expect(await synthesizeSpeech('Namaste', 'Puck')).toEqual({ ok: true, mimeType: 'audio/wav', base64: 'UklGRg==' });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Puck');
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
  });

  it('wraps raw PCM in WAV and uses the default voice for an unknown one', async () => {
    const f = jest.fn().mockResolvedValue(audioResponse('audio/L16;codec=pcm;rate=24000', Buffer.alloc(100).toString('base64')));
    setTtsFetchForTesting(f as unknown as typeof fetch);
    const out = await synthesizeSpeech('hi', 'Bogus');
    expect(out.ok && Buffer.from(out.base64, 'base64').toString('ascii', 0, 4)).toBe('RIFF');
    expect(JSON.parse(f.mock.calls[0][1].body).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
  });

  it('moves to the next TTS model when one is out of daily quota, and skips it until the quota resets', async () => {
    const quota = { status: 429, ok: false, json: async () => ({ error: { details: [{ retryDelay: '3600s' }] } }) } as unknown as Response;
    const f = jest.fn().mockResolvedValueOnce(quota).mockResolvedValue(audioResponse('audio/wav', 'UklGRg=='));
    setTtsFetchForTesting(f as unknown as typeof fetch);
    let now = 1_000_000;
    const modelOf = (url: string) => /models\/([^:]+):/.exec(url)?.[1];
    expect(await synthesizeSpeech('one', 'Kore', () => now)).toMatchObject({ ok: true });
    expect((f.mock.calls as [string][]).map(c => modelOf(c[0]))).toEqual(['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts']);
    await synthesizeSpeech('two', 'Kore', () => now);
    expect(modelOf(f.mock.calls[2][0])).toBe('gemini-3.8-flash-tts');
    now += 3_600_001;
    await synthesizeSpeech('three', 'Kore', () => now);
    expect(modelOf(f.mock.calls[3][0])).toBe('gemini-3.8-flash-lite-tts');
  });

  it('reads the retry delay Google sends, defaulting to a minute', () => {
    expect(retryDelayMs({ error: { details: [{ '@type': 'x' }, { retryDelay: '51722s' }] } })).toBe(51_722_000);
    expect(retryDelayMs(null)).toBe(60_000);
  });

  it('reports rate limits and missing keys instead of throwing', async () => {
    setTtsFetchForTesting(jest.fn().mockResolvedValue(audioResponse('audio/wav', '', 429)) as unknown as typeof fetch);
    expect(await synthesizeSpeech('hi')).toEqual({ ok: false, error: 'rate_limited' });
    cfg.gemini.apiKey = '';
    expect(await synthesizeSpeech('hi')).toEqual({ ok: false, error: 'not_configured' });
  });
});
