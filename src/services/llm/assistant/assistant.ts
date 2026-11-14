/**
 * Lumen AI: a chat assistant over ALL of the member's own data (logs, free-text notes, sleep,
 * activity, medicines, health records, photos). The member chose this deliberately, including
 * sending photos on Gemini's free tier, where Google may use content to improve its models.
 *
 * Tone is "free but honest": it may interpret, suggest possible explanations, assess photos and
 * discuss medicines, but must state uncertainty and never claim a diagnosis as certain. Unlike the
 * narration layer (../engine.ts) there is no numeral/lexicon validator here. Only the fixed
 * emergency message is kept, and it is added by code, not left to the model.
 */
import type { Content, Part } from '@google/generative-ai';
import { User } from '../../../models/User';
import { DEFAULT_BOUNDARY_HOUR, resolveTimeZone, trackingDayKey } from '../../../utils/dayKey';
import { generateTurn } from '../geminiClient';
import { classifyQuestion } from '../router';
import { runTool, TOOL_DECLARATIONS, type ToolContext } from './dataTools';
import { getPhotoForAi } from './mediaBytes';

export const MAX_ROUNDS = 8;
export const TOTAL_BUDGET_MS = 60_000;
const PER_CALL_TIMEOUT_MS = 30_000;
const MAX_IMAGES_PER_ANSWER = 4;
const HISTORY_MESSAGES = 20;
/** Retries for a Google-side 503 "high demand" before giving up on this answer. */
const BUSY_RETRIES = 2;
const BUSY_PAUSE_MS = 1_500;

/** Fixed, not model-written: shown first whenever the message reads like an emergency. */
export const EMERGENCY_PREFIX = 'If this is happening now and you feel very unwell, call 112 (India) or go to the nearest emergency department first.';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  mediaIds?: string[];
}

export interface AssistantResult {
  text: string;
  /** Gemini requests used, for keeping an eye on free-tier limits. */
  requests: number;
  toolCalls: string[];
  /** Set when the answer is a fallback message rather than a model answer. */
  error?: 'not_configured' | 'rate_limited' | 'busy' | 'blocked' | 'timeout' | 'failed';
}

const FAILURE_TEXT: Record<NonNullable<AssistantResult['error']>, string> = {
  not_configured: 'Lumen AI is not set up on the server yet (no Gemini API key).',
  rate_limited: "Gemini's free tier is busy for this minute or today's limit is used up. Please try again shortly.",
  busy: "Google's Gemini service is overloaded right now (high demand on their side). Please try again in a minute.",
  blocked: "Gemini declined to answer this one (its own safety filter). Try rephrasing, or ask about a different photo or day.",
  timeout: 'That took too long to work out. Try a narrower question, e.g. a shorter date range.',
  failed: 'Lumen AI could not answer just now. Please try again.',
};

function systemPrompt(ctx: ToolContext, name: string, conditions: string[]): string {
  const who = conditions.length ? `${name}, who lives with ${conditions.join(', ')}` : name;
  return `You are Lumen AI, a personal health-data assistant for ${who}. You can read ALL of their own Lumen data through the tools, including free-text notes and photos (some are sensitive: stool, urine, skin). They have explicitly asked you to analyse everything, without holding back.

How to work:
- Look things up with the tools before answering. Never guess or invent data. Mention concrete days and numbers.
- For trends and comparisons across many days (e.g. days with vs without a food, this month vs last), call get_day_summaries once for the whole period (it covers months in one call) and count across all days. Do not sample a few days with get_day.
- When a photo matters (a rash, stool, urine, a lab report), use list_photos then view_photo and describe what you actually see.
- You may interpret, compare periods, spot trends, suggest possible explanations, assess photos in plain clinical language (e.g. Bristol stool type, colour, visible blood or mucus, rash size and appearance), and discuss their medicines.
- Be honest about uncertainty: say "this could be", give the main alternatives, say how sure you are and what would make it clearer. Never present a diagnosis as certain. Things logged on the same days are not proof that one caused the other; say so when it matters.
- On starting, stopping or changing a medicine: give your view, and say to confirm with their doctor. Never tell them to stop a prescribed medicine abruptly.
- If anything suggests an emergency (chest pain with breathlessness, heavy bleeding, very high fever while on immunosuppressants, sudden loss of vision, confusion), say clearly to get urgent care now (India: 112).
- Today is ${ctx.today}. Dates are Lumen days (YYYY-MM-DD) that start at ${ctx.boundaryHour}:00 in ${ctx.timeZone}.
- Reply in the language the member writes in (English, Hindi or Hinglish). Short paragraphs and simple "- " bullets. Use **bold** for short labels instead of # headings. No tables.`;
}

export async function buildToolContext(userId: string): Promise<{ ctx: ToolContext; name: string; conditions: string[] } | null> {
  const user = await User.findById(userId).select('name conditions preferences').lean();
  if (!user) return null;
  const timeZone = resolveTimeZone(user.preferences?.timezone);
  const boundaryHour = user.preferences?.dayBoundaryHour ?? DEFAULT_BOUNDARY_HOUR;
  return {
    ctx: {
      userId,
      timeZone,
      boundaryHour,
      photoAccess: !!user.preferences?.aiPhotoAccess,
      today: trackingDayKey(new Date(), timeZone, boundaryHour),
    },
    name: user.name || 'the member',
    conditions: user.conditions ?? [],
  };
}

function historyToContents(history: ChatMessage[]): Content[] {
  return history.slice(-HISTORY_MESSAGES).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.mediaIds?.length ? `${m.text}\n(attached photo ids: ${m.mediaIds.join(', ')})` : m.text || '(photo)' }],
  }));
}

/**
 * After tool calls, flash-lite sometimes opens its reply with debris: stray punctuation (",\n")
 * or a lone word ending in "thought" (seen live: "thought\n", "sometimesthought\n").
 */
export function cleanReply(text: string): string {
  return text
    .replace(/^[\s,.;:]+/, '')
    .replace(/^\S*thought[\s,.;:]*\n+/i, '')
    .replace(/^[\s,.;:]+/, '');
}

export async function runAssistant(opts: {
  userId: string;
  history: ChatMessage[];
  message: string;
  mediaIds?: string[];
  /** Overrides the time budget (the weekly review runs in the background and can take longer). */
  budgetMs?: number;
}): Promise<AssistantResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? TOTAL_BUDGET_MS;
  const built = await buildToolContext(opts.userId);
  if (!built) return { text: FAILURE_TEXT.failed, requests: 0, toolCalls: [], error: 'failed' };
  const { ctx } = built;

  // The member's own attachments go in with the question.
  const userParts: Part[] = [{ text: opts.message || 'Please look at this photo.' }];
  for (const id of (opts.mediaIds ?? []).slice(0, MAX_IMAGES_PER_ANSWER)) {
    const res = await getPhotoForAi(ctx.userId, id, ctx.photoAccess);
    if (res.ok) {
      userParts.push({ text: `Attached photo ${id} (taken ${res.photo.takenAt.toISOString().slice(0, 10)}):` });
      userParts.push({ inlineData: { mimeType: res.photo.mimeType, data: res.photo.base64 } });
    } else {
      userParts.push({ text: `(Attached photo ${id} could not be shown: ${res.reason === 'photo_access_off' ? 'photo access is turned off in Settings' : res.reason}.)` });
    }
  }

  const contents: Content[] = [...historyToContents(opts.history), { role: 'user', parts: userParts }];
  const system = systemPrompt(ctx, built.name, built.conditions);
  const toolCalls: string[] = [];
  let requests = 0;
  let imagesShown = 0;
  let busyRetries = 0;
  let answer = '';
  let error: AssistantResult['error'];

  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const remaining = budget - (Date.now() - started);
    if (remaining < 3_000) { error = 'timeout'; break; }
    // The last round withholds the tools, so the model has to answer with what it has gathered.
    const lastRound = round === MAX_ROUNDS || remaining < 12_000;
    requests++;
    const turn = await generateTurn({
      systemPrompt: system,
      contents: lastRound ? [...contents, { role: 'user', parts: [{ text: 'Answer now using what you have found.' }] }] : contents,
      tools: lastRound ? undefined : TOOL_DECLARATIONS,
      timeoutMs: Math.min(PER_CALL_TIMEOUT_MS, remaining),
    });
    if (!turn.ok) {
      if (turn.error === 'busy' && busyRetries < BUSY_RETRIES && budget - (Date.now() - started) > 8_000) {
        busyRetries++;
        round--; // the same step again, after a short pause
        await new Promise(r => setTimeout(r, BUSY_PAUSE_MS * busyRetries));
        continue;
      }
      error = turn.error;
      break;
    }
    if (turn.functionCalls.length === 0 || lastRound) { answer = cleanReply(turn.text); break; }

    contents.push({ role: 'model', parts: turn.parts });
    const responseParts: Part[] = [];
    const imageParts: Part[] = [];
    for (const call of turn.functionCalls) {
      toolCalls.push(call.name);
      const args = (call.args ?? {}) as Record<string, unknown>;
      if (call.name === 'view_photo' && imagesShown >= MAX_IMAGES_PER_ANSWER) {
        responseParts.push({ functionResponse: { name: call.name, response: { ok: false, reason: `Already viewed ${MAX_IMAGES_PER_ANSWER} photos for this answer.` } } });
        continue;
      }
      const result = await runTool(ctx, call.name, args);
      responseParts.push({ functionResponse: { name: call.name, response: result.response } });
      for (const img of result.images ?? []) {
        imagesShown++;
        imageParts.push({ text: `Photo ${img.mediaId} (taken ${img.takenAt.toISOString().slice(0, 10)}):` });
        imageParts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
      }
    }
    // Current Gemini models reject the old 'function' role: tool results go back as the user's turn,
    // and any photos ride in that same turn (an image can't sit inside a function response).
    contents.push({ role: 'user', parts: [...responseParts, ...imageParts] });
  }

  let text = answer || (error ? FAILURE_TEXT[error] : FAILURE_TEXT.failed);
  if (!answer && !error) error = 'failed';
  if (classifyQuestion(opts.message) === 'crisis') text = `${EMERGENCY_PREFIX}\n\n${text}`;
  return { text, requests, toolCalls, ...(answer ? {} : { error }) };
}
