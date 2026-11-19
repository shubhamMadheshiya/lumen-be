/**
 * Keeps DayMetric rows fresh. Instead of every writer remembering to say "this day changed",
 * each read asks the database what changed since the last build (every tracked collection has
 * `updatedAt`), and rebuilds just those days and their neighbours. The only changes that leave
 * no trail — a log moved to another day, a dose mark deleted — are recorded in `dirtyDays`.
 *
 * Anything that changes how every day is read (time zone, day boundary, analysis kinds,
 * metric roles, dose plans, this code's version) rebuilds everything.
 */
import mongoose from 'mongoose';
import { LogEntry } from '../../models/LogEntry';
import { DaySession } from '../../models/DaySession';
import { DailyActivity } from '../../models/DailyActivity';
import { ActivitySession } from '../../models/ActivitySession';
import { DoseEvent } from '../../models/DoseEvent';
import { WeatherDay } from '../../models/WeatherDay';
import { FlareEpisode } from '../../models/FlareEpisode';
import { DayMetric } from '../../models/DayMetric';
import { MetricState } from '../../models/MetricState';
import { shiftDayKey } from '../../utils/dayKey';
import { userDayContext, UserDayContext } from '../../utils/userDay';
import { METRICS_VERSION } from './dayMetrics';
import { configHash, firstDataDay, storeRange } from './metricsService';

const running = new Map<string, Promise<FreshResult>>();

export interface FreshResult { rebuilt: 'none' | 'partial' | 'full'; days: number; builtAt: Date; firstDay: string | null; today: string }

/** Makes sure the member's rows reflect every change so far. Concurrent callers share one run. */
export function ensureFresh(userId: string): Promise<FreshResult> {
  const existing = running.get(userId);
  if (existing) return existing;
  const p = refresh(userId).finally(() => running.delete(userId));
  running.set(userId, p);
  return p;
}

/** Rebuilds every day (the hourly job's safety net, and after migrations). */
export async function rebuildAllMetrics(userId: string): Promise<FreshResult> {
  await MetricState.deleteOne({ userId: new mongoose.Types.ObjectId(userId) });
  return ensureFresh(userId);
}

/** Days whose rows must be rebuilt although nothing there has a newer updatedAt. */
export async function markDaysDirty(userId: string, days: string[]): Promise<void> {
  const valid = days.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (valid.length === 0) return;
  await MetricState.updateOne({ userId: new mongoose.Types.ObjectId(userId) }, { $addToSet: { dirtyDays: { $each: valid } } });
}

/** A log moved away from `oldOccurredAt`: its old day needs rebuilding too. */
export async function markMovedEntry(userId: string, oldOccurredAt: Date, oldTimeZone?: string | null): Promise<void> {
  try {
    const ctx = await userDayContext(userId);
    await markDaysDirty(userId, [ctx.dayKeyOf(new Date(oldOccurredAt), oldTimeZone)]);
  } catch (err) {
    console.warn('[analytics] could not mark moved entry:', err);
  }
}

async function refresh(userId: string): Promise<FreshResult> {
  const uid = new mongoose.Types.ObjectId(userId);
  const startedAt = new Date();
  const ctx = await userDayContext(uid);
  const today = ctx.dayKeyOf(startedAt);
  const [state, hash] = await Promise.all([MetricState.findOne({ userId: uid }).lean(), configHash(uid)]);

  const needsFull = !state
    || state.version !== METRICS_VERSION
    || state.timeZone !== ctx.timeZone
    || state.boundaryHour !== ctx.boundaryHour
    || state.configHash !== hash;

  if (needsFull) {
    const first = await firstDataDay(uid, ctx, today);
    const days = first ? await storeRange(uid, ctx, first, today) : 0;
    await DayMetric.deleteMany({ userId: uid, ...(first ? { $or: [{ dayKey: { $lt: first } }, { dayKey: { $gt: today } }] } : {}) });
    await MetricState.updateOne(
      { userId: uid },
      { $set: { version: METRICS_VERSION, builtAt: startedAt, timeZone: ctx.timeZone, boundaryHour: ctx.boundaryHour, configHash: hash, dirtyDays: [], firstDay: first ?? undefined } },
      { upsert: true },
    );
    return { rebuilt: 'full', days, builtAt: startedAt, firstDay: first, today };
  }

  const changed = await changedDays(uid, ctx, state.builtAt);
  for (const d of state.dirtyDays ?? []) changed.add(d);
  // New days since the last build (also turns today's planned doses into rows).
  const lastRow = await DayMetric.findOne({ userId: uid }).sort({ dayKey: -1 }).select('dayKey').lean();
  let firstDay = state.firstDay ?? null;
  if (!firstDay && changed.size > 0) firstDay = [...changed].sort()[0];
  if (lastRow && lastRow.dayKey < today) for (let d = shiftDayKey(lastRow.dayKey, 1); d <= today; d = shiftDayKey(d, 1)) changed.add(d);
  if (!lastRow && changed.size > 0) changed.add(today);

  if (changed.size === 0) return { rebuilt: 'none', days: 0, builtAt: state.builtAt, firstDay, today };

  const sorted = [...changed].sort();
  const floor = shiftDayKey(today, -3 * 365);
  if (!firstDay || sorted[0] < firstDay) firstDay = sorted[0] < floor ? floor : sorted[0];
  // Rebuild each cluster of changed days (with one day either side), not the span between them.
  let days = 0;
  for (const [a, b] of clusters(sorted.filter(d => d >= firstDay! && d <= today))) {
    days += await storeRange(uid, ctx, maxKey(shiftDayKey(a, -1), firstDay), minKey(shiftDayKey(b, 1), today));
  }
  await MetricState.updateOne(
    { userId: uid },
    { $set: { builtAt: startedAt, firstDay }, $pullAll: { dirtyDays: state.dirtyDays ?? [] } },
  );
  return { rebuilt: 'partial', days, builtAt: startedAt, firstDay, today };
}

const maxKey = (a: string, b: string) => (a > b ? a : b);

/** Sorted day keys → [first, last] runs; days up to 3 apart share a run. */
export function clusters(sorted: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && d <= shiftDayKey(last[1], 3)) last[1] = d > last[1] ? d : last[1];
    else out.push([d, d]);
  }
  return out;
}
const minKey = (a: string, b: string) => (a < b ? a : b);

/** Every Lumen day touched by a change after `since`. */
async function changedDays(uid: mongoose.Types.ObjectId, ctx: UserDayContext, since: Date): Promise<Set<string>> {
  const after = { $gt: since };
  const [logs, sessions, steps, activity, doses, weather, flares] = await Promise.all([
    LogEntry.find({ userId: uid, updatedAt: after }).select('occurredAt timezone').lean(),
    DaySession.find({ userId: uid, updatedAt: after }).select('sessionDate').lean(),
    DailyActivity.find({ userId: uid, updatedAt: after }).select('date').lean(),
    ActivitySession.find({ userId: uid, updatedAt: after }).select('startTime').lean(),
    DoseEvent.find({ userId: uid, updatedAt: after }).select('dayKey').lean(),
    WeatherDay.find({ userId: uid, updatedAt: after }).select('dayKey').lean(),
    FlareEpisode.find({ userId: uid, updatedAt: after }).select('startDay endDay').lean(),
  ]);
  const out = new Set<string>();
  for (const l of logs) out.add(ctx.dayKeyOf(l.occurredAt, l.timezone));
  // A bedtime belongs to the night that ends the next morning.
  for (const s of sessions) { out.add(s.sessionDate); out.add(shiftDayKey(s.sessionDate, 1)); }
  for (const s of steps) out.add(s.date);
  for (const a of activity) if (a.startTime) out.add(ctx.dayKeyOf(a.startTime));
  for (const d of doses) out.add(d.dayKey);
  for (const w of weather) out.add(w.dayKey);
  for (const f of flares) for (let d = f.startDay; d <= f.endDay; d = shiftDayKey(d, 1)) out.add(d);
  return out;
}
