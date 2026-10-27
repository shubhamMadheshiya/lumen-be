/**
 * Marks flare episodes in the day table. There is no agreed definition of a flare, so each
 * episode records which rule produced it:
 *   explicit  the member tapped "Flare now" or chose the Flare face (taps within 72 h merge)
 *   inferred  at least 2 of 3 consecutive logged days with the worst symptom well above the
 *             member's own recent baseline; followed by a 7-day refractory period
 * Inferred episodes are only a guess until the member confirms them.
 */
import { DayRow } from './dayTable';
import { shiftDayKey, daysBetween } from '../../utils/dayKey';
import { median, scaledMad } from './stats';

// Re-exported so existing imports of these two general-purpose stats from this file keep working
export { median, scaledMad };

export const FLARE_RULE_VERSION = 1;
export const BASELINE_DAYS = 28;
export const MIN_BASELINE_VALUES = 10;
export const MERGE_GAP_DAYS = 3;
export const REFRACTORY_DAYS = 7;
/** Day is "high" at median + this many points, or this many scaled MADs, whichever is larger. */
const MIN_RISE = 2;
const MAD_MULTIPLIER = 2.5;
/** Floor so a very steady baseline does not make tiny wobbles look like flares. */
const MAD_FLOOR = 0.5;

export interface FlareEpisodeDraft {
  startDay: string;
  endDay: string;
  source: 'explicit' | 'inferred';
  rule: string;
}

function explicitEpisodes(rows: DayRow[]): FlareEpisodeDraft[] {
  const out: FlareEpisodeDraft[] = [];
  for (const r of rows) {
    if (!r.explicitFlare) continue;
    const last = out[out.length - 1];
    if (last && daysBetween(last.endDay, r.dayKey) <= MERGE_GAP_DAYS) last.endDay = r.dayKey;
    else out.push({ startDay: r.dayKey, endDay: r.dayKey, source: 'explicit', rule: 'flare_tap' });
  }
  return out;
}

function inferredEpisodes(rows: DayRow[], explicit: FlareEpisodeDraft[]): FlareEpisodeDraft[] {
  const inExplicit = (day: string) => explicit.some(e => day >= e.startDay && day <= e.endDay);
  const bySym = new Map(rows.map(r => [r.dayKey, r.symptomMax]));
  const out: FlareEpisodeDraft[] = [];
  const flareDays = new Set<string>();
  explicit.forEach(e => { for (let d = e.startDay; d <= e.endDay; d = shiftDayKey(d, 1)) flareDays.add(d); });

  let refractoryUntil = '';
  for (const r of rows) {
    const day = r.dayKey;
    const today = bySym.get(day);
    if (today === null || today === undefined || day <= refractoryUntil || inExplicit(day)) continue;

    // The member's own recent normal, leaving out days already known to be flares
    const baseline: number[] = [];
    for (let i = 1; i <= BASELINE_DAYS; i++) {
      const k = shiftDayKey(day, -i);
      const v = bySym.get(k);
      if (v !== null && v !== undefined && !flareDays.has(k)) baseline.push(v);
    }
    if (baseline.length < MIN_BASELINE_VALUES) continue;

    const med = median(baseline);
    const bar = med + Math.max(MIN_RISE, MAD_MULTIPLIER * Math.max(scaledMad(baseline), MAD_FLOOR));
    if (today < bar) continue;

    // Needs one more high day among the two days before
    const high = [1, 2]
      .map(i => shiftDayKey(day, -i))
      .filter(k => { const v = bySym.get(k); return v !== null && v !== undefined && v >= bar && !flareDays.has(k); });
    if (high.length === 0) continue;

    const startDay = high.sort()[0];
    const endDay = day;
    out.push({ startDay, endDay, source: 'inferred', rule: `two_of_three_above_baseline_v${FLARE_RULE_VERSION}` });
    for (let d = startDay; d <= endDay; d = shiftDayKey(d, 1)) flareDays.add(d);
    refractoryUntil = shiftDayKey(endDay, REFRACTORY_DAYS);
  }
  return out;
}

export function labelFlares(rows: DayRow[]): FlareEpisodeDraft[] {
  const sorted = [...rows].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const explicit = explicitEpisodes(sorted);
  const inferred = inferredEpisodes(sorted, explicit);
  return [...explicit, ...inferred].sort((a, b) => a.startDay.localeCompare(b.startDay));
}
