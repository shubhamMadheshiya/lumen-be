import { sharedTemplateToProposal } from '../services/templates/sharedTemplate';
import { buildDraftContent } from '../services/templates/aiTemplateDraft';

const embed = {
  title: 'Joints Logging Template',
  categories: [{
    name: 'Joints', role: 'symptom', icon: '🦴',
    questions: [{
      title: 'Which joints hurt?', frequency: 'daily',
      options: [
        { label: 'Knee', fields: [{ key: 'severity', dataType: 'range', min: 0, max: 10 }] },
        { label: 'Swollen', fields: [{ key: 'v', dataType: 'boolean' }] },
        { label: '', fields: [] },
      ],
    }],
  }],
};

describe('sharedTemplateToProposal', () => {
  it('rebuilds a shared category as a custom proposal the draft builder accepts', () => {
    const proposal = sharedTemplateToProposal(embed)!;
    const draft = buildDraftContent(proposal, { categories: [], questions: [], options: [], quickActions: [] } as never);
    expect(draft.categories).toHaveLength(1);
    const options = draft.categories[0].questions[0].options;
    expect(options.map(o => [o.label, o.measure])).toEqual([['Knee', 'severity'], ['Swollen', 'yes_no']]);
    expect(options[0].fields[0]).toMatchObject({ dataType: 'range', min: 0, max: 10 });
  });

  it('returns null for old shares without questions and for junk', () => {
    expect(sharedTemplateToProposal({ title: 'x', categories: [{ name: 'Joints' }] })).toBeNull();
    expect(sharedTemplateToProposal('nope')).toBeNull();
    expect(sharedTemplateToProposal({ categories: 'x' })).toBeNull();
  });
});
