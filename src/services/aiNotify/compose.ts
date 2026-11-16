/**
 * Lumen AI writes one phone notification. It runs the normal assistant (all of the member's own
 * data through the tools, their chosen provider and model) with a kind-specific prompt and a strict
 * reply format, so the result can be checked before anything is pushed.
 *
 * Wording line (fixed 2026-10-23 for intelligent notifications): observation → their own data →
 * one gentle action. No risk percentages, no diagnosis, never "stop a medicine".
 */
import { runAssistant } from '../llm/assistant/assistant';
import type { AiKind } from './gate';

export type NoteOpen = 'chat' | 'log' | 'insights';
export const TITLE_MAX = 60;
export const BODY_MAX = 180;
const LOG_REPLY_BODY_MAX = 300;

/** Fixed, not model-written: added to a reply when the red flag says "now". */
export const URGENT_LINE = 'Feeling very unwell? Call 112 now.';

export interface ParsedNote { title: string; body: string; open: NoteOpen }

const clean = (s: string) => s.replace(/\*\*/g, '').replace(/^["“']|["”']$/g, '').replace(/\s+/g, ' ').trim();

/** Cut to `max` characters, at a sentence end if one is near, else at a word, with an ellipsis. */
export function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('। '));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(' ');
  return `${cut.slice(0, word > max * 0.5 ? word : max - 1).trimEnd()}…`;
}

/** 'skip' for SKIP, null for anything that isn't the agreed format. */
export function parseNotification(text: string, bodyMax = BODY_MAX): ParsedNote | 'skip' | null {
  const t = text.trim();
  if (/^skip\b/i.test(t) || t.toUpperCase() === 'SKIP') return 'skip';
  const field = (name: string) => new RegExp(`^\\s*\\**${name}\\**\\s*:\\s*(.+)$`, 'im').exec(t)?.[1];
  const title = clean(field('TITLE') ?? '');
  const body = clean(field('BODY') ?? '');
  if (!title || !body) return null;
  const openRaw = (field('OPEN') ?? 'chat').toLowerCase();
  const open: NoteOpen = openRaw.includes('log') ? 'log' : openRaw.includes('insight') ? 'insights' : 'chat';
  return { title: fit(title, TITLE_MAX), body: fit(body, bodyMax), open };
}

const FORMAT_LINES = `Reply in exactly this format and nothing else:
TITLE: <at most 45 characters>
BODY: <at most 160 characters: one or two short sentences>
OPEN: chat | log | insights`;
/** Nudges and check-ins may stay quiet; a briefing, a test and a log reply always say something. */
const FORMAT = `${FORMAT_LINES}
Or reply with exactly SKIP if there is nothing genuinely useful to say.`;
const FORMAT_NO_SKIP = `${FORMAT_LINES}
Always write a notification; do not reply SKIP.`;

const RULES = `You are writing ONE phone notification for this member from their own Lumen data. Look at the data you need with the tools first.
Rules:
- Say what you noticed, tie it to their own data (a day, a number), then give one gentle, practical action.
- No risk scores or percentages, no diagnosis, never tell them to stop or change a prescribed medicine.
- Warm and plain, like a friend who knows their data. No markdown, no emoji.
- Write in the language the member uses in their own notes and Lumen AI chats (Hinglish if they write Hinglish), otherwise simple English.`;

export interface ComposeContext {
  today: string;
  time: string;
  /** log_reply: what was logged and what Lumen's safety check flagged. */
  logged?: { when: string; summary: string; flags: { level: 'today' | 'now'; title: string; message: string }[] };
}

export function promptFor(kind: AiKind | 'test', ctx: ComposeContext): string {
  switch (kind) {
    case 'briefing':
    case 'test':
      return `${RULES}
This is their MORNING BRIEFING for ${ctx.today} (it is ${ctx.time}). First call get_day_summaries for the last 7 days and get_medications. Mention one concrete thing from their recent days (a symptom, sleep, a pattern) and one practical focus for today. If there is very little data, write a short, warm good-morning with one simple suggestion (for example to log how they slept).
OPEN should usually be chat.
${FORMAT_NO_SKIP}`;
    case 'nudge':
      return `${RULES}
It is ${ctx.time} on ${ctx.today}. Look at what they logged today so far and their patterns (get_patterns, get_day). If something logged today matches one of their patterns, or something that matters is missing today (medicines not marked, very little water, a check-in they usually do), write one timely nudge. If nothing stands out, reply SKIP.
${FORMAT}`;
    case 'check_in':
      return `${RULES}
It is evening (${ctx.time}) on ${ctx.today}. Look at today's logs. Ask ONE short, personal question about today that they can answer by logging (for example how a symptom they logged this morning went). OPEN: log. Reply SKIP if they have already logged a full picture of today.
${FORMAT}`;
    case 'log_reply': {
      const flags = ctx.logged?.flags.map(f => `- ${f.title}: ${f.message}`).join('\n') || '- (no safety flag; the severity was high)';
      return `${RULES}
They just logged this (${ctx.logged?.when}): ${ctx.logged?.summary}
Lumen's safety check says:
${flags}
Look at today and the last few days for context (get_day, search_logs). Write a calm, specific reply: what to watch for over the next hours and when to contact their doctor. OPEN: chat.
${FORMAT_NO_SKIP}`;
    }
  }
}

export type ComposeResult =
  | { ok: true; note: ParsedNote; provider: string; model: string }
  | { ok: false; reason: 'skip' | 'bad_format' | string };

export async function composeNote(userId: string, kind: AiKind | 'test', ctx: ComposeContext): Promise<ComposeResult> {
  const result = await runAssistant({ userId, history: [], message: promptFor(kind, ctx), effort: 'low', budgetMs: 60_000, allowWrites: false });
  if (result.error) return { ok: false, reason: result.error };
  const isUrgent = kind === 'log_reply' && !!ctx.logged?.flags.some(f => f.level === 'now');
  const parsed = parseNotification(result.text, kind === 'log_reply' ? LOG_REPLY_BODY_MAX : BODY_MAX);
  if (parsed === 'skip') return kind === 'log_reply' ? { ok: false, reason: 'bad_format' } : { ok: false, reason: 'skip' };
  if (!parsed) return { ok: false, reason: 'bad_format' };
  const note = isUrgent ? { ...parsed, body: `${URGENT_LINE} ${parsed.body}` } : parsed;
  return { ok: true, note, provider: result.provider, model: result.model };
}
