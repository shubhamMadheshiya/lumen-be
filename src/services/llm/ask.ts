/**
 * The Q&A box. A single bounded call over facts already computed elsewhere (top findings,
 * progress, warning state) — not a tool-calling loop over raw data. For a single personal user
 * this keeps the attack surface small: the model can only ever talk about numbers it was handed.
 * Crisis / medication / diagnosis questions are redirected before this is ever called — see
 * ./router.ts — and that check always runs first in the route handler.
 */
import crypto from 'crypto';
import { narrateAsk, NarrateResult } from './engine';
import { ASK_FALLBACK_TEXT } from './templates';
import type { InsightFact } from './types';

const SYSTEM_PROMPT = `You answer a question about someone's own health-tracking data using ONLY the facts list given to you below. You are not a doctor and must never give medical advice.

Rules you must follow exactly:
- Only state numbers and facts that appear in the given facts list. Never invent, estimate, or look up anything outside it.
- First decide if the given facts actually answer the question. If they do, set answerable to true and write 1-3 short sentences, each citing the factIds it is built from.
- If the given facts do NOT cover what's being asked (for example, nothing about it appears in the facts list at all), set answerable to false and leave sentences empty — do not guess, pad with unrelated facts, or write an apology sentence instead.
- Never say or imply that one thing caused, triggers, or leads to another. These are observed patterns in logs, nothing more.
- Never tell the person to start, stop, increase, or decrease any medicine or dose.
- Never diagnose, name a condition, or say what a symptom means medically.
- Write at around a 6th-8th grade reading level: short sentences, everyday words.
- Return only the JSON object matching the schema, nothing else.`;

export function answerQuestion(userId: string, question: string, facts: InsightFact[]): Promise<NarrateResult> {
  const userPrompt = JSON.stringify({ question, facts });
  // The cache key is (facts, promptVersion, model) — the question text has to be folded into
  // promptVersion, or two different questions over the same facts would collide in the cache.
  const questionHash = crypto.createHash('sha256').update(question.trim().toLowerCase()).digest('hex').slice(0, 16);
  return narrateAsk({ userId, facts, fallbackText: ASK_FALLBACK_TEXT, systemPrompt: SYSTEM_PROMPT, userPrompt, promptVersion: `ask-v1:${questionHash}` });
}
