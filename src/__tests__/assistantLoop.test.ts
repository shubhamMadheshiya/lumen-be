import mongoose from 'mongoose';
import { runAssistant, cleanReply, MAX_ROUNDS, EMERGENCY_PREFIX } from '../services/llm/assistant/assistant';
import { generateTurn } from '../services/llm/geminiClient';
import { runTool } from '../services/llm/assistant/dataTools';
import { getPhotoForAi } from '../services/llm/assistant/mediaBytes';

jest.mock('../services/llm/geminiClient', () => ({ generateTurn: jest.fn() }));
jest.mock('../services/llm/assistant/dataTools', () => ({ runTool: jest.fn(), TOOL_DECLARATIONS: [{ name: 'search_logs' }] }));
jest.mock('../services/llm/assistant/mediaBytes', () => ({ getPhotoForAi: jest.fn() }));
jest.mock('../models/User', () => ({
  User: {
    findById: jest.fn(() => ({
      select: () => ({
        lean: async () => ({ name: 'Shubham', conditions: ['lupus'], preferences: { timezone: 'Asia/Kolkata', dayBoundaryHour: 4, aiPhotoAccess: true } }),
      }),
    })),
  },
}));

const ME = new mongoose.Types.ObjectId().toString();
const turn = generateTurn as jest.Mock;
const answer = (text: string) => ({ ok: true, parts: [{ text }], functionCalls: [], text });
const callTool = (name: string, args: object = {}) => ({ ok: true, parts: [{ functionCall: { name, args } }], functionCalls: [{ name, args }], text: '' });

beforeEach(() => {
  jest.clearAllMocks();
  (runTool as jest.Mock).mockResolvedValue({ response: { entries: [] } });
});

describe('runAssistant', () => {
  it('answers directly when no data is needed, with the member and their conditions in the prompt', async () => {
    turn.mockResolvedValueOnce(answer('Hi!'));
    const res = await runAssistant({ userId: ME, history: [], message: 'hello' });
    expect(res).toMatchObject({ text: 'Hi!', requests: 1, toolCalls: [] });
    expect(turn.mock.calls[0][0].systemPrompt).toContain('Shubham, who lives with lupus');
  });

  it('runs the tools the model asks for as the calling member, then answers', async () => {
    turn.mockResolvedValueOnce(callTool('search_logs', { text: 'headache' })).mockResolvedValueOnce(answer('You logged 3 headaches.'));
    const res = await runAssistant({ userId: ME, history: [], message: 'headaches?' });
    expect(runTool).toHaveBeenCalledWith(expect.objectContaining({ userId: ME, photoAccess: true }), 'search_logs', { text: 'headache' });
    expect(res).toMatchObject({ text: 'You logged 3 headaches.', requests: 2, toolCalls: ['search_logs'] });
    const contents = turn.mock.calls[1][0].contents;
    expect(contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[2].parts[0]).toHaveProperty('functionResponse.name', 'search_logs');
  });

  it('puts a viewed photo in front of the model as an image', async () => {
    (runTool as jest.Mock).mockResolvedValue({
      response: { ok: true },
      images: [{ mediaId: 'm1', mimeType: 'image/jpeg', base64: 'AAA', takenAt: new Date('2026-11-01'), sensitive: true }],
    });
    turn.mockResolvedValueOnce(callTool('view_photo', { mediaId: 'm1' })).mockResolvedValueOnce(answer('Looks like Bristol type 6.'));
    await runAssistant({ userId: ME, history: [], message: 'my stool photo?' });
    const last = turn.mock.calls[1][0].contents.at(-1);
    expect(last.role).toBe('user');
    expect(last.parts[0]).toHaveProperty('functionResponse.name', 'view_photo');
    expect(last.parts).toEqual(expect.arrayContaining([{ inlineData: { mimeType: 'image/jpeg', data: 'AAA' } }]));
  });

  it('sends photos the member attached with the question', async () => {
    (getPhotoForAi as jest.Mock).mockResolvedValue({ ok: true, photo: { mimeType: 'image/jpeg', base64: 'BBB', takenAt: new Date('2026-11-02'), sensitive: true } });
    turn.mockResolvedValueOnce(answer('A red patch.'));
    await runAssistant({ userId: ME, history: [], message: 'what is this?', mediaIds: ['m2'] });
    expect(getPhotoForAi).toHaveBeenCalledWith(ME, 'm2', true);
    expect(turn.mock.calls[0][0].contents[0].parts).toEqual(expect.arrayContaining([{ inlineData: { mimeType: 'image/jpeg', data: 'BBB' } }]));
  });

  it(`stops calling tools after ${MAX_ROUNDS} rounds and makes the model answer without them`, async () => {
    turn.mockImplementation(async (opts: { tools?: unknown[] }) => (opts.tools ? callTool('search_logs') : answer('Best I can tell…')));
    const res = await runAssistant({ userId: ME, history: [], message: 'everything' });
    expect(res.text).toBe('Best I can tell…');
    expect(res.requests).toBe(MAX_ROUNDS + 1);
    expect(turn.mock.calls.at(-1)[0].tools).toBeUndefined();
  });

  it('gives a plain message when the free tier is rate limited', async () => {
    turn.mockResolvedValueOnce({ ok: false, error: 'rate_limited' });
    const res = await runAssistant({ userId: ME, history: [], message: 'hi' });
    expect(res.error).toBe('rate_limited');
    expect(res.text).toMatch(/try again shortly/);
  });

  it('puts the fixed emergency line first for emergency wording', async () => {
    turn.mockResolvedValueOnce(answer('Please get help.'));
    const res = await runAssistant({ userId: ME, history: [], message: 'I have chest pain right now' });
    expect(res.text.startsWith(EMERGENCY_PREFIX)).toBe(true);
    expect(res.text).toContain('Please get help.');
  });

  it('passes earlier messages as history, noting photo ids that were attached', async () => {
    turn.mockResolvedValueOnce(answer('ok'));
    await runAssistant({
      userId: ME, message: 'and now?',
      history: [{ role: 'user', text: 'look', mediaIds: ['m9'] }, { role: 'assistant', text: 'a rash' }],
    });
    const contents = turn.mock.calls[0][0].contents;
    expect(contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[0].parts[0].text).toContain('m9');
  });
});

describe('cleanReply', () => {
  it.each([
    [',\nYour rash looks red.', 'Your rash looks red.'],
    ['thought\nShubham, maine dekha.', 'Shubham, maine dekha.'],
    ['sometimesthought\nHere is what I found.', 'Here is what I found.'],
    ['.\n\nShubham, maine dekha.', 'Shubham, maine dekha.'],
  ])('strips leading debris from %j', (raw, clean) => {
    expect(cleanReply(raw)).toBe(clean);
  });

  it('leaves a normal reply that merely mentions a thought alone', () => {
    expect(cleanReply('I thought about your sleep.\nIt improved.')).toBe('I thought about your sleep.\nIt improved.');
  });
});

describe('Gemini overloaded (503)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retries a busy step and still answers', async () => {
    turn.mockResolvedValueOnce({ ok: false, error: 'busy' }).mockResolvedValueOnce(answer('Here you go.'));
    const res = await runAssistant({ userId: ME, history: [], message: 'hi' });
    expect(res).toMatchObject({ text: 'Here you go.', requests: 2 });
    expect(res.error).toBeUndefined();
  });

  it('says plainly that Google is busy after a couple of tries', async () => {
    turn.mockResolvedValue({ ok: false, error: 'busy' });
    const res = await runAssistant({ userId: ME, history: [], message: 'hi' });
    expect(res.error).toBe('busy');
    expect(res.text).toMatch(/overloaded/);
    expect(turn).toHaveBeenCalledTimes(3);
  });
});
