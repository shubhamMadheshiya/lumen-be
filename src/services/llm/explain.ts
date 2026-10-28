/**
 * One call per card: build the facts, build the deterministic fallback, ask the narration engine
 * to (optionally) improve on it with Gemini. See ./engine.ts for the cache/validate/fallback flow.
 */
import type { FindingDto, ProgressDto } from '../insightPresenter';
import { factsForFinding, factsForProgress, factsForWarning, WarningStateLike } from './facts';
import { templateForFinding, templateForProgress, templateForWarning } from './templates';
import { narrate, NarrateResult } from './engine';
import type { InsightFact } from './types';

const SYSTEM_PROMPT = `You rewrite verified health-tracking facts into 1-3 short, warm, plain-language sentences for someone managing an autoimmune condition.

Rules you must follow exactly:
- Only state numbers and facts that appear in the given facts list. Never invent, round differently, or combine numbers in a way not already stated.
- Every sentence must cite the factIds it is built from.
- Never say or imply that one thing caused, triggers, or leads to another. These are observed patterns in the person's own logs, nothing more.
- Never tell the person to start, stop, increase, or decrease any medicine or dose.
- Never diagnose, name a condition, or say what a symptom means medically.
- Write at around a 6th-8th grade reading level: short sentences, everyday words.
- Return only the JSON object matching the schema, nothing else.`;

async function run(userId: string, facts: InsightFact[], fallbackText: string, userPrompt: string): Promise<NarrateResult> {
  return narrate({ userId, facts, fallbackText, systemPrompt: SYSTEM_PROMPT, userPrompt, promptVersion: 'explain-v1' });
}

export function explainFinding(userId: string, finding: FindingDto): Promise<NarrateResult> {
  const facts = factsForFinding(finding);
  return run(userId, facts, templateForFinding(finding), JSON.stringify({ facts }));
}

export function explainProgress(userId: string, progress: ProgressDto): Promise<NarrateResult> {
  const facts = factsForProgress(progress);
  return run(userId, facts, templateForProgress(progress), JSON.stringify({ facts }));
}

export function explainWarning(userId: string, state: WarningStateLike): Promise<NarrateResult> {
  const facts = factsForWarning(state);
  return run(userId, facts, templateForWarning(state), JSON.stringify({ facts }));
}
