/**
 * Lists for the chat's "attach" pickers: the member's own items of one kind, newest first, with
 * a short subtitle. Days and files are picked on the phone (a date, a PDF), so they aren't here.
 */
import mongoose from 'mongoose';
import { Note } from '../../../models/Note';
import { Task } from '../../../models/Task';
import { TaskList } from '../../../models/TaskList';
import { Medication } from '../../../models/Medication';
import { HealthRecord } from '../../../models/HealthRecord';
import { FlareEpisode } from '../../../models/FlareEpisode';
import { Experiment } from '../../../models/Experiment';
import { InsightFinding } from '../../../models/InsightFinding';
import { AiWeeklyReport } from '../../../models/AiWeeklyReport';
import { presentFindings } from '../../insightPresenter';

export const ATTACHABLE_KINDS = ['note', 'task', 'list', 'medication', 'record', 'flare', 'experiment', 'pattern', 'weekly_report'] as const;
export type AttachableKind = (typeof ATTACHABLE_KINDS)[number];

export interface Attachable {
  id: string;
  title: string;
  subtitle?: string;
  /** ISO date or YYYY-MM-DD, for sorting and display. */
  date?: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (d?: Date | string | null) => (d ? new Date(d).toISOString() : undefined);
const RECORD_TYPE: Record<string, string> = {
  blood_test: 'Blood test', doctor_prescription: 'Prescription', imaging: 'Imaging', doctor_note: 'Doctor note',
};

export async function listAttachables(userId: string, kind: AttachableKind, q: string | undefined, limit: number): Promise<Attachable[]> {
  const uid = new mongoose.Types.ObjectId(userId);
  const text = q?.trim() ? new RegExp(escape(q.trim()), 'i') : null;
  const like = (field: string) => (text ? { [field]: text } : {});
  const matches = (s: string) => !text || text.test(s);

  switch (kind) {
    case 'note': {
      const notes = await Note.find({ userId: uid, deletedAt: null, isArchived: { $ne: true }, ...like('title') })
        .select('title icon updatedAt').sort({ updatedAt: -1 }).limit(limit).lean();
      return notes.map(n => ({ id: String(n._id), title: n.title || 'Untitled', date: iso(n.updatedAt) }));
    }
    case 'task': {
      const [tasks, lists] = await Promise.all([
        Task.find({ userId: uid, ...like('title') }).select('title isCompleted dueDate listId updatedAt').sort({ isCompleted: 1, updatedAt: -1 }).limit(limit).lean(),
        TaskList.find({ userId: uid }).select('name').lean(),
      ]);
      const names = new Map(lists.map(l => [String(l._id), l.name]));
      return tasks.map(t => ({
        id: String(t._id),
        title: t.title,
        subtitle: [t.listId ? names.get(String(t.listId)) ?? 'Tasks' : 'Tasks', t.isCompleted ? 'Completed' : t.dueDate ? `Due ${t.dueDate}` : null].filter(Boolean).join(' · '),
        date: iso(t.updatedAt),
      }));
    }
    case 'list': {
      const lists = await TaskList.find({ userId: uid, ...like('name') }).select('name icon updatedAt').sort({ sortOrder: 1 }).limit(limit).lean();
      const counts = await Task.aggregate<{ _id: mongoose.Types.ObjectId; open: number }>([
        { $match: { userId: uid, isCompleted: false, listId: { $in: lists.map(l => l._id) } } },
        { $group: { _id: '$listId', open: { $sum: 1 } } },
      ]);
      const open = new Map(counts.map(c => [String(c._id), c.open]));
      // The chip adds its own kind emoji, so the list's icon stays out of the title.
      return lists.map(l => ({ id: String(l._id), title: l.name, subtitle: `${l.icon ? `${l.icon} ` : ''}${open.get(String(l._id)) ?? 0} open`, date: iso(l.updatedAt) }));
    }
    case 'medication': {
      const meds = await Medication.find({ userId: uid, ...like('name') }).sort({ active: -1, name: 1 }).limit(limit).lean();
      return meds.map(m => ({
        id: String(m._id),
        title: m.name,
        subtitle: [[m.dose, m.unit].filter(Boolean).join(' '), m.schedule, m.active ? null : 'Stopped'].filter(Boolean).join(' · ') || undefined,
        date: m.startedOn,
      }));
    }
    case 'record': {
      const recs = await HealthRecord.find({ userId: uid, ...like('title') }).select('title type date clinicOrLab').sort({ date: -1 }).limit(limit).lean();
      return recs.map(r => ({
        id: String(r._id),
        title: r.title,
        subtitle: [RECORD_TYPE[r.type] ?? r.type, r.clinicOrLab, r.date ? new Date(r.date).toISOString().slice(0, 10) : null].filter(Boolean).join(' · '),
        date: iso(r.date),
      }));
    }
    case 'flare': {
      const flares = await FlareEpisode.find({ userId: uid }).sort({ startDay: -1 }).limit(limit).lean();
      return flares
        .map(f => ({
          id: String(f._id),
          title: f.startDay === f.endDay ? `Flare on ${f.startDay}` : `Flare ${f.startDay} to ${f.endDay}`,
          subtitle: f.source === 'explicit' ? 'Marked by you' : f.confirmed === 'yes' ? 'Detected, confirmed' : f.confirmed === 'no' ? 'Detected, not a flare' : 'Detected by Lumen',
          date: f.startDay,
        }))
        .filter(f => matches(`${f.title} ${f.subtitle}`));
    }
    case 'experiment': {
      const exps = await Experiment.find({ userId: uid }).sort({ createdAt: -1 }).limit(limit).lean();
      return exps
        .map(e => ({ id: String(e._id), title: `${e.exposureLabel} → ${e.outcomeLabel}`, subtitle: `Started ${e.startDay} · ${e.status}`, date: e.startDay }))
        .filter(e => matches(e.title));
    }
    case 'pattern': {
      const stored = await InsightFinding.find({ userId: uid, shownTier: { $ne: 'still_learning' } }).lean();
      const findings = await presentFindings(stored);
      return findings
        .map(f => ({
          id: f.id,
          title: `${f.exposure.optionLabel} → ${f.outcome.optionLabel}`,
          subtitle: `${f.lagDays === 0 ? 'Same day' : `${f.lagDays} day${f.lagDays === 1 ? '' : 's'} later`} · ${f.counts.exposedWith} of ${f.counts.exposedTotal} days`,
        }))
        .filter(f => matches(f.title))
        .slice(0, limit);
    }
    case 'weekly_report': {
      const reps = await AiWeeklyReport.find({ userId: uid }).select('weekStart weekEnd text').sort({ weekStart: -1 }).limit(limit).lean();
      return reps
        .map(r => ({ id: String(r._id), title: `Week of ${r.weekStart}`, subtitle: r.text.replace(/\s+/g, ' ').slice(0, 80), date: r.weekStart }))
        .filter(r => matches(`${r.title} ${r.subtitle}`));
    }
  }
}
