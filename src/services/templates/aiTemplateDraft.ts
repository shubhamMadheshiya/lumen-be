/**
 * Lumen AI log templates: the AI proposes (library keys first, then custom items described by a
 * simple "measure"), this module turns the proposal into a reviewable draft, and the member's
 * review applies or undoes it. The AI never writes raw field definitions and never changes the
 * member's tracking setup by itself.
 */
import mongoose from 'mongoose';
import { Category } from '../../models/Category';
import { Question } from '../../models/Question';
import { Option } from '../../models/Option';
import { QuickAction } from '../../models/QuickAction';
import { User } from '../../models/User';
import {
  AiTemplateDraft,
  type AppliedRef, type DraftAddOptions, type DraftArchive, type DraftCategory, type DraftField,
  type DraftOption, type DraftQuestion, type DraftQuickAction, type IAiTemplateDraftDoc,
} from '../../models/AiTemplateDraft';
import { ALL_CATEGORY_TEMPLATES, QUICK_ACTION_TEMPLATES } from '../../shared/templates/library';

export const LIMITS = { categories: 8, questions: 10, options: 15, quickActions: 10, archive: 10, addOptions: 10 };
export const MEASURES = ['severity', 'yes_no', 'number', 'duration', 'temperature', 'text', 'none'] as const;
export type Measure = (typeof MEASURES)[number];

const ROLE_COLOR = { symptom: '#FF3B30', trigger_candidate: '#FF9500', context: '#5856D6' } as const;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();
const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A simple "how is it measured" choice → valid field definitions. */
export function fieldsForMeasure(measure: string, opts: { unit?: string; min?: number; max?: number } = {}): DraftField[] {
  switch (measure as Measure) {
    case 'severity':
      return [{ key: 'severity', label: 'Severity', dataType: 'range', min: 0, max: 10, step: 1, displayAs: 'slider', helpText: '0 = none, 10 = worst ever' }];
    case 'yes_no':
      return [{ key: 'present', label: 'Yes / no', dataType: 'boolean', displayAs: 'toggle' }];
    case 'number': {
      const min = opts.min ?? 0;
      const max = opts.max !== undefined && opts.max > min ? opts.max : min + 100;
      return [{ key: 'amount', label: opts.unit ? `Amount (${opts.unit})` : 'Amount', dataType: 'number', unit: opts.unit, min, max, step: 1, displayAs: 'stepper' }];
    }
    case 'duration':
      return [{ key: 'duration', label: 'How long', dataType: 'duration', unit: 'min', min: 0, max: 1440, step: 5, displayAs: 'stepper' }];
    case 'temperature':
      return [{ key: 'temperature', label: 'Temperature', dataType: 'temperature', unit: '°C', allowedUnits: ['°C', '°F'], min: 35, max: 42, step: 0.1, displayAs: 'stepper' }];
    case 'text':
      return [{ key: 'details', label: 'Details', dataType: 'string', displayAs: 'text', placeholder: 'Describe it…' }];
    default:
      return [];
  }
}

/** The plain-words field type for the review screen. */
export function measureOfFields(fields: DraftField[]): string {
  const f = fields[0];
  if (!f) return 'none';
  if (f.dataType === 'range') return 'severity';
  if (f.dataType === 'boolean') return 'yes_no';
  if (f.dataType === 'temperature') return 'temperature';
  if (f.dataType === 'duration') return 'duration';
  if (f.dataType === 'string') return 'text';
  if (f.dataType === 'number') return 'number';
  return f.dataType;
}

// ── The member's current setup ───────────────────────────────────────────────

export async function loadConfig(userId: string) {
  const uid = new mongoose.Types.ObjectId(userId);
  const active = { userId: uid, archivedAt: { $exists: false } };
  const [categories, questions, options, quickActions] = await Promise.all([
    Category.find(active).select('name role templateKey order createdAt').sort({ order: 1 }).lean(),
    Question.find(active).select('categoryId title templateKey order createdAt').sort({ order: 1 }).lean(),
    Option.find(active).select('questionId label templateKey order createdAt').sort({ order: 1 }).lean(),
    QuickAction.find(active).select('label templateKey order').sort({ order: 1 }).lean(),
  ]);
  return { categories, questions, options, quickActions };
}
type Config = Awaited<ReturnType<typeof loadConfig>>;

// ── Proposal → draft ─────────────────────────────────────────────────────────

/** What the AI sends (loosely typed: it is model output and is checked here). */
export interface Proposal {
  title?: unknown;
  summary?: unknown;
  library?: { categories?: unknown; quickActions?: unknown };
  custom?: unknown;
  addOptions?: unknown;
  customQuickActions?: unknown;
  archive?: unknown;
}

const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Record<string, unknown>[] : []);

function customOption(o: Record<string, unknown>, id: string, existing: Config['options'], questionId?: string): DraftOption | null {
  const label = str(o.label, 100);
  if (!label) return null;
  const measure = (MEASURES as readonly string[]).includes(String(o.measure)) ? String(o.measure) : 'none';
  const match = questionId ? existing.find(x => String(x.questionId) === questionId && norm(x.label) === norm(label)) : undefined;
  return {
    id, label, allowComment: true, captureTime: 'user_picks', measure,
    fields: fieldsForMeasure(measure, { unit: str(o.unit, 20) || undefined, min: num(o.min), max: num(o.max) }),
    include: !match, ...(match ? { existingId: String(match._id) } : {}),
  };
}

/** Items newer than this are never suggested for archiving. */
export const ARCHIVE_MIN_AGE_MS = 45 * 86_400_000;

export function buildDraftContent(proposal: Proposal, config: Config, now = new Date()) {
  const categories: DraftCategory[] = [];
  const findCat = (templateKey: string | undefined, name: string) =>
    config.categories.find(c => (templateKey && c.templateKey === templateKey) || norm(c.name) === norm(name));
  const findQ = (catId: string | undefined, templateKey: string | undefined, title: string) =>
    config.questions.find(q => (templateKey && q.templateKey === templateKey) || (catId && String(q.categoryId) === catId && norm(q.title) === norm(title)));

  // Library categories, expanded.
  const libCats = Array.isArray(proposal.library?.categories) ? (proposal.library!.categories as unknown[]) : [];
  for (const key of libCats.map(String)) {
    if (categories.length >= LIMITS.categories) break;
    const t = ALL_CATEGORY_TEMPLATES.find(c => c.templateKey === key);
    if (!t || categories.some(c => c.templateKey === key)) continue;
    const cid = `c${categories.length + 1}`;
    const catMatch = findCat(t.templateKey, t.name);
    const questions: DraftQuestion[] = t.questions.slice(0, LIMITS.questions).map((q, qi) => {
      const qMatch = findQ(catMatch ? String(catMatch._id) : undefined, q.templateKey, q.title);
      const options: DraftOption[] = q.options.slice(0, LIMITS.options).map((o, oi) => {
        const oMatch = config.options.find(x => x.templateKey === o.templateKey || (qMatch && String(x.questionId) === String(qMatch._id) && norm(x.label) === norm(o.label)));
        const fields = o.fields as DraftField[];
        return {
          id: `${cid}q${qi + 1}o${oi + 1}`, templateKey: o.templateKey, label: o.label, icon: o.icon, allowComment: o.allowComment,
          captureTime: o.captureTime === 'none' ? 'none' : 'user_picks', fields, measure: measureOfFields(fields),
          include: !oMatch, ...(oMatch ? { existingId: String(oMatch._id) } : {}),
        };
      });
      return {
        id: `${cid}q${qi + 1}`, templateKey: q.templateKey, title: q.title, helpText: q.helpText, selectionType: q.selectionType,
        allowOther: q.allowOther, frequency: q.frequency, options,
        include: !qMatch || options.some(o => o.include), ...(qMatch ? { existingId: String(qMatch._id) } : {}),
      };
    });
    categories.push({
      id: cid, templateKey: t.templateKey, name: t.name, icon: t.icon, color: t.color, role: t.role, fromLibrary: true, questions,
      include: !catMatch || questions.some(q => q.include), ...(catMatch ? { existingId: String(catMatch._id) } : {}),
    });
  }

  // Custom categories (new, or more questions under one the member already has).
  for (const c of arr(proposal.custom)) {
    if (categories.length >= LIMITS.categories) break;
    const name = str(c.category ?? c.name, 60);
    if (!name) continue;
    const role = (['symptom', 'trigger_candidate', 'context'] as const).find(r => r === c.role) ?? 'symptom';
    const cid = `c${categories.length + 1}`;
    const catMatch = findCat(undefined, name);
    const questions: DraftQuestion[] = [];
    for (const q of arr(c.questions).slice(0, LIMITS.questions)) {
      const title = str(q.title, 200);
      if (!title) continue;
      const qid = `${cid}q${questions.length + 1}`;
      const qMatch = findQ(catMatch ? String(catMatch._id) : undefined, undefined, title);
      const options = arr(q.options).slice(0, LIMITS.options)
        .map((o, oi) => customOption(o, `${qid}o${oi + 1}`, config.options, qMatch ? String(qMatch._id) : undefined))
        .filter((o): o is DraftOption => !!o);
      if (!options.length) continue;
      questions.push({
        id: qid, title, helpText: str(q.helpText, 300) || undefined,
        selectionType: q.selectionType === 'single' ? 'single' : 'multiple', allowOther: true,
        frequency: (['anytime', 'once_per_day', 'morning', 'evening'] as const).find(f => f === q.frequency) ?? 'anytime',
        options, include: !qMatch || options.some(o => o.include), ...(qMatch ? { existingId: String(qMatch._id) } : {}),
      });
    }
    if (!questions.length) continue;
    categories.push({
      id: cid, name, icon: str(c.icon, 8) || '🩺', color: ROLE_COLOR[role], role, fromLibrary: false, questions,
      include: true, ...(catMatch ? { existingId: String(catMatch._id) } : {}),
    });
  }

  // More options for questions the member already has (e.g. something they keep typing under "Other").
  const addOptions: DraftAddOptions[] = [];
  for (const a of arr(proposal.addOptions).slice(0, LIMITS.addOptions)) {
    const q = config.questions.find(x => String(x._id) === String(a.questionId));
    if (!q) continue;
    const id = `a${addOptions.length + 1}`;
    const options = arr(a.options).slice(0, LIMITS.options)
      .map((o, oi) => customOption(o, `${id}o${oi + 1}`, config.options, String(q._id)))
      .filter((o): o is DraftOption => !!o && o.include);
    if (options.length) addOptions.push({ id, questionId: String(q._id), questionTitle: q.title, options });
  }

  const quickActions: DraftQuickAction[] = [];
  const libQa = Array.isArray(proposal.library?.quickActions) ? (proposal.library!.quickActions as unknown[]).map(String) : [];
  for (const key of libQa) {
    if (quickActions.length >= LIMITS.quickActions) break;
    const t = QUICK_ACTION_TEMPLATES.find(q => q.templateKey === key);
    if (!t || quickActions.some(q => q.templateKey === key)) continue;
    const match = config.quickActions.find(q => q.templateKey === key || norm(q.label) === norm(t.label));
    quickActions.push({
      id: `qa${quickActions.length + 1}`, templateKey: t.templateKey, label: t.label, icon: t.icon, color: t.color, mode: t.mode,
      unit: t.unit, dailyGoal: t.dailyGoal, fromLibrary: true, include: !match, ...(match ? { existingId: String(match._id) } : {}),
    });
  }
  for (const q of arr(proposal.customQuickActions)) {
    if (quickActions.length >= LIMITS.quickActions) break;
    const label = str(q.label, 40);
    if (!label) continue;
    const match = config.quickActions.find(x => norm(x.label) === norm(label));
    quickActions.push({
      id: `qa${quickActions.length + 1}`, label, icon: str(q.icon, 8) || '✅', color: '#34C759',
      mode: (['counter', 'timer', 'toggle'] as const).find(m => m === q.mode) ?? 'counter',
      unit: str(q.unit, 20) || undefined, dailyGoal: num(q.dailyGoal), fromLibrary: false,
      include: !match, ...(match ? { existingId: String(match._id) } : {}),
    });
  }

  // Suggestions to retire things the member doesn't use. Only their own active items.
  const archive: DraftArchive[] = [];
  for (const a of arr(proposal.archive).slice(0, LIMITS.archive)) {
    const kind = (['category', 'question', 'option'] as const).find(k => k === a.kind);
    if (!kind) continue;
    const pool = kind === 'category' ? config.categories : kind === 'question' ? config.questions : config.options;
    const target = (pool as { _id: unknown; name?: string; title?: string; label?: string; createdAt?: Date }[]).find(x => String(x._id) === String(a.id));
    if (!target) continue;
    // "Unused" only means something once it has had time to be used: never retire recent additions.
    if (target.createdAt && now.getTime() - new Date(target.createdAt).getTime() < ARCHIVE_MIN_AGE_MS) continue;
    archive.push({
      id: `r${archive.length + 1}`, kind, targetId: String(target._id),
      label: target.name ?? target.title ?? target.label ?? '', reason: str(a.reason, 200), include: false,
    });
  }

  return { categories, addOptions, quickActions, archive };
}

export async function createDraft(
  userId: string,
  proposal: Proposal,
  meta: { request?: string; conversationId?: string } = {},
): Promise<IAiTemplateDraftDoc | null> {
  const content = buildDraftContent(proposal, await loadConfig(userId));
  if (!content.categories.length && !content.addOptions.length && !content.quickActions.length && !content.archive.length) return null;
  return AiTemplateDraft.create({
    userId: new mongoose.Types.ObjectId(userId),
    title: str(proposal.title, 120) || 'Lumen AI tracking suggestion',
    summary: str(proposal.summary, 1000),
    request: meta.request ? str(meta.request, 1000) : undefined,
    conversationId: meta.conversationId,
    ...content,
  });
}

// ── Apply / undo ─────────────────────────────────────────────────────────────

export type ItemEdits = Record<string, { include?: boolean; label?: string }>;

const pick = <T extends { id: string; include: boolean }>(item: T, edits: ItemEdits) => edits[item.id]?.include ?? item.include;
const relabel = (current: string, id: string, edits: ItemEdits, max: number) => str(edits[id]?.label, max) || current;

export class DraftError extends Error {
  constructor(public code: 'NOT_FOUND' | 'NOT_DRAFT' | 'NOT_APPLIED', message: string) { super(message); }
}

export async function applyDraft(userId: string, draftId: string, edits: ItemEdits = {}): Promise<IAiTemplateDraftDoc> {
  const uid = new mongoose.Types.ObjectId(userId);
  const draft = mongoose.isValidObjectId(draftId) ? await AiTemplateDraft.findOne({ _id: draftId, userId: uid }) : null;
  if (!draft) throw new DraftError('NOT_FOUND', 'Draft not found');
  if (draft.status !== 'draft') throw new DraftError('NOT_DRAFT', 'This suggestion was already used.');

  const created: AppliedRef[] = [];
  const archived: AppliedRef[] = [];
  const keyFor = (templateKey: string | undefined, itemId: string) => templateKey ?? `ai_${draftId}_${itemId}`;
  const owns = async (kind: 'category' | 'question', id: string) =>
    !!(await (kind === 'category' ? Category : Question).exists({ _id: id, userId: uid }));

  let catOrder = await Category.countDocuments({ userId: uid });
  const createOption = async (o: DraftOption, questionId: unknown, order: number) => {
    const doc = await Option.create({
      userId: uid, questionId, label: relabel(o.label, o.id, edits, 100), icon: o.icon, allowComment: o.allowComment,
      captureTime: o.captureTime, fields: o.fields, order, isActive: true, templateKey: keyFor(o.templateKey, o.id),
    });
    created.push({ kind: 'option', id: String(doc._id) });
  };

  for (const c of draft.categories) {
    if (!pick(c, edits)) continue;
    let categoryId: unknown = c.existingId && (await owns('category', c.existingId)) ? c.existingId : undefined;
    if (!categoryId) {
      const cat = await Category.create({
        userId: uid, name: relabel(c.name, c.id, edits, 60), icon: c.icon, color: c.color, role: c.role,
        order: catOrder++, isActive: true, templateKey: keyFor(c.templateKey, c.id),
      });
      categoryId = cat._id;
      created.push({ kind: 'category', id: String(cat._id) });
    }
    let qOrder = await Question.countDocuments({ userId: uid, categoryId });
    for (const q of c.questions) {
      if (!pick(q, edits)) continue;
      let questionId: unknown = q.existingId && (await owns('question', q.existingId)) ? q.existingId : undefined;
      if (!questionId) {
        const question = await Question.create({
          userId: uid, categoryId, title: relabel(q.title, q.id, edits, 200), helpText: q.helpText, selectionType: q.selectionType,
          allowOther: q.allowOther, required: false, frequency: q.frequency, order: qOrder++, version: 1, isActive: true,
          templateKey: keyFor(q.templateKey, q.id),
        });
        questionId = question._id;
        created.push({ kind: 'question', id: String(question._id) });
      }
      let oOrder = await Option.countDocuments({ userId: uid, questionId });
      for (const o of q.options) if (pick(o, edits) && !o.existingId) await createOption(o, questionId, oOrder++);
    }
  }

  for (const a of draft.addOptions) {
    if (!(await owns('question', a.questionId))) continue;
    let oOrder = await Option.countDocuments({ userId: uid, questionId: a.questionId });
    for (const o of a.options) if (pick(o, edits) && !o.existingId) await createOption(o, a.questionId, oOrder++);
  }

  let qaOrder = await QuickAction.countDocuments({ userId: uid });
  for (const q of draft.quickActions) {
    if (!pick(q, edits) || q.existingId) continue;
    const doc = await QuickAction.create({
      userId: uid, label: relabel(q.label, q.id, edits, 40), icon: q.icon, color: q.color, mode: q.mode, unit: q.unit,
      dailyGoal: q.dailyGoal, order: qaOrder++, isVisible: true, templateKey: keyFor(q.templateKey, q.id),
    });
    created.push({ kind: 'quickAction', id: String(doc._id) });
  }

  for (const r of draft.archive) {
    if (!pick(r, edits)) continue;
    const model = r.kind === 'category' ? Category : r.kind === 'question' ? Question : Option;
    const res = await (model as typeof Category).updateOne(
      { _id: r.targetId, userId: uid, archivedAt: { $exists: false } },
      { $set: { isActive: false, archivedAt: new Date() } },
    );
    if (res.modifiedCount) archived.push({ kind: r.kind, id: r.targetId });
  }

  draft.status = 'applied';
  draft.applied = { created, archived, at: new Date() };
  draft.markModified('applied');
  await draft.save();
  if (created.length || archived.length) await User.findByIdAndUpdate(uid, { $inc: { configVersion: 1 } });
  return draft;
}

const MODEL_FOR = { category: Category, question: Question, option: Option, quickAction: QuickAction } as const;

/** Hides everything the draft created and brings back what it archived. Logged entries are untouched. */
export async function undoDraft(userId: string, draftId: string): Promise<IAiTemplateDraftDoc> {
  const uid = new mongoose.Types.ObjectId(userId);
  const draft = mongoose.isValidObjectId(draftId) ? await AiTemplateDraft.findOne({ _id: draftId, userId: uid }) : null;
  if (!draft) throw new DraftError('NOT_FOUND', 'Draft not found');
  if (draft.status !== 'applied') throw new DraftError('NOT_APPLIED', 'Nothing to undo.');
  const now = new Date();
  for (const ref of draft.applied.created) {
    const set = ref.kind === 'quickAction' ? { isVisible: false, archivedAt: now } : { isActive: false, archivedAt: now };
    await (MODEL_FOR[ref.kind] as typeof Category).updateOne({ _id: ref.id, userId: uid }, { $set: set });
  }
  for (const ref of draft.applied.archived) {
    await (MODEL_FOR[ref.kind] as typeof Category).updateOne({ _id: ref.id, userId: uid }, { $set: { isActive: true }, $unset: { archivedAt: 1 } });
  }
  draft.status = 'undone';
  await draft.save();
  await User.findByIdAndUpdate(uid, { $inc: { configVersion: 1 } });
  return draft;
}

/** For the app: the draft plus counts of what "Add" would do. */
export function draftPayload(d: IAiTemplateDraftDoc) {
  const optionsToAdd = d.categories.filter(c => c.include).flatMap(c => c.questions.filter(q => q.include).flatMap(q => q.options.filter(o => o.include && !o.existingId)))
    .length + d.addOptions.flatMap(a => a.options.filter(o => o.include)).length;
  return {
    id: String(d._id), title: d.title, summary: d.summary, status: d.status,
    categories: d.categories, addOptions: d.addOptions, quickActions: d.quickActions, archive: d.archive,
    counts: {
      categories: d.categories.filter(c => c.include && !c.existingId).length,
      options: optionsToAdd,
      quickActions: d.quickActions.filter(q => q.include && !q.existingId).length,
      archive: d.archive.length,
    },
    applied: { created: d.applied?.created?.length ?? 0, archived: d.applied?.archived?.length ?? 0, at: d.applied?.at ?? null },
    createdAt: d.createdAt,
  };
}
