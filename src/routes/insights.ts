import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { InsightResult } from '../models/InsightResult';
import { LogEntry } from '../models/LogEntry';
import { computeInsights } from '../services/insightService';
import { buildDescriptiveStats, presentInsights } from '../services/insightPresenter';

export const insightsRouter = Router();
insightsRouter.use(authenticate);

const DAYS_NEEDED = 14;
const FIRST_COMPUTE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** When each member last had an on-demand first analysis, so an empty result is not recomputed on every visit. */
const lastAutoCompute = new Map<string, number>();

// GET /insights - cached pattern results plus descriptive stats, in the shape the app shows
insightsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId!);

    const firstEntry = await LogEntry.findOne({ userId, deletedAt: { $exists: false } }).sort({ occurredAt: 1 });
    if (!firstEntry) {
      return res.json({ success: true, data: { ready: false, reason: 'no_data', daysOfData: 0, daysNeeded: DAYS_NEEDED, insights: [], stats: [] } });
    }

    const daysOfData = Math.max(0, Math.floor((Date.now() - firstEntry.occurredAt.getTime()) / 86400000));
    if (daysOfData < DAYS_NEEDED) {
      return res.json({
        success: true,
        data: {
          ready: false,
          reason: 'insufficient_data',
          daysOfData,
          daysRecorded: daysOfData,
          daysNeeded: DAYS_NEEDED,
          insights: [],
          stats: [],
        },
      });
    }

    let stored = await InsightResult.find({ userId }).sort({ computedAt: -1 }).limit(100);

    // The nightly job is the usual source. A member who just passed 14 days has nothing cached yet,
    // so analyse once now instead of showing an empty page until 03:00 UTC.
    const key = String(userId);
    if (stored.length === 0 && Date.now() - (lastAutoCompute.get(key) ?? 0) > FIRST_COMPUTE_COOLDOWN_MS) {
      lastAutoCompute.set(key, Date.now());
      await computeInsights(key).catch(err => console.error('[insights] first compute error:', err));
      stored = await InsightResult.find({ userId }).sort({ computedAt: -1 }).limit(100);
    }

    const [insights, stats] = await Promise.all([presentInsights(stored), buildDescriptiveStats(key)]);
    res.json({
      success: true,
      data: {
        ready: true,
        daysOfData,
        lastComputedAt: stored[0] ? stored[0].computedAt.toISOString() : undefined,
        insights,
        stats,
      },
    });
  } catch (err) { next(err); }
});

// POST /insights/recompute - analyse now; responds when the new results are stored
insightsRouter.post('/recompute', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await computeInsights(req.userId!);
    res.json({ success: true, message: 'Insights updated.' });
  } catch (err) { next(err); }
});
