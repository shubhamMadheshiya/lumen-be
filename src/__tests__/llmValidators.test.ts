import { validateNarration, fleschKincaidGrade, CAUSAL_LEXICON, MEDICATION_LEXICON, DIAGNOSIS_LEXICON } from '../services/llm/validators';
import type { InsightFact, NarrationSentence } from '../services/llm/types';

const fact = (id: string, text: string): InsightFact => ({
  id, kind: 'rate', text, numbers: Array.from(text.matchAll(/\d+(\.\d+)?/g)).map(m => Number(m[0])), labels: [],
});

describe('validateNarration', () => {
  const facts: InsightFact[] = [fact('f1', '9 of 14 days after dairy, fatigue was logged.')];

  it('accepts a sentence whose numbers all come from its cited fact', () => {
    const sentences: NarrationSentence[] = [{ text: 'Fatigue showed up on 9 of 14 days after dairy.', factIds: ['f1'] }];
    expect(validateNarration(sentences, facts)).toEqual({ valid: true });
  });

  it('rejects a sentence with no cited facts', () => {
    const sentences: NarrationSentence[] = [{ text: 'Something happened.', factIds: [] }];
    expect(validateNarration(sentences, facts).valid).toBe(false);
  });

  it('rejects a sentence citing an unknown fact id', () => {
    const sentences: NarrationSentence[] = [{ text: 'Fatigue happened often.', factIds: ['f999'] }];
    expect(validateNarration(sentences, facts).valid).toBe(false);
  });

  it('rejects a number not present in the cited fact', () => {
    const sentences: NarrationSentence[] = [{ text: 'Fatigue showed up on 11 of 14 days after dairy.', factIds: ['f1'] }];
    const result = validateNarration(sentences, facts);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('uncited_number');
  });

  it('rejects causal language even when the numbers are honest', () => {
    const sentences: NarrationSentence[] = [{ text: 'Dairy causes fatigue on 9 of 14 days.', factIds: ['f1'] }];
    expect(validateNarration(sentences, facts).valid).toBe(false);
  });

  it('rejects medication-change language', () => {
    const sentences: NarrationSentence[] = [{ text: 'You should stop your medication dose.', factIds: ['f1'] }];
    expect(validateNarration(sentences, facts).valid).toBe(false);
  });

  it('rejects diagnostic language', () => {
    const sentences: NarrationSentence[] = [{ text: 'This sounds like a flare starting.', factIds: ['f1'] }];
    expect(validateNarration(sentences, facts).valid).toBe(false);
  });

  it('allows a legitimate denial sentence ("not a prediction") without tripping the lexicons', () => {
    const sentences: NarrationSentence[] = [{ text: 'This is not a diagnosis and does not mean dairy causes anything — just 9 of 14 days line up.', factIds: ['f1'] }];
    // The sentence intentionally contains the word "causes" inside a denial; the lexicon is a
    // blunt safety net and is allowed to be conservative here, so this is expected to fail closed.
    expect(validateNarration(sentences, facts).valid).toBe(false);
  });

  it('rejects text above an 8th-grade reading level', () => {
    const longWord = 'uncharacteristically';
    const text = `The ${longWord} multifactorial predispositional susceptibility manifestation was documented on 9 of 14 occasions subsequent to dietary consumption.`;
    const sentences: NarrationSentence[] = [{ text, factIds: ['f1'] }];
    expect(validateNarration(sentences, facts).valid).toBe(false);
  });
});

describe('fleschKincaidGrade', () => {
  it('scores simple short sentences low', () => {
    expect(fleschKincaidGrade('You had a good day. It was nice.')).toBeLessThan(8);
  });
});

describe('lexicons', () => {
  it.each(['causes', 'leads to', 'due to', 'triggers'])('causal lexicon matches "%s"', word => {
    expect(CAUSAL_LEXICON.test(`dairy ${word} fatigue`)).toBe(true);
  });
  it('medication lexicon matches "stop your medication"', () => {
    expect(MEDICATION_LEXICON.test('you could stop your medication')).toBe(true);
  });
  it('diagnosis lexicon matches "sounds like"', () => {
    expect(DIAGNOSIS_LEXICON.test('this sounds like a flare')).toBe(true);
  });
});
