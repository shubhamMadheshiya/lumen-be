import mongoose from 'mongoose';
import { markdownToDoc, inlineNodes } from '../services/notes/markdownToDoc';
import { validateDoc, docToMarkdown } from '../shared/notes/docUtils';
import { buildDraftContent, fieldsForMeasure, measureOfFields } from '../services/templates/aiTemplateDraft';
import { cleanMarkdown, journalHeading } from '../services/notes/aiNoteActions';

const id = () => new mongoose.Types.ObjectId();

describe('markdownToDoc', () => {
  const md = `# Doctor visit prep

Since last visit things were **better** overall, see [guide](https://example.org).

## Symptoms
- Joint pain 6/10 on *3 days*
- Fatigue

1. First
2. Second

- [ ] Ask about \`HCQ\` dose
- [x] Book blood test

> Remember: bring reports

---

\`\`\`
raw code
\`\`\``;

  it('builds a valid editor document with every block and mark the AI uses', () => {
    const doc = markdownToDoc(md) as { type: string; content: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }[] };
    expect(validateDoc(doc)).toEqual({ valid: true });
    expect(doc.content.map(n => n.type)).toEqual([
      'heading', 'paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'horizontalRule', 'codeBlock',
    ]);
    expect(doc.content[0].attrs).toEqual({ level: 1 });
    const tasks = doc.content[5].content as { attrs: { checked: boolean } }[];
    expect(tasks.map(t => t.attrs.checked)).toEqual([false, true]);
    // Round trip keeps the meaning
    const back = docToMarkdown(doc);
    expect(back).toContain('Joint pain 6/10');
    expect(back).toContain('Book blood test');
  });

  it('marks bold, italic, code and links inline', () => {
    expect(inlineNodes('a **b** *c* `d` [e](https://x.y)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'c', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'd', marks: [{ type: 'code' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'e', marks: [{ type: 'link', attrs: { href: 'https://x.y', target: '_blank' } }] },
    ]);
  });

  it('always returns at least an empty paragraph', () => {
    expect(markdownToDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

describe('fieldsForMeasure', () => {
  it('turns a simple measure into a valid field', () => {
    expect(fieldsForMeasure('severity')[0]).toMatchObject({ key: 'severity', dataType: 'range', min: 0, max: 10, displayAs: 'slider' });
    expect(fieldsForMeasure('temperature')[0]).toMatchObject({ dataType: 'temperature', allowedUnits: ['°C', '°F'] });
    expect(fieldsForMeasure('number', { unit: 'glasses', min: 0, max: 20 })[0]).toMatchObject({ dataType: 'number', unit: 'glasses', max: 20 });
    expect(fieldsForMeasure('number', { min: 5, max: 1 })[0]).toMatchObject({ min: 5, max: 105 });
    expect(fieldsForMeasure('none')).toEqual([]);
    expect(fieldsForMeasure('rocket')).toEqual([]);
    expect(measureOfFields(fieldsForMeasure('yes_no'))).toBe('yes_no');
  });
});

describe('buildDraftContent', () => {
  const symptomsCat = { _id: id(), name: 'Symptoms', role: 'symptom', templateKey: 'cat_symptoms', order: 0 };
  const painQ = { _id: id(), categoryId: symptomsCat._id, title: 'What symptoms?', templateKey: 'q_custom', order: 0 };
  const config = {
    categories: [symptomsCat],
    questions: [painQ],
    options: [{ _id: id(), questionId: painQ._id, label: 'Headache', templateKey: undefined, order: 0 }],
    quickActions: [{ _id: id(), label: 'Water', templateKey: 'qa_water', order: 0 }],
  } as never;

  it('expands library items and marks what the member already tracks', () => {
    const d = buildDraftContent({ library: { categories: ['cat_symptoms', 'cat_body_output', 'nope'], quickActions: ['qa_water', 'qa_bowel'] } }, config);
    expect(d.categories.map(c => c.templateKey)).toEqual(['cat_symptoms', 'cat_body_output']);
    expect(d.categories[0].existingId).toBe(String(symptomsCat._id));
    expect(d.categories[1]).toMatchObject({ fromLibrary: true, include: true });
    expect(d.categories[1].questions.length).toBeGreaterThan(0);
    expect(d.quickActions.find(q => q.templateKey === 'qa_water')).toMatchObject({ include: false, existingId: expect.any(String) });
    expect(d.quickActions.find(q => q.templateKey === 'qa_bowel')).toMatchObject({ include: true });
  });

  it('builds custom items with valid fields, under an existing category when names match', () => {
    const d = buildDraftContent({
      custom: [
        { category: 'symptoms', role: 'symptom', questions: [{ title: 'Morning stiffness', frequency: 'morning', options: [{ label: 'Stiffness', measure: 'duration' }, { label: '' }] }] },
        { category: 'Joints', role: 'weird', icon: '🦴', questions: [{ title: 'Which joints?', options: [{ label: 'Knee', measure: 'severity' }] }] },
        { category: 'Empty', questions: [{ title: 'No options', options: [] }] },
      ],
    }, config);
    expect(d.categories).toHaveLength(2);
    expect(d.categories[0]).toMatchObject({ name: 'symptoms', existingId: String(symptomsCat._id) });
    expect(d.categories[0].questions[0]).toMatchObject({ title: 'Morning stiffness', frequency: 'morning' });
    expect(d.categories[0].questions[0].options).toHaveLength(1);
    expect(d.categories[0].questions[0].options[0].fields[0]).toMatchObject({ dataType: 'duration' });
    expect(d.categories[1]).toMatchObject({ name: 'Joints', role: 'symptom', icon: '🦴' });
  });

  it('adds options to an existing question, skipping ones it already has, and only archives the member\'s own items', () => {
    const d = buildDraftContent({
      addOptions: [{ questionId: String(painQ._id), options: [{ label: 'Jaw pain', measure: 'severity' }, { label: 'headache', measure: 'severity' }] }, { questionId: String(id()), options: [{ label: 'x' }] }],
      archive: [{ kind: 'category', id: String(symptomsCat._id), reason: 'Unused for 3 months' }, { kind: 'category', id: String(id()) }],
    }, config);
    expect(d.addOptions).toHaveLength(1);
    expect(d.addOptions[0].options.map(o => o.label)).toEqual(['Jaw pain']);
    expect(d.archive).toEqual([expect.objectContaining({ kind: 'category', targetId: String(symptomsCat._id), label: 'Symptoms', include: false })]);
  });

  it('caps the size of a proposal', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ category: `C${i}`, questions: [{ title: 'Q', options: [{ label: 'O', measure: 'yes_no' }] }] }));
    expect(buildDraftContent({ custom: many }, config).categories).toHaveLength(8);
  });
});

describe('note action helpers', () => {
  it('strips fences and prefaces from AI markdown', () => {
    expect(cleanMarkdown('```markdown\n- a\n```')).toBe('- a');
    expect(cleanMarkdown("Here is the summary:\n- a")).toBe('- a');
  });

  it('labels journal days', () => {
    expect(journalHeading('2026-11-16')).toBe('16 Nov 2026 (Mon)');
  });
});

describe('archive suggestions', () => {
  it('never suggests hiding something added recently', () => {
    const now = new Date('2026-11-17T00:00:00Z');
    const fresh = { _id: id(), name: 'Food & Drink', role: 'trigger_candidate', templateKey: 'cat_food', order: 0, createdAt: new Date('2026-11-10T00:00:00Z') };
    const old = { _id: id(), name: 'Daily Habits', role: 'context', templateKey: 'cat_habits', order: 1, createdAt: new Date('2026-06-01T00:00:00Z') };
    const config = { categories: [fresh, old], questions: [], options: [], quickActions: [] } as never;
    const d = buildDraftContent({ archive: [{ kind: 'category', id: String(fresh._id) }, { kind: 'category', id: String(old._id) }] }, config, now);
    expect(d.archive.map(a => a.label)).toEqual(['Daily Habits']);
  });
});
