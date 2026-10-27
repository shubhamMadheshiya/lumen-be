/**
 * Level 0, "higher than your usual": a robust z-score against the member's own trailing 28-day
 * baseline, plus a one-sided CUSUM so a slow drift a single bad day would miss still gets noticed.
 * In-app only; this is the level every member who logs enough can reach.
 */
import { DayRow } from './dayTable';
import { dailyComposite } from './progress';
import { shiftDayKey } from '../../utils/dayKey';
import { BASELINE_WINDOW_DAYS, cusum, CusumConfig, DEFAULT_CUSUM, MIN_BASELINE_VALUES, robustZ } from './earlyWarningFeatures';

export const Z_ALERT_THRESHOLD = 2.5;
/** Of the last 3 logged days, this many need to clear the z threshold. */
export const Z_ALERT_DAYS_NEEDED = 2;
export const Z_ALERT_WINDOW_DAYS = 3;

export interface Level0Day {
  dayKey: string;
  z: number | null;
  cusumS: number;
  zAlert: boolean;
  cusumAlert: boolean;
  alert: boolean;
}

/**
 * Scores every observed day in `rows`, using only the baseline that precedes it. Call once over
 * the member's whole history; the backtest and the live check both read off this same series.
 */
export function evaluateLevel0Series(rows: DayRow[], cusumConfig: CusumConfig = DEFAULT_CUSUM): Level0Day[] {
  const byDay = new Map(rows.map(r => [r.dayKey, r]));
  const sorted = [...rows].sort((a, b) => a.dayKey.localeCompare(b.dayKey)).filter(r => r.symptomObserved);

  const zSeries: Array<number | null> = [];
  const days: Level0Day[] = [];

  for (const row of sorted) {
    const baselineStart = shiftDayKey(row.dayKey, -BASELINE_WINDOW_DAYS);
    const baseline: number[] = [];
    for (let d = baselineStart; d < row.dayKey; d = shiftDayKey(d, 1)) {
      const r = byDay.get(d);
      if (!r?.symptomObserved) continue;
      const v = dailyComposite(r);
      if (v !== null) baseline.push(v);
    }
    const current = dailyComposite(row);
    const z = current !== null && baseline.length >= MIN_BASELINE_VALUES ? robustZ(current, baseline) : null;
    zSeries.push(z);
    days.push({ dayKey: row.dayKey, z, cusumS: 0, zAlert: false, cusumAlert: false, alert: false });
  }

  const cusumSeries = cusum(zSeries, cusumConfig);
  cusumSeries.forEach((c, i) => { days[i].cusumS = c.s; days[i].cusumAlert = c.alert; });

  for (let i = 0; i < days.length; i++) {
    const windowStart = Math.max(0, i - Z_ALERT_WINDOW_DAYS + 1);
    const window = days.slice(windowStart, i + 1);
    const highCount = window.filter(d => d.z !== null && d.z >= Z_ALERT_THRESHOLD).length;
    days[i].zAlert = window.length === Z_ALERT_WINDOW_DAYS && highCount >= Z_ALERT_DAYS_NEEDED;
    days[i].alert = days[i].zAlert || days[i].cusumAlert;
  }

  return days;
}
