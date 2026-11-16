/**
 * Lumen AI notifications: every 15 minutes, for members with Lumen AI full access, writes and
 * pushes whichever of the morning briefing, midday nudge and evening check-in is due in their own
 * time zone (times are in their notification settings). Separate from the hourly insight job.
 */
import cron from 'node-cron';
import { runDueAiNotifications } from '../services/aiNotify/run';

let running = false;

export function startAiNotificationScheduler(): void {
  cron.schedule('*/15 * * * *', async () => {
    // A slow AI run must never overlap the next tick (it would see the same slot as due).
    if (running) return;
    running = true;
    try {
      const n = await runDueAiNotifications(new Date());
      if (n) console.log(`[ai-notify] Wrote ${n} Lumen AI notification(s).`);
    } catch (err) {
      console.error('[ai-notify] scheduler error:', err);
    } finally {
      running = false;
    }
  });
  console.log('[ai-notify] Lumen AI notification scheduler registered (every 15 min)');
}
