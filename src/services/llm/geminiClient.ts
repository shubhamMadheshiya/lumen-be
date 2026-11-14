/**
 * The only file that talks to Gemini. Structured output (responseSchema) is used instead of
 * free text so a malformed reply is a JSON parse error, not a format the rest of the pipeline has
 * to guess at. Any failure (missing key, network, bad JSON) returns null — the caller always has
 * a deterministic template to fall back to (see ./templates.ts and ./engine.ts).
 */
import {
  GoogleGenerativeAI, SchemaType,
  type Content, type FunctionCall, type FunctionDeclaration, type Part,
} from '@google/generative-ai';
import { config } from '../../config';
import type { NarrationResult } from './types';

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

// ── Lumen AI (assistant) ─────────────────────────────────────────────────────

export type TurnResult =
  | { ok: true; parts: Part[]; functionCalls: FunctionCall[]; text: string }
  | { ok: false; error: 'not_configured' | 'rate_limited' | 'busy' | 'blocked' | 'timeout' | 'failed'; detail?: string };

/**
 * One model turn for the assistant: free text plus optional function calls. Unlike the narration
 * calls above there is no JSON schema and no validator — the assistant is allowed to interpret.
 */
export async function generateTurn(opts: {
  systemPrompt: string;
  contents: Content[];
  tools?: FunctionDeclaration[];
  timeoutMs: number;
  maxOutputTokens?: number;
}): Promise<TurnResult> {
  const genAI = getClient();
  if (!genAI) return { ok: false, error: 'not_configured' };
  try {
    const model = genAI.getGenerativeModel({
      model: config.gemini.assistantModel,
      systemInstruction: opts.systemPrompt,
      ...(opts.tools?.length ? { tools: [{ functionDeclarations: opts.tools }] } : {}),
      generationConfig: { temperature: 0.4, maxOutputTokens: opts.maxOutputTokens ?? 2048 },
    }, { timeout: opts.timeoutMs });
    const result = await model.generateContent({ contents: opts.contents });
    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate || response.promptFeedback?.blockReason || candidate.finishReason === 'SAFETY') {
      return { ok: false, error: 'blocked', detail: response.promptFeedback?.blockReason ?? candidate?.finishReason };
    }
    const parts = candidate.content?.parts ?? [];
    const functionCalls = parts.filter(p => p.functionCall).map(p => p.functionCall as FunctionCall);
    // Newer models can return their internal reasoning as parts marked `thought`; never show those.
    const text = parts
      .filter(p => !(p as Part & { thought?: boolean }).thought)
      .map(p => p.text ?? '')
      .join('')
      .trim();
    return { ok: true, parts, functionCalls, text };
  } catch (err) {
    const e = err as { status?: number; name?: string; message?: string };
    if (e.status === 429) return { ok: false, error: 'rate_limited', detail: e.message };
    // 503 'model is experiencing high demand' (seen live on the free tier) and 500s are Google-side and usually pass.
    if (e.status === 503 || e.status === 500) return { ok: false, error: 'busy', detail: e.message };
    if (e.name === 'AbortError' || /aborted|timeout/i.test(e.message ?? '')) return { ok: false, error: 'timeout' };
    console.error('[gemini] assistant turn failed:', e.message);
    return { ok: false, error: 'failed', detail: e.message };
  }
}
