/**
 * One sleep entry per night (keyed by the Lumen day you woke up on), whoever reports it:
 * the phone's Health Connect sync ("device"), the in-app sleep tracker ("tracker") or the
 * "I'm awake" / "Go to bed" buttons ("buttons"). A better source never gets overwritten by a
 * weaker one, but a quality rating from any source is always kept.
 */
import mongoose from 'mongoose';
import { LogEntry } from '../../models/LogEntry';
import { userDayContext } from '../../utils/userDay';

export type SleepSource = 'device' | 'tracker' | 'buttons';
export type SleepQuality = 'RESTFUL' | 'GOOD' | 'FAIR' | 'POOR';
const RANK: Record<SleepSource, number> = { device: 3, tracker: 2, buttons: 1 };

export interface SleepInput {
  wakeTime: Date;
  bedtime?: Date | null;
  durationMinutes?: number | null;
  quality?: SleepQuality | null;
  source: SleepSource;
  timezone?: string | null;
  location?: Record<string, unknown> | null;
  daySessionId?: mongoose.Types.ObjectId;
}

export const sleepClientId = (userId: string, dayKey: string) => `sleep:${userId}:${dayKey}`;

function fmt(d: Date, tz: string) {
  try { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }); } catch { return d.toISOString().slice(11, 16); }
}

function valueOf(entry: { answers?: Array<{ values?: Array<{ fieldKey: string; value: unknown }> }> } | null, key: string): unknown {
  return entry?.answers?.[0]?.values?.find(v => v.fieldKey === key)?.value;
}

/** Saves (or improves) the night's sleep entry. Returns null when there is nothing usable to save. */
export async function upsertSleepRecord(userId: string, input: SleepInput) {
  const uid = new mongoose.Types.ObjectId(userId);
  const ctx = await userDayContext(uid);
  const tz = input.timezone || ctx.timeZone;
  const wake = input.wakeTime;
  const dayKey = ctx.dayKeyOf(wake, tz);
  const clientId = sleepClientId(userId, dayKey);

  const existing = await LogEntry.findOne({ userId: uid, clientId }).lean();
  // The member deleted this night on purpose: a later sync must not bring it back.
  if (existing?.deletedAt) return existing;

  const existingSource = (valueOf(existing, 'sleep_source') as SleepSource | undefined) ?? (existing ? 'buttons' : undefined);
  const keepTimes = !!existing && !!existingSource && RANK[existingSource] > RANK[input.source];

  let bedtime = input.bedtime ?? null;
  let duration = input.durationMinutes ?? (bedtime ? Math.round((wake.getTime() - bedtime.getTime()) / 60000) : null);
  let wakeAt = wake;
  let source: SleepSource = input.source;
  if (keepTimes) {
    const b = valueOf(existing, 'bedtime');
    bedtime = typeof b === 'string' ? new Date(b) : null;
    duration = Number(valueOf(existing, 'sleep_duration_minutes')) || null;
    const w = valueOf(existing, 'wake_time');
    wakeAt = typeof w === 'string' ? new Date(w) : wake;
    source = existingSource!;
  }
  // A night shorter than 15 min or longer than 24 h is a mistaken tap, not sleep.
  if (duration == null || !Number.isFinite(duration) || duration < 15 || duration > 24 * 60) return existing ?? null;

  const quality = input.quality ?? (valueOf(existing, 'sleep_quality') as SleepQuality | undefined) ?? null;
  const h = Math.floor(duration / 60);
  const m = duration % 60;
  const qualityLabel = quality ? ` · ${quality.charAt(0)}${quality.slice(1).toLowerCase()}` : '';
  const note = bedtime
    ? `Sleep: ${h}h ${m}m (${fmt(bedtime, tz)} – ${fmt(wakeAt, tz)})${qualityLabel}`
    : `Sleep: ${h}h ${m}m (woke at ${fmt(wakeAt, tz)})${qualityLabel}`;

  return LogEntry.findOneAndUpdate(
    { userId: uid, clientId },
    {
      $set: {
        source: 'sleep',
        occurredAt: wakeAt,
        timezone: tz,
        note,
        answers: [{
          optionId: 'sleep_summary',
          optionLabelSnapshot: `${h}h ${m}m sleep`,
          values: [
            { fieldKey: 'sleep_duration_minutes', dataType: 'number', value: duration, unit: 'min', canonicalValue: duration * 60 },
            ...(bedtime ? [{ fieldKey: 'bedtime', dataType: 'string', value: bedtime.toISOString() }] : []),
            { fieldKey: 'wake_time', dataType: 'string', value: wakeAt.toISOString() },
            ...(quality ? [{ fieldKey: 'sleep_quality', dataType: 'enum', value: quality }] : []),
            { fieldKey: 'sleep_source', dataType: 'string', value: source },
          ],
        }],
        ...(input.location ? { location: input.location } : {}),
      },
      $setOnInsert: { userId: uid, clientId, loggedAt: new Date(), ...(input.daySessionId ? { daySessionId: input.daySessionId } : {}) },
    },
    { upsert: true, new: true },
  ).lean();
}
