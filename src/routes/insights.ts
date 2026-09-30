import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { InsightResult } from '../models/InsightResult';
import { LogEntry } from '../models/LogEntry';
import { computeInsights } from '../services/insightService';

export const insightsRouter = Router();
insightsRouter.use(authenticate);

// GET /insights — return cached insight results
insightsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId!);

    // Check if the user has enough data (14+ days)
    const firstEntry = await LogEntry.findOne({ userId, deletedAt: { $exists: false } }).sort({ occurredAt: 1 });
    if (!firstEntry) {
      return res.json({ success: true, data: { ready: false, reason: 'no_data', insights: [] } });
    }

    const daysSinceFirst = (Date.now() - firstEntry.occurredAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceFirst < 14) {
      return res.json({
        success: true,
        data: {
          ready: false,
          reason: 'insufficient_data',
          daysRecorded: Math.floor(daysSinceFirst),
          daysNeeded: 14,
          insights: [],
        },
      });
    }

    const insights = await InsightResult.find({ userId }).sort({ computedAt: -1 }).limit(100);
    res.json({ success: true, data: { ready: true, insights } });
  } catch (err) { next(err); }
});

// POST /insights/recompute — trigger on demand
insightsRouter.post('/recompute', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Run async — respond immediately, results will be available on next GET
    computeInsights(req.userId!).catch(err =>
      console.error('[insights] recompute error:', err),
    );
    res.json({ success: true, message: 'Insight computation started. Check back in a moment.' });
  } catch (err) { next(err); }
});
