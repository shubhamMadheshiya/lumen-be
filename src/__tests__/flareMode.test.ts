import {
  assessFlare,
  percentile,
  dayKey,
  ABSOLUTE_SEVERITY_FLOOR,
  MIN_BASELINE_DAYS,
} from '../services/flareModeService';
import { NotificationPolicy } from '../models/NotificationPolicy';
import mongoose from 'mongoose';

const TODAY = '2026-10-23';

function key(daysAgo: number): string {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** 30 baseline days (3..32 days ago) cycling through the given severities. */
function baseline(values: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 3; i < 33; i++) out[key(i)] = values[i % values.length];
  return out;
}

describe('percentile', () => {
  it('interpolates between ranks', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.8)).toBeCloseTo(4.2);
    expect(percentile([5], 0.8)).toBe(5);
    expect(percentile([], 0.8)).toBe(0);
  });
});

describe('assessFlare', () => {
  it('reports insufficient_data below the baseline minimum', () => {
    const data: Record<string, number> = {};
    for (let i = 3; i < 3 + MIN_BASELINE_DAYS - 1; i++) data[key(i)] = 3;
    expect(assessFlare(data, TODAY).state).toBe('insufficient_data');
  });

  it('detects a flare when two consecutive days exceed the personal p80', () => {
    const data = { ...baseline([2, 3, 2, 3, 4]), [key(0)]: 8, [key(1)]: 7 };
    const r = assessFlare(data, TODAY);
    expect(r.state).toBe('flare');
    expect(r.runLength).toBe(2);
  });

  it('does not flag a single high day', () => {
    const data = { ...baseline([2, 3, 2, 3, 4]), [key(0)]: 8, [key(1)]: 2 };
    expect(assessFlare(data, TODAY).state).toBe('unclear');
  });

  it('applies an absolute floor so a patient who always logs low is not flagged', () => {
    const data = { ...baseline([1, 1, 1, 1, 1]), [key(0)]: 3, [key(1)]: 3 };
    const r = assessFlare(data, TODAY);
    expect(r.threshold).toBe(ABSOLUTE_SEVERITY_FLOOR);
    expect(r.state).toBe('calm');
  });

  it('treats a missing day as a break, not as evidence', () => {
    const data = { ...baseline([2, 3, 2, 3, 4]), [key(0)]: 8, [key(2)]: 8 };
    expect(assessFlare(data, TODAY).state).toBe('unclear');
  });

  it('uses yesterday and the day before when today has no log yet', () => {
    const data = { ...baseline([2, 3, 2, 3, 4]), [key(1)]: 9, [key(2)]: 8 };
    expect(assessFlare(data, TODAY).state).toBe('flare');
  });

  it('reports calm after two consecutive days at or below the threshold', () => {
    const data = { ...baseline([2, 3, 2, 3, 4]), [key(0)]: 2, [key(1)]: 3 };
    expect(assessFlare(data, TODAY).state).toBe('calm');
  });

  it('keeps recent days out of the baseline so a flare cannot raise its own bar', () => {
    const data = { ...baseline([2, 3, 2, 3, 4]), [key(0)]: 10, [key(1)]: 10, [key(2)]: 10 };
    const r = assessFlare(data, TODAY);
    expect(r.threshold).toBeLessThan(5);
    expect(r.state).toBe('flare');
  });
});

describe('dayKey', () => {
  it('buckets by the patient timezone, not UTC', () => {
    const lateEveningNewYork = new Date('2026-10-24T02:30:00Z');
    expect(dayKey(lateEveningNewYork, 'America/New_York')).toBe('2026-10-23');
    expect(dayKey(lateEveningNewYork, 'UTC')).toBe('2026-10-24');
  });

  it('falls back to UTC for an invalid timezone', () => {
    expect(dayKey(new Date('2026-10-24T02:30:00Z'), 'Not/AZone')).toBe('2026-10-24');
  });
});

describe('NotificationPolicy defaults', () => {
  it('ships a budget of 2, quiet hours on, and safety alerts off until consented', () => {
    const p = new NotificationPolicy({ userId: new mongoose.Types.ObjectId() });
    expect(p.validateSync()).toBeUndefined();
    expect(p.dailyBudget).toBe(2);
    expect(p.quietHours.enabled).toBe(true);
    expect(p.flareMode.auto).toBe(true);
    expect(p.flareMode.active).toBe(false);
    expect(p.capabilities.safety).toBe(false);
    expect(p.capabilities.flareRisk).toBe(true);
  });

  it('rejects a budget above the cap', () => {
    const p = new NotificationPolicy({ userId: new mongoose.Types.ObjectId(), dailyBudget: 9 });
    expect(p.validateSync()?.errors.dailyBudget).toBeDefined();
  });
});
