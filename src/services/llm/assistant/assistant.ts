/**
 * Lumen AI: a chat assistant over ALL of the member's own data (logs, free-text notes, sleep,
 * activity, medicines, health records, photos). The member chose this deliberately, including
 * sending photos on Gemini's free tier, where Google may use content to improve its models.
 * The member can also switch to Claude (paid) and pick the model: see ./models.ts and ./providers.
 *
 * Tone is "free but honest": it may interpret, suggest possible explanations, assess photos and
 * discuss medicines, but must state uncertainty and never claim a diagnosis as certain. Unlike the
 * narration layer (../engine.ts) there is no numeral/lexicon validator here. Only the fixed
 * emergency message is kept, and it is added by code, not left to the model.
 */
import { User } from '../../../models/User';
import { DEFAULT_BOUNDARY_HOUR, resolveTimeZone, trackingDayKey } from '../../../utils/dayKey';
import { classifyQuestion } from '../router';
import { runTool, TOOL_DECLARATIONS, type ToolContext } from './dataTools';
import { getPhotoForAi } from './mediaBytes';
import { resolveModel, type AiModelInfo } from './models';
import { getProvider } from './providers';
import type { AssistantError, Effort, InputPart, ToolResultInput, Usage } from './providers/types';

export const MAX_ROUNDS = 8;
/** Default budget; each model in ./models.ts has its own. */
export const TOTAL_BUDGET_MS = 60_000;
const MIN_CALL_TIMEOUT_MS = 30_000;
const MAX_IMAGES_PER_ANSWER = 4;
const HISTORY_MESSAGES = 20;
/** Retries for a provider-side overload (Gemini 503 "high demand", Claude 529) before giving up. */
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
  /** Model requests used, for keeping an eye on free-tier limits and cost. */
  requests: number;
  toolCalls: string[];
  provider: AiModelInfo['provider'];
  model: string;
  usage: Usage;
  /** The member's chosen model wasn't usable (no key / unknown), so the Gemini default answered. */
  fellBack: boolean;
  /** Set when the answer is a fallback message rather than a model answer. */
  error?: AssistantError;
}

const PROVIDER_NAME = { gemini: 'Gemini', claude: 'Claude' } as const;

export function failureText(error: AssistantError, provider: AiModelInfo['provider']): string {
  const name = PROVIDER_NAME[provider];
  switch (error) {
    case 'not_configured': return `Lumen AI is not set up on the server yet (no ${name} API key).`;
    case 'bad_key': return provider === 'claude'
      ? 'The Claude API key on the server is invalid or its prepaid credit has run out. Switch to Gemini in Settings, or top up at console.anthropic.com.'
      : 'The Gemini API key on the server is not valid.';
    case 'rate_limited': return provider === 'claude'
      ? 'Claude is rate-limiting this account for a moment. Please try again shortly.'
      : "Gemini's free tier is busy for this minute or today's limit is used up. Please try again shortly.";
    case 'busy': return `${name} is overloaded right now (high demand on their side). Please try again in a minute.`;
    case 'blocked': return `${name} declined to answer this one (its own safety filter). Try rephrasing, or ask about a different photo or day.`;
    case 'timeout': return 'That took too long to work out. Try a narrower question, e.g. a shorter date range, or a faster model.';
    default: return 'Lumen AI could not answer just now. Please try again.';
  }
}

const VOICE_RULES = `
This reply will be spoken aloud in a voice conversation:
- Answer in 2-5 short, natural spoken sentences. No markdown, no bullet points, no headings, no emoji.
- Say numbers and dates the way a person would ("about 7 hours", "last Tuesday").
- Give the main point first; offer to go into detail instead of listing everything.`;

function systemPrompt(ctx: ToolContext, name: string, conditions: string[], voice: boolean): string {
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
- Reply in the language the member writes in (English, Hindi or Hinglish). Short paragraphs and simple "- " bullets. Use **bold** for short labels instead of # headings. No tables.${voice ? `\n${VOICE_RULES}` : ''}`;
}

export async function buildToolContext(userId: string): Promise<{ ctx: ToolContext; name: string; conditions: string[]; prefs: { aiProvider?: string; aiModel?: string } } | null> {
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
    prefs: { aiProvider: user.preferences?.aiProvider, aiModel: user.preferences?.aiModel },
  };
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

const addUsage = (a: Usage, b?: Usage): Usage => ({
  inputTokens: a.inputTokens + (b?.inputTokens ?? 0),
  outputTokens: a.outputTokens + (b?.outputTokens ?? 0),
  cacheReadTokens: (a.cacheReadTokens ?? 0) + (b?.cacheReadTokens ?? 0),
  cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b?.cacheWriteTokens ?? 0),
});

export async function runAssistant(opts: {
  userId: string;
  history: ChatMessage[];
  message: string;
  mediaIds?: string[];
  /** Overrides the model's time budget (the weekly review runs in the background and can take longer). */
  budgetMs?: number;
  /** The reply will be spoken: short, no markdown. */
  voice?: boolean;
  /** How hard Claude should think; defaults to medium (low for voice). */
  effort?: Effort;
}): Promise<AssistantResult> {
  const started = Date.now();
  const built = await buildToolContext(opts.userId);
  const { model, fellBack } = resolveModel(built?.prefs);
  const zero: Usage = { inputTokens: 0, outputTokens: 0 };
  const base = { provider: model.provider, model: model.id, fellBack };
  if (!built) return { ...base, text: failureText('failed', model.provider), requests: 0, toolCalls: [], usage: zero, error: 'failed' };
  const { ctx } = built;
  const budget = Math.max(opts.budgetMs ?? 0, model.budgetMs);

  // The member's own attachments go in with the question.
  const userParts: InputPart[] = [{ type: 'text', text: opts.message || 'Please look at this photo.' }];
  for (const id of (opts.mediaIds ?? []).slice(0, MAX_IMAGES_PER_ANSWER)) {
    const res = await getPhotoForAi(ctx.userId, id, ctx.photoAccess);
    if (res.ok) {
      userParts.push({ type: 'text', text: `Attached photo ${id} (taken ${res.photo.takenAt.toISOString().slice(0, 10)}):` });
      userParts.push({ type: 'image', mimeType: res.photo.mimeType, base64: res.photo.base64 });
    } else {
      userParts.push({ type: 'text', text: `(Attached photo ${id} could not be shown: ${res.reason === 'photo_access_off' ? 'photo access is turned off in Settings' : res.reason}.)` });
    }
  }

  const session = getProvider(model.provider).startSession({
    model: model.id,
    system: systemPrompt(ctx, built.name, built.conditions, !!opts.voice),
    history: opts.history.slice(-HISTORY_MESSAGES).map(m => ({
      role: m.role,
      text: m.mediaIds?.length ? `${m.text}\n(attached photo ids: ${m.mediaIds.join(', ')})` : m.text || '(photo)',
    })),
    userParts,
    tools: TOOL_DECLARATIONS,
    effort: opts.effort ?? (opts.voice ? 'low' : 'medium'),
  });

  const toolCalls: string[] = [];
  let usage = zero;
  let requests = 0;
  let imagesShown = 0;
  let busyRetries = 0;
  let answer = '';
  let error: AssistantError | undefined;
  let nudged = false;

  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const remaining = budget - (Date.now() - started);
    if (remaining < 3_000) { error = 'timeout'; break; }
    // The last round withholds the tools, so the model has to answer with what it has gathered.
    const lastRound = round === MAX_ROUNDS || remaining < Math.min(12_000, budget / 5);
    if (lastRound && !nudged && toolCalls.length) { session.addUserText('Answer now using what you have found.'); nudged = true; }
    requests++;
    const step = await session.next({
      withTools: !lastRound,
      timeoutMs: Math.min(Math.max(MIN_CALL_TIMEOUT_MS, budget / 2), remaining),
    });
    if (!step.ok) {
      if (step.error === 'busy' && busyRetries < BUSY_RETRIES && budget - (Date.now() - started) > 8_000) {
        busyRetries++;
        round--; // the same step again, after a short pause
        await new Promise(r => setTimeout(r, BUSY_PAUSE_MS * busyRetries));
        continue;
      }
      error = step.error;
      break;
    }
    usage = addUsage(usage, step.usage);
    if (step.calls.length === 0 || lastRound) { answer = cleanReply(step.text); break; }

    const results: ToolResultInput[] = [];
    for (const call of step.calls) {
      toolCalls.push(call.name);
      if (call.name === 'view_photo' && imagesShown >= MAX_IMAGES_PER_ANSWER) {
        results.push({ id: call.id, name: call.name, response: { ok: false, reason: `Already viewed ${MAX_IMAGES_PER_ANSWER} photos for this answer.` } });
        continue;
      }
      const result = await runTool(ctx, call.name, call.args);
      const images = (result.images ?? []).map(img => {
        imagesShown++;
        return { label: `Photo ${img.mediaId} (taken ${img.takenAt.toISOString().slice(0, 10)}):`, mimeType: img.mimeType, base64: img.base64 };
      });
      results.push({ id: call.id, name: call.name, response: result.response as Record<string, unknown>, images });
    }
    session.addToolResults(results);
  }

  if (!answer && !error) error = 'failed';
  let text = answer || failureText(error ?? 'failed', model.provider);
  if (classifyQuestion(opts.message) === 'crisis') text = `${EMERGENCY_PREFIX}\n\n${text}`;
  return { ...base, text, requests, toolCalls, usage, ...(answer ? {} : { error }) };
}
