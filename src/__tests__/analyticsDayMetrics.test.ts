/** DayMetric rows: amounts in base units, reactive taps, sleep sources, daily numbers, absence rules. */
import { buildMetricRows, inferMetricRole, MetricInput, MetricEntry } from '../services/analytics/dayMetrics';
import { dailyValues, BUILT_IN_BY_ID, itemMetric, firstSeenDay } from '../services/analytics/metricCatalog';
import { withCanonical, canonicalFor } from '../services/logs/canonical';

const TZ = 'Asia/Kolkata';
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);

function input(entries: MetricEntry[], over: Partial<MetricInput> = {}): MetricInput {
  return {
    entries,
    categories: new Map([
      ['catSym', { label: 'Symptoms', kind: 'outcome' }],
      ['catFood', { label: 'Food', kind: 'exposure' }],
      ['catHab', { label: 'Habits', kind: 'exposure' }],
      ['catMeds', { label: 'Medicines', kind: 'context' }],
    ]),
    quickActions: new Map([
      ['qaWater', { label: 'Water', kind: 'context', defaultValue: 250, unit: 'ml', metricRole: 'water' }],
      ['qaPain', { label: 'Painkiller', kind: 'reactive' }],
      ['qaWalk', { label: 'Walk', kind: 'exposure', metricRole: 'walk' }],
      ['qaFlare', { label: 'Flare now!', kind: 'outcome' }],
    ]),
    questions: new Map([
      ['qEx', { label: 'Exercise', categoryId: 'catHab', metricRole: 'exercise' }],
      ['qSleep', { label: 'Sleep quality', categoryId: 'catHab', metricRole: 'sleep' }],
    ]),
    optionCategory: new Map([['optWeak', 'catSym'], ['optDairy', 'catFood']]),
    steps: new Map(), walkMinutes: new Map(), exerciseMinutes: new Map(), sessions: new Map(),
    weather: new Map(), doses: new Map(), flareDays: new Set(),
    timeZone: TZ, boundaryHour: 4,
    from: '2026-11-01', to: '2026-11-03',
    ...over,
  };
}

const water = (day: string, hhmm: string, values?: MetricEntry['answers'][number]['values']): MetricEntry => ({
  occurredAt: at(day, hhmm), timezone: TZ, source: 'quick_action', quickActionId: 'qaWater',
  answers: values ? [{ optionId: 'qa:amount', values }] : [],
});

describe('buildMetricRows', () => {
  it('adds water from taps in ml, glasses and the default amount, on the Lumen day', () => {
    const rows = buildMetricRows(input([
      water('2026-11-01', '09:00', [{ dataType: 'number', value: 500, unit: 'ml' }]),
      water('2026-11-01', '12:00', [{ dataType: 'number', value: 1, unit: 'glass' }]),
      water('2026-11-01', '15:00'),
      // 02:00 on the 2nd is still the 1st with a 4 AM boundary
      water('2026-11-02', '02:00'),
    ]));
    expect(rows.map(r => r.dayKey)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(rows[0].metrics.waterMl).toBe(500 + 250 + 250 + 250);
    expect(rows[0].items.find(i => i.key === 'qa_qaWater')).toMatchObject({ count: 4, qty: 1250, unit: 'ml' });
    expect(rows[1].metrics.waterMl).toBeNull();
    expect(rows[1].logged.any).toBe(false);
  });

  it('marks an item logged within 3 h after a symptom as reactive, and keys symptoms by option and category', () => {
    const rows = buildMetricRows(input([
      { occurredAt: at('2026-11-01', '10:00'), timezone: TZ, categoryId: 'catSym', source: 'questionnaire', answers: [{ optionId: 'optWeak', optionLabelSnapshot: 'Weakness', values: [{ dataType: 'range', value: 7 }] }] },
      { occurredAt: at('2026-11-01', '11:00'), timezone: TZ, quickActionId: 'qaPain', source: 'quick_action', answers: [] },
      { occurredAt: at('2026-11-01', '18:00'), timezone: TZ, quickActionId: 'qaPain', source: 'quick_action', answers: [] },
    ]));
    const d = rows[0];
    expect(d.items.find(i => i.key === 'opt_optWeak')).toMatchObject({ outcome: true, maxSev: 7, group: 'catSym' });
    expect(d.items.find(i => i.key === 'cat_catSym')).toMatchObject({ outcome: true, maxSev: 7 });
    expect(d.items.find(i => i.key === 'qa_qaPain')).toMatchObject({ count: 2, reactive: 1 });
    expect(d.metrics.symptomMax).toBe(7);
    expect(d.logged.symptomBasis).toBe('symptom_entry');
  });

  it('takes sleep from the best source and drops impossible nights', () => {
    const sleep = (day: string, minutes: number, src: string): MetricEntry => ({
      occurredAt: at(day, '07:00'), timezone: TZ, source: 'sleep',
      answers: [{ optionId: 'sleep_summary', values: [
        { fieldKey: 'sleep_duration_minutes', dataType: 'number', value: minutes },
        { fieldKey: 'sleep_source', dataType: 'string', value: src },
        { fieldKey: 'sleep_quality', dataType: 'enum', value: 'GOOD' },
      ] }],
    });
    const rows = buildMetricRows(input([sleep('2026-11-01', 420, 'buttons'), sleep('2026-11-01', 390, 'device'), sleep('2026-11-02', 60, 'device')], {
      sessions: new Map([['2026-11-02', { wakeTime: at('2026-11-02', '06:00') }], ['2026-11-01', { sleepTime: at('2026-11-01', '22:00') }]]),
    }));
    expect(rows[0].metrics).toMatchObject({ sleepHours: 6.5, sleepSource: 'device', sleepQuality: 3 });
    // The 1-hour "night" is dropped from the log; the day buttons give 8 h instead.
    expect(rows[1].metrics).toMatchObject({ sleepHours: 8, sleepSource: 'buttons' });
    // Auto entries do not count as the member logging that day.
    expect(rows[0].logged.any).toBe(false);
  });

  it('sums exercise minutes from a duration question and walks from sessions plus walk timers', () => {
    const rows = buildMetricRows(input([
      { occurredAt: at('2026-11-01', '08:00'), timezone: TZ, categoryId: 'catHab', questionId: 'qEx', source: 'questionnaire', answers: [{ optionId: 'optLight', optionLabelSnapshot: 'Light', values: [{ dataType: 'duration', value: 1800 }] }] },
      { occurredAt: at('2026-11-01', '18:00'), timezone: TZ, quickActionId: 'qaWalk', source: 'quick_action', answers: [{ optionId: 'qa:timer', values: [{ dataType: 'duration', value: 600 }] }] },
      { occurredAt: at('2026-11-02', '08:00'), timezone: TZ, categoryId: 'catHab', questionId: 'qEx', source: 'questionnaire', answers: [{ optionId: 'optNo', optionLabelSnapshot: 'No exercise', values: [] }] },
    ], { walkMinutes: new Map([['2026-11-01', 20]]) }));
    expect(rows[0].metrics.exerciseMin).toBe(30);
    expect(rows[0].metrics.walkMin).toBe(30);
    expect(rows[1].metrics.exerciseMin).toBe(0);
  });

  it('reads energy, stress, overall and mood from the check-in', () => {
    const rows = buildMetricRows(input([
      { occurredAt: at('2026-11-01', '21:00'), timezone: TZ, source: 'check_in', answers: [
        { optionId: 'checkin:energy', values: [{ dataType: 'range', value: 3 }] },
        { optionId: 'checkin:stress', values: [{ dataType: 'range', value: 8 }] },
        { optionId: 'checkin:global', values: [{ dataType: 'range', value: 6 }] },
      ] },
      { occurredAt: at('2026-11-01', '22:00'), timezone: TZ, source: 'check_in', answers: [{ optionId: 'feeling:low' }] },
    ]));
    expect(rows[0].metrics).toMatchObject({ energy: 3, stress: 8, patientGlobal: 6, mood: 2 });
    expect(rows[0].logged.symptomBasis).toBe('check_in');
    expect(rows[0].items.find(i => i.key === 'feel_low')).toBeTruthy();
  });

  it('flags mixed units instead of adding them', () => {
    const rows = buildMetricRows(input([
      { occurredAt: at('2026-11-01', '10:00'), timezone: TZ, categoryId: 'catFood', source: 'questionnaire', answers: [{ optionId: 'optDairy', optionLabelSnapshot: 'Dairy', values: [{ dataType: 'number', value: 1, unit: 'katori' }] }] },
      { occurredAt: at('2026-11-01', '13:00'), timezone: TZ, categoryId: 'catFood', source: 'questionnaire', answers: [{ optionId: 'optDairy', optionLabelSnapshot: 'Dairy', values: [{ dataType: 'number', value: 200, unit: 'ml' }] }] },
    ]));
    expect(rows[0].items.find(i => i.key === 'opt_optDairy')).toMatchObject({ count: 2, qty: null, mixedUnits: true });
  });
});

describe('absence rules', () => {
  const rows = buildMetricRows(input([
    water('2026-11-02', '09:00'),
    { occurredAt: at('2026-11-03', '10:00'), timezone: TZ, categoryId: 'catFood', source: 'questionnaire', answers: [{ optionId: 'optDairy', optionLabelSnapshot: 'Dairy' }] },
  ]));

  it('water is 0 on a later logged day without water, missing on days with no logging', () => {
    const def = BUILT_IN_BY_ID.get('water_ml')!;
    expect(dailyValues(def, rows, firstSeenDay(def, rows))).toEqual([null, 250, 0]);
  });

  it('sleep and energy are never filled with 0', () => {
    expect(dailyValues(BUILT_IN_BY_ID.get('sleep_hours')!, rows, null)).toEqual([null, null, null]);
    expect(dailyValues(BUILT_IN_BY_ID.get('energy')!, rows, null)).toEqual([null, null, null]);
  });

  it('item counts are 0 from the first time the item was logged', () => {
    const def = itemMetric('opt_optDairy', 'Dairy', 'count');
    expect(dailyValues(def, rows, firstSeenDay(def, rows))).toEqual([null, null, 1]);
  });
});

describe('inferMetricRole', () => {
  it('uses the explicit role, then the template, then the label', () => {
    expect(inferMetricRole(null, 'qa_water', 'Water')).toBeNull();
    expect(inferMetricRole(undefined, 'qa_water', 'Paani')).toBe('water');
    expect(inferMetricRole(undefined, undefined, 'Morning yoga')).toBe('exercise');
    expect(inferMetricRole(undefined, undefined, 'Evening walk')).toBe('walk');
    expect(inferMetricRole(undefined, undefined, 'Coffee')).toBeNull();
  });
});

describe('canonical values', () => {
  it('converts known units and leaves unknown ones alone', () => {
    expect(canonicalFor({ dataType: 'number', value: 2, unit: 'glass' })).toBe(500);
    expect(canonicalFor({ dataType: 'number', value: 98.6, unit: '°F' })).toBeCloseTo(37, 1);
    expect(canonicalFor({ dataType: 'duration', value: 90 })).toBe(90);
    expect(canonicalFor({ dataType: 'number', value: 1, unit: 'katori' })).toBeUndefined();
    const [a] = withCanonical([{ optionId: 'x', values: [{ fieldKey: 'h', dataType: 'number', value: 7, unit: 'hours' }] }]);
    expect(a.values![0]).toMatchObject({ canonicalValue: 25200 });
  });
});
