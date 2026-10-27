/**
 * Level 1, "resemblance": does the last 7 days look like the run-up to a past flare?
 *
 * Every evaluation uses only exemplars and a reference distribution built from data strictly
 * before the day being scored, so the exact same function is safe to call live or inside the
 * walk-forward backtest. At personal scale (a few hundred days, a handful of flares) this is a
 * few hundred thousand vector comparisons at most — fast enough not to need anything cleverer.
 */
import { DayRow } from './dayTable';
import { shiftDayKey, daysBetween } from '../../utils/dayKey';
import { featureVector, standardize, vectorSimilarity, ResemblanceVector } from './earlyWarningFeatures';

export interface FlareStart { startDay: string; usable: boolean }

export interface Level1Config {
  windowDays: number;
  /** A pre-flare exemplar needs at least this share of its 7 days logged to be trustworthy. */
  minLoggedShare: number;
  /** How far above the reference distribution a match needs to be. */
  percentile: number;
  /** A second exemplar counts as "also close" at this share of the best similarity found that day. */
  closeShareOfBest: number;
  /** How many distinct past episodes need to look close, not just the single nearest one. */
  minCloseExemplars: number;
  /** Days this soon before a flare, or inside/just after one, are left out of the "ordinary day" reference. */
  refractoryDays: number;
}

export const DEFAULT_LEVEL1_CONFIG: Level1Config = {
  windowDays: 7,
  minLoggedShare: 4 / 7,
  percentile: 0.95,
  closeShareOfBest: 0.85,
  minCloseExemplars: 2,
  refractoryDays: 7,
};

export interface Level1Day {
  dayKey: string;
  bestSimilarity: number | null;
  closeExemplars: number;
  exemplarCount: number;
  threshold: number | null;
  alert: boolean;
}

/** True once `windowDays` of day-table rows exist on or before `dayKey` (even if some are unlogged). */
function hasFullWindow(rows: DayRow[], dayKey: string, windowDays: number): boolean {
  return rows.length > 0 && daysBetween(rows[0].dayKey, dayKey) >= windowDays - 1;
}

/** Days that fall inside a flare, or within `refractoryDays` after one ends, or in the window right before one starts. */
function exclusionZone(flareRanges: Array<{ startDay: string; endDay: string }>, windowDays: number, refractoryDays: number): Set<string> {
  const zone = new Set<string>();
  for (const f of flareRanges) {
    for (let d = shiftDayKey(f.startDay, -windowDays); d <= shiftDayKey(f.endDay, refractoryDays); d = shiftDayKey(d, 1)) {
      zone.add(d);
    }
  }
  return zone;
}

export function evaluateLevel1Series(
  rows: DayRow[],
  flareRanges: Array<{ startDay: string; endDay: string }>,
  config: Level1Config = DEFAULT_LEVEL1_CONFIG,
): Level1Day[] {
  const sorted = [...rows].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  if (sorted.length === 0) return [];
  const exclusion = exclusionZone(flareRanges, config.windowDays, config.refractoryDays);
  const out: Level1Day[] = [];

  for (const row of sorted) {
    const d = row.dayKey;
    if (!hasFullWindow(sorted, d, config.windowDays)) {
      out.push({ dayKey: d, bestSimilarity: null, closeExemplars: 0, exemplarCount: 0, threshold: null, alert: false });
      continue;
    }

    // Only flares that have already started before `d`, so nothing here can see the future
    const priorFlares = flareRanges.filter(f => f.startDay < d);
    const exemplarVectors: ResemblanceVector[] = [];
    for (const f of priorFlares) {
      const windowEnd = shiftDayKey(f.startDay, -1);
      const v = featureVector(sorted, windowEnd, config.windowDays);
      if (v.loggedShare >= config.minLoggedShare) exemplarVectors.push(v);
    }

    if (exemplarVectors.length === 0) {
      out.push({ dayKey: d, bestSimilarity: null, closeExemplars: 0, exemplarCount: 0, threshold: null, alert: false });
      continue;
    }

    // The reference population used both to standardise features and to set the alert bar is
    // every prior ordinary day's window (not a flare, its run-up, or its refractory tail)
    const priorRows = sorted.filter(r => r.dayKey < d);
    const referenceVectors = priorRows
      .filter(r => !exclusion.has(r.dayKey) && hasFullWindow(priorRows, r.dayKey, config.windowDays))
      .map(r => featureVector(priorRows, r.dayKey, config.windowDays))
      .filter(v => v.loggedShare >= config.minLoggedShare);

    const standardAll = [...referenceVectors, ...exemplarVectors];
    const stdExemplars = exemplarVectors.map(v => standardize(v, standardAll));

    const today = featureVector(priorRows.concat(row), d, config.windowDays);
    if (today.loggedShare < config.minLoggedShare || referenceVectors.length < 10) {
      out.push({ dayKey: d, bestSimilarity: null, closeExemplars: 0, exemplarCount: exemplarVectors.length, threshold: null, alert: false });
      continue;
    }
    const stdToday = standardize(today, standardAll);
    const similarities = stdExemplars.map(e => vectorSimilarity(stdToday, e));
    const best = Math.max(...similarities);

    // Null distribution: how similar an ORDINARY day typically looks to the same exemplars
    const refSimilarities = referenceVectors
      .map(v => Math.max(...stdExemplars.map(e => vectorSimilarity(standardize(v, standardAll), e))))
      .sort((a, b) => a - b);
    const threshold = refSimilarities.length
      ? refSimilarities[Math.min(refSimilarities.length - 1, Math.floor(config.percentile * refSimilarities.length))]
      : null;

    const closeExemplars = similarities.filter(s => s >= best * config.closeShareOfBest).length;
    const alert = threshold !== null && best > threshold && closeExemplars >= Math.min(config.minCloseExemplars, exemplarVectors.length);

    out.push({ dayKey: d, bestSimilarity: best, closeExemplars, exemplarCount: exemplarVectors.length, threshold, alert });
  }

  return out;
}
