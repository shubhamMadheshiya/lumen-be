/**
 * Things the member attaches to a Lumen AI message ("refs"): a day, a note, a task or list, a
 * medicine, a health record, a flare, an experiment, an insight pattern, a weekly review or a PDF.
 *
 * `resolveRef` turns one into compact data the model reads with the question. The same resolver
 * backs the `open_attachment` tool, so later turns can re-read something attached earlier (chat
 * history keeps only each attachment's kind, id and title). Every lookup is filtered by userId.
 */
import mongoose from 'mongoose';
import { Note, type INoteBlockDoc } from '../../../models/Note';
import { Task } from '../../../models/Task';
import { TaskList } from '../../../models/TaskList';
import { Medication } from '../../../models/Medication';
import { HealthRecord } from '../../../models/HealthRecord';
import { FlareEpisode } from '../../../models/FlareEpisode';
import { Experiment } from '../../../models/Experiment';
import { InsightFinding } from '../../../models/InsightFinding';
import { AiWeeklyReport } from '../../../models/AiWeeklyReport';
import { docToMarkdown } from '../../../shared/notes/docUtils';
import { presentFindings } from '../../insightPresenter';
import { flattenBlocks, runTool, type ToolContext } from './dataTools';
import { getFileForAi, getPhotoForAi, type PhotoForAi } from './mediaBytes';

import { type ChatRef, type RefKind } from './refTypes';

export { REF_KINDS, MAX_REFS, MAX_FILE_REFS, type ChatRef, type RefKind } from './refTypes';

/** Characters of data per attachment and per message, so one big list can't crowd out the question. */
export const MAX_REF_CHARS = 12_000;
export const MAX_REFS_TOTAL_CHARS = 40_000;
/** A health record's own documents included when it is attached. */
const MAX_RECORD_FILES = 2;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const KIND_LABEL: Record<RefKind, string> = {
  day: 'day', note: 'note', task: 'task', list: 'to-do list', medication: 'medicine', record: 'health record',
  flare: 'flare', experiment: 'experiment', pattern: 'insight pattern', weekly_report: 'weekly review', file: 'file',
};

export const refLabel = (ref: Pick<ChatRef, 'kind' | 'id' | 'title'>) => `${KIND_LABEL[ref.kind]} "${ref.title}" [${ref.kind}:${ref.id}]`;

export type RefFile = PhotoForAi & { mediaId: string; label: string };

export type ResolvedRef =
  | { ok: true; data: Record<string, unknown>; files: RefFile[] }
  | { ok: false; reason: 'not_found' | 'invalid' | 'unreadable' | 'too_large' | 'not_a_pdf' };

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const validId = (id: string) => mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id);

function noteText(n: { doc?: unknown; plainText?: string; blocks?: unknown }): string {
  return n.doc ? docToMarkdown(n.doc as Parameters<typeof docToMarkdown>[0]) : n.plainText || flattenBlocks(n.blocks as INoteBlockDoc[]);
}

const presentTask = (t: {
  _id: unknown; title: string; notes?: string; isCompleted: boolean; completedAt?: Date; isImportant: boolean; inMyDay: boolean;
  dueDate?: string; reminderTime?: string; repeat?: unknown; energyCost?: string; categories?: string[];
  steps?: Array<{ title: string; completed: boolean }>; createdAt?: Date;
}) => ({
  id: String(t._id),
  title: t.title,
  done: t.isCompleted,
  completedAt: t.completedAt,
  important: t.isImportant || undefined,
  inMyDay: t.inMyDay || undefined,
  due: t.dueDate,
  reminder: t.reminderTime,
  repeat: t.repeat,
  energyCost: t.energyCost,
  categories: t.categories?.length ? t.categories : undefined,
  steps: t.steps?.length ? t.steps.map(s => `${s.completed ? '[x]' : '[ ]'} ${s.title}`) : undefined,
  notes: t.notes || undefined,
  created: t.createdAt,
});

type Resolver = (ctx: ToolContext, id: string) => Promise<ResolvedRef>;

const resolvers: Record<RefKind, Resolver> = {
  async day(ctx, id) {
    if (!DAY_RE.test(id)) return { ok: false, reason: 'invalid' };
    const res = await runTool(ctx, 'get_day', { date: id });
    if ('error' in res.response) return { ok: false, reason: 'unreadable' };
    return { ok: true, data: res.response, files: [] };
  },

  async note(ctx, id) {
    if (!validId(id)) return { ok: false, reason: 'invalid' };
    const n = await Note.findOne({ _id: id, userId: oid(ctx.userId), deletedAt: null }).lean();
    if (!n) return { ok: false, reason: 'not_found' };
    return {
      ok: true,
      data: { id, title: n.title, updated: n.updatedAt, tags: n.tags?.length ? n.tags : undefined, text: noteText(n) },
      files: [],
    };
  },

  async task(ctx, id) {
    if (!validId(id)) return { ok: false, reason: 'invalid' };
    const t = await Task.findOne({ _id: id, userId: oid(ctx.userId) }).lean();
    if (!t) return { ok: false, reason: 'not_found' };
    const list = t.listId ? await TaskList.findOne({ _id: t.listId, userId: oid(ctx.userId) }).select('name').lean() : null;
    return { ok: true, data: { ...presentTask(t), list: list?.name ?? 'Tasks' }, files: [] };
  },

  async list(ctx, id) {
    if (!validId(id)) return { ok: false, reason: 'invalid' };
    const list = await TaskList.findOne({ _id: id, userId: oid(ctx.userId) }).lean();
    if (!list) return { ok: false, reason: 'not_found' };
    const [open, done] = await Promise.all([
      Task.find({ userId: oid(ctx.userId), listId: list._id, isCompleted: false }).sort({ sortOrder: 1 }).limit(150).lean(),
      Task.find({ userId: oid(ctx.userId), listId: list._id, isCompleted: true }).sort({ completedAt: -1 }).limit(100).lean(),
    ]);
    return { ok: true, data: { id, name: list.name, openTasks: open.map(presentTask), recentlyCompleted: done.map(presentTask) }, files: [] };
  },

  async medication(ctx, id) {
    if (!validId(id)) return { ok: false, reason: 'invalid' };
    const m = await Medication.findOne({ _id: id, userId: oid(ctx.userId) }).lean();
    if (!m) return { ok: false, reason: 'not_found' };
    return {
      ok: true,
      data: {
        id, name: m.name, dose: m.dose, unit: m.unit, schedule: m.schedule, active: m.active,
        startedOn: m.startedOn, stoppedOn: m.stoppedOn, changes: m.changes ?? [],
      },
      files: [],
    };
  },

  async record(ctx, id) {
    if (!validId(id)) return { ok: false, reason: 'invalid' };
    const r = await HealthRecord.findOne({ _id: id, userId: oid(ctx.userId) }).lean();
    if (!r) return { ok: false, reason: 'not_found' };
    const mediaIds = (r.mediaIds ?? []).map(String);
    const files: RefFile[] = [];
    for (const [i, mediaId] of mediaIds.slice(0, MAX_RECORD_FILES).entries()) {
      const res = await getPhotoForAi(ctx.userId, mediaId, ctx.photoAccess);
      if (res.ok) files.push({ ...res.photo, mediaId, label: `Document ${i + 1} of health record "${r.title}"${r.fileNames?.[i] ? ` (${r.fileNames[i]})` : ''}:` });
    }
    return {
      ok: true,
      data: {
        id, title: r.title, type: r.type, date: r.date, doctor: r.doctorName, clinic: r.clinicOrLab, notes: r.notes,
        biomarkers: r.biomarkers, medications: r.medications, tags: r.tags?.length ? r.tags : undefined,
        documents: mediaIds.length,
        ...(mediaIds.length && !ctx.photoAccess ? { documentsNotice: 'The documents are not included: photo access is turned off in Settings.' } : {}),
        ...(mediaIds.length > MAX_RECORD_FILES && ctx.photoAccess ? { documentsNotice: `Only the first ${MAX_RECORD_FILES} documents are attached; use view_photo for the others: ${mediaIds.slice(MAX_RECORD_FILES).join(', ')}.` } : {}),
      },
      files,
    };
  },

  async flare(ctx, id) {
    if (!validId(id)) return { ok: false, reason: 'invalid' };
    const f = await FlareEpisode.findOne({ _id: id, userId: oid(ctx.userId) }).lean();
    if (!f) return { ok: false, reason: 'not_found' };
    return { ok: true, data: { id, start: f.startDay, end: f.endDay, source: f.source, rule: f.rule, confirmed: f.confirmed }, files: [] };
  },

  async experiment(ctx, id) {
    if (!validId(id)) return { ok: false, reason: 'invalid' };
    const e = await Experiment.findOne({ _id: id, userId: oid(ctx.userId) }).lean();
    if (!e) return { ok: false, reason: 'not_found' };
    return {
      ok: true,
      data: {
        id, testing: e.exposureLabel, outcome: e.outcomeLabel, startDay: e.startDay, washoutDays: e.washoutDays,
        blockOrder: e.blockOrder, status: e.status, medicine: e.isMedicineRelated,
        note: 'Each block is one week; "with" means doing the thing, "without" means not doing it.',
      },
      files: [],
    };
  },

  async pattern(ctx, id) {
    const [exposureKey, outcomeKey, lag] = id.split('|');
    const lagDays = Number(lag);
    if (!exposureKey || !outcomeKey || !Number.isInteger(lagDays)) return { ok: false, reason: 'invalid' };
    const stored = await InsightFinding.find({ userId: oid(ctx.userId), exposureKey, outcomeKey, lagDays }).lean();
    if (!stored.length) return { ok: false, reason: 'not_found' };
    const [f] = await presentFindings(stored);
    if (!f) return { ok: false, reason: 'not_found' };
    return {
      ok: true,
      data: {
        id, exposure: f.exposure.optionLabel, outcome: f.outcome.optionLabel, lagDays: f.lagDays, tier: f.tier,
        daysWithExposure: `${f.counts.exposedWith} of ${f.counts.exposedTotal}`, otherDays: `${f.counts.otherWith} of ${f.counts.otherTotal}`,
        noLongerSeen: f.noLongerSeen,
        note: 'Counts are days where the outcome followed. Same-days association, not proof of cause.',
      },
      files: [],
    };
  },

  async weekly_report(ctx, id) {
    if (!validId(id)) return { ok: false, reason: 'invalid' };
    const r = await AiWeeklyReport.findOne({ _id: id, userId: oid(ctx.userId) }).lean();
    if (!r) return { ok: false, reason: 'not_found' };
    return { ok: true, data: { id, weekStart: r.weekStart, weekEnd: r.weekEnd, text: r.text }, files: [] };
  },

  async file(ctx, id) {
    if (!validId(id)) return { ok: false, reason: 'invalid' };
    const res = await getFileForAi(ctx.userId, id);
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, data: { id, kind: 'PDF document', attached: 'below' }, files: [{ ...res.file, mediaId: id, label: '' }] };
  },
};

const REASON_TEXT: Record<Exclude<ResolvedRef, { ok: true }>['reason'], string> = {
  not_found: 'it no longer exists or is not theirs',
  invalid: 'the reference is not valid',
  unreadable: 'it could not be read just now',
  too_large: 'the file is too large (over 10 MB)',
  not_a_pdf: 'only PDF files can be attached',
};
export const refFailureText = (reason: keyof typeof REASON_TEXT) => REASON_TEXT[reason];

export async function resolveRef(ctx: ToolContext, ref: Pick<ChatRef, 'kind' | 'id'>): Promise<ResolvedRef> {
  const resolver = resolvers[ref.kind];
  if (!resolver) return { ok: false, reason: 'invalid' };
  try {
    return await resolver(ctx, String(ref.id ?? ''));
  } catch (err) {
    console.error(`[assistant] attachment ${ref.kind}:${ref.id} failed:`, err);
    return { ok: false, reason: 'unreadable' };
  }
}

/** Compact JSON, cut to `max` characters with a marker so the model knows it is partial. */
export function clipJson(data: Record<string, unknown>, max: number): string {
  const s = JSON.stringify(data);
  return s.length > max ? `${s.slice(0, max)}… (cut: ${s.length - max} more characters; ask the member or use the other tools for the rest)` : s;
}
