/**
 * Safety routing for the Q&A box, checked before the question ever reaches the model. This is
 * deliberately plain regex matching with fixed copy — the same philosophy as
 * ../safety/redFlags.ts: nothing about "is this a crisis / a medicine question / a diagnosis
 * question" is left to the LLM to decide for itself.
 */

export type QuestionRoute = 'crisis' | 'medication' | 'diagnosis' | 'ok';

const CRISIS = /\b(chest pain|can'?t breathe|suicidal|kill myself|severe bleeding|heavy bleeding|unconscious|seizure|emergency)\b/i;
const MEDICATION = /\b(should i (stop|start|skip|increase|decrease|double)|is it ok to (stop|skip)|can i stop|should i take more|change my (dose|dosage|medicine|medication))\b/i;
const DIAGNOSIS = /\b(do i have|is this|what'?s wrong with me|am i|what disease|what condition|is it (lupus|ra|ibd|ms|celiac|arthritis))\b/i;

export function classifyQuestion(question: string): QuestionRoute {
  if (CRISIS.test(question)) return 'crisis';
  if (MEDICATION.test(question)) return 'medication';
  if (DIAGNOSIS.test(question)) return 'diagnosis';
  return 'ok';
}

export const CRISIS_REPLY = 'If this is happening now and you feel very unwell, call 112 (India) or your local emergency number, or go to the nearest emergency department. I can\'t help with this here.';
export const MEDICATION_REDIRECT = "I can't advise on starting, stopping or changing a medicine or its dose — please ask your doctor or pharmacist. I can show you patterns from your own logs if that helps the conversation.";
export const DIAGNOSIS_REDIRECT = "I can't tell you what a symptom means medically or whether you have a condition — that needs your doctor. I can show you patterns Lumen has found in your own logs though.";

export function fixedReplyFor(route: Exclude<QuestionRoute, 'ok'>): string {
  return route === 'crisis' ? CRISIS_REPLY : route === 'medication' ? MEDICATION_REDIRECT : DIAGNOSIS_REDIRECT;
}
