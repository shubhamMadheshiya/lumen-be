/**
 * Runs the insight computation nightly for every user who has data.
 * Uses node-cron; runs at 3:00 AM UTC (low-traffic hour).
 */
import cron from 'node-cron';
import { User } from '../models/User';
import { LogEntry } from '../models/LogEntry';
import { computeInsights } from '../services/insightService';

export function startInsightScheduler(): void {
  // Runs every day at 03:00 UTC
  cron.schedule('0 3 * * *', async () => {
    console.log('[scheduler] Running nightly insight computation…');
    try {
      // Find users who have at least one log entry
      const usersWithData = await LogEntry.distinct('userId');
      let processed = 0;
      for (const userId of usersWithData) {
        try {
          await computeInsights(userId.toString());
          processed++;
        } catch (err) {
          console.error(`[scheduler] Error for user ${userId}:`, err);
        }
      }
      console.log(`[scheduler] Insight computation done. Processed ${processed} users.`);
    } catch (err) {
      console.error('[scheduler] Fatal error:', err);
    }
  }, {
    timezone: 'UTC',
  });

  console.log('[scheduler] Insight scheduler registered (runs daily at 03:00 UTC)');
}
