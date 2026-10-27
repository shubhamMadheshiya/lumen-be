/**
 * Keeps findings from flickering. A finding only moves to a higher tier after it earned that tier
 * on two different days, and only moves down after it fell below its tier on two different days.
 * Re-running the analysis several times in one day does not count as extra confirmations.
 */
import { Tier } from './dayLevelTests';

export const TIER_RANK: Record<Tier, number> = { still_learning: 0, possible: 1, consistent: 2 };
const TIER_BY_RANK: Tier[] = ['still_learning', 'possible', 'consistent'];

export interface TierState {
  /** What the member sees. */
  shown: Tier;
  /** The tier the data earned on the last run of an earlier day (or null for a new finding). */
  previous: Tier | null;
  /** The tier the data earned on the latest run. */
  latest: Tier;
  latestDay: string;
}

export function startState(day: string, candidate: Tier): TierState {
  return { shown: 'still_learning', previous: null, latest: candidate, latestDay: day };
}

/** Folds one more run (on Lumen day `day`) into a finding's state. */
export function advance(state: TierState, day: string, candidate: Tier): TierState {
  // A second run on the same day replaces that day's result instead of counting twice
  const previous = day === state.latestDay ? state.previous : state.latest;
  const latest = candidate;
  const cand = TIER_RANK[latest];
  const prev = previous === null ? null : TIER_RANK[previous];
  const shown = TIER_RANK[state.shown];

  let next = shown;
  if (cand > shown && prev !== null && prev > shown) next = Math.min(cand, prev);
  else if (cand < shown && prev !== null && prev < shown) next = Math.max(cand, prev);

  return { shown: TIER_BY_RANK[next], previous, latest, latestDay: day };
}

/** A finding the member once saw that is no longer supported. */
export function isNoLongerSeen(state: TierState, hadBeenShown: boolean): boolean {
  return hadBeenShown && state.shown === 'still_learning';
}
