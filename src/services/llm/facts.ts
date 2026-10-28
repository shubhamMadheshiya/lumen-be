/**
 * Turns already-computed, already-validated results (a finding, the progress trend, the
 * early-warning state) into `InsightFact[]` — the only thing the LLM narration layer is allowed
 * to see. Nothing here reads raw log entries, free-text notes or database ids.
 */
import crypto from 'crypto';
import type { FindingDto, ProgressDto, DescriptiveStatDto } from '../insightPresenter';
import type { InsightFact, FactKind } from './types';

function randomFactId(): string {
  return `f_${crypto.randomBytes(4).toString('hex')}`;
}

function fact(kind: FactKind, text: string, labels: string[] = []): InsightFact {
  const numbers = Array.from(text.matchAll(/\d+(\.\d+)?/g)).map(m => Number(m[0]));
  return { id: randomFactId(), kind, text, numbers, labels };
}

export interface WarningStateLike {
  alert: boolean;
  alertLevel: 0 | 1 | null;
  level1Enabled: boolean;
  episodeCount: number;
  loggedDays: number;
  trackRecordFollowed: number | null;
  trackRecordOf: number | null;
}

export function factsForFinding(finding: FindingDto): InsightFact[] {
  const exposure = finding.exposure.optionLabel;
  const outcome = finding.outcome.optionLabel;
  const { exposedWith, exposedTotal, otherWith, otherTotal } = finding.counts;
  const when = finding.lagDays <= 0 ? 'the same day as' : finding.lagDays === 1 ? 'the day after' : `${finding.lagDays} days after`;
  return [
    fact('rate', `${exposedWith} of ${exposedTotal} days ${when} ${exposure}, ${outcome} was logged.`, [exposure, outcome]),
    fact('rate', `On other days, ${outcome} was logged on ${otherWith} of ${otherTotal} days.`, [outcome]),
    fact('tier', `This pattern is currently rated "${finding.tier}" (possible or consistent, based on how often it repeats).`),
    fact('label', `The two things being compared are "${exposure}" and "${outcome}".`, [exposure, outcome]),
  ];
}

export function factsForProgress(progress: ProgressDto): InsightFact[] {
  const facts: InsightFact[] = [
    fact('trend', `The overall trend over the recent weeks is classified as "${progress.trend.state}".`),
    fact('days', `${progress.goodBadDays.good} good days and ${progress.goodBadDays.bad} harder days out of ${progress.goodBadDays.observed} observed days (trailing ${progress.goodBadDays.windowDays}-day window).`),
  ];
  if (progress.trend.estimatedChange !== null) {
    facts.push(fact('count', `The estimated change in severity over the trend window is ${Math.abs(progress.trend.estimatedChange).toFixed(1)} points.`));
  }
  if (progress.recentShift) {
    facts.push(fact('other', `A shift in the ${progress.recentShift.direction === 'up' ? 'worse' : 'better'} direction was recently detected.`));
  }
  return facts;
}

/**
 * The "At a glance" stat cards (days logged, symptom severity, most logged symptom, average
 * sleep, ...). These are the only place sleep, water and similar day-to-day numbers are already
 * computed and verified, so Ask needs them too — otherwise "is my sleep getting better?" has
 * nothing to work from even though Lumen already shows the answer elsewhere on the same screen.
 */
export function factsForStats(stats: DescriptiveStatDto[]): InsightFact[] {
  return stats.map(s => fact('other', `${s.title}: ${s.value}${s.sub ? ` (${s.sub})` : ''}${s.trend ? `, trend ${s.trend}` : ''}.`));
}

export function factsForWarning(state: WarningStateLike): InsightFact[] {
  const facts: InsightFact[] = [
    fact('other', state.alert ? `An early-warning alert is currently active (level ${state.alertLevel}).` : 'No early-warning alert is currently active.'),
  ];
  if (state.level1Enabled && state.trackRecordOf !== null && state.trackRecordFollowed !== null) {
    facts.push(fact('rate', `In the past, a flare followed this kind of alert ${state.trackRecordFollowed} times out of ${state.trackRecordOf}.`));
  }
  facts.push(fact('count', `This is based on ${state.episodeCount} flare episodes and ${state.loggedDays} logged days.`));
  return facts;
}
