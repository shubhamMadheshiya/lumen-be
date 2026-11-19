/**
 * An Explore answer squeezed for Lumen AI: plain counts, tiers and flags, nothing it could
 * mistake for proof. Kept under the attachment size cap.
 */
import type { ExploreResult } from './explore';
import type { ExploreQuestion } from './exploreService';

const lagText = (lag: number | string, direction: 'before' | 'after') => {
  if (lag === 'w3') return direction === 'before' ? 'within the 3 days before' : 'within the 3 days after';
  if (lag === 0) return 'same day';
  return direction === 'before' ? `${lag} day${lag === 1 ? '' : 's'} before` : `${lag} day${lag === 1 ? '' : 's'} after`;
};

export function compactExplore(r: ExploreResult & { range?: { from: string; to: string } }, q: ExploreQuestion): Record<string, unknown> {
  const dir = r.direction;
  return {
    question: {
      target: r.target.label,
      direction: q.target.kind === 'period' ? 'this stretch vs the same number of days before it' : dir === 'before' ? 'what came before it' : 'what followed it',
      range: r.range ?? null,
    },
    targetDays: r.target.days,
    daysWithLogging: r.target.observedDays,
    thingsChecked: r.checkedCount,
    standsOut: r.findings.slice(0, 15).map(f => ({
      item: f.label,
      when: q.target.kind === 'period' ? 'in this stretch vs before' : lagText(f.lag, dir),
      // before: rate of the target after the item vs other days; after: rate of the item after the target vs other days.
      counts: dir === 'before' && q.target.kind !== 'period'
        ? `${r.target.label} on ${f.a} of ${f.a + f.b} days with ${f.label}, vs ${f.c} of ${f.c + f.d} other days`
        : `${f.label} on ${f.a} of ${f.a + f.b} days, vs ${f.c} of ${f.c + f.d} other days`,
      direction: f.way === 'more' ? 'more often' : 'less often',
      strength: f.tier,
      notes: f.flags,
    })),
    numbers: r.numeric.filter(n => n.tier !== 'none').slice(0, 10).map(n => ({
      metric: n.label, unit: n.unit, typicalOnTargetDays: n.medianWith, typicalOtherDays: n.medianOther,
      daysCompared: `${n.nWith} vs ${n.nOther}`, strength: n.tier, when: n.lag === 0 ? 'same day' : dir === 'before' ? 'day before' : 'day after',
    })),
    checkedNoClearDifference: r.unclear.length,
    notEnoughDataYet: r.notEnough.slice(0, 8).map(n => `${n.label} (${n.days} days)`),
    caveats: r.caveats,
    note: 'These are co-occurrence counts from the member\'s own logs. Many things were checked, so a few can look linked by chance; "possible" is weaker than "consistent". They do not show that one thing causes another. Suggest a 6-week experiment (Insights › Test it) or talking it over with their doctor rather than drawing conclusions.',
  };
}
