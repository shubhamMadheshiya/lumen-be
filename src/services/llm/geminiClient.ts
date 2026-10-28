/**
 * The only file that talks to Gemini. Structured output (responseSchema) is used instead of
 * free text so a malformed reply is a JSON parse error, not a format the rest of the pipeline has
 * to guess at. Any failure (missing key, network, bad JSON) returns null — the caller always has
 * a deterministic template to fall back to (see ./templates.ts and ./engine.ts).
 */
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { config } from '../../config';
import type { NarrationResult } from './types';

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    sentences: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          text: { type: SchemaType.STRING },
          factIds: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ['text', 'factIds'],
      },
    },
  },
  required: ['sentences'],
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
