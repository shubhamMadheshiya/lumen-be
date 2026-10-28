import { narrate } from '../services/llm/engine';
import { Narration } from '../models/Narration';
import { generateSentences, isGeminiConfigured } from '../services/llm/geminiClient';
import type { InsightFact } from '../services/llm/types';

jest.mock('../models/Narration', () => ({ Narration: { findOne: jest.fn(), create: jest.fn() } }));
jest.mock('../services/llm/geminiClient', () => ({ generateSentences: jest.fn(), isGeminiConfigured: jest.fn() }));

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
