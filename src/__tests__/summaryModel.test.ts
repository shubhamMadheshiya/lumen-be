import { DayRow } from '../services/insights/dayTable';
import { shiftDayKey } from '../utils/dayKey';
import {
  buildSummaryModel, completenessLine, periodLine, SummaryModelInput, topSymptomKeys, weeklySeriesForSymptom,
} from '../services/insights/summaryModel';

function row(dayKey: string, over: Partial<DayRow> = {}): DayRow {
  return {
    dayKey, symptomObserved: true, observedBasis: 'symptom_entry', exposureObserved: true,
    entryCount: 1, distinctHours: 1, engagement: 0, nonSymptomEntries: 0, symptoms: [], exposures: [], reactiveCount: 0,
    symptomPresent: true, symptomMax: 4, symptomMean: 4, patientGlobal: null, noSymptomsCheckIn: false,
    explicitFlare: false, steps: null, walkMinutes: null, wakeTime: null, sleepTime: null, sleepHours: null,
    ...over,
  };
}

const TO = '2026-10-27';
const FROM = '2026-10-01';

describe('periodLine', () => {
  it('formats a range within one month, and across months', () => {
    expect(periodLine('2026-10-01', '2026-10-27')).toBe('1–27 Oct 2026');
    expect(periodLine('2026-09-28', '2026-10-03')).toBe('28 Sep – 3 Oct 2026');
  });
});

describe('completenessLine', () => {
  it('counts observed days against the full range, including unlogged ones', () => {
    const rows = [row('2026-10-01'), row('2026-10-02', { symptomObserved: false }), row('2026-10-03')];
    expect(completenessLine(rows, '2026-10-01', '2026-10-03')).toBe('Logged 2 of 3 days in this period.');
  });
});

describe('topSymptomKeys', () => {
  it('ranks by how often each symptom appears within the range, outside symptoms excluded', () => {
    const rows = [
      row('2026-10-01', { symptoms: [{ key: 'opt_a', label: 'Fatigue', present: true, max: 5 }] }),
      row('2026-10-02', { symptoms: [{ key: 'opt_a', label: 'Fatigue', present: true, max: 5 }, { key: 'opt_b', label: 'Pain', present: true, max: 3 }] }),
      row('2026-09-01', { symptoms: [{ key: 'opt_c', label: 'Outside range', present: true, max: 9 }] }),
    ];
    expect(topSymptomKeys(rows, '2026-10-01', '2026-10-31', 2)).toEqual([
      { key: 'opt_a', label: 'Fatigue' },
      { key: 'opt_b', label: 'Pain' },
    ]);
  });

  it('leaves out the whole-category entry, naming the specific symptom instead', () => {
    const rows = [row('2026-10-01', { symptoms: [
      { key: 'cat_symptoms', label: 'Symptoms', present: true, max: 5 },
      { key: 'opt_fatigue', label: 'Fatigue', present: true, max: 5 },
    ] })];
    expect(topSymptomKeys(rows, '2026-10-01', '2026-10-31')).toEqual([{ key: 'opt_fatigue', label: 'Fatigue' }]);
  });
});

describe('weeklySeriesForSymptom', () => {
  it('takes the median of that symptom\'s own severity per week', () => {
    const rows = [
      row('2026-10-05', { symptoms: [{ key: 'cat_a', label: 'Fatigue', present: true, max: 4 }] }),
      row('2026-10-06', { symptoms: [{ key: 'cat_a', label: 'Fatigue', present: true, max: 8 }] }),
      row('2026-10-07', { symptoms: [{ key: 'cat_b', label: 'Other', present: true, max: 9 }] }), // not this symptom
    ];
    expect(weeklySeriesForSymptom(rows, 'cat_a', 1)).toEqual([6]);
  });
});

function baseInput(over: Partial<SummaryModelInput> = {}): SummaryModelInput {
  const rows = Array.from({ length: 95 }, (_, i) => row(shiftDayKey(TO, -i), { symptomMax: 3 + (i % 5) }));
  return {
    from: FROM, to: TO, rows,
    medications: [],
    trend: { state: 'steady', weeks: [], pValue: 0.8, estimatedChange: 0, baseline: 4, weeksNeeded: 0 },
    flareEpisodes: [], redFlagEvents: [], findings: [],
    ...over,
  };
}

describe('buildSummaryModel', () => {
  it('formats medicine lines by status, and counts what was truncated', () => {
    const model = buildSummaryModel(baseInput({
      medications: [
        { name: 'Methotrexate', dose: '15', unit: 'mg', active: true, startedOn: '2026-08-19' },
        { name: 'Ibuprofen', active: false, stoppedOn: '2026-10-25' },
        { name: 'Vitamin D', active: true },
      ],
      maxListLines: 2,
    } as Partial<SummaryModelInput>));
    expect(model.medicationLines).toEqual([
      'Methotrexate, 15 mg — active, started 19 Aug 2026',
      'Ibuprofen — stopped 25 Oct 2026',
    ]);
    expect(model.medicationsTruncated).toBe(1);
  });

  it('describes every trend state in plain words', () => {
    for (const state of ['improving', 'worsening', 'steady', 'mixed', 'not_enough_data'] as const) {
      const model = buildSummaryModel(baseInput({ trend: { state, weeks: [], pValue: null, estimatedChange: null, baseline: null, weeksNeeded: 0 } }));
      expect(model.trendLine.length).toBeGreaterThan(0);
    }
  });

  it('labels a flare by its source, and drops ones the member said were not flares', () => {
    const model = buildSummaryModel(baseInput({
      flareEpisodes: [
        { startDay: '2026-10-10', endDay: '2026-10-11', source: 'explicit', confirmed: null },
        { startDay: '2026-10-05', endDay: '2026-10-05', source: 'inferred', confirmed: 'yes' },
        { startDay: '2026-10-02', endDay: '2026-10-02', source: 'inferred', confirmed: null },
        { startDay: '2026-09-01', endDay: '2026-09-01', source: 'inferred', confirmed: 'no' },
      ],
    }));
    expect(model.flareLines.some(l => l.includes('Flare now'))).toBe(true);
    expect(model.flareLines.some(l => l.includes('confirmed by the member'))).toBe(true);
    expect(model.flareLines.some(l => l.includes('not confirmed'))).toBe(true);
    expect(model.flareLines).toHaveLength(3); // the "no" one is dropped
  });

  it('marks a red flag as urgent only for the "now" level', () => {
    const model = buildSummaryModel(baseInput({
      redFlagEvents: [
        { dayKey: '2026-10-20', title: 'A fever is worth a call', level: 'today' },
        { dayKey: '2026-10-21', title: 'Chest pain with breathlessness needs care now', level: 'now' },
      ],
    }));
    expect(model.redFlagLines[0]).toContain('(urgent)'); // most recent first
    expect(model.redFlagLines[1]).not.toContain('(urgent)');
  });

  it('formats patterns with "X of Y" counts and puts consistent ones first', () => {
    const model = buildSummaryModel(baseInput({
      findings: [
        { exposureLabel: 'Coffee', outcomeLabel: 'Headache', lagDays: 0, counts: { exposedWith: 5, exposedTotal: 10, otherWith: 3, otherTotal: 20 }, tier: 'possible' },
        { exposureLabel: 'Dairy', outcomeLabel: 'Joint pain', lagDays: 1, counts: { exposedWith: 9, exposedTotal: 14, otherWith: 6, otherTotal: 31 }, tier: 'consistent' },
      ],
    }));
    expect(model.patternLines[0]).toContain('Dairy → Joint pain');
    expect(model.patternLines[0]).toContain('9 of 14 days');
    expect(model.patternLines[0]).toContain('vs 6 of 31 other days');
    expect(model.patternLines[1]).toContain('Coffee → Headache');
  });

  it('includes the member\'s questions for the doctor, trimmed, or null when blank', () => {
    expect(buildSummaryModel(baseInput({ notesForDoctor: '  Is this normal?  ' })).notesForDoctor).toBe('Is this normal?');
    expect(buildSummaryModel(baseInput({ notesForDoctor: '   ' })).notesForDoctor).toBeNull();
    expect(buildSummaryModel(baseInput()).notesForDoctor).toBeNull();
  });

  it('builds a calendar strip for the last 28 days, marking unlogged days separately', () => {
    const rows = [
      ...Array.from({ length: 90 }, (_, i) => row(shiftDayKey(TO, -i - 28), { symptomMax: 5 })), // steady baseline
      row(shiftDayKey(TO, -2), { symptomMax: 1 }), // should read as good
      row(shiftDayKey(TO, -1), { symptomMax: 9 }), // should read as harder
      // the most recent day (TO) has no row at all -> unlogged
    ];
    const model = buildSummaryModel(baseInput({ rows }));
    expect(model.calendar).toHaveLength(28);
    expect(model.calendar[model.calendar.length - 1]).toMatchObject({ dayKey: TO, mark: 'unlogged' });
    expect(model.calendar.find(c => c.dayKey === shiftDayKey(TO, -2))?.mark).toBe('good');
    expect(model.calendar.find(c => c.dayKey === shiftDayKey(TO, -1))?.mark).toBe('harder');
  });

  it('always marks a flare day as harder, whatever its own score was', () => {
    const rows = [
      ...Array.from({ length: 90 }, (_, i) => row(shiftDayKey(TO, -i - 28), { symptomMax: 5 })),
      row(shiftDayKey(TO, -1), { symptomMax: 1 }), // low score, but it's a flare day below
    ];
    const flareDay = shiftDayKey(TO, -1);
    const model = buildSummaryModel(baseInput({ rows }), new Set([flareDay]));
    expect(model.calendar.find(c => c.dayKey === flareDay)?.mark).toBe('harder');
  });

  it('includes weekly series for the trend and the top symptoms', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(shiftDayKey(TO, -i), {
      symptomMax: 4,
      symptoms: [{ key: 'opt_a', label: 'Fatigue', present: true, max: 4 }],
    }));
    const model = buildSummaryModel(baseInput({
      rows,
      trend: { state: 'steady', weeks: [{ weekKey: '2026-10-05', medianValue: 4, loggedDays: 5 }, { weekKey: '2026-10-12', medianValue: 4, loggedDays: 5 }], pValue: 0.9, estimatedChange: 0, baseline: 4, weeksNeeded: 0 },
    }));
    expect(model.weeklySeries.find(s => s.label === 'Overall')).toBeTruthy();
    expect(model.weeklySeries.find(s => s.label === 'Fatigue')).toBeTruthy();
  });
});
