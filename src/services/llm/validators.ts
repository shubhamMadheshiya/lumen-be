/**
 * Deterministic checks the LLM's output must pass before it is ever shown. Each runs in well
 * under a millisecond. A failure means "use the template instead", never "show it anyway".
 */
import type { InsightFact, NarrationSentence } from './types';

export const CAUSAL_LEXICON = /\b(causes?|caused|causing|leads? to|led to|due to|makes? you|triggers?|triggered|because of|results? in)\b/i;
export const MEDICATION_LEXICON = /\b(stop|start|increase|decrease|skip|double)\b[^.]{0,40}\b(dose|dosage|medicine|medication|tablet|pill|mg)\b|\b(dose|dosage|medicine|medication|tablet|pill)\b[^.]{0,40}\b(stop|start|increase|decrease|skip|double)\b/i;
export const DIAGNOSIS_LEXICON = /\b(you have|you'?re experiencing|sounds like|consistent with|this means you|likely (a|an)|probably (a|an))\b/i;

const SYLLABLE_VOWELS = /[aeiouy]+/gi;

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  let count = (w.match(SYLLABLE_VOWELS) ?? []).length;
  if (w.endsWith('e') && !w.endsWith('le') && count > 1) count -= 1;
  return Math.max(1, count);
}

/** Flesch-Kincaid Grade Level — approximate but stable enough for a go/no-go cap. */
export function fleschKincaidGrade(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
}

export interface ValidationResult { valid: boolean; reason?: string }

const NUMBER_RE = /\d+(\.\d+)?/g;

/**
 * Every numeral the model wrote must come from a fact it cited; every sentence must cite at
 * least one real fact; and the three safety lexicons must not appear anywhere in the output.
 */
export function validateNarration(sentences: NarrationSentence[], facts: InsightFact[]): ValidationResult {
  if (sentences.length === 0) return { valid: false, reason: 'empty' };
  const byId = new Map(facts.map(f => [f.id, f]));
  const fullText = sentences.map(s => s.text).join(' ');

  for (const s of sentences) {
    if (s.factIds.length === 0) return { valid: false, reason: 'uncited_sentence' };
    const cited = s.factIds.map(id => byId.get(id)).filter((f): f is InsightFact => !!f);
    if (cited.length !== s.factIds.length) return { valid: false, reason: 'unknown_fact_id' };
    const allowedNumbers = new Set(cited.flatMap(f => f.numbers));
    const usedNumbers = Array.from(s.text.matchAll(NUMBER_RE)).map(m => Number(m[0]));
    for (const n of usedNumbers) {
      if (!allowedNumbers.has(n)) return { valid: false, reason: `uncited_number_${n}` };
    }
  }

  if (CAUSAL_LEXICON.test(fullText)) return { valid: false, reason: 'causal_language' };
  if (MEDICATION_LEXICON.test(fullText)) return { valid: false, reason: 'medication_language' };
  if (DIAGNOSIS_LEXICON.test(fullText)) return { valid: false, reason: 'diagnosis_language' };

  const grade = fleschKincaidGrade(fullText);
  if (grade > 8) return { valid: false, reason: `reading_grade_${grade.toFixed(1)}` };

  return { valid: true };
}
