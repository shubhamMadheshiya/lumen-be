/**
 * Runs the early-warning engine for one member and keeps the result and their feedback in sync.
 * Reads the day table and flare episodes exactly as insightEngine.ts does; call this from the same
 * nightly/on-demand analysis so the warning is never more stale than the rest of Insights.
 */
import mongoose from 'mongoose';
import { EarlyWarningState } from '../../models/EarlyWarningState';
import { FlareEpisode } from '../../models/FlareEpisode';
import { DayRow } from './dayTable';
import { runEarlyWarningEngine } from './earlyWarningEngine';

export type FeedbackAction = 'helpful' | 'not_this_time' | 'stop';
/** "Not this time" moves the bar to roughly this percentile; two "Stop" taps disable the feature. */
const RAISED_PERCENTILE = 0.97;
const STOP_TAPS_TO_DISABLE = 2;

export async function runAndStoreEarlyWarning(userId: string, rows: DayRow[]): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);
  const existing = await EarlyWarningState.findOne({ userId: uid }).lean();
  if (existing?.disabledByMember) return; // the member asked to stop; leave their last state as is

  const episodes = await FlareEpisode.find({ userId: uid }).select('startDay endDay source confirmed').lean();
  const result = runEarlyWarningEngine(rows, episodes, { percentileOverride: existing?.percentileOverride });

  await EarlyWarningState.updateOne(
    { userId: uid },
    {
      $set: {
        enabledLevel: result.enabledLevel,
        alert: result.alert,
        alertLevel: result.alertLevel,
        suppressedByFlare: result.suppressedByFlare,
        level1Enabled: result.level1.enabled,
        level1GateReason: result.level1.gateReason ?? null,
        episodeCount: result.level1.episodeCount,
        loggedDays: result.level1.loggedDays,
        backtest: result.level1.backtest,
        trackRecordFollowed: result.level1.trackRecord?.followed ?? null,
        trackRecordOf: result.level1.trackRecord?.of ?? null,
        computedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function applyEarlyWarningFeedback(userId: string, action: FeedbackAction): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);
  if (action === 'helpful') return; // nothing to change; this is just a thumbs-up for our own records

  if (action === 'not_this_time') {
    await EarlyWarningState.updateOne({ userId: uid }, { $set: { percentileOverride: RAISED_PERCENTILE } }, { upsert: true });
    return;
  }

  const doc = await EarlyWarningState.findOneAndUpdate(
    { userId: uid },
    { $inc: { stopTaps: 1 } },
    { upsert: true, new: true },
  );
  if ((doc?.stopTaps ?? 0) >= STOP_TAPS_TO_DISABLE) {
    await EarlyWarningState.updateOne({ userId: uid }, { $set: { disabledByMember: true, alert: false } });
  }
}
