import {
  buildDayRows, DayTableInput, EntryInput, FEELING_FLARE_OPTION_ID,
  NO_SYMPTOMS_OPTION_ID, PATIENT_GLOBAL_OPTION_ID,
} from '../services/insights/dayTable';
import { categoryKind, quickActionKind } from '../services/insights/analysisKind';

const IST = 'Asia/Kolkata';
const t = (iso: string) => new Date(iso);

const base = (over: Partial<DayTableInput> = {}): DayTableInput => ({
  entries: [],
  categories: new Map([
    ['cat-symptom', { label: 'Symptoms', kind: 'outcome' }],
    ['cat-food', { label: 'Food', kind: 'exposure' }],
  ]),
  quickActions: new Map([
    ['qa-coffee', { label: 'Coffee', kind: 'exposure' }],
    ['qa-pill', { label: 'Painkiller', kind: 'reactive' }],
    ['qa-flare', { label: 'Flare now', kind: 'outcome' }],
  ]),
  steps: new Map(),
  walkMinutes: new Map(),
  sessions: new Map(),
  timeZone: IST,
  boundaryHour: 4,
  ...over,
});

const symptom = (iso: string, severity?: number): EntryInput => ({
  occurredAt: t(iso), timezone: IST, categoryId: 'cat-symptom',
  answers: [{ optionId: 'o-fatigue', optionLabelSnapshot: 'Fatigue', values: severity === undefined ? [] : [{ dataType: 'range', value: severity }] }],
});
const food = (iso: string, optionId = 'o-dairy', label = 'Dairy'): EntryInput => ({
  occurredAt: t(iso), timezone: IST, categoryId: 'cat-food', answers: [{ optionId, optionLabelSnapshot: label }],
});
const tap = (iso: string, quickActionId: string): EntryInput => ({
  occurredAt: t(iso), timezone: IST, quickActionId, answers: [],
});
const checkIn = (iso: string, optionId: string, score?: number): EntryInput => ({
  occurredAt: t(iso), timezone: IST, source: 'check_in',
  answers: [{ optionId, optionLabelSnapshot: optionId, values: score === undefined ? [] : [{ dataType: 'range', value: score }] }],
});

describe('buildDayRows: observed days', () => {
  it('treats a day with no symptom evidence as unobserved, not symptom-free', () => {
    const rows = buildDayRows(base({ entries: [food('2026-10-27T05:00:00Z')] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symptomObserved: false, symptomPresent: false, exposureObserved: true });
  });

  it('counts a symptom entry, a "no symptoms" check-in and a patient global as observed', () => {
    const rows = buildDayRows(base({
      entries: [
        symptom('2026-10-27T05:00:00Z', 6),
        checkIn('2026-10-28T15:00:00Z', NO_SYMPTOMS_OPTION_ID),
        checkIn('2026-10-29T15:00:00Z', PATIENT_GLOBAL_OPTION_ID, 3),
      ],
    }));
    expect(rows.map(r => [r.dayKey, r.observedBasis, r.symptomPresent])).toEqual([
      ['2026-10-27', 'symptom_entry', true],
      ['2026-10-28', 'check_in', false],
      ['2026-10-29', 'check_in', false],
    ]);
    expect(rows[2].patientGlobal).toBe(3);
  });

  it('a "Flare" feeling is an observed symptom day', () => {
    const [row] = buildDayRows(base({ entries: [checkIn('2026-10-27T05:00:00Z', FEELING_FLARE_OPTION_ID)] }));
    expect(row).toMatchObject({ symptomPresent: true, symptomObserved: true, explicitFlare: true });
  });

  it('accepts a busy logging day with a session as weak evidence only', () => {
    const entries = [food('2026-10-27T03:00:00Z'), tap('2026-10-27T09:00:00Z', 'qa-coffee')];
    const withSession = buildDayRows(base({ entries, sessions: new Map([['2026-10-27', { wakeTime: t('2026-10-27T02:00:00Z') }]]) }));
    expect(withSession[0]).toMatchObject({ observedBasis: 'weak', symptomObserved: true });
    const noSession = buildDayRows(base({ entries }));
    expect(noSession[0].symptomObserved).toBe(false);
  });

  it('emits a row for every day in between, including silent ones', () => {
    const rows = buildDayRows(base({ entries: [symptom('2026-10-27T05:00:00Z', 4), symptom('2026-10-30T05:00:00Z', 4)] }));
    expect(rows.map(r => r.dayKey)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(rows[1]).toMatchObject({ entryCount: 0, symptomObserved: false });
  });
});

describe('buildDayRows: day boundary', () => {
  it('puts a 1:30 AM log on the previous Lumen day', () => {
    // 20:00Z = 01:30 IST on the 28th, before the 4 AM boundary
    const rows = buildDayRows(base({ entries: [symptom('2026-10-27T20:00:00Z', 5)] }));
    expect(rows.map(r => r.dayKey)).toEqual(['2026-10-27']);
  });
});

describe('buildDayRows: exposures and reactive taps', () => {
  it('records exposures per option and category with first and last time', () => {
    const [row] = buildDayRows(base({ entries: [food('2026-10-27T04:00:00Z'), food('2026-10-27T10:00:00Z')] }));
    expect(row.exposures.map(e => [e.key, e.count]).sort()).toEqual([['cat_cat-food', 2], ['opt_o-dairy', 2]]);
    const dairy = row.exposures.find(e => e.key === 'opt_o-dairy')!;
    expect(dairy.firstAt).toEqual(t('2026-10-27T04:00:00Z'));
    expect(dairy.lastAt).toEqual(t('2026-10-27T10:00:00Z'));
  });

  it('keeps a painkiller out of the exposures and counts it as reactive', () => {
    const [row] = buildDayRows(base({ entries: [tap('2026-10-27T05:00:00Z', 'qa-pill'), tap('2026-10-27T06:00:00Z', 'qa-coffee')] }));
    expect(row.exposures.map(e => e.key)).toEqual(['qa_qa-coffee']);
    expect(row.reactiveCount).toBe(1);
  });

  it('does not offer something logged within 3 h after a symptom as that day\'s exposure', () => {
    const entries = [symptom('2026-10-27T05:00:00Z', 6), tap('2026-10-27T06:30:00Z', 'qa-coffee')];
    const [row] = buildDayRows(base({ entries }));
    expect(row.exposures).toEqual([]);
    expect(row.reactiveCount).toBe(1);
  });

  it('still counts it when the symptom came after, or long before', () => {
    const entries = [tap('2026-10-27T05:00:00Z', 'qa-coffee'), symptom('2026-10-27T05:30:00Z', 6), tap('2026-10-27T12:00:00Z', 'qa-coffee')];
    const [row] = buildDayRows(base({ entries }));
    expect(row.exposures[0]).toMatchObject({ key: 'qa_qa-coffee', count: 2, afterSymptomCount: 0 });
  });

  it('"Flare now" is a symptom, never an exposure', () => {
    const [row] = buildDayRows(base({ entries: [tap('2026-10-27T05:00:00Z', 'qa-flare')] }));
    expect(row.exposures).toEqual([]);
    expect(row.symptomPresent).toBe(true);
    expect(row.symptoms[0].key).toBe('qa_qa-flare');
  });
});

describe('buildDayRows: severity and context', () => {
  it('takes the day max and mean from range answers only', () => {
    const [row] = buildDayRows(base({ entries: [symptom('2026-10-27T05:00:00Z', 4), symptom('2026-10-27T09:00:00Z', 8), symptom('2026-10-27T10:00:00Z')] }));
    expect(row).toMatchObject({ symptomMax: 8, symptomMean: 6, symptomPresent: true });
    expect(row.symptoms.find(s => s.key === 'opt_o-fatigue')).toMatchObject({ present: true, max: 8 });
  });

  it('adds steps, walking and sleep for the day, and ignores impossible sleep', () => {
    const sessions = new Map([
      ['2026-10-26', { sleepTime: t('2026-10-26T17:30:00Z') }],
      ['2026-10-27', { wakeTime: t('2026-10-27T01:30:00Z'), sleepTime: t('2026-10-27T17:30:00Z') }],
      ['2026-10-28', { wakeTime: t('2026-10-28T20:00:00Z') }],
    ]);
    const rows = buildDayRows(base({
      entries: [symptom('2026-10-27T05:00:00Z', 4), symptom('2026-10-28T05:00:00Z', 4)],
      steps: new Map([['2026-10-27', 5400]]),
      walkMinutes: new Map([['2026-10-27', 25]]),
      sessions,
    }));
    expect(rows[0]).toMatchObject({ steps: 5400, walkMinutes: 25, sleepHours: 8 });
    expect(rows[1].sleepHours).toBeNull(); // 26 h between bedtime and wake is not a night's sleep
    expect(rows[1].steps).toBeNull();
  });
});

describe('analysis kind defaults', () => {
  it('follows the category role unless the member chose otherwise', () => {
    expect(categoryKind({ role: 'symptom' })).toBe('outcome');
    expect(categoryKind({ role: 'trigger_candidate' })).toBe('exposure');
    expect(categoryKind({ role: 'context' })).toBe('context');
    expect(categoryKind({ role: 'trigger_candidate', analysis: { kind: 'ignore' } })).toBe('ignore');
  });

  it('guesses quick taps from the label, and lets the member override', () => {
    expect(quickActionKind({ label: 'Flare now' })).toBe('outcome');
    expect(quickActionKind({ label: 'Painkiller' })).toBe('reactive');
    expect(quickActionKind({ label: 'Lie down' })).toBe('reactive');
    expect(quickActionKind({ label: 'Water' })).toBe('context');
    expect(quickActionKind({ label: 'Coffee' })).toBe('exposure');
    expect(quickActionKind({ label: 'Water', analysis: { kind: 'exposure' } })).toBe('exposure');
  });
});
