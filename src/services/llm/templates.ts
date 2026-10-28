/**
 * Deterministic plain-language fallback text. This is the default experience — the LLM is an
 * optional upgrade on top of it, used whenever Gemini is unavailable, unconfigured, or its output
 * fails validation (see ./validators.ts).
 */
import type { FindingDto, ProgressDto } from '../insightPresenter';
import type { WarningStateLike } from './facts';

export function templateForFinding(finding: FindingDto): string {
  const exposure = finding.exposure.optionLabel;
  const outcome = finding.outcome.optionLabel;
  const { exposedWith, exposedTotal, otherWith, otherTotal } = finding.counts;
  const when = finding.lagDays <= 0 ? 'the same day as' : finding.lagDays === 1 ? 'the day after' : `${finding.lagDays} days after`;
  const rated = finding.tier === 'consistent' ? 'a pattern that keeps repeating' : 'a pattern worth watching';
  return `In your logs, ${when} "${exposure}", "${outcome}" was logged on ${exposedWith} of ${exposedTotal} days, compared with ${otherWith} of ${otherTotal} other days. Lumen rates this ${rated}. This only shows what happened together in your own logs, not why — it's worth mentioning to your doctor if you're curious.`;
}

export function templateForProgress(progress: ProgressDto): string {
  const words: Record<ProgressDto['trend']['state'], string> = {
    improving: 'Your logs suggest things have been improving over the recent weeks.',
    worsening: 'Your logs suggest things have been harder over the recent weeks.',
    steady: "Your logs have been fairly steady over the recent weeks — no clear change either way.",
    mixed: 'Your logs show a mixed picture over the recent weeks, without a clear single direction.',
    not_enough_data: "There isn't quite enough logged data yet to say how the trend is moving.",
  };
  const gbd = progress.goodBadDays;
  return `${words[progress.trend.state]} Out of ${gbd.observed} observed days, ${gbd.good} were good days and ${gbd.bad} were harder days.`;
}

export function templateForWarning(state: WarningStateLike): string {
  if (!state.alert) return "No early-warning alert is active right now. Lumen will say so here if today's pattern starts to resemble the days before your past flares.";
  const track = state.trackRecordOf ? ` In the past, this kind of alert was followed by a flare ${state.trackRecordFollowed} times out of ${state.trackRecordOf}.` : '';
  return `Today's pattern resembles the days that came before some of your past flares.${track} This is not a diagnosis or a prediction — just a reason to be a bit gentler with yourself today.`;
}

export const ASK_FALLBACK_TEXT = "I can only answer using the patterns Lumen has already found in your own logs, and right now I can't put together a confident answer to that. Try looking at the Insights tab, or rephrase your question around a specific pattern you've seen there.";
