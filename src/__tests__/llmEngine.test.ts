import { narrate, narrateAsk } from '../services/llm/engine';
import { Narration } from '../models/Narration';
import { generateAnswer, generateSentences, isGeminiConfigured } from '../services/llm/geminiClient';
import type { InsightFact } from '../services/llm/types';

jest.mock('../models/Narration', () => ({ Narration: { findOne: jest.fn(), create: jest.fn() } }));
jest.mock('../services/llm/geminiClient', () => ({ generateSentences: jest.fn(), generateAnswer: jest.fn(), isGeminiConfigured: jest.fn() }));

const facts: InsightFact[] = [{ id: 'f1', kind: 'rate', text: '9 of 14 days', numbers: [9, 14], labels: [] }];
const baseOpts = { userId: 'u1', facts, fallbackText: 'TEMPLATE TEXT', systemPrompt: 'sys', userPrompt: 'user' };

describe('narrate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Narration.findOne as jest.Mock).mockReturnValue({ lean: async () => null });
    (Narration.create as jest.Mock).mockResolvedValue(undefined);
  });

  it('returns the cached result without calling Gemini', async () => {
    (Narration.findOne as jest.Mock).mockReturnValue({ lean: async () => ({ text: 'CACHED', source: 'ai' }) });
    const result = await narrate(baseOpts);
    expect(result).toEqual({ text: 'CACHED', source: 'ai' });
    expect(generateSentences).not.toHaveBeenCalled();
  });

  it('falls back to the template when Gemini is not configured', async () => {
    (isGeminiConfigured as jest.Mock).mockReturnValue(false);
    const result = await narrate(baseOpts);
    expect(result).toEqual({ text: 'TEMPLATE TEXT', source: 'template' });
    expect(generateSentences).not.toHaveBeenCalled();
  });

  it('returns the AI text when Gemini produces a valid, cited answer', async () => {
    (isGeminiConfigured as jest.Mock).mockReturnValue(true);
    (generateSentences as jest.Mock).mockResolvedValue({ sentences: [{ text: 'Fatigue showed up on 9 of 14 days.', factIds: ['f1'] }] });
    const result = await narrate(baseOpts);
    expect(result).toEqual({ text: 'Fatigue showed up on 9 of 14 days.', source: 'ai' });
  });

  it('retries once, then falls back to the template if every attempt fails validation', async () => {
    (isGeminiConfigured as jest.Mock).mockReturnValue(true);
    (generateSentences as jest.Mock).mockResolvedValue({ sentences: [{ text: 'Fatigue happened on 99 of 14 days.', factIds: ['f1'] }] });
    const result = await narrate(baseOpts);
    expect(result).toEqual({ text: 'TEMPLATE TEXT', source: 'template' });
    expect(generateSentences).toHaveBeenCalledTimes(2);
  });

  it('falls back to the template when Gemini returns null', async () => {
    (isGeminiConfigured as jest.Mock).mockReturnValue(true);
    (generateSentences as jest.Mock).mockResolvedValue(null);
    const result = await narrate(baseOpts);
    expect(result).toEqual({ text: 'TEMPLATE TEXT', source: 'template' });
  });

  it('caches whatever it returns, tagged with its source', async () => {
    (isGeminiConfigured as jest.Mock).mockReturnValue(false);
    await narrate(baseOpts);
    expect(Narration.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', text: 'TEMPLATE TEXT', source: 'template' }));
  });
});

describe('narrateAsk', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Narration.findOne as jest.Mock).mockReturnValue({ lean: async () => null });
    (Narration.create as jest.Mock).mockResolvedValue(undefined);
  });

  it('returns the AI text when the model answers with a valid, cited sentence', async () => {
    (isGeminiConfigured as jest.Mock).mockReturnValue(true);
    (generateAnswer as jest.Mock).mockResolvedValue({ answerable: true, sentences: [{ text: 'Fatigue showed up on 9 of 14 days.', factIds: ['f1'] }] });
    const result = await narrateAsk(baseOpts);
    expect(result).toEqual({ text: 'Fatigue showed up on 9 of 14 days.', source: 'ai' });
  });

  it('uses the fixed fallback text, not a model-written refusal, when the model honestly says it cannot answer', async () => {
    (isGeminiConfigured as jest.Mock).mockReturnValue(true);
    (generateAnswer as jest.Mock).mockResolvedValue({ answerable: false, sentences: [] });
    const result = await narrateAsk(baseOpts);
    expect(result).toEqual({ text: 'TEMPLATE TEXT', source: 'template' });
    // An honest "I can't answer" is accepted on the first attempt — it does not need a retry.
    expect(generateAnswer).toHaveBeenCalledTimes(1);
  });

  it('retries, then falls back, when answerable is true but the cited numbers are wrong', async () => {
    (isGeminiConfigured as jest.Mock).mockReturnValue(true);
    (generateAnswer as jest.Mock).mockResolvedValue({ answerable: true, sentences: [{ text: 'Fatigue happened on 99 of 14 days.', factIds: ['f1'] }] });
    const result = await narrateAsk(baseOpts);
    expect(result).toEqual({ text: 'TEMPLATE TEXT', source: 'template' });
    expect(generateAnswer).toHaveBeenCalledTimes(2);
  });

  it('falls back to the template when Gemini returns null', async () => {
    (isGeminiConfigured as jest.Mock).mockReturnValue(true);
    (generateAnswer as jest.Mock).mockResolvedValue(null);
    const result = await narrateAsk(baseOpts);
    expect(result).toEqual({ text: 'TEMPLATE TEXT', source: 'template' });
  });
});
