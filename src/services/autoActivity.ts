/**
 * Walks and daily step totals that the phone recorded on its own (iOS motion history, Android
 * Health Connect). The app sends them; this checks them and saves each walk once.
 *
 * A walk's clientId is derived from its start minute on the device, so re-sending is harmless.
 * A walk the user removed stays DISCARDED and is never brought back by a later sync.
 */
import mongoose from 'mongoose';
import { ActivitySession } from '../models/ActivitySession';
import { DailyActivity } from '../models/DailyActivity';
import { LogEntry } from '../models/LogEntry';

const MIN = 60000;
const DAY = 24 * 60 * MIN;
/** Oldest history a phone can hand over (Health Connect keeps 30 days before the grant). */
const MAX_AGE_MS = 35 * DAY;
const MAX_WALKS_PER_REQUEST = 200;
const MAX_DAYS_PER_REQUEST = 40;

export interface AutoWalkInput {
  clientId: string;
  startTime: string;
  endTime: string;
  steps: number;
  distanceMeters: number;
  timezone?: string;
}

export interface CleanAutoWalk {
  clientId: string;
  startTime: Date;
  endTime: Date;
  steps: number;
  distanceMeters: number;
  timezone: string;
}

export interface DailyStepsInput {
  date: string;
  steps: number;
  source: 'ios_motion' | 'health_connect';
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Drops anything malformed rather than failing the whole batch: one odd walk must not block the rest. */
export function cleanAutoWalks(input: unknown, now: number = Date.now()): CleanAutoWalk[] {
  if (!Array.isArray(input)) return [];
  const out: CleanAutoWalk[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, MAX_WALKS_PER_REQUEST)) {
    const w = raw as Partial<AutoWalkInput>;
    if (typeof w?.clientId !== 'string' || !/^auto:[\w:.-]{1,80}$/.test(w.clientId) || seen.has(w.clientId)) continue;
    const start = new Date(w.startTime as string).getTime();
    const end = new Date(w.endTime as string).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const minutes = (end - start) / MIN;
    if (minutes < 3 || minutes > 6 * 60) continue;
    if (end > now + 5 * MIN || start < now - MAX_AGE_MS) continue;
    if (!isNum(w.steps) || w.steps < 0 || w.steps > 60000) continue;
    if (!isNum(w.distanceMeters) || w.distanceMeters < 0 || w.distanceMeters > 50000) continue;
    seen.add(w.clientId);
    out.push({
      clientId: w.clientId,
      startTime: new Date(start),
      endTime: new Date(end),
      steps: Math.round(w.steps),
      distanceMeters: Math.round(w.distanceMeters),
      timezone: typeof w.timezone === 'string' && w.timezone.length <= 64 ? w.timezone : 'UTC',
    });
  }
  return out;
}

export function cleanDailySteps(input: unknown): DailyStepsInput[] {
  if (!Array.isArray(input)) return [];
  const byDate = new Map<string, DailyStepsInput>();
  for (const raw of input.slice(0, MAX_DAYS_PER_REQUEST)) {
    const d = raw as Partial<DailyStepsInput>;
    if (typeof d?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
    if (!isNum(d.steps) || d.steps < 0 || d.steps > 200000) continue;
    if (d.source !== 'ios_motion' && d.source !== 'health_connect') continue;
    byDate.set(d.date, { date: d.date, steps: Math.round(d.steps), source: d.source });
  }
  return Array.from(byDate.values());
}

/** "Walk (auto-detected): 1.2 km in 14 min" */
export function autoWalkNote(walk: Pick<CleanAutoWalk, 'distanceMeters' | 'startTime' | 'endTime' | 'steps'>): string {
  const km = (walk.distanceMeters / 1000).toFixed(1);
  const mins = Math.round((walk.endTime.getTime() - walk.startTime.getTime()) / MIN);
  return `Walk (auto-detected): ${km} km in ${mins} min, about ${walk.steps.toLocaleString('en-US')} steps`;
}

/** True when an automatic walk shares any time with a manual one (an open manual walk runs until now). */
export function overlaps(walk: Pick<CleanAutoWalk, 'startTime' | 'endTime'>, start: Date, end?: Date | null): boolean {
  const manualEnd = end ? end.getTime() : Number.POSITIVE_INFINITY;
  return walk.startTime.getTime() < manualEnd && walk.endTime.getTime() > start.getTime();
}

/** Saves walks that are new; leaves existing ones (including removed ones) alone. Returns the new ones. */
export async function saveAutoWalks(userId: mongoose.Types.ObjectId, walks: CleanAutoWalk[]) {
  if (walks.length === 0) return [];
  const existing = await ActivitySession.find({ userId, clientId: { $in: walks.map(w => w.clientId) } }, { clientId: 1 });
  const known = new Set(existing.map(e => e.clientId));
  // A walk the member timed with "Start walking" is already counted, with GPS distance.
  const earliest = new Date(Math.min(...walks.map(w => w.startTime.getTime())));
  const latest = new Date(Math.max(...walks.map(w => w.endTime.getTime())));
  const manual = await ActivitySession.find({
    userId,
    source: { $ne: 'AUTO' },
    activityType: 'WALKING',
    status: { $ne: 'DISCARDED' },
    startTime: { $lt: latest },
    $or: [{ endTime: { $gt: earliest } }, { endTime: { $exists: false } }, { endTime: null }],
  }, { startTime: 1, endTime: 1 });
  const created = [];
  for (const w of walks) {
    if (known.has(w.clientId)) continue;
    if (manual.some(m => overlaps(w, m.startTime, m.endTime))) continue;
    const seconds = Math.round((w.endTime.getTime() - w.startTime.getTime()) / 1000);
    const hours = seconds / 3600;
    try {
      const session = await ActivitySession.create({
        userId,
        clientId: w.clientId,
        source: 'AUTO',
        activityType: 'WALKING',
        title: 'Walk',
        status: 'COMPLETED',
        startTime: w.startTime,
        endTime: w.endTime,
        totalDurationSeconds: seconds,
        activeDurationSeconds: seconds,
        distanceMeters: w.distanceMeters,
        steps: w.steps,
        averageSpeedKmh: hours > 0 ? Number((w.distanceMeters / 1000 / hours).toFixed(2)) : 0,
        averagePaceMinPerKm: w.distanceMeters > 0 ? Number(((seconds / 60) / (w.distanceMeters / 1000)).toFixed(2)) : 0,
        hasRouteData: false,
      });
      const log = await LogEntry.create({
        userId,
        clientId: `log:${w.clientId}`,
        source: 'activity',
        activitySessionId: session._id,
        occurredAt: w.startTime,
        loggedAt: new Date(),
        timezone: w.timezone,
        note: autoWalkNote(w),
        answers: [],
        mediaIds: [],
      });
      session.linkedLogEntryId = log._id as mongoose.Types.ObjectId;
      await session.save();
      created.push(session);
    } catch (err) {
      // Two syncs racing on the same walk: the unique (userId, clientId) index keeps one.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  return created;
}

export async function saveDailySteps(userId: mongoose.Types.ObjectId, days: DailyStepsInput[]): Promise<number> {
  if (days.length === 0) return 0;
  const res = await DailyActivity.bulkWrite(days.map(d => ({
    updateOne: {
      filter: { userId, date: d.date },
      update: { $set: { steps: d.steps, source: d.source } },
      upsert: true,
    },
  })));
  return (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
}
