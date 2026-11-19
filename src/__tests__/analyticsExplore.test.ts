/**
 * Explore on synthetic histories: no patterns in pure noise (the false-alarm rate), planted
 * patterns are found at the right lag and direction, skipped medicine → symptoms after,
 * "logged together" and reactive handling, numbers on target days, period questions.
 */
import { explore, LabelLookup, riseSeries } from '../services/analytics/explore';
import { DayMetricRow, ItemDay } from '../services/analytics/dayMetrics';
import { resolveMetric } from '../services/analytics/metricCatalog';
import { shiftDayKey } from '../utils/dayKey';
import { mannWhitneyU } from '../services/insights/stats';
import { spearman } from '../services/analytics/correlation';
import { summarise } from '../services/analytics/metricsSummary';
import { BUILT_IN_BY_ID } from '../services/analytics/metricCatalog';
import { encodeSpecToken, decodeSpecToken } from '../services/analytics/exploreService';
import { compactExplore } from '../services/analytics/exploreCompact';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const item = (key: string, label: string, outcome: boolean, extra: Partial<ItemDay> = {}): ItemDay => ({
  key, label, group: outcome ? 'catSym' : `g_${key}`, count: 1, reactive: 0, qty: null, unit: null, mixedUnits: false,
  maxSev: outcome ? 6 : null, hours: [100], outcome, ...extra,
});

const EXPOSURES = ['dairy', 'gluten', 'coffee', 'sugar', 'alcohol', 'late_meal', 'spicy', 'stress_work'];

interface Plan {
  days: number;
  seed: number;
  /** probability of weakness on a normal day */
  base?: number;
  plant?: { exposure: string; lag: number; rate: number };
  skipEffect?: boolean;
}

function history(p: Plan): DayMetricRow[] {
  const r = rng(p.seed);
  const rows: DayMetricRow[] = [];
  let day = '2025-06-01';
  const exp: Record<string, boolean[]> = {};
  for (const e of EXPOSURES) exp[e] = [];
  const skips: boolean[] = [];
  for (let i = 0; i < p.days; i++) {
    for (const e of EXPOSURES) exp[e].push(r() < 0.3);
    skips.push(r() < 0.2);
    let pW = p.base ?? 0.2;
    if (p.plant && i - p.plant.lag >= 0 && exp[p.plant.exposure][i - p.plant.lag]) pW = p.plant.rate;
    const fatigue = p.skipEffect && i >= 1 && skips[i - 1] ? r() < 0.75 : r() < 0.15;
    const weak = r() < pW;
    const items: ItemDay[] = EXPOSURES.filter(e => exp[e][i]).map(e => item(`opt_${e}`, e, false, { hours: [i * 24 + 9] }));
    if (weak) items.push(item('opt_weak', 'Weakness', true, { hours: [i * 24 + 15] }));
    if (fatigue) items.push(item('opt_fatigue', 'Fatigue', true, { hours: [i * 24 + 16] }));
    rows.push({
      dayKey: day,
      logged: { any: true, entryCount: items.length + 2, symptomBasis: 'check_in' },
      items,
      metrics: {
        sleepHours: 6 + r() * 3 - (weak ? 0 : 0), sleepSource: 'device', sleepQuality: null, steps: Math.round(3000 + r() * 6000), walkMin: null,
        exerciseMin: null, waterMl: null, energy: null, stress: null, mood: null, patientGlobal: null, symptomMax: weak ? 6 : null,
        symptomCount: weak ? 1 : 0, flareDay: false, tMaxC: null, tMinC: null, humidity: null, pressureHpa: null, pressureDelta: null, uvMax: null, precipMm: null,
      },
      doses: [{ medicationId: 'aaaaaaaaaaaaaaaaaaaaaaaa', scheduled: 1, taken: skips[i] ? 0 : 1, skipped: skips[i] ? 1 : 0, extra: 0, unmarked: 0, prn: false }],
    });
    day = shiftDayKey(day, 1);
  }
  return rows;
}

const lookup: LabelLookup = {
  item: k => k.replace(/^opt_/, ''),
  med: () => 'HCQ',
  metric: id => resolveMetric(id, { item: k => k, med: () => 'HCQ', itemUnit: () => null }),
};

describe('explore — false alarms on pure noise', () => {
  it('shows "stands out" for at most ~5% of noise histories', () => {
    let any = 0;
    const N = 60;
    for (let s = 1; s <= N; s++) {
      const res = explore(history({ days: 150, seed: s }), { target: { kind: 'item', key: 'opt_weak' }, direction: 'before' }, lookup);
      if (res.findings.length > 0) any++;
    }
    expect(any / N).toBeLessThanOrEqual(0.07);
  });
});

describe('explore — planted patterns', () => {
  it('finds "dairy the day before weakness"', () => {
    let found = 0;
    for (let s = 1; s <= 10; s++) {
      const res = explore(history({ days: 180, seed: 100 + s, plant: { exposure: 'dairy', lag: 1, rate: 0.6 } }), { target: { kind: 'item', key: 'opt_weak' }, direction: 'before' }, lookup);
      const f = res.findings.find(x => x.key === 'opt_dairy');
      if (f && f.way === 'more' && (f.lag === 1 || f.lag === 'w3')) found++;
    }
    expect(found).toBeGreaterThanOrEqual(8);
  });

  it('finds fatigue after a skipped medicine, comparing with days every dose was taken', () => {
    const res = explore(history({ days: 180, seed: 7, skipEffect: true }), { target: { kind: 'dose', medicationId: 'aaaaaaaaaaaaaaaaaaaaaaaa', status: 'skipped' }, direction: 'after' }, lookup);
    const f = res.findings.find(x => x.key === 'opt_fatigue');
    expect(f).toBeDefined();
    expect(f!.lag === 1 || f!.lag === 'w3').toBe(true);
    expect(f!.way).toBe('more');
    expect(res.caveats).toContain('unmarked_left_out');
    expect(res.target.label).toBe('Skipped HCQ');
  });

  it('never offers the target itself or its own category as a candidate', () => {
    const rows = history({ days: 120, seed: 3 }).map(r => ({
      ...r,
      items: r.items.some(i => i.key === 'opt_weak') ? [...r.items, item('cat_catSym', 'Symptoms', true)] : r.items,
    }));
    const res = explore(rows, { target: { kind: 'item', key: 'opt_weak' }, direction: 'before' }, lookup);
    const all = [...res.findings, ...res.unclear].map(f => f.key);
    expect(all).not.toContain('opt_weak');
    expect(all).not.toContain('cat_catSym');
  });

  it('flags things logged in the same hour as the target', () => {
    const rows = history({ days: 160, seed: 11, base: 0.15 }).map(r => {
      const weak = r.items.find(i => i.key === 'opt_weak');
      if (!weak) return r;
      // A "note" logged in the same entry/hour as every weakness
      return { ...r, items: [...r.items, item('opt_note', 'note', false, { hours: weak.hours })] };
    });
    const res = explore(rows, { target: { kind: 'item', key: 'opt_weak' }, direction: 'before' }, lookup);
    const f = res.findings.find(x => x.key === 'opt_note');
    expect(f).toBeDefined();
    expect(f!.lag).toBe(0);
    expect(f!.flags).toContain('logged_together');
  });

  it('reports counts the way they are shown: target after the item vs other days', () => {
    const res = explore(history({ days: 180, seed: 105, plant: { exposure: 'dairy', lag: 0, rate: 0.7 } }), { target: { kind: 'item', key: 'opt_weak' }, direction: 'before' }, lookup);
    const f = res.findings.find(x => x.key === 'opt_dairy')!;
    expect(f.rateWith).toBeCloseTo(f.a / (f.a + f.b), 2);
    expect(f.rateOther).toBeCloseTo(f.c / (f.c + f.d), 2);
    expect(f.rateWith).toBeGreaterThan(f.rateOther);
    expect(res.checkedCount).toBeGreaterThan(10);
  });

  it('a period question compares the stretch with the same number of days before it', () => {
    const rows = history({ days: 120, seed: 9 });
    const from = rows[90].dayKey;
    const to = rows[119].dayKey;
    // Make the last 30 days have lots of coffee
    for (let i = 90; i < 120; i++) if (!rows[i].items.some(x => x.key === 'opt_coffee')) rows[i].items.push(item('opt_coffee', 'coffee', false));
    const res = explore(rows, { target: { kind: 'period', from, to }, direction: 'before' }, lookup);
    expect(res.period).toMatchObject({ from, to, prevFrom: rows[60].dayKey, prevTo: rows[89].dayKey });
    expect(res.findings.find(f => f.key === 'opt_coffee')?.way).toBe('more');
    expect(res.caveats).toContain('period_rtm');
  });
});

describe('riseSeries', () => {
  it('needs 5 earlier values and a clear jump over the member\'s own level', () => {
    const rows = history({ days: 30, seed: 1 }).map((r, i) => ({ ...r, metrics: { ...r.metrics, symptomMax: i === 20 ? 9 : 2 } }));
    const s = riseSeries(rows, 'symptom_max');
    expect(s.slice(0, 5).every(p => !p.observed)).toBe(true);
    expect(s[20].hit).toBe(true);
    expect(s.filter(p => p.hit)).toHaveLength(1);
  });
});

describe('stats helpers', () => {
  it('Mann-Whitney separates clearly different groups and not identical ones', () => {
    expect(mannWhitneyU([1, 2, 3, 4, 5, 6, 7, 8], [11, 12, 13, 14, 15, 16, 17, 18]).p).toBeLessThan(0.01);
    expect(mannWhitneyU([5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5]).p).toBe(1);
  });

  it('Spearman follows rank order', () => {
    expect(spearman([1, 2, 3, 4, 5, 6, 7, 8], [2, 4, 6, 8, 10, 12, 14, 100])!.rho).toBeCloseTo(1, 5);
    expect(spearman([1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1])!.rho).toBeCloseTo(-1, 5);
  });
});

describe('metric summaries', () => {
  it('averages only days with a value and reports coverage and change', () => {
    const rows = history({ days: 60, seed: 4 });
    rows.forEach((r, i) => { r.metrics.sleepHours = i < 30 ? 6 : i % 3 === 0 ? null : 8; });
    const def = BUILT_IN_BY_ID.get('sleep_hours')!;
    const s = summarise(def, rows.slice(30), rows.slice(0, 30), rows[0].dayKey);
    expect(s.value).toBe(8);
    expect(s.covered).toBe(20);
    expect(s.total).toBe(30);
    expect(s.prev).toEqual({ value: 6, covered: 30 });
    expect(s.change).toBe('higher');
  });
});

describe('question tokens', () => {
  it('round-trip, and reject junk', () => {
    const q = { target: { kind: 'item' as const, key: 'opt_abc123' }, direction: 'before' as const, range: '365d' as const };
    const t = encodeSpecToken(q);
    expect(decodeSpecToken(t)?.success).toBe(true);
    expect(decodeSpecToken('not base64 !!')).toBeNull();
    expect(decodeSpecToken(Buffer.from('{"target":{"kind":"evil"}}').toString('base64url'))?.success).toBe(false);
  });

  it('compact output for the AI keeps counts and the not-proof note', () => {
    const q = { target: { kind: 'item' as const, key: 'opt_weak' }, direction: 'before' as const, range: '365d' as const };
    const res = explore(history({ days: 180, seed: 101, plant: { exposure: 'dairy', lag: 1, rate: 0.6 } }), q, lookup);
    const c = compactExplore(res, q);
    expect(JSON.stringify(c).length).toBeLessThan(12000);
    expect(String(c.note)).toMatch(/do not show that one thing causes another/);
    expect((c.standsOut as Array<{ counts: string }>)[0].counts).toMatch(/^weak on \d+ of \d+ days with dairy, vs \d+ of \d+ other days$/);
  });
});
