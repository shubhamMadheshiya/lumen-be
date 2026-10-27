/**
 * Rebuilds a member's day table and flare episodes from their raw logs. The whole table is
 * rebuilt each time: one person's history is a few hundred rows, so this stays well under a
 * second and avoids the bugs of keeping a table up to date entry by entry.
 */
import mongoose from 'mongoose';
import { LogEntry } from '../../models/LogEntry';
import { Category } from '../../models/Category';
import { QuickAction } from '../../models/QuickAction';
import { DaySession } from '../../models/DaySession';
import { DailyActivity } from '../../models/DailyActivity';
import { ActivitySession } from '../../models/ActivitySession';
import { User } from '../../models/User';
import { DayFeature } from '../../models/DayFeature';
import { FlareEpisode } from '../../models/FlareEpisode';
import { DEFAULT_BOUNDARY_HOUR, resolveTimeZone, trackingDayKey } from '../../utils/dayKey';
import { shiftDayKey } from '../../utils/dayKey';
import { categoryKind, quickActionKind } from './analysisKind';
import { buildDayRows, DayRow, DAY_TABLE_VERSION, EntryInput, ItemInfo } from './dayTable';
import { labelFlares } from './flareLabels';

const id = (v: unknown) => String(v);

export async function loadDayRows(userId: string): Promise<{ rows: DayRow[]; timeZone: string; boundaryHour: number }> {
  const uid = new mongoose.Types.ObjectId(userId);
  const user = await User.findById(uid).select('preferences.timezone preferences.dayBoundaryHour').lean();
  const timeZone = resolveTimeZone(user?.preferences?.timezone);
  const boundaryHour = user?.preferences?.dayBoundaryHour ?? DEFAULT_BOUNDARY_HOUR;

  const [entries, categories, quickActions, sessions, daily, walks] = await Promise.all([
    LogEntry.find({ userId: uid, deletedAt: { $exists: false } })
      .select('occurredAt timezone source categoryId quickActionId answers').lean(),
    Category.find({ userId: uid }).select('name role analysis').lean(),
    QuickAction.find({ userId: uid }).select('label analysis').lean(),
    DaySession.find({ userId: uid }).select('sessionDate wakeTime sleepTime').lean(),
    DailyActivity.find({ userId: uid }).select('date steps').lean(),
    ActivitySession.find({ userId: uid, activityType: 'WALKING', status: { $ne: 'DISCARDED' } })
      .select('startTime activeDurationSeconds').lean(),
  ]);

  const catMap = new Map<string, ItemInfo>(categories.map(c => [id(c._id), { label: c.name, kind: categoryKind(c) }]));
  const qaMap = new Map<string, ItemInfo>(quickActions.map(q => [id(q._id), { label: q.label, kind: quickActionKind(q) }]));

  const walkMinutes = new Map<string, number>();
  for (const w of walks) {
    const day = trackingDayKey(w.startTime, timeZone, boundaryHour);
    walkMinutes.set(day, (walkMinutes.get(day) ?? 0) + Math.round((w.activeDurationSeconds ?? 0) / 60));
  }

  const input: EntryInput[] = entries.map(e => ({
    occurredAt: e.occurredAt,
    timezone: e.timezone,
    source: e.source,
    categoryId: e.categoryId ? id(e.categoryId) : undefined,
    quickActionId: e.quickActionId ? id(e.quickActionId) : undefined,
    answers: (e.answers ?? []) as EntryInput['answers'],
  }));

  const rows = buildDayRows({
    entries: input,
    categories: catMap,
    quickActions: qaMap,
    steps: new Map(daily.map(d => [d.date, d.steps])),
    walkMinutes,
    sessions: new Map(sessions.map(s => [s.sessionDate, { wakeTime: s.wakeTime, sleepTime: s.sleepTime }])),
    timeZone,
    boundaryHour,
  });
  return { rows, timeZone, boundaryHour };
}

/**
 * Reads the member's day table as it was last built (by the nightly job or an earlier analysis),
 * without recomputing it. Fast, and consistent with how cached findings are served elsewhere.
 * Returns [] if the table has never been built yet.
 */
export async function loadPersistedDayRows(userId: string): Promise<DayRow[]> {
  const uid = new mongoose.Types.ObjectId(userId);
  const docs = await DayFeature.find({ userId: uid }).sort({ dayKey: 1 }).lean();
  return docs.map((d): DayRow => ({
    dayKey: d.dayKey,
    symptomObserved: d.symptomObserved,
    observedBasis: d.observedBasis,
    exposureObserved: d.exposureObserved,
    entryCount: d.entryCount,
    distinctHours: d.distinctHours,
    engagement: d.engagement,
    nonSymptomEntries: d.nonSymptomEntries,
    symptoms: d.symptoms,
    exposures: d.exposures,
    reactiveCount: d.reactiveCount,
    symptomPresent: d.symptomPresent,
    symptomMax: d.symptomMax,
    symptomMean: d.symptomMean,
    patientGlobal: d.patientGlobal,
    noSymptomsCheckIn: d.noSymptomsCheckIn,
    explicitFlare: d.explicitFlare,
    steps: d.steps,
    walkMinutes: d.walkMinutes,
    wakeTime: d.wakeTime,
    sleepTime: d.sleepTime,
    sleepHours: d.sleepHours,
  }));
}

/** Flare episode days the member hasn't said "no" to, as a set for quick membership checks. */
export async function loadFlareDayKeys(userId: string): Promise<Set<string>> {
  const uid = new mongoose.Types.ObjectId(userId);
  const episodes = await FlareEpisode.find({ userId: uid, confirmed: { $ne: 'no' } }).select('startDay endDay').lean();
  const keys = new Set<string>();
  for (const e of episodes) {
    for (let d = e.startDay; d <= e.endDay; d = shiftDayKey(d, 1)) keys.add(d);
  }
  return keys;
}

/** How many flare episodes (that the member hasn't said "no" to) started within [from, to]. */
export async function countFlaresInRange(userId: string, from: string, to: string): Promise<number> {
  const uid = new mongoose.Types.ObjectId(userId);
  return FlareEpisode.countDocuments({ userId: uid, confirmed: { $ne: 'no' }, startDay: { $gte: from, $lte: to } });
}

/** Rebuilds and stores the day table and flare episodes. Returns the rows and where the member's days start. */
export async function rebuildDayTable(userId: string): Promise<{ rows: DayRow[]; timeZone: string; boundaryHour: number }> {
  const uid = new mongoose.Types.ObjectId(userId);
  const { rows, timeZone, boundaryHour } = await loadDayRows(userId);
  const builtAt = new Date();

  if (rows.length > 0) {
    await DayFeature.bulkWrite(rows.map(r => ({
      updateOne: {
        filter: { userId: uid, dayKey: r.dayKey },
        update: { $set: { ...r, timeZone, boundaryHour, version: DAY_TABLE_VERSION, builtAt } },
        upsert: true,
      },
    })));
  }
  // Days that no longer have a row (an entry was deleted or the boundary moved)
  await DayFeature.deleteMany({ userId: uid, dayKey: { $nin: rows.map(r => r.dayKey) } });

  await syncFlareEpisodes(uid, rows);
  return { rows, timeZone, boundaryHour };
}

/** Replaces the member's flare episodes, keeping their yes/no answers on episodes that survive. */
async function syncFlareEpisodes(uid: mongoose.Types.ObjectId, rows: DayRow[]): Promise<void> {
  const drafts = labelFlares(rows);
  const existing = await FlareEpisode.find({ userId: uid }).select('startDay confirmed').lean();
  const answers = new Map(existing.map(e => [e.startDay, e.confirmed ?? null]));

  await FlareEpisode.deleteMany({ userId: uid });
  if (drafts.length === 0) return;
  await FlareEpisode.insertMany(drafts.map(d => ({ ...d, userId: uid, confirmed: answers.get(d.startDay) ?? null })));
}
