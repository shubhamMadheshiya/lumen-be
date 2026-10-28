/**
 * Shared plumbing for both narration ("explain this card") and Q&A: check the cache, call
 * Gemini, validate, retry once, fall back to the deterministic template. The template is never
 * a worse answer than a broken one — it's the thing that ships when nothing else can be trusted.
 */
import crypto from 'crypto';
import { config } from '../../config';
import { Narration } from '../../models/Narration';
import { generateAnswer, generateSentences, isGeminiConfigured } from './geminiClient';
import { validateNarration } from './validators';
import type { InsightFact } from './types';

const MAX_ATTEMPTS = 2;

/**
 * Fact ids are random per call (see facts.ts) so two calls about the identical underlying finding
 * never share an id — only `text` is content-addressed, so the cache key is built from that alone.
 */
function hashOf(facts: InsightFact[], promptVersion: string): string {
  const stable = facts.map(f => f.text).sort();
  return crypto.createHash('sha256').update(JSON.stringify({ stable, promptVersion, model: config.gemini.model })).digest('hex');
}

export interface NarrateOptions {
  userId: string;
  facts: InsightFact[];
  fallbackText: string;
  systemPrompt: string;
  userPrompt: string;
  promptVersion?: string;
}

export interface NarrateResult { text: string; source: 'ai' | 'template' }

async function withCache(
  opts: NarrateOptions,
  produce: () => Promise<NarrateResult>,
): Promise<NarrateResult> {
  const promptVersion = opts.promptVersion ?? 'v1';
  const hash = hashOf(opts.facts, promptVersion);

  const cached = await Narration.findOne({ userId: opts.userId, hash }).lean();
  if (cached) return { text: cached.text, source: cached.source };

  const result = await produce();
  await Narration.create({ userId: opts.userId, hash, text: result.text, source: result.source, llmModel: config.gemini.model }).catch(() => undefined);
  return result;
}

export function narrate(opts: NarrateOptions): Promise<NarrateResult> {
  return withCache(opts, async () => {
    if (!isGeminiConfigured()) return { text: opts.fallbackText, source: 'template' };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const result = await generateSentences(opts.systemPrompt, opts.userPrompt);
      if (!result || result.sentences.length === 0) continue;
      const check = validateNarration(result.sentences, opts.facts);
      if (check.valid) return { text: result.sentences.map(s => s.text).join(' '), source: 'ai' };
    }

    return { text: opts.fallbackText, source: 'template' };
  });
}

/**
 * Q&A variant: the model can honestly say it doesn't have enough to answer (`answerable: false`)
 * without being forced to fabricate a citation for that sentence — see geminiClient.ts for why.
 */
export function narrateAsk(opts: NarrateOptions): Promise<NarrateResult> {
  return withCache(opts, async () => {
    if (!isGeminiConfigured()) return { text: opts.fallbackText, source: 'template' };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const result = await generateAnswer(opts.systemPrompt, opts.userPrompt);
      if (!result) continue;
      if (!result.answerable) return { text: opts.fallbackText, source: 'template' };
      if (result.sentences.length === 0) continue;
      const check = validateNarration(result.sentences, opts.facts);
      if (check.valid) return { text: result.sentences.map(s => s.text).join(' '), source: 'ai' };
    }

    return { text: opts.fallbackText, source: 'template' };
  });
}
