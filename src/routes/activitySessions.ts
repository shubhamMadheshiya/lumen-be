import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { ActivitySession } from '../models/ActivitySession';
import { LogEntry } from '../models/LogEntry';
import { DaySession } from '../models/DaySession';

export const activitySessionsRouter = Router();
activitySessionsRouter.use(authenticate);

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

// GET /api/v1/activity-sessions
activitySessionsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { activityType, from, to, limit = 50 } = req.query;

    const query: Record<string, unknown> = { userId };
    if (activityType) query.activityType = activityType;
    if (from || to) {
      query.startTime = {};
      if (from) (query.startTime as Record<string, unknown>).$gte = new Date(from as string);
      if (to) (query.startTime as Record<string, unknown>).$lte = new Date(to as string);
    }

    const sessions = await ActivitySession.find(query)
      .sort({ startTime: -1 })
      .limit(Number(limit));

    res.json({ success: true, data: sessions });
  } catch (err) { next(err); }
});

// POST /api/v1/activity-sessions
activitySessionsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { clientId, activityType = 'WALKING', title, startTime, daySessionId } = req.body;

    // Check for existing session by clientId to prevent duplicates
    if (clientId) {
      const existing = await ActivitySession.findOne({ userId, clientId });
      if (existing) {
        return res.json({ success: true, data: existing });
      }
    }

    const session = await ActivitySession.create({
      userId,
      clientId: clientId || new mongoose.Types.ObjectId().toString(),
      activityType,
      title: title || `${activityType.charAt(0) + activityType.slice(1).toLowerCase()} Session`,
      status: 'ACTIVE',
      startTime: startTime ? new Date(startTime) : new Date(),
      daySessionId,
    });

    res.status(201).json({ success: true, data: session });
  } catch (err) { next(err); }
});

// GET /api/v1/activity-sessions/:id
activitySessionsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const session = await ActivitySession.findOne({ _id: req.params.id, userId });
    if (!session) return res.status(404).json({ success: false, error: 'Activity session not found' });
    res.json({ success: true, data: session });
  } catch (err) { next(err); }
});

// POST /api/v1/activity-sessions/:id/pause
activitySessionsRouter.post('/:id/pause', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { activeDurationSeconds, distanceMeters, steps } = req.body;

    const session = await ActivitySession.findOneAndUpdate(
      { _id: req.params.id, userId },
      {
        $set: {
          status: 'PAUSED',
          ...(activeDurationSeconds !== undefined && { activeDurationSeconds }),
          ...(distanceMeters !== undefined && { distanceMeters }),
          ...(steps !== undefined && { steps }),
        },
      },
      { new: true }
    );

    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    res.json({ success: true, data: session });
  } catch (err) { next(err); }
});

// POST /api/v1/activity-sessions/:id/resume
activitySessionsRouter.post('/:id/resume', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const session = await ActivitySession.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { status: 'ACTIVE' } },
      { new: true }
    );

    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    res.json({ success: true, data: session });
  } catch (err) { next(err); }
});

// POST /api/v1/activity-sessions/:id/stop
activitySessionsRouter.post('/:id/stop', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const {
      endTime,
      totalDurationSeconds,
      activeDurationSeconds,
      distanceMeters,
      steps,
      averageSpeedKmh,
      averagePaceMinPerKm,
      startLatitude,
      startLongitude,
      endLatitude,
      endLongitude,
      routePoints,
      notes,
      createTimelineLog = true,
    } = req.body;

    const end = endTime ? new Date(endTime) : new Date();

    const session = await ActivitySession.findOneAndUpdate(
      { _id: req.params.id, userId },
      {
        $set: {
          status: 'COMPLETED',
          endTime: end,
          totalDurationSeconds: totalDurationSeconds || 0,
          activeDurationSeconds: activeDurationSeconds || 0,
          distanceMeters: distanceMeters || 0,
          steps: steps || 0,
          averageSpeedKmh,
          averagePaceMinPerKm,
          startLatitude,
          startLongitude,
          endLatitude,
          endLongitude,
          routePoints: routePoints || [],
          hasRouteData: Array.isArray(routePoints) && routePoints.length > 0,
          notes,
        },
      },
      { new: true }
    );

    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

    let logEntry = null;
    if (createTimelineLog) {
      // Create unified Timeline LogEntry
      const km = (session.distanceMeters / 1000).toFixed(2);
      const mins = Math.round(session.activeDurationSeconds / 60);

      logEntry = await LogEntry.create({
        userId,
        clientId: new mongoose.Types.ObjectId().toString(),
        source: 'activity',
        activitySessionId: session._id,
        occurredAt: session.startTime,
        loggedAt: new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        note: `${session.title}: ${km} km in ${mins} min${notes ? ` — ${notes}` : ''}`,
        answers: [],
        mediaIds: [],
      });

      session.linkedLogEntryId = logEntry._id as mongoose.Types.ObjectId;
      await session.save();
    }

    res.json({
      success: true,
      data: {
        session,
        logEntry,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/v1/activity-sessions/walking/summary
activitySessionsRouter.get('/walking/summary', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { period = 'week' } = req.query;

    const now = new Date();
    let startDate = new Date();
    if (period === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      startDate.setDate(now.getDate() - 7);
    } else if (period === 'month') {
      startDate.setDate(now.getDate() - 30);
    }

    const sessions = await ActivitySession.find({
      userId,
      activityType: 'WALKING',
      status: 'COMPLETED',
      startTime: { $gte: startDate },
    });

    const totalDistanceMeters = sessions.reduce((acc, s) => acc + (s.distanceMeters || 0), 0);
    const totalDurationSeconds = sessions.reduce((acc, s) => acc + (s.activeDurationSeconds || 0), 0);
    const totalSteps = sessions.reduce((acc, s) => acc + (s.steps || 0), 0);
    const count = sessions.length;

    const avgPace = count > 0 && totalDistanceMeters > 0
      ? (totalDurationSeconds / 60) / (totalDistanceMeters / 1000)
      : 0;

    const avgSpeed = count > 0 && totalDurationSeconds > 0
      ? (totalDistanceMeters / 1000) / (totalDurationSeconds / 3600)
      : 0;

    res.json({
      success: true,
      data: {
        period,
        count,
        totalDistanceMeters,
        totalDistanceKm: Number((totalDistanceMeters / 1000).toFixed(2)),
        totalDurationSeconds,
        totalDurationMinutes: Math.round(totalDurationSeconds / 60),
        totalSteps,
        averagePaceMinPerKm: Number(avgPace.toFixed(2)),
        averageSpeedKmh: Number(avgSpeed.toFixed(2)),
      },
    });
  } catch (err) { next(err); }
});
