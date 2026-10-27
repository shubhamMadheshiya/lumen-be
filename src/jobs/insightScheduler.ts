/**
 * Runs the insight computation once a day for every user who has data, 30 minutes after that
 * user's own Day Reset Boundary (04:30 by default) in their own time zone, so fresh results are
 * ready before their morning. The job wakes every hour and picks the users whose boundary just passed.
 */
import cron from 'node-cron';
import { User } from '../models/User';
import { LogEntry } from '../models/LogEntry';
import { computeInsights } from '../services/insightService';
import { DEFAULT_BOUNDARY_HOUR, resolveTimeZone } from '../utils/dayKey';

/** Hour of day (0-23) at `date` in `timeZone`. */
export function localHour(date: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: resolveTimeZone(timeZone), hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).find(p => p.type === 'hour')?.value;
  return Number(h);
}

/** True when this user's boundary hour is the current hour in their zone. */
export function isDueNow(prefs: { timezone?: string; dayBoundaryHour?: number } | undefined, now: Date): boolean {
  const boundary = prefs?.dayBoundaryHour ?? DEFAULT_BOUNDARY_HOUR;
  return localHour(now, prefs?.timezone ?? 'UTC') === boundary;
}

export function startInsightScheduler(): void {
  // Every hour at :30, so "04:30 local" is hit for whichever zone the member is in
  cron.schedule('30 * * * *', async () => {
    try {
      const now = new Date();
      const usersWithData = await LogEntry.distinct('userId');
      const users = await User.find({ _id: { $in: usersWithData } }).select('preferences.timezone preferences.dayBoundaryHour').lean();
      const due = users.filter(u => isDueNow(u.preferences, now));
      if (due.length === 0) return;

      console.log(`[scheduler] Running insight computation for ${due.length} user(s)…`);
      let processed = 0;
      for (const u of due) {
        try {
          await computeInsights(String(u._id));
          processed++;
        } catch (err) {
          console.error(`[scheduler] Error for user ${u._id}:`, err);
        }
      }
      console.log(`[scheduler] Insight computation done. Processed ${processed} users.`);
    } catch (err) {
      console.error('[scheduler] Fatal error:', err);
    }
  }, {
    timezone: 'UTC',
  });

  console.log('[scheduler] Insight scheduler registered (hourly check; runs 30 min after each member\'s day boundary)');
}
