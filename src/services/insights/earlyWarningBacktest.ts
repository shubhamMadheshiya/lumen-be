/**
 * Walks a day-by-day alert series forward against the member's own flare history and decides
 * whether that detector is trustworthy enough to turn on: good enough precision, not too many
 * false alarms, and clearly better than firing on random days at the same rate. Re-run whenever
 * the day table changes (effectively nightly); a detector that stops passing is switched back off.
 */
import { daysBetween } from '../../utils/dayKey';
import { mulberry32 } from './testing/synth';

export interface BacktestConfig {
  /** An alert counts as a hit if a flare starts within this many days after it (inclusive). */
  hitWindowMin: number;
  hitWindowMax: number;
  minPrecision: number;
  maxFalseAlertsPer30Days: number;
  permutationTrials: number;
  maxPermutationP: number;
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  hitWindowMin: 1,
  hitWindowMax: 7,
  minPrecision: 0.4,
  maxFalseAlertsPer30Days: 2,
  permutationTrials: 500,
  maxPermutationP: 0.1,
};

export interface BacktestResult {
  alertDays: number;
  hits: number;
  precision: number | null;
  falseAlertsPer30Days: number;
  permutationP: number | null;
  passes: boolean;
  reason?: 'too_few_alerts' | 'low_precision' | 'too_many_false_alarms' | 'not_better_than_random';
}

/** Whether a flare starts within [min, max] days after `alertDay`. */
function isHit(alertDay: string, flareStartDays: string[], min: number, max: number): boolean {
  return flareStartDays.some(f => { const gap = daysBetween(alertDay, f); return gap >= min && gap <= max; });
}

/**
 * @param eligibleDays days the detector was allowed to evaluate (it may legitimately say nothing on others)
 * @param alertDays the subset of eligibleDays it actually alerted on
 */
export function backtestAlerts(
  eligibleDays: string[],
  alertDays: string[],
  flareStartDays: string[],
  config: BacktestConfig = DEFAULT_BACKTEST_CONFIG,
  seed = 1,
): BacktestResult {
  const hits = alertDays.filter(d => isHit(d, flareStartDays, config.hitWindowMin, config.hitWindowMax)).length;
  const precision = alertDays.length > 0 ? hits / alertDays.length : null;
  const spanDays = eligibleDays.length > 0 ? daysBetween(eligibleDays[0], eligibleDays[eligibleDays.length - 1]) + 1 : 0;
  const falseAlerts = alertDays.length - hits;
  const falseAlertsPer30Days = spanDays > 0 ? (falseAlerts * 30) / spanDays : 0;

  if (alertDays.length < 3) {
    return { alertDays: alertDays.length, hits, precision, falseAlertsPer30Days, permutationP: null, passes: false, reason: 'too_few_alerts' };
  }
  if (precision === null || precision < config.minPrecision) {
    return { alertDays: alertDays.length, hits, precision, falseAlertsPer30Days, permutationP: null, passes: false, reason: 'low_precision' };
  }
  if (falseAlertsPer30Days > config.maxFalseAlertsPer30Days) {
    return { alertDays: alertDays.length, hits, precision, falseAlertsPer30Days, permutationP: null, passes: false, reason: 'too_many_false_alarms' };
  }

  // Would firing on this many RANDOM eligible days do just as well? If random matches or beats the
  // observed precision too often, the detector is not adding anything over chance.
  const rand = mulberry32(seed);
  let atLeastAsGood = 0;
  for (let t = 0; t < config.permutationTrials; t++) {
    const pool = [...eligibleDays];
    const sample: string[] = [];
    for (let k = 0; k < alertDays.length && pool.length > 0; k++) {
      const idx = Math.floor(rand() * pool.length);
      sample.push(pool.splice(idx, 1)[0]);
    }
    const randomHits = sample.filter(d => isHit(d, flareStartDays, config.hitWindowMin, config.hitWindowMax)).length;
    if (randomHits / sample.length >= precision) atLeastAsGood++;
  }
  const permutationP = atLeastAsGood / config.permutationTrials;

  const passes = permutationP < config.maxPermutationP;
  return {
    alertDays: alertDays.length, hits, precision, falseAlertsPer30Days, permutationP, passes,
    ...(passes ? {} : { reason: 'not_better_than_random' as const }),
  };
}

/** Natural-frequency track record text data: "a flare followed N times out of M warnings". */
export function trackRecord(result: BacktestResult): { followed: number; of: number } {
  return { followed: result.hits, of: result.alertDays };
}
