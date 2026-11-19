/** Weather parsing, freshness clusters, the PDF report's missed-dose fix and the AI attachment kind. */
import { parseOpenMeteo, openMeteoUrl, roundCoord } from '../services/weather/weatherDays';
import { clusters } from '../services/analytics/freshness';
import { isMissedDoseLabel } from '../services/reportGenerator';
import { REF_KINDS } from '../services/llm/assistant/refTypes';
import { TOOL_DECLARATIONS } from '../services/llm/assistant/dataTools';
import { ALL_CATEGORY_TEMPLATES, CONDITION_BUNDLES } from '../shared/templates/library';

describe('weather', () => {
  it('averages hourly humidity/pressure per day and works out the change from the day before', () => {
    const hours = (day: string) => Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`);
    const rows = parseOpenMeteo({
      daily: { time: ['2026-11-01', '2026-11-02'], temperature_2m_max: [31.26, 29], temperature_2m_min: [20, 19], uv_index_max: [7, 6], precipitation_sum: [0, 4.2] },
      hourly: {
        time: [...hours('2026-11-01'), ...hours('2026-11-02')],
        relative_humidity_2m: [...Array(24).fill(60), ...Array(24).fill(80)],
        pressure_msl: [...Array(24).fill(1012), ...Array(24).fill(1006)],
      },
    });
    expect(rows[0]).toMatchObject({ dayKey: '2026-11-01', tMaxC: 31.3, humidity: 60, pressureHpa: 1012, pressureDelta: null });
    expect(rows[1]).toMatchObject({ humidity: 80, pressureHpa: 1006, pressureDelta: -6, precipMm: 4.2 });
  });

  it('only ever sends a rounded location', () => {
    expect(roundCoord(28.613939)).toBe(28.61);
    expect(openMeteoUrl(28.613939, 77.209021, 'Asia/Kolkata', 92)).toContain('latitude=28.61&longitude=77.21');
  });
});

describe('freshness clusters', () => {
  it('groups changed days that are close, keeps far ones apart', () => {
    expect(clusters(['2026-01-01', '2026-01-02', '2026-01-05', '2026-03-01'])).toEqual([['2026-01-01', '2026-01-05'], ['2026-03-01', '2026-03-01']]);
  });
});

describe('PDF report adherence', () => {
  it('no longer counts "Missed dose" as taken', () => {
    expect(isMissedDoseLabel('missed dose')).toBe(true);
    expect(isMissedDoseLabel('skipped')).toBe(true);
    expect(isMissedDoseLabel('taken as prescribed')).toBe(false);
    expect(isMissedDoseLabel('extra / rescue dose')).toBe(false);
  });
});

describe('Lumen AI', () => {
  it('can take an Explore analysis as an attachment and has the explore/metrics tools', () => {
    expect(REF_KINDS).toContain('analysis');
    const names = TOOL_DECLARATIONS.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['explore_relations', 'get_metrics']));
  });
});

describe('neuro template', () => {
  it('is a symptom category with weakness, numbness and paralysis, and has a bundle', () => {
    const neuro = ALL_CATEGORY_TEMPLATES.find(c => c.templateKey === 'cat_neuro')!;
    expect(neuro.role).toBe('symptom');
    expect(neuro.questions[0].options.map(o => o.templateKey)).toEqual(expect.arrayContaining(['opt_weakness', 'opt_numbness', 'opt_paralysis']));
    expect(CONDITION_BUNDLES.find(b => b.key === 'neuro')?.categoryKeys).toContain('cat_neuro');
  });
});
