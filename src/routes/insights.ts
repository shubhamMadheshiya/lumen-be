import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { InsightResult } from '../models/InsightResult';
import { InsightFinding } from '../models/InsightFinding';
import { InsightRun } from '../models/InsightRun';
import { DayFeature } from '../models/DayFeature';
import { LogEntry } from '../models/LogEntry';
import { User } from '../models/User';
import { computeInsights } from '../services/insightService';
import { buildDescriptiveStats, presentCompare, presentFindings, presentInsights, presentProgress } from '../services/insightPresenter';
import { DEFAULT_BOUNDARY_HOUR, resolveTimeZone } from '../utils/dayKey';
import { DEFAULT_CONFIG } from '../services/insights/insightConfig';
import { loadFlareDayKeys, loadPersistedDayRows, countFlaresInRange } from '../services/insights/dayTableService';
import { classifyTrend, goodBadDays, regimeShifts, weeklyMedians } from '../services/insights/progress';
import { compareAroundEvent, DEFAULT_WASHOUT_DAYS, PRE_WINDOW_DAYS, POST_WINDOW_DAYS } from '../services/insights/beforeAfter';
import { shiftDayKey } from '../utils/dayKey';
import { EarlyWarningState } from '../models/EarlyWarningState';
import { applyEarlyWarningFeedback, FeedbackAction } from '../services/insights/earlyWarningService';
import { z } from 'zod';

export const insightsRouter = Router();
insightsRouter.use(authenticate);

/** Calendar days of logging before the "At a glance" stats appear. */
const DAYS_NEEDED = 14;
/** Days with something logged on both sides of a comparison before patterns can be tested at all. */
const OBSERVED_DAYS_NEEDED = DEFAULT_CONFIG.minPairs;
const FIRST_COMPUTE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** When each member last had an on-demand first analysis, so an empty result is not recomputed on every visit. */
const lastAutoCompute = new Map<string, number>();

// GET /insights - findings (the new shape), descriptive stats, and how close patterns are to being testable.
// `insights` is the older card shape, kept so an app build from before this change keeps working.
insightsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId!);

    const firstEntry = await LogEntry.findOne({ userId, deletedAt: { $exists: false } }).sort({ occurredAt: 1 });
    const empty = { insights: [], findings: [], stats: [], progress: { observedDays: 0, daysNeeded: OBSERVED_DAYS_NEEDED } };
    if (!firstEntry) {
      return res.json({ success: true, data: { ready: false, reason: 'no_data', daysOfData: 0, daysNeeded: DAYS_NEEDED, ...empty } });
    }

    const key = String(userId);
    // The nightly job is the usual source. A first-time member has no analysis yet, so run one now
    // instead of showing an empty page until their next morning.
    if (!(await InsightRun.exists({ userId })) && Date.now() - (lastAutoCompute.get(key) ?? 0) > FIRST_COMPUTE_COOLDOWN_MS) {
      lastAutoCompute.set(key, Date.now());
      await computeInsights(key).catch(err => console.error('[insights] first compute error:', err));
    }

    const [observedDays, storedFindings, stored, lastRun] = await Promise.all([
      DayFeature.countDocuments({ userId, symptomObserved: true }),
      InsightFinding.find({ userId, $or: [{ shownTier: { $ne: 'still_learning' } }, { noLongerSeen: true }] }).lean(),
      InsightResult.find({ userId }).sort({ computedAt: -1 }).limit(100),
      InsightRun.findOne({ userId }).sort({ ranAt: -1 }).lean(),
    ]);
    const progress = { observedDays, daysNeeded: OBSERVED_DAYS_NEEDED, comparisons: lastRun?.eligibleTests ?? 0 };

    const daysOfData = Math.max(0, Math.floor((Date.now() - firstEntry.occurredAt.getTime()) / 86400000));
    if (daysOfData < DAYS_NEEDED) {
      return res.json({
        success: true,
        data: {
          ready: false, reason: 'insufficient_data', daysOfData, daysRecorded: daysOfData, daysNeeded: DAYS_NEEDED,
          insights: [], findings: [], stats: [], progress,
        },
      });
    }

    const user = await User.findById(userId).select('preferences.timezone preferences.dayBoundaryHour').lean();
    const prefs = {
      timeZone: resolveTimeZone(user?.preferences?.timezone),
      boundaryHour: user?.preferences?.dayBoundaryHour ?? DEFAULT_BOUNDARY_HOUR,
    };
    const [insights, findings, stats] = await Promise.all([
      presentInsights(stored),
      presentFindings(storedFindings, DEFAULT_CONFIG.weakShareFlag),
      buildDescriptiveStats(key, new Date(), prefs),
    ]);
    res.json({
      success: true,
      data: {
        ready: true,
        daysOfData,
        lastComputedAt: lastRun ? lastRun.ranAt.toISOString() : stored[0] ? stored[0].computedAt.toISOString() : undefined,
        insights,
        findings,
        stats,
        progress,
      },
    });
  } catch (err) { next(err); }
});

// GET /insights/progress - weekly trend, good/bad-day count, and the latest regime-shift label.
// Reads the day table as it stood at the last analysis; it does not recompute it.
insightsRouter.get('/progress', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const [rows, flareDayKeys] = await Promise.all([loadPersistedDayRows(userId), loadFlareDayKeys(userId)]);
    const trend = classifyTrend(weeklyMedians(rows));
    const gbd = goodBadDays(rows, flareDayKeys);
    const shifts = regimeShifts(rows);
    res.json({ success: true, data: presentProgress(trend, gbd, shifts) });
  } catch (err) { next(err); }
});

// GET /insights/compare?day=YYYY-MM-DD&washoutDays=7 - "did this change help?", before vs after `day`.
insightsRouter.get('/compare', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const day = String(req.query.day ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return res.status(400).json({ success: false, message: 'day must be a YYYY-MM-DD date' });
    }
    const washoutDays = Math.min(60, Math.max(0, parseInt(String(req.query.washoutDays ?? DEFAULT_WASHOUT_DAYS), 10) || DEFAULT_WASHOUT_DAYS));

    const userId = req.userId!;
    const rows = await loadPersistedDayRows(userId);

    // compareAroundEvent counts flares through a synchronous callback; the pre/post windows are
    // fixed once `day` and `washoutDays` are, so both counts are fetched up front.
    const preFrom = shiftDayKey(day, -PRE_WINDOW_DAYS);
    const preTo = shiftDayKey(day, -1);
    const postFrom = shiftDayKey(day, washoutDays);
    const postTo = shiftDayKey(day, washoutDays + POST_WINDOW_DAYS - 1);
    const [preFlares, postFlares] = await Promise.all([
      countFlaresInRange(userId, preFrom, preTo),
      countFlaresInRange(userId, postFrom, postTo),
    ]);
    const countFlares = (from: string) => (from === preFrom ? preFlares : postFlares);

    const result = compareAroundEvent(rows, day, countFlares, washoutDays);
    res.json({ success: true, data: presentCompare(result, day, washoutDays) });
  } catch (err) { next(err); }
});

// POST /insights/recompute - analyse now; responds when the new results are stored
insightsRouter.post('/recompute', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await computeInsights(req.userId!);
    res.json({ success: true, message: 'Insights updated.' });
  } catch (err) { next(err); }
});

// GET /insights/warning - the last computed early-warning state (set by the nightly analysis / recompute)
insightsRouter.get('/warning', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const state = await EarlyWarningState.findOne({ userId: req.userId! }).lean();
    if (!state) {
      return res.json({ success: true, data: { ready: false } });
    }
    res.json({
      success: true,
      data: {
        ready: true,
        enabledLevel: state.enabledLevel,
        alert: state.disabledByMember ? false : state.alert,
        alertLevel: state.disabledByMember ? null : state.alertLevel,
        suppressedByFlare: state.suppressedByFlare,
        disabled: state.disabledByMember,
        level1: {
          enabled: state.level1Enabled,
          gateReason: state.level1GateReason ?? null,
          episodeCount: state.episodeCount,
          loggedDays: state.loggedDays,
          trackRecord: state.trackRecordOf !== null
            ? { followed: state.trackRecordFollowed, of: state.trackRecordOf }
            : null,
        },
        computedAt: state.computedAt?.toISOString(),
      },
    });
  } catch (err) { next(err); }
});

const WarningFeedbackSchema = z.object({ action: z.enum(['helpful', 'not_this_time', 'stop']) });

// POST /insights/warning/feedback - "Helpful / Not this time / Stop these" on the warning card
insightsRouter.post('/warning/feedback', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = WarningFeedbackSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'action must be helpful, not_this_time or stop' });
    await applyEarlyWarningFeedback(req.userId!, parsed.data.action as FeedbackAction);
    res.json({ success: true });
  } catch (err) { next(err); }
});
