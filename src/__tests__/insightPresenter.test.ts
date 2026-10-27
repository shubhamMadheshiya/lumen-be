import mongoose from 'mongoose';
import {
  buildDescriptiveStats,
  formatDuration,
  presentInsights,
  severityByDay,
  trendOf,
} from '../services/insightPresenter';
import { LogEntry } from '../models/LogEntry';
import { Category } from '../models/Category';
import { Question } from '../models/Question';
import { Option } from '../models/Option';
import { QuickAction } from '../models/QuickAction';
import { DaySession } from '../models/DaySession';

jest.mock('../models/LogEntry', () => ({ LogEntry: { find: jest.fn() } }));
jest.mock('../models/Category', () => ({ Category: { find: jest.fn() } }));
jest.mock('../models/Question', () => ({ Question: { find: jest.fn() } }));
jest.mock('../models/Option', () => ({ Option: { find: jest.fn() } }));
jest.mock('../models/QuickAction', () => ({ QuickAction: { find: jest.fn() } }));
jest.mock('../models/DaySession', () => ({ DaySession: { find: jest.fn() } }));

/** find(...).select().sort().limit().lean() all resolve to the same rows. */
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'sort', 'limit', 'lean']) c[m] = () => c;
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
  return c;
}
const mockFind = (model: unknown, rows: unknown[]) => (model as { find: jest.Mock }).find.mockReturnValue(chain(rows));

const oid = () => new mongoose.Types.ObjectId();
const NOW = new Date('2026-10-27T12:00:00.000Z');
const daysAgo = (n: number, hour = 9) => {
  const d = new Date(NOW.getTime() - n * 86400000);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

describe('small helpers', () => {
  it('names a trend only when the change is big enough', () => {
    expect(trendOf(5, 3)).toBe('up');
    expect(trendOf(3, 5)).toBe('down');
    expect(trendOf(4.1, 4)).toBe('flat');
    expect(trendOf(4, null)).toBeUndefined();
  });

  it('formats hours as h and m', () => {
    expect(formatDuration(7.5)).toBe('7h 30m');
    expect(formatDuration(8)).toBe('8h 00m');
  });

  it('averages only range answers, per day', () => {
    const map = severityByDay([
      { occurredAt: daysAgo(1), answers: [{ values: [{ dataType: 'range', value: 4 }, { dataType: 'string', value: 'x' }] }] },
      { occurredAt: daysAgo(1), answers: [{ values: [{ dataType: 'range', value: 6 }] }] },
      { occurredAt: daysAgo(2), answers: [{ values: [{ dataType: 'range', value: 'high' }] }] },
    ]);
    expect(Array.from(map.values())).toEqual([[4, 6]]);
  });
});

describe('presentInsights', () => {
  const optId = oid(), qId = oid(), catId = oid(), qaId = oid(), symCatId = oid();

  beforeEach(() => {
    jest.clearAllMocks();
    mockFind(QuickAction, [{ _id: qaId, icon: '☕' }]);
    mockFind(Option, [{ _id: optId, questionId: qId, icon: '🥛' }]);
    mockFind(Question, [{ _id: qId, categoryId: catId }]);
    (Category.find as jest.Mock).mockImplementation((q: { _id: { $in: unknown[] } }) => {
      const wanted = q._id.$in.map(String);
      const all = [
        { _id: catId, name: 'Food & Drink', icon: '🍽️', role: 'trigger_candidate' },
        { _id: symCatId, name: 'Symptoms', icon: '🩺', role: 'symptom' },
      ];
      return chain(all.filter(c => wanted.includes(String(c._id))));
    });
  });

  const stored = (over: Record<string, unknown>) => ({
    _id: oid(), triggerId: `opt_${optId}`, triggerLabel: 'Dairy', symptomId: `cat_${symCatId}`, symptomLabel: 'Symptoms',
    lagWindowHours: [24, 48], lift: 1.8, occurrences: 9, confidence: 'medium' as const, computedAt: NOW, ...over,
  });

  it('turns a stored result into the card shape', async () => {
    const [dto] = await presentInsights([stored({})]);
    expect(dto).toMatchObject({
      trigger: { categoryName: 'Food & Drink', optionLabel: 'Dairy', categoryIcon: '🍽️' },
      symptom: { categoryName: 'Symptom', optionLabel: 'Symptoms', categoryIcon: '🩺' },
      lagWindow: '24-48h',
      lift: 1.8,
      supportCount: 9,
      confidence: 'Medium',
      computedAt: NOW.toISOString(),
    });
    expect(typeof dto._id).toBe('string');
  });

  it('capitalises each confidence level', async () => {
    const out = await presentInsights([stored({ confidence: 'low' }), stored({ confidence: 'high' })]);
    expect(out.map(o => o.confidence)).toEqual(['Low', 'High']);
  });

  it('labels a quick tap as one', async () => {
    const [dto] = await presentInsights([stored({ triggerId: `qa_${qaId}`, triggerLabel: 'Coffee' })]);
    expect(dto.trigger).toEqual({ categoryName: 'Quick tap', optionLabel: 'Coffee', categoryIcon: '☕' });
  });

  it('still returns a card when the option or category no longer exists', async () => {
    const [dto] = await presentInsights([stored({ triggerId: `opt_${oid()}`, symptomId: 'nonsense' })]);
    expect(dto.trigger).toMatchObject({ categoryName: '', optionLabel: 'Dairy' });
    expect(dto.symptom.categoryName).toBe('');
  });

  it('does nothing for an empty list', async () => {
    expect(await presentInsights([])).toEqual([]);
    expect(Option.find).not.toHaveBeenCalled();
  });
});

describe('buildDescriptiveStats', () => {
  const symCat = { _id: oid(), role: 'symptom', name: 'Symptoms' };
  const foodCat = { _id: oid(), role: 'trigger_candidate', name: 'Food' };
  const symptom = (when: Date, severity: number, label = 'Fatigue') => ({
    occurredAt: when, categoryId: symCat._id,
    answers: [{ optionLabelSnapshot: label, values: [{ dataType: 'range', value: severity }] }],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFind(Category, [symCat, foodCat]);
    mockFind(DaySession, []);
  });

  it('reports days logged, severity with its trend, and the most logged symptom', async () => {
    mockFind(LogEntry, [
      symptom(daysAgo(1), 6), symptom(daysAgo(2), 8), symptom(daysAgo(3), 7, 'Joint pain'),
      symptom(daysAgo(9), 3), symptom(daysAgo(10), 3),
      { occurredAt: daysAgo(4), categoryId: foodCat._id, answers: [{ optionLabelSnapshot: 'Dairy', values: [] }] },
    ]);
    const stats = await buildDescriptiveStats(String(oid()), NOW);
    const by = Object.fromEntries(stats.map(s => [s.key, s]));

    expect(by['days-logged'].value).toBe('6 of 30');
    expect(by['symptom-severity']).toMatchObject({ value: '7.0', trend: 'up', trendGoodDirection: 'down' });
    expect(by['symptom-severity'].sub).toContain('3.0 the week before');
    expect(by['symptom-severity'].sparkValues).toEqual([3, 3, 7, 8, 6]);
    expect(by['top-symptom']).toMatchObject({ value: 'Fatigue', sub: '4 times in 30 days' });
    expect(by['busiest-weekday']).toBeUndefined(); // fewer than 7 symptom entries
  });

  it('names a clear busiest weekday once there are enough entries', async () => {
    // 2026-10-27 is a Tuesday; the same weekday 7 and 14 days earlier is also a Tuesday
    const tuesday = (n: number) => daysAgo(n);
    mockFind(LogEntry, [
      symptom(tuesday(0), 5), symptom(tuesday(7), 5), symptom(tuesday(14), 5), symptom(tuesday(21), 5),
      symptom(daysAgo(1), 4), symptom(daysAgo(3), 4), symptom(daysAgo(10), 4),
    ]);
    const stats = await buildDescriptiveStats(String(oid()), NOW);
    expect(stats.find(s => s.key === 'busiest-weekday')).toMatchObject({ value: 'Tuesdays', sub: '4 of 7 entries in 60 days' });
  });

  it('works out average sleep from bedtime to the next morning', async () => {
    mockFind(LogEntry, [symptom(daysAgo(1), 4)]);
    mockFind(DaySession, [
      { sessionDate: '2026-10-22', sleepTime: new Date('2026-10-22T22:00:00Z'), wakeTime: new Date('2026-10-22T07:00:00Z') },
      { sessionDate: '2026-10-23', sleepTime: new Date('2026-10-23T22:30:00Z'), wakeTime: new Date('2026-10-23T06:00:00Z') },
      { sessionDate: '2026-10-24', sleepTime: new Date('2026-10-24T23:00:00Z'), wakeTime: new Date('2026-10-24T06:30:00Z') },
      { sessionDate: '2026-10-25', sleepTime: new Date('2026-10-25T22:00:00Z'), wakeTime: new Date('2026-10-25T06:00:00Z') },
      { sessionDate: '2026-10-26', sleepTime: new Date('2026-10-26T22:00:00Z'), wakeTime: new Date('2026-10-26T06:00:00Z') },
    ]);
    const sleep = (await buildDescriptiveStats(String(oid()), NOW)).find(s => s.key === 'sleep');
    // each night is one day's bedtime to the next day's wake: 8h, 8h, 7h, 8h -> average 7h 45m
    expect(sleep?.sub).toBe('over the last 4 nights');
    expect(sleep?.value).toBe('7h 45m');
    expect(sleep?.sparkValues).toEqual([8, 8, 7, 8]);
  });

  it('leaves out stats it has no data for', async () => {
    mockFind(LogEntry, []);
    expect(await buildDescriptiveStats(String(oid()), NOW)).toEqual([]);
  });
});
