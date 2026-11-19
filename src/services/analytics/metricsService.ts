/**
 * Loads everything one range of days needs and (re)builds the member's DayMetric rows.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { LogEntry } from '../../models/LogEntry';
import { Category } from '../../models/Category';
import { Question } from '../../models/Question';
import { Option } from '../../models/Option';
import { QuickAction } from '../../models/QuickAction';
import { DaySession } from '../../models/DaySession';
import { DailyActivity } from '../../models/DailyActivity';
import { ActivitySession } from '../../models/ActivitySession';
import { Medication } from '../../models/Medication';
import { DoseEvent } from '../../models/DoseEvent';
import { WeatherDay } from '../../models/WeatherDay';
import { FlareEpisode } from '../../models/FlareEpisode';
import { DayMetric } from '../../models/DayMetric';
import { categoryKind, quickActionKind } from '../insights/analysisKind';
import { dayKeysBetween, shiftDayKey, trackingDayKey } from '../../utils/dayKey';
import { UserDayContext } from '../../utils/userDay';
import { doseDay, DoseDay } from '../meds/doses';
import {
  buildMetricRows, CategoryInfo, DayMetricRow, inferMetricRole, MetricEntry, MetricRole, METRICS_VERSION,
  QuestionInfo, QuickActionInfo,
} from './dayMetrics';

const DAY_MS = 86400000;
/** Never build further back than this: older history is still in the logs, just not analysed. */
export const MAX_HISTORY_DAYS = 3 * 365;

const id = (v: unknown) => String(v);

/** Config that changes how EVERY day is read; when it changes, everything is rebuilt. */
export async function configHash(uid: mongoose.Types.ObjectId): Promise<string> {
  const [cats, qas, qs, meds] = await Promise.all([
    Category.find({ userId: uid }).select('name role analysis').lean(),
    QuickAction.find({ userId: uid }).select('label analysis defaultValue unit metricRole templateKey').lean(),
    Question.find({ userId: uid }).select('title categoryId metricRole templateKey').lean(),
    Medication.find({ userId: uid }).select('prn scheduleHistory startedOn stoppedOn').lean(),
  ]);
  const payload = JSON.stringify({
    c: cats.map(c => [id(c._id), c.name, categoryKind(c)]).sort(),
    q: qas.map(q => [id(q._id), q.label, quickActionKind(q), q.defaultValue ?? null, q.unit ?? null, inferMetricRole(q.metricRole, q.templateKey, q.label)]).sort(),
    s: qs.map(q => [id(q._id), id(q.categoryId), inferMetricRole(q.metricRole, q.templateKey, q.title)]).sort(),
    m: meds.map(m => [id(m._id), !!m.prn, m.startedOn ?? '', m.stoppedOn ?? '', JSON.stringify(m.scheduleHistory ?? [])]).sort(),
  });
  return crypto.createHash('sha1').update(payload).digest('hex');
}

/** The first day worth building: the earliest log, step count or dose mark (capped). */
export async function firstDataDay(uid: mongoose.Types.ObjectId, ctx: UserDayContext, today: string): Promise<string | null> {
  const [firstLog, firstSteps, firstDose] = await Promise.all([
    LogEntry.findOne({ userId: uid, deletedAt: { $exists: false } }).sort({ occurredAt: 1 }).select('occurredAt timezone').lean(),
    DailyActivity.findOne({ userId: uid }).sort({ date: 1 }).select('date').lean(),
    DoseEvent.findOne({ userId: uid }).sort({ dayKey: 1 }).select('dayKey').lean(),
  ]);
  const candidates = [
    firstLog ? ctx.dayKeyOf(firstLog.occurredAt, firstLog.timezone) : null,
    firstSteps?.date ?? null,
    firstDose?.dayKey ?? null,
  ].filter((d): d is string => !!d && d <= today);
  if (candidates.length === 0) return null;
  const first = candidates.sort()[0];
  const floor = shiftDayKey(today, -MAX_HISTORY_DAYS);
  return first < floor ? floor : first;
}

/** Builds rows for [from, to] from the database (pure build in dayMetrics.ts). */
export async function buildRange(uid: mongoose.Types.ObjectId, ctx: UserDayContext, from: string, to: string): Promise<DayMetricRow[]> {
  // Entries are fetched with a margin: a day in another zone, the 3-hour "after a symptom"
  // window and the night before all reach across the edges.
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - 2 * DAY_MS);
  const end = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY_MS);
  const [entries, cats, qas, qs, opts, sessions, daily, activity, meds, marks, weather, flares] = await Promise.all([
    LogEntry.find({ userId: uid, deletedAt: { $exists: false }, occurredAt: { $gte: start, $lt: end } })
      .select('occurredAt timezone source categoryId questionId quickActionId answers').lean(),
    Category.find({ userId: uid }).select('name role analysis').lean(),
    QuickAction.find({ userId: uid }).select('label analysis defaultValue unit metricRole templateKey').lean(),
    Question.find({ userId: uid }).select('title categoryId metricRole templateKey').lean(),
    Option.find({ userId: uid }).select('questionId').lean(),
    DaySession.find({ userId: uid, sessionDate: { $gte: shiftDayKey(from, -1), $lte: to } }).select('sessionDate wakeTime sleepTime').lean(),
    DailyActivity.find({ userId: uid, date: { $gte: from, $lte: to } }).select('date steps').lean(),
    ActivitySession.find({ userId: uid, activityType: { $in: ['WALKING', 'EXERCISE'] }, status: { $ne: 'DISCARDED' }, startTime: { $gte: start, $lt: end } })
      .select('startTime activeDurationSeconds activityType').lean(),
    Medication.find({ userId: uid }).lean(),
    DoseEvent.find({ userId: uid, dayKey: { $gte: from, $lte: to } }).lean(),
    WeatherDay.find({ userId: uid, dayKey: { $gte: from, $lte: to } }).lean(),
    FlareEpisode.find({ userId: uid, confirmed: { $ne: 'no' }, endDay: { $gte: from }, startDay: { $lte: to } }).select('startDay endDay').lean(),
  ]);

  const categories = new Map<string, CategoryInfo>(cats.map(c => [id(c._id), { label: c.name, kind: categoryKind(c) }]));
  const quickActions = new Map<string, QuickActionInfo>(qas.map(q => [id(q._id), {
    label: q.label, kind: quickActionKind(q), defaultValue: q.defaultValue ?? null, unit: q.unit ?? null,
    metricRole: inferMetricRole(q.metricRole as MetricRole | null | undefined, q.templateKey, q.label),
  }]));
  const questionCat = new Map<string, string>();
  const questions = new Map<string, QuestionInfo>(qs.map(q => {
    questionCat.set(id(q._id), id(q.categoryId));
    return [id(q._id), { label: q.title, categoryId: id(q.categoryId), metricRole: inferMetricRole(q.metricRole as MetricRole | null | undefined, q.templateKey, q.title) }];
  }));
  const optionCategory = new Map<string, string>();
  for (const o of opts) {
    const cat = questionCat.get(id(o.questionId));
    if (cat) optionCategory.set(id(o._id), cat);
  }

  const walkMinutes = new Map<string, number>();
  const exerciseMinutes = new Map<string, number>();
  for (const s of activity) {
    const day = trackingDayKey(s.startTime, ctx.timeZone, ctx.boundaryHour);
    const target = s.activityType === 'WALKING' ? walkMinutes : exerciseMinutes;
    target.set(day, (target.get(day) ?? 0) + (s.activeDurationSeconds ?? 0) / 60);
  }

  const doses = new Map<string, DoseDay[]>();
  const days = dayKeysBetween(from, to);
  for (const day of days) {
    const list = meds.map(m => doseDay(m, marks, day)).filter(d => d.scheduled + d.taken + d.skipped + d.extra > 0);
    if (list.length) doses.set(day, list);
  }

  const flareDays = new Set<string>();
  for (const f of flares) for (let d = f.startDay; d <= f.endDay; d = shiftDayKey(d, 1)) flareDays.add(d);

  const input: MetricEntry[] = entries.map(e => ({
    occurredAt: e.occurredAt,
    timezone: e.timezone,
    source: e.source,
    categoryId: e.categoryId ? id(e.categoryId) : undefined,
    questionId: e.questionId ? id(e.questionId) : undefined,
    quickActionId: e.quickActionId ? id(e.quickActionId) : undefined,
    answers: (e.answers ?? []).map(a => ({ ...a, optionId: String(a.optionId ?? '') })) as MetricEntry['answers'],
  }));

  return buildMetricRows({
    entries: input, categories, quickActions, questions, optionCategory,
    steps: new Map(daily.map(d => [d.date, d.steps])),
    walkMinutes, exerciseMinutes,
    sessions: new Map(sessions.map(s => [s.sessionDate, { wakeTime: s.wakeTime, sleepTime: s.sleepTime }])),
    weather: new Map(weather.map(w => [w.dayKey, w])),
    doses, flareDays,
    timeZone: ctx.timeZone, boundaryHour: ctx.boundaryHour,
    from, to,
  });
}

/** Builds and stores rows for [from, to]. */
export async function storeRange(uid: mongoose.Types.ObjectId, ctx: UserDayContext, from: string, to: string): Promise<number> {
  if (from > to) return 0;
  const rows = await buildRange(uid, ctx, from, to);
  const builtAt = new Date();
  for (let i = 0; i < rows.length; i += 500) {
    await DayMetric.bulkWrite(rows.slice(i, i + 500).map(r => ({
      updateOne: {
        filter: { userId: uid, dayKey: r.dayKey },
        update: { $set: { ...r, version: METRICS_VERSION, builtAt } },
        upsert: true,
      },
    })));
  }
  return rows.length;
}

export interface StoredDay extends DayMetricRow { }

/** Reads stored rows for [from, to], oldest first. */
export async function readRows(uid: mongoose.Types.ObjectId, from: string, to: string): Promise<DayMetricRow[]> {
  const docs = await DayMetric.find({ userId: uid, dayKey: { $gte: from, $lte: to } })
    .select('dayKey logged items metrics doses').sort({ dayKey: 1 }).lean();
  return docs.map(d => ({ dayKey: d.dayKey, logged: d.logged, items: d.items ?? [], metrics: d.metrics, doses: d.doses ?? [] }));
}
