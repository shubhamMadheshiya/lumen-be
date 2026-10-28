import { classifyQuestion, fixedReplyFor } from '../services/llm/router';

describe('classifyQuestion', () => {
  it.each([
    'I have chest pain right now, what should I do',
    "I can't breathe properly",
  ])('routes crisis language to crisis: %s', q => expect(classifyQuestion(q)).toBe('crisis'));

  it.each([
    'should I stop my medication',
    'is it ok to skip my dose today',
    'should I increase my dosage',
  ])('routes medicine-change questions to medication: %s', q => expect(classifyQuestion(q)).toBe('medication'));

  it.each([
    'do I have lupus',
    "what's wrong with me",
    'am I having a flare',
  ])('routes diagnosis-seeking questions to diagnosis: %s', q => expect(classifyQuestion(q)).toBe('diagnosis'));

  it.each([
    'how many days did I log dairy this month',
    'is my sleep getting better',
    'what pattern did you find about coffee',
  ])('routes ordinary data questions to ok: %s', q => expect(classifyQuestion(q)).toBe('ok'));
});

describe('fixedReplyFor', () => {
  it('gives a fixed, non-empty reply for every non-ok route', () => {
    (['crisis', 'medication', 'diagnosis'] as const).forEach(route => {
      expect(fixedReplyFor(route).length).toBeGreaterThan(10);
    });
  });
});
