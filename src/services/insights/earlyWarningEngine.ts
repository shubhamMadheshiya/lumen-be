/**
 * Decides what the member sees today: "higher than your usual" (Level 0, available to anyone with
 * a baseline), or "the last few days resemble your pre-flare days" (Level 1, only once it has
 * proven itself on the member's own history). Both levels need the SAME raw signal on the last two
 * evaluated days before anything is shown, so one noisy day never triggers a card by itself, and
 * nothing is shown during a flare or in the week after one.
 */
import { DayRow } from './dayTable';
import { shiftDayKey } from '../../utils/dayKey';
import { evaluateLevel0Series, Level0Day } from './earlyWarningLevel0';
import { DEFAULT_LEVEL1_CONFIG, evaluateLevel1Series, Level1Config, Level1Day } from './earlyWarningLevel1';
import { backtestAlerts, BacktestConfig, BacktestResult, DEFAULT_BACKTEST_CONFIG, trackRecord } from './earlyWarningBacktest';

export const MIN_EPISODES_FOR_LEVEL1 = 4;
export const MIN_LOGGED_DAYS_FOR_LEVEL1 = 45;
export const REFRACTORY_DAYS = 7;

export interface UsableEpisode { startDay: string; endDay: string }

export interface EarlyWarningResult {
  /** The highest level that currently passes its own backtest and is available to alert from. */
  enabledLevel: 0 | 1;
  /** True once the chosen level's raw signal held on the last two evaluated days, and nothing suppressed it. */
  alert: boolean;
  /** Which level produced the alert; null when there is none. */
  alertLevel: 0 | 1 | null;
  suppressedByFlare: boolean;
  level1: {
    enabled: boolean;
    gateReason?: 'too_few_episodes' | 'too_few_logged_days';
    episodeCount: number;
    loggedDays: number;
    backtest: BacktestResult | null;
    trackRecord: { followed: number; of: number } | null;
  };
}

function twoDayAlert<T extends { alert: boolean }>(series: T[]): boolean {
  if (series.length < 2) return false;
  return series[series.length - 1].alert && series[series.length - 2].alert;
}

function inFlareOrRefractory(dayKey: string, episodes: UsableEpisode[], refractoryDays: number): boolean {
  return episodes.some(e => dayKey >= e.startDay && dayKey <= shiftDayKey(e.endDay, refractoryDays));
}

export function runEarlyWarningEngine(
  rows: DayRow[],
  allEpisodes: Array<{ startDay: string; endDay: string; source: 'explicit' | 'inferred'; confirmed: 'yes' | 'no' | null }>,
  config: { level1?: Level1Config; backtest?: BacktestConfig; percentileOverride?: number } = {},
): EarlyWarningResult {
  const sorted = [...rows].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const today = sorted[sorted.length - 1]?.dayKey;

  const usable: UsableEpisode[] = allEpisodes
    .filter(e => e.source === 'explicit' || e.confirmed === 'yes')
    .map(e => ({ startDay: e.startDay, endDay: e.endDay }));

  const loggedDays = sorted.filter(r => r.symptomObserved).length;
  const l0Series = evaluateLevel0Series(sorted);

  let level1Enabled = false;
  let backtest: BacktestResult | null = null;
  let gateReason: 'too_few_episodes' | 'too_few_logged_days' | undefined;
  let l1Series: Level1Day[] = [];

  if (usable.length < MIN_EPISODES_FOR_LEVEL1) {
    gateReason = 'too_few_episodes';
  } else if (loggedDays < MIN_LOGGED_DAYS_FOR_LEVEL1) {
    gateReason = 'too_few_logged_days';
  } else {
    const level1Config: Level1Config = {
      ...DEFAULT_LEVEL1_CONFIG,
      ...config.level1,
      percentile: config.percentileOverride ?? config.level1?.percentile ?? DEFAULT_LEVEL1_CONFIG.percentile,
    };
    l1Series = evaluateLevel1Series(sorted, usable, level1Config);
    const eligible = l1Series.filter(d => d.bestSimilarity !== null);
    if (eligible.length > 0) {
      backtest = backtestAlerts(
        eligible.map(d => d.dayKey),
        eligible.filter(d => d.alert).map(d => d.dayKey),
        usable.map(e => e.startDay),
        { ...DEFAULT_BACKTEST_CONFIG, ...config.backtest },
      );
      level1Enabled = backtest.passes;
    }
  }

  const suppressedByFlare = !!today && inFlareOrRefractory(today, usable, REFRACTORY_DAYS);

  let alert = false;
  let alertLevel: 0 | 1 | null = null;
  if (!suppressedByFlare) {
    if (level1Enabled && twoDayAlert(l1Series.filter(d => d.bestSimilarity !== null))) {
      alert = true; alertLevel = 1;
    } else if (twoDayAlert(l0Series as Level0Day[])) {
      alert = true; alertLevel = 0;
    }
  }

  return {
    enabledLevel: level1Enabled ? 1 : 0,
    alert,
    alertLevel,
    suppressedByFlare,
    level1: {
      enabled: level1Enabled,
      gateReason,
      episodeCount: usable.length,
      loggedDays,
      backtest,
      trackRecord: backtest ? trackRecord(backtest) : null,
    },
  };
}

