/**
 * Entry point for "analyse this member's logs".
 *
 * The statistics live in services/insights/: logs become one row per Lumen day (dayTable), each
 * exposure is compared with each symptom on days with and without it (dayLevelTests), results are
 * corrected for how many comparisons were made, and a finding only appears after two days of
 * support (tiering). Everything is descriptive: it never says what caused a symptom.
 */
import { rebuildDayTable } from './insights/dayTableService';
import { runInsightEngine } from './insights/insightEngine';
import { runAndStoreEarlyWarning } from './insights/earlyWarningService';

export async function computeInsights(userId: string): Promise<void> {
  // Without a day table there is nothing sound to analyse; keep whatever was shown before
  const built = await rebuildDayTable(userId).catch(err => {
    console.error('[insights] day table error:', err);
    return null;
  });
  if (!built) return;

  const outcome = await runInsightEngine(userId, built);
  if (!outcome.skipped) {
    console.log(`[insights] user ${userId}: ${outcome.eligibleTests} comparisons, showing ${outcome.shown.possible} possible and ${outcome.shown.consistent} consistent`);
  }

  // Early warning reads the same day table; a failure here must not affect the rest of Insights
  await runAndStoreEarlyWarning(userId, built.rows).catch(err => console.error('[insights] early warning error:', err));
}
