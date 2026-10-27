import { shiftDayKey } from '../utils/dayKey';
import { backtestAlerts, DEFAULT_BACKTEST_CONFIG, trackRecord } from '../services/insights/earlyWarningBacktest';

const START = '2026-01-01';
const at = (i: number) => shiftDayKey(START, i);
const range = (n: number) => Array.from({ length: n }, (_, i) => at(i));

describe('trackRecord', () => {
  it('reads hits and total straight off the result', () => {
    expect(trackRecord({ alertDays: 7, hits: 3, precision: 3 / 7, falseAlertsPer30Days: 1, permutationP: 0.02, passes: true })).toEqual({ followed: 3, of: 7 });
  });
});

describe('backtestAlerts', () => {
  const eligible = range(300);

  it('fails with too few alerts to judge', () => {
    const r = backtestAlerts(eligible, [at(10), at(20)], [at(12)]);
    expect(r).toMatchObject({ passes: false, reason: 'too_few_alerts' });
  });

  it('fails on low precision', () => {
    // 10 alerts, only 2 near a flare
    const alerts = [at(10), at(30), at(50), at(70), at(90), at(110), at(130), at(150), at(170), at(190)];
    const flares = [at(12), at(72)]; // only 2 of the 10 alerts are followed by a flare
    const r = backtestAlerts(eligible, alerts, flares);
    expect(r).toMatchObject({ passes: false, reason: 'low_precision' });
    expect(r.precision).toBeCloseTo(0.2, 5);
  });

  it('fails when false alarms come too often, even with ok precision', () => {
    // 10 alerts every 2 days; only the first 4 (at 0,2,4,6) are followed by a flare 2 days later
    // (at 2,4,6,8) -> precision 4/10 = 0.4 clears a lowered bar, but the other 6 are false alarms
    // packed into 20 days, far more than the 30-day false-alarm limit
    const mixedAlerts = Array.from({ length: 10 }, (_, i) => at(i * 2));
    const mixedFlares = [at(2), at(4), at(6), at(8)];
    const r = backtestAlerts(range(20), mixedAlerts, mixedFlares, { ...DEFAULT_BACKTEST_CONFIG, minPrecision: 0.3 });
    expect(r.precision).toBeCloseTo(0.4, 5);
    expect(r.reason).toBe('too_many_false_alarms');
  });

  it('passes a detector that is clearly better than chance', () => {
    // Flares every ~15 days; alerts land 2-3 days before each one, nothing else
    const flares: string[] = [];
    const alerts: string[] = [];
    for (let i = 20; i < 280; i += 15) { flares.push(at(i)); alerts.push(at(i - 3)); }
    const r = backtestAlerts(eligible, alerts, flares, DEFAULT_BACKTEST_CONFIG, 7);
    expect(r.passes).toBe(true);
    expect(r.precision).toBe(1);
    expect(r.permutationP).toBeLessThan(0.1);
  });

  it('does not pass firing on random days when flares are frequent enough that chance alone looks good', () => {
    // A flare every 4 days: almost any day is "close" to a flare, so hitting one is not impressive
    const flares: string[] = [];
    for (let i = 0; i < 300; i += 4) flares.push(at(i));
    const alerts = [at(50), at(90), at(130), at(170)]; // ordinary, unremarkable alert days
    const r = backtestAlerts(eligible, alerts, flares, DEFAULT_BACKTEST_CONFIG, 3);
    expect(r.reason).not.toBe('too_few_alerts');
    if (r.precision !== null && r.precision >= DEFAULT_BACKTEST_CONFIG.minPrecision) {
      expect(r.passes).toBe(false);
      expect(r.reason).toBe('not_better_than_random');
    }
  });

  it('is deterministic for a given seed', () => {
    const flares: string[] = [];
    const alerts: string[] = [];
    for (let i = 20; i < 280; i += 20) { flares.push(at(i)); alerts.push(at(i - 2)); }
    const a = backtestAlerts(eligible, alerts, flares, DEFAULT_BACKTEST_CONFIG, 42);
    const b = backtestAlerts(eligible, alerts, flares, DEFAULT_BACKTEST_CONFIG, 42);
    expect(a.permutationP).toBe(b.permutationP);
  });
});
