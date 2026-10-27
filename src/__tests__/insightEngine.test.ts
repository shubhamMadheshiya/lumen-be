import { analyseDays, TestResult } from '../services/insights/dayLevelTests';
import { DEFAULT_CONFIG } from '../services/insights/insightConfig';
import { syntheticDays } from '../services/insights/testing/synth';
import { advance, startState } from '../services/insights/tiering';

const findings = (results: TestResult[]) => results.filter(r => r.tier !== 'still_learning');

describe('analyseDays: gates', () => {
  it('stays silent with too little data', () => {
    const rows = syntheticDays({ days: 20, seed: 1 });
    const { results } = analyseDays(rows, DEFAULT_CONFIG);
    expect(findings(results)).toEqual([]);
    expect(results).toEqual([]);
  });

  it('never tests an exposure against itself', () => {
    const rows = syntheticDays({ days: 90, seed: 2 });
    rows.forEach(r => { r.symptoms.push({ key: 'opt_e0', label: 'Same', present: true, max: null }); });
    const { results } = analyseDays(rows, DEFAULT_CONFIG);
    expect(results.some(r => r.exposureKey === r.outcomeKey)).toBe(false);
  });

  it('does not count silent days as symptom-free', () => {
    // Half the days unlogged: pairs only come from days where both were logged
    const rows = syntheticDays({ days: 120, seed: 3, unloggedShare: 0.5 });
    const logged = rows.filter(r => r.symptomObserved).length;
    const { results } = analyseDays(rows, DEFAULT_CONFIG);
    for (const r of results) expect(r.pairs).toBeLessThanOrEqual(logged);
  });
});

describe('analyseDays: false alarms on members with no real link (null suite)', () => {
  it('rarely shows anything for 200 members with 90 days of pure noise', () => {
    let possible = 0;
    let consistent = 0;
    let totalFindings = 0;
    const users = 200;
    for (let seed = 1; seed <= users; seed++) {
      const { results } = analyseDays(syntheticDays({ days: 90, seed: 1000 + seed }), DEFAULT_CONFIG);
      const shown = findings(results);
      totalFindings += shown.length;
      if (shown.length > 0) possible++;
      if (shown.some(r => r.tier === 'consistent')) consistent++;
    }
    // The old engine showed at least one false pattern for every member (about 29 on average)
    console.info(`null suite: ${possible}/${users} members with any finding, ${consistent} with a consistent one, ${totalFindings} findings in total`);
    expect(possible / users).toBeLessThanOrEqual(0.10);
    expect(consistent / users).toBeLessThanOrEqual(0.02);
  });
});

describe('analyseDays: limits when busy logging days lift everything (stress case)', () => {
  it('documents the residual false-alarm rate when the busy-day effect is very strong', () => {
    let any = 0;
    let consistent = 0;
    const users = 100;
    for (let seed = 1; seed <= users; seed++) {
      const { results } = analyseDays(syntheticDays({ days: 90, seed: 3000 + seed, busyStrength: 0.5 }), DEFAULT_CONFIG);
      if (findings(results).length > 0) any++;
      if (results.some(r => r.tier === 'consistent')) consistent++;
    }
    // Matching on how much else was logged removes most, not all, of this confounding. Cards say
    // "linked with", never "causes", and wait two days, because of exactly this limit.
    console.info(`stress suite (busyStrength 0.5): ${any}/${users} members with any finding, ${consistent} consistent`);
    expect(any / users).toBeLessThanOrEqual(0.25);
    expect(consistent / users).toBeLessThanOrEqual(0.08);
  });
});

describe('analyseDays: a real link (planted suite)', () => {
  it('finds a tripled risk the next day for most members with about 120 logged days', () => {
    let found = 0;
    const users = 60;
    for (let seed = 1; seed <= users; seed++) {
      const rows = syntheticDays({
        days: 150, seed: 5000 + seed, symptomRate: 0.25, exposureRate: 0.4, // about 120 logged days
        planted: { exposure: 0, outcome: 0, lag: 1, rr: 3 },
      });
      const { results } = analyseDays(rows, DEFAULT_CONFIG);
      if (findings(results).some(r => r.exposureKey === 'opt_e0' && r.outcomeKey === 'cat_o0' && r.lagDays === 1)) found++;
    }
    console.info(`planted suite: ${found}/${users} members found the planted link`);
    expect(found / users).toBeGreaterThanOrEqual(0.70);
  });

  it('reports the planted link with plain counts and a ratio above 1', () => {
    const rows = syntheticDays({ days: 150, seed: 7, planted: { exposure: 0, outcome: 0, lag: 1, rr: 4 } });
    const { results } = analyseDays(rows, DEFAULT_CONFIG);
    const hit = results.find(r => r.exposureKey === 'opt_e0' && r.outcomeKey === 'cat_o0' && r.lagDays === 1)!;
    expect(hit.a + hit.b + hit.c + hit.d).toBe(hit.pairs);
    expect(hit.shrunkRR).toBeGreaterThan(1.3);
    expect(hit.riskDifference).toBeGreaterThan(0.1);
    expect(hit.tier).not.toBe('still_learning');
  });
});

describe('tier hysteresis', () => {
  it('needs the same tier on two different days before showing it', () => {
    let s = startState('2026-10-01', 'possible');
    expect(s.shown).toBe('still_learning');
    s = advance(s, '2026-10-02', 'possible');
    expect(s.shown).toBe('possible');
  });

  it('does not count two runs on the same day as two confirmations', () => {
    let s = startState('2026-10-01', 'possible');
    s = advance(s, '2026-10-01', 'possible');
    s = advance(s, '2026-10-01', 'possible');
    expect(s.shown).toBe('still_learning');
  });

  it('moves up to the lower of the two recent tiers, and down only after two weaker runs', () => {
    let s = startState('2026-10-01', 'consistent');
    s = advance(s, '2026-10-02', 'possible');
    expect(s.shown).toBe('possible');
    s = advance(s, '2026-10-03', 'consistent');
    expect(s.shown).toBe('possible'); // previous run was only possible
    s = advance(s, '2026-10-04', 'consistent');
    expect(s.shown).toBe('consistent');
    s = advance(s, '2026-10-05', 'still_learning');
    expect(s.shown).toBe('consistent'); // one weak run is not enough
    s = advance(s, '2026-10-06', 'still_learning');
    expect(s.shown).toBe('still_learning');
  });

  it('a weak run after a strong one does not flicker the finding off', () => {
    let s = startState('2026-10-01', 'possible');
    s = advance(s, '2026-10-02', 'possible');
    s = advance(s, '2026-10-03', 'still_learning');
    s = advance(s, '2026-10-04', 'possible');
    expect(s.shown).toBe('possible');
  });
});
