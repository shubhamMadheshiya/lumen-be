/**
 * The only file that talks to Gemini. Structured output (responseSchema) is used instead of
 * free text so a malformed reply is a JSON parse error, not a format the rest of the pipeline has
 * to guess at. Any failure (missing key, network, bad JSON) returns null — the caller always has
 * a deterministic template to fall back to (see ./templates.ts and ./engine.ts).
 */
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { config } from '../../config';
import type { NarrationResult, AskResult } from './types';

const SENTENCES_ITEMS = {
  type: SchemaType.OBJECT,
  properties: {
    text: { type: SchemaType.STRING },
    factIds: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: ['text', 'factIds'],
} as const;

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    sentences: { type: SchemaType.ARRAY, items: SENTENCES_ITEMS },
  },
  required: ['sentences'],
} as const;

/**
 * Q&A gets its own schema with an explicit `answerable` flag. Without it, a model that honestly
 * writes "I don't have that in your logs" has no fact to cite for that sentence and fails
 * validateNarration's citation check — so an honest refusal and a hallucination looked identical
 * to the validator. `answerable: false` lets the engine use the fixed fallback text directly,
 * no citation needed, while a true answer still goes through the same citation/lexicon checks.
 */
const ASK_RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    answerable: { type: SchemaType.BOOLEAN },
    sentences: { type: SchemaType.ARRAY, items: SENTENCES_ITEMS },
  },
  required: ['answerable', 'sentences'],
} as const;

let client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI | null {
  if (!config.gemini.apiKey) return null;
  if (!client) client = new GoogleGenerativeAI(config.gemini.apiKey);
  return client;
}

export function isGeminiConfigured(): boolean {
  return !!config.gemini.apiKey;
}

/**
 * A hung request must never hang the member's request — fall back to the template instead.
 * gemini-3.1-flash-lite (the default model) answers in a few seconds with no internal "thinking"
 * step; a reasoning-heavy model like gemini-3.8-flash can take 15-25s+ for the same prompt, so if
 * GEMINI_MODEL is ever changed to one of those, this may need raising again.
 */
const REQUEST_TIMEOUT_MS = 15000;

export async function generateSentences(systemPrompt: string, userPrompt: string): Promise<NarrationResult | null> {
  const genAI = getClient();
  if (!genAI) return null;
  try {
    const model = genAI.getGenerativeModel({
      model: config.gemini.model,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA as never,
        temperature: 0.2,
        maxOutputTokens: 500,
      },
    }, { timeout: REQUEST_TIMEOUT_MS });
    const result = await model.generateContent(userPrompt);
    const raw = result.response.text();
    const parsed = JSON.parse(raw) as NarrationResult;
    if (!Array.isArray(parsed.sentences)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function generateAnswer(systemPrompt: string, userPrompt: string): Promise<AskResult | null> {
  const genAI = getClient();
  if (!genAI) return null;
  try {
    const model = genAI.getGenerativeModel({
      model: config.gemini.model,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ASK_RESPONSE_SCHEMA as never,
        temperature: 0.2,
        maxOutputTokens: 500,
      },
    }, { timeout: REQUEST_TIMEOUT_MS });
    const result = await model.generateContent(userPrompt);
    const raw = result.response.text();
    const parsed = JSON.parse(raw) as AskResult;
    if (typeof parsed.answerable !== 'boolean' || !Array.isArray(parsed.sentences)) return null;
    return parsed;
  } catch {
    return null;
  }
}
