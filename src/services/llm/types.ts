/**
 * Shared types for the LLM narration layer (Phase 6).
 *
 * The model never sees raw logs, notes or database ids. It only sees `InsightFact[]` — numbers
 * and labels the engine already computed and verified — and must cite which facts back each
 * sentence it writes. `validateNarration` (./validators.ts) then checks the citations are honest
 * before the text is ever shown.
 */

export type FactKind = 'rate' | 'count' | 'tier' | 'label' | 'trend' | 'days' | 'other';

export interface InsightFact {
  /** Random per-request id (never a database id), e.g. "f_a1b2c3". */
  id: string;
  kind: FactKind;
  /** The fact stated in plain words, e.g. "9 of 14 days after Food dairy had Fatigue logged". */
  text: string;
  /** Every bare number in `text`, for the validator's numeral check. */
  numbers: number[];
  /** Every item/category label in `text`, for the validator's name check. */
  labels: string[];
}

export interface NarrationSentence {
  text: string;
  /** Ids of the InsightFact objects this sentence is built from. */
  factIds: string[];
}

export interface NarrationResult {
  sentences: NarrationSentence[];
}
