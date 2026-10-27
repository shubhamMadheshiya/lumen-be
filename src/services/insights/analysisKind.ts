/**
 * How Insights treats a category or quick tap. The member's own choice (`analysis.kind`) always
 * wins; otherwise a category follows its role, and a quick tap is guessed from its label.
 *
 * `reactive` matters most: painkillers, rest and "Flare now" are usually done BECAUSE of a
 * symptom, so offering them as a possible cause would just be the symptom pointing at itself.
 */

export type AnalysisKind = 'exposure' | 'outcome' | 'reactive' | 'context' | 'ignore';

interface Item {
  analysis?: { kind?: AnalysisKind } | null;
}

interface CategoryLike extends Item { role: 'trigger_candidate' | 'symptom' | 'context' }
interface QuickActionLike extends Item { label: string }

const OUTCOME_LABEL = /\b(flare|flaring|symptom|pain|ache|attack)\b/i;
const REACTIVE_LABEL = /\b(painkiller|pain ?relief|analgesic|ibuprofen|paracetamol|acetaminophen|aspirin|naproxen|rest|lie down|lying down|nap|ice|heat pack|heating pad|stretch|breathing)\b/i;
const CONTEXT_LABEL = /\b(water|stood|stand|face wash|hand wash|brush)\b/i;

export function categoryKind(c: CategoryLike): AnalysisKind {
  if (c.analysis?.kind) return c.analysis.kind;
  if (c.role === 'trigger_candidate') return 'exposure';
  if (c.role === 'symptom') return 'outcome';
  return 'context';
}

export function quickActionKind(q: QuickActionLike): AnalysisKind {
  if (q.analysis?.kind) return q.analysis.kind;
  // "Flare now" and the like are symptoms the member is reporting, not things that happened to them
  if (OUTCOME_LABEL.test(q.label)) return 'outcome';
  if (REACTIVE_LABEL.test(q.label)) return 'reactive';
  // Everyday upkeep taps happen almost daily; compared with symptoms they only add noise
  if (CONTEXT_LABEL.test(q.label)) return 'context';
  return 'exposure';
}
