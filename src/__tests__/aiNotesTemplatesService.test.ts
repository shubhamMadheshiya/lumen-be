import mongoose from 'mongoose';
import { Note } from '../models/Note';
import { User } from '../models/User';
import { Category } from '../models/Category';
import { Question } from '../models/Question';
import { Option } from '../models/Option';
import { QuickAction } from '../models/QuickAction';
import { AiTemplateDraft } from '../models/AiTemplateDraft';
import { createAiNote, appendToNote } from '../services/notes/aiNoteWriter';
import { applyDraft, undoDraft, DraftError } from '../services/templates/aiTemplateDraft';
import { runWriteTool } from '../services/llm/assistant/writeTools';
import { runNoteAction, writeJournalEntry } from '../services/notes/aiNoteActions';
import { runAssistant } from '../services/llm/assistant/assistant';

jest.mock('../services/llm/assistant/assistant', () => ({ runAssistant: jest.fn() }));

const ME = new mongoose.Types.ObjectId().toString();
const ctx = { userId: ME, timeZone: 'Asia/Kolkata', boundaryHour: 4, photoAccess: false, today: '2026-11-17' };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('aiNoteWriter', () => {
  it('creates a note in the editor format, tagged and owned by the member', async () => {
    const create = jest.spyOn(Note, 'create').mockImplementation((async (d: Record<string, unknown>) => ({ _id: 'n1', ...d })) as never);
    await createAiNote(ME, { title: '## **RA plan**', markdown: '- [ ] Ask about MTX', tags: ['Doctor'] });
    const doc = create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc).toMatchObject({ title: 'RA plan', tags: ['lumen-ai', 'doctor'], icon: '✨', plainText: expect.stringContaining('Ask about MTX'), deletedAt: null });
    expect(String(doc.userId)).toBe(ME);
    expect((doc.doc as { content: { type: string }[] }).content[0].type).toBe('taskList');
  });

  it('only puts a note under a parent the member owns', async () => {
    jest.spyOn(Note, 'findOne').mockReturnValue({ select: () => ({ lean: async () => null }) } as never);
    const create = jest.spyOn(Note, 'create').mockImplementation((async (d: Record<string, unknown>) => d) as never);
    await createAiNote(ME, { title: 'x', markdown: 'y', parentNoteId: new mongoose.Types.ObjectId().toString() });
    expect((create.mock.calls[0][0] as Record<string, unknown>).parentNoteId).toBeNull();
  });

  it('appends to the end of an existing note, dropping an empty first paragraph', async () => {
    const note = {
      _id: 'n1', title: 'T', doc: { type: 'doc', content: [{ type: 'paragraph' }] }, plainText: '',
      markModified: jest.fn(), save: jest.fn(async () => undefined),
    } as Record<string, unknown>;
    const find = jest.spyOn(Note, 'findOne').mockResolvedValue(note as never);
    await appendToNote(ME, new mongoose.Types.ObjectId().toString(), '## Summary\n- one');
    expect((find.mock.calls[0][0] as Record<string, unknown>).deletedAt).toBeNull();
    expect((note.doc as { content: { type: string }[] }).content.map(n => n.type)).toEqual(['heading', 'bulletList']);
    expect(note.plainText).toContain('one');
    expect(note.save).toHaveBeenCalled();
  });
});

describe('write tools', () => {
  it('create_note returns a note card for the chat', async () => {
    jest.spyOn(Note, 'create').mockImplementation((async (d: Record<string, unknown>) => ({ _id: 'n9', ...d })) as never);
    const out = await runWriteTool(ctx, 'create_note', { title: 'Flare plan', markdown: '- rest' });
    expect(out.artifact).toEqual({ type: 'note', id: 'n9', title: 'Flare plan' });
  });

  it('propose_log_template saves a draft (not applied) and returns a review card', async () => {
    for (const m of [Category, Question, Option, QuickAction]) jest.spyOn(m, 'find').mockReturnValue({ select: () => ({ sort: () => ({ lean: async () => [] }) }) } as never);
    jest.spyOn(AiTemplateDraft, 'create').mockImplementation((async (d: Record<string, unknown>) => ({ _id: 'd1', ...d })) as never);
    const out = await runWriteTool(ctx, 'propose_log_template', { title: 'RA tracking', library: { categories: ['cat_symptoms'] } });
    expect(out.artifact).toEqual({ type: 'template_draft', id: 'd1', title: 'RA tracking' });
    expect(out.response).toMatchObject({ ok: true, note: expect.stringContaining('NOT added yet') });
  });

  it('says so when there is nothing new to propose', async () => {
    for (const m of [Category, Question, Option, QuickAction]) jest.spyOn(m, 'find').mockReturnValue({ select: () => ({ sort: () => ({ lean: async () => [] }) }) } as never);
    const out = await runWriteTool(ctx, 'propose_log_template', { title: 'x', library: { categories: ['nope'] } });
    expect(out).toEqual({ response: { ok: false, error: expect.stringContaining('Nothing new') } });
  });
});

describe('applyDraft / undoDraft', () => {
  const draftDoc = (over: Record<string, unknown> = {}) => ({
    _id: 'd1', status: 'draft', applied: { created: [], archived: [] },
    categories: [{
      id: 'c1', name: 'Joints', icon: '🦴', color: '#f00', role: 'symptom', fromLibrary: false, include: true,
      questions: [
        { id: 'c1q1', title: 'Which joints?', selectionType: 'multiple', allowOther: true, frequency: 'anytime', include: true,
          options: [
            { id: 'c1q1o1', label: 'Knee', allowComment: true, captureTime: 'user_picks', fields: [], measure: 'none', include: true },
            { id: 'c1q1o2', label: 'Hip', allowComment: true, captureTime: 'user_picks', fields: [], measure: 'none', include: true },
          ] },
        { id: 'c1q2', title: 'Skipped', selectionType: 'single', allowOther: true, frequency: 'anytime', include: false, options: [] },
      ],
    }],
    addOptions: [], quickActions: [{ id: 'qa1', templateKey: 'qa_walk', label: 'Walk', icon: '🚶', color: '#0f0', mode: 'timer', fromLibrary: true, include: true }],
    archive: [{ id: 'r1', kind: 'category', targetId: 'old1', label: 'Old', reason: 'unused', include: false }],
    markModified: jest.fn(), save: jest.fn(async () => undefined),
    ...over,
  });

  beforeEach(() => {
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(3 as never);
    jest.spyOn(Question, 'countDocuments').mockResolvedValue(0 as never);
    jest.spyOn(Option, 'countDocuments').mockResolvedValue(0 as never);
    jest.spyOn(QuickAction, 'countDocuments').mockResolvedValue(5 as never);
    jest.spyOn(Category, 'create').mockImplementation((async (d: Record<string, unknown>) => ({ _id: 'cat1', ...d })) as never);
    jest.spyOn(Question, 'create').mockImplementation((async (d: Record<string, unknown>) => ({ _id: 'q1', ...d })) as never);
    let n = 0;
    jest.spyOn(Option, 'create').mockImplementation((async (d: Record<string, unknown>) => ({ _id: `o${++n}`, ...d })) as never);
    jest.spyOn(QuickAction, 'create').mockImplementation((async (d: Record<string, unknown>) => ({ _id: 'qa1', ...d })) as never);
    jest.spyOn(Category, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    jest.spyOn(User, 'findByIdAndUpdate').mockResolvedValue({} as never);
  });

  it('creates only what the member kept, with their renames, and records it for undo', async () => {
    const d = draftDoc();
    jest.spyOn(AiTemplateDraft, 'findOne').mockResolvedValue(d as never);
    await applyDraft(ME, new mongoose.Types.ObjectId().toString(), { c1q1o2: { include: false }, c1q1o1: { label: 'Left knee' }, r1: { include: true } });
    expect(Category.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Joints', order: 3, templateKey: expect.stringMatching(/^ai_.+_c1$/) }));
    expect(Question.create).toHaveBeenCalledTimes(1);
    expect(Option.create).toHaveBeenCalledTimes(1);
    expect(Option.create).toHaveBeenCalledWith(expect.objectContaining({ label: 'Left knee', questionId: 'q1' }));
    expect(QuickAction.create).toHaveBeenCalledWith(expect.objectContaining({ templateKey: 'qa_walk', order: 5 }));
    expect(Category.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: 'old1' }), { $set: expect.objectContaining({ isActive: false }) });
    expect(d.status).toBe('applied');
    expect((d.applied as { created: unknown[]; archived: unknown[] }).created).toEqual([
      { kind: 'category', id: 'cat1' }, { kind: 'question', id: 'q1' }, { kind: 'option', id: 'o1' }, { kind: 'quickAction', id: 'qa1' },
    ]);
    expect((d.applied as { archived: unknown[] }).archived).toEqual([{ kind: 'category', id: 'old1' }]);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(expect.anything(), { $inc: { configVersion: 1 } });
  });

  it('refuses to apply twice or another member\'s draft', async () => {
    jest.spyOn(AiTemplateDraft, 'findOne').mockResolvedValue(draftDoc({ status: 'applied' }) as never);
    await expect(applyDraft(ME, new mongoose.Types.ObjectId().toString())).rejects.toBeInstanceOf(DraftError);
    jest.spyOn(AiTemplateDraft, 'findOne').mockResolvedValue(null as never);
    await expect(applyDraft(ME, new mongoose.Types.ObjectId().toString())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('undo hides what was created and restores what was archived, nothing else', async () => {
    const d = draftDoc({ status: 'applied', applied: { created: [{ kind: 'category', id: 'cat1' }, { kind: 'quickAction', id: 'qa1' }], archived: [{ kind: 'category', id: 'old1' }] } });
    jest.spyOn(AiTemplateDraft, 'findOne').mockResolvedValue(d as never);
    const qaUpdate = jest.spyOn(QuickAction, 'updateOne').mockResolvedValue({} as never);
    await undoDraft(ME, new mongoose.Types.ObjectId().toString());
    expect(Category.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: 'cat1' }), { $set: expect.objectContaining({ isActive: false }) });
    expect(qaUpdate).toHaveBeenCalledWith(expect.objectContaining({ _id: 'qa1' }), { $set: expect.objectContaining({ isVisible: false }) });
    expect(Category.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: 'old1' }), { $set: { isActive: true }, $unset: { archivedAt: 1 } });
    expect(d.status).toBe('undone');
  });
});

describe('note actions and journal', () => {
  const N1 = new mongoose.Types.ObjectId();
  const noteDoc = () => ({
    _id: N1, title: 'Plan', icon: '📝', tags: [], doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rest and fluids.' }] }] },
    plainText: 'Rest and fluids.', markModified: jest.fn(), save: jest.fn(async () => undefined),
  });

  it('summarize appends a Summary section using only the note, without write tools', async () => {
    const note = noteDoc();
    jest.spyOn(Note, 'findOne').mockResolvedValue(note as never);
    (runAssistant as jest.Mock).mockResolvedValue({ text: '```markdown\n- Rest more\n```', artifacts: [] });
    const out = await runNoteAction(ME, new mongoose.Types.ObjectId().toString(), 'summarize');
    expect(out).toEqual({ ok: true, noteId: String(N1), created: false });
    expect(runAssistant).toHaveBeenCalledWith(expect.objectContaining({ allowWrites: false, message: expect.stringContaining('Rest and fluids.') }));
    expect(note.plainText).toContain('Summary');
    expect(note.plainText).toContain('Rest more');
  });

  it('a translation becomes a sub-page copy', async () => {
    jest.spyOn(Note, 'findOne')
      .mockResolvedValueOnce(noteDoc() as never)
      .mockReturnValueOnce({ select: () => ({ lean: async () => ({ _id: N1 }) }) } as never);
    const create = jest.spyOn(Note, 'create').mockImplementation((async (d: Record<string, unknown>) => ({ _id: 'n2', ...d })) as never);
    (runAssistant as jest.Mock).mockResolvedValue({ text: 'Aaram aur paani.', artifacts: [] });
    const out = await runNoteAction(ME, new mongoose.Types.ObjectId().toString(), 'hinglish');
    expect(out).toEqual({ ok: true, noteId: 'n2', created: true });
    expect(create.mock.calls[0][0]).toMatchObject({ title: 'Plan · Hinglish', parentNoteId: N1 });
  });

  it('writes a journal day once', async () => {
    jest.spyOn(User, 'findById').mockReturnValue({ select: () => ({ lean: async () => ({ preferences: { aiJournalNoteId: new mongoose.Types.ObjectId().toString() } }) }) } as never);
    const journal = { ...noteDoc(), title: 'Health journal', plainText: '16 Nov 2026 (Mon)\n- done' };
    jest.spyOn(Note, 'findOne').mockResolvedValue(journal as never);
    expect(await writeJournalEntry(ME, '2026-11-16')).toBe(false);
    expect(runAssistant).not.toHaveBeenCalled();
    (runAssistant as jest.Mock).mockResolvedValue({ text: '- Pain 4/10, slept 7 h', artifacts: [] });
    expect(await writeJournalEntry(ME, '2026-11-17')).toBe(true);
    expect(journal.plainText).toContain('17 Nov 2026 (Tue)');
    expect(journal.plainText).toContain('Pain 4/10');
  });
});
