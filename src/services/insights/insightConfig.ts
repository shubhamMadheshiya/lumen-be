/**
 * Every threshold of the Insights engine lives here, in one versioned object, and is stamped into
 * each run. They were fixed from the simulations BEFORE looking at the owner's real results, so
 * nobody (including us) can tune a cut-off until a favourite suspicion "wins".
 */

export const ENGINE_VERSION = 1;

export interface InsightConfig {
  /** Day offsets tested: exposure on day d, symptom on day d + lag. */
  lags: number[];
  /** A comparison needs this many paired days where both days were observed. */
  minPairs: number;
  minExposedDays: number;
  minUnexposedDays: number;
  minOutcomeDays: number;
  /** Share of paired days with the exposure must be inside this range. */
  minPrevalence: number;
  maxPrevalence: number;
  /** How many bands "other things logged that day" is split into when matching exposure and other days. */
  engagementStrata: number;
  /** Fisher p-value above which the slower probability calculation is skipped. */
  screenFisherP: number;
  possible: { pSuperior: number; shrunkRR: number; q: number };
  consistent: { pSuperior: number; q: number; circularP: number };
  /** Circular-shift permutation test: smallest and largest shift in days. */
  circularMinShift: number;
  /** A finding needs this many paired days in each half for the split-half check. */
  minHalfDays: number;
  /** Prior spread of true log risk ratios when too few tests exist to estimate it. */
  defaultTau2: number;
  minTau2: number;
  /** Share of paired days with only weak evidence of logging above which a finding is flagged. */
  weakShareFlag: number;
}

export const DEFAULT_CONFIG: InsightConfig = {
  lags: [0, 1, 2],
  minPairs: 30,
  minExposedDays: 8,
  minUnexposedDays: 8,
  minOutcomeDays: 4,
  minPrevalence: 0.1,
  maxPrevalence: 0.9,
  engagementStrata: 5,
  screenFisherP: 0.25,
  possible: { pSuperior: 0.9, shrunkRR: 1.5, q: 0.1 },
  consistent: { pSuperior: 0.97, q: 0.01, circularP: 0.1 },
  circularMinShift: 7,
  minHalfDays: 12,
  defaultTau2: 0.25,
  minTau2: 0.05,
  weakShareFlag: 0.25,
};
