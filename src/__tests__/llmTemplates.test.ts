import { templateForFinding, templateForProgress, templateForWarning, ASK_FALLBACK_TEXT } from '../services/llm/templates';
import { CAUSAL_LEXICON, MEDICATION_LEXICON, DIAGNOSIS_LEXICON } from '../services/llm/validators';
import type { FindingDto, ProgressDto } from '../services/insightPresenter';
import type { WarningStateLike } from '../services/llm/facts';

const finding = (over: Partial<FindingDto> = {}): FindingDto => ({
  id: 'x', exposureKey: 'opt_a', outcomeKey: 'opt_b',
  exposure: { categoryName: 'Food', optionLabel: 'Dairy' },
  outcome: { categoryName: 'Symptom', optionLabel: 'Fatigue' },
  lagDays: 1,
  counts: { exposedWith: 9, exposedTotal: 14, otherWith: 6, otherTotal: 31 },
  tier: 'possible',
  noLongerSeen: false,
  weakDays: false,
  ...over,
});

const progress = (state: ProgressDto['trend']['state']): ProgressDto => ({
  trend: { state, weeklyValues: [], pValue: null, estimatedChange: null, weeksNeeded: 0 },
  goodBadDays: { good: 5, bad: 2, observed: 10, windowDays: 90 },
  recentShift: null,
});

const warning = (over: Partial<WarningStateLike> = {}): WarningStateLike => ({
  alert: false, alertLevel: null, level1Enabled: false, episodeCount: 3, loggedDays: 60,
  trackRecordFollowed: null, trackRecordOf: null, ...over,
});

describe('template fallback copy-lint', () => {
  const allTexts = [
    templateForFinding(finding()),
    templateForFinding(finding({ tier: 'consistent' })),
    ...(['improving', 'worsening', 'steady', 'mixed', 'not_enough_data'] as const).map(progress).map(templateForProgress),
    templateForWarning(warning()),
    templateForWarning(warning({ alert: true, alertLevel: 1, trackRecordFollowed: 10, trackRecordOf: 23 })),
    ASK_FALLBACK_TEXT,
  ];

  it.each(allTexts)('never uses causal, medication-change or diagnostic language: %s', text => {
    expect(CAUSAL_LEXICON.test(text)).toBe(false);
    expect(MEDICATION_LEXICON.test(text)).toBe(false);
    expect(DIAGNOSIS_LEXICON.test(text)).toBe(false);
  });

  it('states the exact counts given', () => {
    expect(templateForFinding(finding())).toContain('9 of 14');
    expect(templateForFinding(finding())).toContain('6 of 31');
  });
});
