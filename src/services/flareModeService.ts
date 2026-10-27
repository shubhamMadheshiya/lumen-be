/**
 * Flare-mode detection, based only on the patient's own symptom severity history.
 *
 * Symptom severity is read from `range` fields on entries in categories with
 * role 'symptom', assumed to use the 0-10 severity scale.
 * Flare mode only quiets notifications; it makes no clinical claim.
 */
import mongoose from 'mongoose';
import { LogEntry } from '../models/LogEntry';
import { Category } from '../models/Category';
import { getOrCreatePolicy } from '../models/NotificationPolicy';
import { DEFAULT_BOUNDARY_HOUR, resolveTimeZone, shiftDayKey, trackingDayKey } from '../utils/dayKey';

export const MIN_BASELINE_DAYS = 14;
export const BASELINE_WINDOW_DAYS = 60;
export const ABSOLUTE_SEVERITY_FLOOR = 4;
export const FLARE_RUN_DAYS = 2;
const PERCENTILE = 0.8;

export type FlareState = 'flare' | 'calm' | 'unclear' | 'insufficient_data';

export interface FlareAssessment {
  state: FlareState;
  threshold?: number;
  runLength: number;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** The day `date` falls in, split at the member's Day Reset Boundary (0 = local midnight). */
export function dayKey(date: Date, timeZone: string, boundaryHour = 0): string {
  return trackingDayKey(date, timeZone, boundaryHour);
}

const shiftKey = shiftDayKey;

/**
 * @param dailyMax highest symptom severity logged per local day (YYYY-MM-DD)
 * @param todayKey the patient's local date today
 */
export function assessFlare(dailyMax: Record<string, number>, todayKey: string): FlareAssessment {
  const recentKeys = [todayKey, shiftKey(todayKey, -1), shiftKey(todayKey, -2)];
  const recentSet = new Set(recentKeys);
  const baselineStart = shiftKey(todayKey, -BASELINE_WINDOW_DAYS);

  const baseline = Object.entries(dailyMax)
    .filter(([k]) => !recentSet.has(k) && k >= baselineStart && k < todayKey)
    .map(([, v]) => v);

  if (baseline.length < MIN_BASELINE_DAYS) {
    return { state: 'insufficient_data', runLength: 0 };
  }

  const threshold = Math.max(percentile(baseline, PERCENTILE), ABSOLUTE_SEVERITY_FLOOR);

  // Walk back from the most recent day with data. A day without a log breaks the run,
  // because silence is not evidence either way.
  const latestIdx = recentKeys.findIndex(k => dailyMax[k] !== undefined);
  if (latestIdx === -1) return { state: 'unclear', threshold, runLength: 0 };

  let above = 0;
  let below = 0;
  for (let i = latestIdx; i < recentKeys.length; i++) {
    const v = dailyMax[recentKeys[i]];
    if (v === undefined) break;
    if (v > threshold) {
      if (below > 0) break;
      above++;
    } else {
      if (above > 0) break;
      below++;
    }
  }

  if (above >= FLARE_RUN_DAYS) return { state: 'flare', threshold, runLength: above };
  if (below >= FLARE_RUN_DAYS) return { state: 'calm', threshold, runLength: below };
  return { state: 'unclear', threshold, runLength: Math.max(above, below) };
}

export async function loadDailySymptomMax(
  userId: mongoose.Types.ObjectId,
  timeZone: string,
  now: Date = new Date(),
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): Promise<Record<string, number>> {
  const since = new Date(now.getTime() - (BASELINE_WINDOW_DAYS + 3) * 24 * 60 * 60 * 1000);
  const symptomCats = await Category.find({ userId, role: 'symptom' }).select('_id').lean();
  if (symptomCats.length === 0) return {};

  const entries = await LogEntry.find({
    userId,
    categoryId: { $in: symptomCats.map(c => c._id) },
    occurredAt: { $gte: since },
    deletedAt: { $exists: false },
  }).select('occurredAt timezone answers').lean();

  const dailyMax: Record<string, number> = {};
  for (const e of entries) {
    for (const ans of e.answers ?? []) {
      for (const f of ans.values ?? []) {
        if (f.dataType !== 'range') continue;
        const raw = f.canonicalValue ?? f.value;
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) continue;
        // The zone the entry was logged in, so a trip does not move old days around
        const key = dayKey(e.occurredAt, resolveTimeZone(e.timezone, timeZone), boundaryHour);
        dailyMax[key] = Math.max(dailyMax[key] ?? 0, n);
      }
    }
  }
  return dailyMax;
}

export interface FlareEvaluation {
  active: boolean;
  source?: 'auto' | 'manual';
  changed: boolean;
  assessment?: FlareAssessment;
}

/** Applies auto-detection to the stored policy. Never touches a manually activated flare mode. */
export async function evaluateFlareMode(
  userId: mongoose.Types.ObjectId,
  timeZone: string,
  now: Date = new Date(),
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): Promise<FlareEvaluation> {
  const policy = await getOrCreatePolicy(userId);
  const current = policy.flareMode;

  if (!current.auto || (current.active && current.source === 'manual')) {
    return { active: current.active, source: current.source, changed: false };
  }

  const dailyMax = await loadDailySymptomMax(userId, timeZone, now, boundaryHour);
  const assessment = assessFlare(dailyMax, dayKey(now, timeZone, boundaryHour));

  let next = current.active;
  if (assessment.state === 'flare') next = true;
  else if (assessment.state === 'calm') next = false;

  if (next === current.active) {
    return { active: current.active, source: current.source, changed: false, assessment };
  }

  policy.flareMode.active = next;
  policy.flareMode.source = next ? 'auto' : undefined;
  policy.flareMode.activatedAt = next ? now : undefined;
  await policy.save();
  return { active: next, source: next ? 'auto' : undefined, changed: true, assessment };
}
