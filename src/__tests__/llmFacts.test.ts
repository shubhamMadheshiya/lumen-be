import { factsForFinding, factsForProgress, factsForStats, factsForWarning } from '../services/llm/facts';
import type { DescriptiveStatDto, FindingDto, ProgressDto } from '../services/insightPresenter';

const finding: FindingDto = {
  id: 'opt_dairy|opt_fatigue|1',
  exposureKey: 'opt_dairy',
  outcomeKey: 'opt_fatigue',
  exposure: { categoryName: 'Food & Drink', optionLabel: 'Dairy' },
  outcome: { categoryName: 'Symptom', optionLabel: 'Fatigue' },
  lagDays: 1,
  counts: { exposedWith: 9, exposedTotal: 14, otherWith: 6, otherTotal: 31 },
  tier: 'possible',
  noLongerSeen: false,
  weakDays: false,
};

describe('factsForFinding', () => {
  it('gives every fact a unique random id', () => {
    const facts = factsForFinding(finding);
    const ids = new Set(facts.map(f => f.id));
    expect(ids.size).toBe(facts.length);
  });

  it('carries the exact counts as numbers, traceable for the numeral validator', () => {
    const facts = factsForFinding(finding);
    const rateFact = facts.find(f => f.text.includes('9 of 14'));
    expect(rateFact).toBeDefined();
    expect(rateFact!.numbers).toEqual(expect.arrayContaining([9, 14]));
  });

  it('includes both labels somewhere in the facts', () => {
    const facts = factsForFinding(finding);
    const allLabels = facts.flatMap(f => f.labels);
    expect(allLabels).toEqual(expect.arrayContaining(['Dairy', 'Fatigue']));
  });
});

describe('factsForProgress', () => {
  const progress: ProgressDto = {
    trend: { state: 'improving', weeklyValues: [], pValue: 0.03, estimatedChange: 3.2, weeksNeeded: 0 },
    goodBadDays: { good: 12, bad: 4, observed: 20, windowDays: 90 },
    recentShift: { dayKey: '2026-10-01', direction: 'down' },
  };

  it('states the trend and good/bad counts as separate facts', () => {
    const facts = factsForProgress(progress);
    expect(facts.some(f => f.text.includes('improving'))).toBe(true);
    expect(facts.some(f => f.numbers.includes(12) && f.numbers.includes(4) && f.numbers.includes(20))).toBe(true);
  });
});

describe('factsForWarning', () => {
  it('states no active alert when alert is false', () => {
    const facts = factsForWarning({ alert: false, alertLevel: null, level1Enabled: false, episodeCount: 2, loggedDays: 50, trackRecordFollowed: null, trackRecordOf: null });
    expect(facts.some(f => /no early-warning alert/i.test(f.text))).toBe(true);
  });

  it('states the track record when one exists', () => {
    const facts = factsForWarning({ alert: true, alertLevel: 1, level1Enabled: true, episodeCount: 6, loggedDays: 200, trackRecordFollowed: 10, trackRecordOf: 23 });
    expect(facts.some(f => f.numbers.includes(10) && f.numbers.includes(23))).toBe(true);
  });
});

describe('factsForStats', () => {
  const stats: DescriptiveStatDto[] = [
    { key: 'sleep', icon: '😴', title: 'Average sleep', value: '6h 45m', sub: 'over the last 7 nights' },
    { key: 'symptom-severity', icon: '🩺', title: 'Symptom severity', value: '3.2', sub: 'average this week, 4.1 the week before', trend: 'down' },
  ];

  it('turns every descriptive stat into a fact carrying its title and value', () => {
    const facts = factsForStats(stats);
    expect(facts).toHaveLength(2);
    expect(facts.some(f => f.text.includes('Average sleep') && f.text.includes('6h 45m'))).toBe(true);
    expect(facts.some(f => f.text.includes('Symptom severity') && f.text.includes('3.2') && f.text.includes('down'))).toBe(true);
  });

  it('gives Ask something to answer a sleep question from, which it would not have without this fact', () => {
    const facts = factsForStats(stats);
    expect(facts.some(f => /sleep/i.test(f.text))).toBe(true);
  });
});
