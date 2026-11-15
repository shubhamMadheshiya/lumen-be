/**
 * Lumen AI's read tools: the member's OWN data, all of it, including free-text notes and photos.
 * Gemini decides which to call (function calling), so a question only pulls what it needs.
 *
 * Every handler filters by the member's userId — there is no way to name another member's data.
 * Community chat is deliberately absent: it holds other people's messages. Raw GPS routes are left
 * out (no analytic value, lots of tokens). Results are capped so a tool reply stays small.
 */
import mongoose from 'mongoose';
import { SchemaType, type FunctionDeclaration } from '@google/generative-ai';
import { LogEntry } from '../../../models/LogEntry';
import { Category } from '../../../models/Category';
import { Note, type INoteBlockDoc } from '../../../models/Note';
import { Task } from '../../../models/Task';
import { Medication } from '../../../models/Medication';
import { HealthRecord } from '../../../models/HealthRecord';
import { DaySession } from '../../../models/DaySession';
import { DailyActivity } from '../../../models/DailyActivity';
import { ActivitySession } from '../../../models/ActivitySession';
import { FlareEpisode } from '../../../models/FlareEpisode';
import { Experiment } from '../../../models/Experiment';
import { InsightFinding } from '../../../models/InsightFinding';
import { Media } from '../../../models/Media';
import { docToMarkdown } from '../../../shared/notes/docUtils';
import { loadFlareDayKeys, loadPersistedDayRows } from '../../insights/dayTableService';
import { classifyTrend, goodBadDays, regimeShifts, weeklyMedians } from '../../insights/progress';
import { presentFindings, presentProgress } from '../../insightPresenter';
import { shiftDayKey, trackingDayKey } from '../../../utils/dayKey';
import { getPhotoForAi, type PhotoForAi } from './mediaBytes';

export interface ToolContext {
  userId: string;
  timeZone: string;
  boundaryHour: number;
  photoAccess: boolean;
  /** Lumen day "today" for this member. */
  today: string;
}

export interface ToolResult {
  response: Record<string, unknown>;
  /** Photos the model asked to look at; sent back to it as image parts. */
  images?: Array<PhotoForAi & { mediaId: string }>;
}

const DEFAULT_DAYS = 30;
const MAX_DAYS = 400;
const DEFAULT_ROWS = 100;
const MAX_ROWS = 300;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const clip = (s: unknown, n = 400): string | undefined => {
  if (s == null || s === '') return undefined;
  const t = String(s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const num = (v: unknown, fallback: number, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

/** Resolves a from/to pair of Lumen days, defaulting to the last 30 days and capping the span. */
function range(ctx: ToolContext, args: Record<string, unknown>, defaultDays = DEFAULT_DAYS): { from: string; to: string } {
  const to = typeof args.to === 'string' && DAY_RE.test(args.to) ? args.to : ctx.today;
  let from = typeof args.from === 'string' && DAY_RE.test(args.from) ? args.from : shiftDayKey(to, -(defaultDays - 1));
  if (from > to) from = to;
  if (shiftDayKey(from, MAX_DAYS) < to) from = shiftDayKey(to, -MAX_DAYS);
  return { from, to };
}

/** A UTC window wide enough to contain every instant of those Lumen days, whatever the zone. */
const widen = (from: string, to: string) => ({
  $gte: new Date(`${shiftDayKey(from, -1)}T00:00:00Z`),
  $lt: new Date(`${shiftDayKey(to, 2)}T00:00:00Z`),
});

const oid = (id: string) => new mongoose.Types.ObjectId(id);

/** Media ids referenced by an entry: the entry's own list plus photo-type answer values. */
function photoIdsOf(entry: { mediaIds?: unknown[]; answers?: Array<{ values?: Array<{ dataType?: string; value?: unknown }> }> }): string[] {
  const ids = new Set<string>((entry.mediaIds ?? []).map(String));
  for (const a of entry.answers ?? []) {
    for (const v of a.values ?? []) {
      if (v.dataType !== 'image') continue;
      const vals = Array.isArray(v.value) ? v.value : [v.value];
      for (const x of vals) if (typeof x === 'string' && mongoose.isValidObjectId(x)) ids.add(x);
    }
  }
  return Array.from(ids);
}

function formatValue(v: { fieldKey?: string; dataType?: string; value?: unknown; unit?: string }): string | null {
  if (v.dataType === 'image') return null;
  const raw = typeof v.value === 'object' && v.value !== null ? JSON.stringify(v.value) : String(v.value ?? '');
  if (!raw) return null;
  return `${v.fieldKey ?? 'value'}=${clip(raw, 80)}${v.unit ? ` ${v.unit}` : ''}`;
}

async function categoryNames(userId: string): Promise<Map<string, string>> {
  const cats = await Category.find({ userId }).select('name').lean();
  return new Map(cats.map(c => [String(c._id), c.name]));
}

type Entry = {
  _id: unknown; occurredAt: Date; categoryId?: unknown; source?: string; note?: string;
  answers?: Array<{ optionLabelSnapshot?: string; comment?: string; otherText?: string; values?: Array<{ fieldKey?: string; dataType?: string; value?: unknown; unit?: string }> }>;
  mediaIds?: unknown[];
  location?: { city?: string; region?: string; country?: string; name?: string };
};

function presentEntry(e: Entry, ctx: ToolContext, cats: Map<string, string>) {
  return {
    day: trackingDayKey(new Date(e.occurredAt), ctx.timeZone, ctx.boundaryHour),
    at: new Date(e.occurredAt).toISOString(),
    category: e.categoryId ? cats.get(String(e.categoryId)) ?? 'Unknown' : e.source,
    items: (e.answers ?? []).map(a => ({
      label: a.optionLabelSnapshot,
      values: (a.values ?? []).map(formatValue).filter(Boolean),
      comment: clip(a.comment),
      other: clip(a.otherText),
    })),
    note: clip(e.note, 1000),
    place: e.location?.city ?? e.location?.name,
    photoIds: photoIdsOf(e),
  };
}

async function loadEntries(ctx: ToolContext, from: string, to: string, extra: Record<string, unknown> = {}) {
  const rows = await LogEntry.find({ userId: oid(ctx.userId), deletedAt: { $exists: false }, occurredAt: widen(from, to), ...extra })
    .sort({ occurredAt: -1 })
    .lean<Entry[]>();
  return rows.filter(e => {
    const d = trackingDayKey(new Date(e.occurredAt), ctx.timeZone, ctx.boundaryHour);
    return d >= from && d <= to;
  });
}

function flattenBlocks(blocks: INoteBlockDoc[] = []): string {
  const out: string[] = [];
  const walk = (bs: INoteBlockDoc[]) => bs.forEach(b => {
    if (b.content) out.push(b.type === 'todo' ? `[${b.completed ? 'x' : ' '}] ${b.content}` : b.content);
    if (b.children?.length) walk(b.children);
  });
  walk(blocks);
  return out.join('\n');
}

// ── Declarations ─────────────────────────────────────────────────────────────

const S = SchemaType;
const dateRange = {
  from: { type: S.STRING, description: 'First Lumen day, YYYY-MM-DD. Defaults to 30 days before `to`.' },
  to: { type: S.STRING, description: 'Last Lumen day, YYYY-MM-DD. Defaults to today.' },
} as const;

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'list_categories',
    description: "The member's own tracking categories (e.g. Symptoms, Food & Drink, Vitals) with their role. Call first if unsure what a category is called.",
  },
  {
    name: 'search_logs',
    description: 'Logged entries in a date range: every answer, value (severity, amounts, temperature, Bristol type...), comment, free-text note, place, and photo ids. Newest first.',
    parameters: {
      type: S.OBJECT,
      properties: {
        ...dateRange,
        category: { type: S.STRING, description: 'Only this category name (case-insensitive substring).' },
        text: { type: S.STRING, description: 'Only entries whose item label, comment or note contains this text (case-insensitive).' },
        limit: { type: S.INTEGER, description: `Max entries, default ${DEFAULT_ROWS}, max ${MAX_ROWS}.` },
      },
    },
  },
  {
    name: 'get_day',
    description: 'Everything about one Lumen day: all entries, wake and bed times, steps, symptom summary, flare flag.',
    parameters: { type: S.OBJECT, properties: { date: { type: S.STRING, description: 'YYYY-MM-DD' } }, required: ['date'] },
  },
  {
    name: 'get_day_summaries',
    description: 'One compact row per day: worst and average symptom severity, overall rating, symptoms and exposures logged, flare, steps, walk minutes, sleep hours. Best for trends over weeks or months.',
    parameters: { type: S.OBJECT, properties: dateRange },
  },
  {
    name: 'get_notes',
    description: "The member's written notes (journal pages), full text.",
    parameters: {
      type: S.OBJECT,
      properties: {
        ...dateRange,
        text: { type: S.STRING, description: 'Only notes containing this text.' },
        limit: { type: S.INTEGER, description: 'Max notes, default 20.' },
      },
    },
  },
  {
    name: 'get_tasks',
    description: 'To-do tasks with notes, steps, due dates and energy cost.',
    parameters: { type: S.OBJECT, properties: { includeCompleted: { type: S.BOOLEAN } } },
  },
  { name: 'get_medications', description: 'All medicines: name, dose, schedule, active or stopped, start/stop days and the history of changes.' },
  {
    name: 'get_health_records',
    description: 'Lab results with biomarker values, prescriptions, imaging and doctor notes. Includes photo/file ids of the documents.',
    parameters: { type: S.OBJECT, properties: { type: { type: S.STRING, description: 'blood_test, prescription, imaging or doctor_note' } } },
  },
  { name: 'get_sleep', description: 'Wake time, bedtime and hours slept per day.', parameters: { type: S.OBJECT, properties: dateRange } },
  { name: 'get_activity', description: 'Daily steps and every walk/exercise session (duration, distance, steps, notes).', parameters: { type: S.OBJECT, properties: dateRange } },
  { name: 'get_flares', description: 'Flare episodes Lumen detected or the member marked, with start/end days and whether confirmed.' },
  { name: 'get_patterns', description: "Patterns Lumen's statistics engine found between things logged and symptoms, with the day counts behind each." },
  { name: 'get_progress', description: "Lumen's weekly trend verdict (improving/worsening/steady), good vs harder days, and any recent shift." },
  { name: 'get_experiments', description: 'Six-week self-experiments the member ran or is running.' },
  {
    name: 'list_photos',
    description: 'Photos the member logged (including sensitive ones such as stool, urine or skin), with day, category and what they were logged as. Use view_photo to look at one.',
    parameters: {
      type: S.OBJECT,
      properties: {
        ...dateRange,
        category: { type: S.STRING, description: 'Only photos from this category.' },
        text: { type: S.STRING, description: 'Only photos whose entry label or note contains this text (e.g. "stool", "rash").' },
        limit: { type: S.INTEGER, description: 'Max photos, default 30.' },
      },
    },
  },
  {
    name: 'view_photo',
    description: 'Look at one photo by its id. The image is attached to the reply so you can describe and analyse it. View at most 4 per answer.',
    parameters: { type: S.OBJECT, properties: { mediaId: { type: S.STRING } }, required: ['mediaId'] },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

type Handler = (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;

const handlers: Record<string, Handler> = {
  async list_categories(ctx) {
    const cats = await Category.find({ userId: oid(ctx.userId) }).select('name role isActive').lean();
    return { response: { categories: cats.map(c => ({ name: c.name, role: c.role, active: c.isActive })) } };
  },

  async search_logs(ctx, args) {
    const { from, to } = range(ctx, args);
    const limit = num(args.limit, DEFAULT_ROWS, MAX_ROWS);
    const cats = await categoryNames(ctx.userId);
    let rows = (await loadEntries(ctx, from, to)).map(e => presentEntry(e, ctx, cats));
    if (typeof args.category === 'string' && args.category.trim()) {
      const c = args.category.trim().toLowerCase();
      rows = rows.filter(r => String(r.category ?? '').toLowerCase().includes(c));
    }
    if (typeof args.text === 'string' && args.text.trim()) {
      const t = args.text.trim().toLowerCase();
      rows = rows.filter(r => JSON.stringify([r.items, r.note]).toLowerCase().includes(t));
    }
    return { response: { from, to, total: rows.length, returned: Math.min(rows.length, limit), entries: rows.slice(0, limit) } };
  },

  async get_day(ctx, args) {
    const date = typeof args.date === 'string' && DAY_RE.test(args.date) ? args.date : ctx.today;
    const cats = await categoryNames(ctx.userId);
    const [entries, session, rows] = await Promise.all([
      loadEntries(ctx, date, date),
      DaySession.findOne({ userId: oid(ctx.userId), sessionDate: date }).lean(),
      loadPersistedDayRows(ctx.userId),
    ]);
    const day = rows.find(r => r.dayKey === date);
    return {
      response: {
        date,
        wokeAt: session?.wakeTime, wentToBedAt: session?.sleepTime,
        summary: day ? summariseDay(day) : null,
        entries: entries.map(e => presentEntry(e, ctx, cats)),
      },
    };
  },

  async get_day_summaries(ctx, args) {
    const { from, to } = range(ctx, args, 60);
    const rows = (await loadPersistedDayRows(ctx.userId)).filter(r => r.dayKey >= from && r.dayKey <= to);
    return { response: { from, to, days: rows.map(summariseDay) } };
  },

  async get_notes(ctx, args) {
    const limit = num(args.limit, 20, 60);
    const filter: Record<string, unknown> = {
      userId: oid(ctx.userId),
      isArchived: { $ne: true },
      deletedAt: null,
    };
    if (typeof args.from === 'string' || typeof args.to === 'string') {
      const { from, to } = range(ctx, args, 365);
      filter.updatedAt = widen(from, to);
    }
    const rawNotes = await Note.find(filter).sort({ updatedAt: -1 }).limit(200).lean();

    const parentIds = Array.from(new Set(rawNotes.map(n => n.parentNoteId).filter(Boolean)));
    const parents = parentIds.length > 0
      ? await Note.find({ _id: { $in: parentIds }, userId: oid(ctx.userId) }).select('_id title').lean()
      : [];
    const parentMap = new Map<string, string>(parents.map(p => [String(p._id), p.title]));

    let notes = rawNotes.map(n => {
      const text = n.doc
        ? docToMarkdown(n.doc)
        : (n.plainText || flattenBlocks(n.blocks as INoteBlockDoc[]));

      return {
        id: String(n._id),
        title: n.title,
        updated: n.updatedAt,
        tags: n.tags,
        text,
        parentTitle: n.parentNoteId ? parentMap.get(String(n.parentNoteId)) : undefined,
        kind: n.kind || 'page',
        rowProps: n.rowProps,
        photoIds: n.mediaIds || [],
      };
    });

    if (typeof args.text === 'string' && args.text.trim()) {
      const t = args.text.trim().toLowerCase();
      notes = notes.filter(n => `${n.title}\n${n.text}`.toLowerCase().includes(t));
    }
    return { response: { total: notes.length, notes: notes.slice(0, limit).map(n => ({ ...n, text: clip(n.text, 3000) })) } };
  },

  async get_tasks(ctx, args) {
    const filter: Record<string, unknown> = { userId: oid(ctx.userId) };
    if (args.includeCompleted !== true) filter.isCompleted = false;
    const tasks = await Task.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
    return {
      response: {
        tasks: tasks.map(t => ({
          title: t.title, notes: clip(t.notes, 600), done: t.isCompleted, due: t.dueDate,
          energyCost: t.energyCost, important: t.isImportant, steps: t.steps?.map(s => `${s.completed ? '[x]' : '[ ]'} ${s.title}`),
        })),
      },
    };
  },

  async get_medications(ctx) {
    const meds = await Medication.find({ userId: oid(ctx.userId) }).lean();
    return {
      response: {
        medications: meds.map(m => ({
          name: m.name, dose: m.dose, unit: m.unit, schedule: m.schedule, active: m.active,
          startedOn: m.startedOn, stoppedOn: m.stoppedOn,
          changes: (m.changes ?? []).map(c => ({ at: c.at, kind: c.kind, note: clip(c.note) })),
        })),
      },
    };
  },

  async get_health_records(ctx, args) {
    const filter: Record<string, unknown> = { userId: oid(ctx.userId) };
    if (typeof args.type === 'string' && args.type) filter.type = args.type;
    const recs = await HealthRecord.find(filter).sort({ date: -1 }).limit(30).lean();
    return {
      response: {
        records: recs.map(r => ({
          title: r.title, type: r.type, date: r.date, doctor: r.doctorName, clinic: r.clinicOrLab,
          notes: clip(r.notes, 1500), biomarkers: r.biomarkers, medications: r.medications,
          documentIds: (r.mediaIds ?? []).map(String),
        })),
      },
    };
  },

  async get_sleep(ctx, args) {
    const { from, to } = range(ctx, args);
    const [sessions, rows] = await Promise.all([
      DaySession.find({ userId: oid(ctx.userId), sessionDate: { $gte: shiftDayKey(from, -1), $lte: to } }).sort({ sessionDate: 1 }).lean(),
      loadPersistedDayRows(ctx.userId),
    ]);
    const hours = new Map(rows.map(r => [r.dayKey, r.sleepHours]));
    return {
      response: {
        from, to,
        nights: sessions.filter(s => s.sessionDate >= from).map(s => ({
          day: s.sessionDate, wokeAt: s.wakeTime, wentToBedAt: s.sleepTime, hoursSleptBefore: hours.get(s.sessionDate) ?? null,
        })),
      },
    };
  },

  async get_activity(ctx, args) {
    const { from, to } = range(ctx, args);
    const [daily, sessions] = await Promise.all([
      DailyActivity.find({ userId: oid(ctx.userId), date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean(),
      ActivitySession.find({ userId: oid(ctx.userId), startTime: widen(from, to) }).select('-routePoints').sort({ startTime: 1 }).lean(),
    ]);
    return {
      response: {
        from, to,
        dailySteps: daily.map(d => ({ day: d.date, steps: d.steps })),
        sessions: sessions.map(s => ({
          type: s.activityType, title: s.title, start: s.startTime, minutes: Math.round((s.activeDurationSeconds ?? 0) / 60),
          km: Math.round((s.distanceMeters ?? 0) / 10) / 100, steps: s.steps, notes: clip(s.notes), source: s.source,
        })),
      },
    };
  },

  async get_flares(ctx) {
    const flares = await FlareEpisode.find({ userId: oid(ctx.userId) }).sort({ startDay: -1 }).limit(100).lean();
    return { response: { flares: flares.map(f => ({ start: f.startDay, end: f.endDay, source: f.source, confirmed: f.confirmed })) } };
  },

  async get_patterns(ctx) {
    const stored = await InsightFinding.find({ userId: oid(ctx.userId), shownTier: { $ne: 'still_learning' } }).lean();
    const findings = await presentFindings(stored);
    return {
      response: {
        patterns: findings.map(f => ({
          exposure: f.exposure.optionLabel, outcome: f.outcome.optionLabel, lagDays: f.lagDays, tier: f.tier,
          daysWithExposure: `${f.counts.exposedWith} of ${f.counts.exposedTotal}`, otherDays: `${f.counts.otherWith} of ${f.counts.otherTotal}`,
          noLongerSeen: f.noLongerSeen,
        })),
      },
    };
  },

  async get_progress(ctx) {
    const [rows, flareDays] = await Promise.all([loadPersistedDayRows(ctx.userId), loadFlareDayKeys(ctx.userId)]);
    return { response: { ...presentProgress(classifyTrend(weeklyMedians(rows)), goodBadDays(rows, flareDays), regimeShifts(rows)) } };
  },

  async get_experiments(ctx) {
    const exps = await Experiment.find({ userId: oid(ctx.userId) }).sort({ createdAt: -1 }).limit(20).lean();
    return {
      response: {
        experiments: exps.map(e => ({ testing: e.exposureLabel, outcome: e.outcomeLabel, startDay: e.startDay, status: e.status, medicine: e.isMedicineRelated })),
      },
    };
  },

  async list_photos(ctx, args) {
    const { from, to } = range(ctx, args, 90);
    const limit = num(args.limit, 30, 100);
    const cats = await categoryNames(ctx.userId);
    const entries = (await loadEntries(ctx, from, to)).map(e => presentEntry(e, ctx, cats)).filter(e => e.photoIds.length > 0);
    const cat = typeof args.category === 'string' ? args.category.trim().toLowerCase() : '';
    const text = typeof args.text === 'string' ? args.text.trim().toLowerCase() : '';
    const picked = entries.filter(e =>
      (!cat || String(e.category ?? '').toLowerCase().includes(cat)) &&
      (!text || JSON.stringify([e.items, e.note, e.category]).toLowerCase().includes(text)));
    const ids = picked.flatMap(e => e.photoIds);
    const media = await Media.find({ _id: { $in: ids.map(oid) }, userId: oid(ctx.userId) }).select('sensitive mimeType').lean();
    const byId = new Map(media.map(m => [String(m._id), m]));
    const photos = picked.flatMap(e => e.photoIds.filter(id => byId.has(id)).map(id => ({
      mediaId: id, day: e.day, category: e.category,
      loggedAs: e.items.map(i => i.label).filter(Boolean).join(', '),
      note: e.note, sensitive: byId.get(id)?.sensitive ?? false,
    })));
    return {
      response: {
        photoAccess: ctx.photoAccess,
        total: photos.length,
        photos: photos.slice(0, limit),
        ...(ctx.photoAccess ? {} : { notice: 'Photo viewing is turned off in Settings → AI & Insights.' }),
      },
    };
  },

  async view_photo(ctx, args) {
    const mediaId = String(args.mediaId ?? '');
    const res = await getPhotoForAi(ctx.userId, mediaId, ctx.photoAccess);
    if (!res.ok) {
      const why = {
        photo_access_off: 'The member has not allowed Lumen AI to view photos (Settings → AI & Insights → Include photos).',
        not_found: 'No photo with that id belongs to this member.',
        not_an_image: 'That file is not an image.',
        unreadable: 'The photo could not be loaded right now.',
      }[res.reason];
      return { response: { ok: false, reason: why } };
    }
    return {
      response: { ok: true, mediaId, takenAt: res.photo.takenAt, sensitive: res.photo.sensitive, note: 'The image is attached below.' },
      images: [{ ...res.photo, mediaId }],
    };
  },
};

function summariseDay(r: Awaited<ReturnType<typeof loadPersistedDayRows>>[number]) {
  return {
    day: r.dayKey,
    worstSeverity: r.symptomMax, averageSeverity: r.symptomMean == null ? null : Math.round(r.symptomMean * 10) / 10,
    overallRating: r.patientGlobal,
    symptoms: r.symptoms.filter(s => s.present && !s.key.startsWith('cat_')).map(s => (s.max == null ? s.label : `${s.label} (${s.max})`)),
    exposures: r.exposures.filter(e => !e.key.startsWith('cat_')).map(e => (e.count > 1 ? `${e.label} ×${e.count}` : e.label)),
    noSymptomsCheckIn: r.noSymptomsCheckIn || undefined,
    flare: r.explicitFlare || undefined,
    steps: r.steps, walkMinutes: r.walkMinutes,
    sleepHours: r.sleepHours == null ? null : Math.round(r.sleepHours * 10) / 10,
    entries: r.entryCount,
  };
}

export async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const handler = handlers[name];
  if (!handler) return { response: { error: `Unknown tool ${name}` } };
  try {
    return await handler(ctx, args ?? {});
  } catch (err) {
    console.error(`[assistant] tool ${name} failed:`, err);
    return { response: { error: 'That data could not be read just now.' } };
  }
}

export const TOOL_NAMES = Object.keys(handlers);
