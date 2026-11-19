import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../utils/errors';
import { DaySession } from '../models/DaySession';
import { WakeUpSchema, GoToSleepSchema, UpdateDaySessionSchema } from '../shared';
import mongoose from 'mongoose';
import { userDayContext } from '../utils/userDay';
import { upsertSleepRecord } from '../services/sleep/sleepRecord';

export const daySessionsRouter = Router();
daySessionsRouter.use(authenticate);

// POST /day-sessions/wake — record wake-up time (once per Lumen day)
daySessionsRouter.post('/wake', validate(WakeUpSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId!);
    const wakeTime = req.body.wakeTime ? new Date(req.body.wakeTime) : new Date();
    // The Lumen day in the member's own zone and boundary (not the UTC date, which put
    // Indian mornings before 05:30 on the previous day).
    const ctx = await userDayContext(userId);
    const sessionDate = ctx.dayKeyOf(wakeTime);

    // Upsert the session for this date; disallow overwrite if wakeTime already set
    const existing = await DaySession.findOne({ userId, sessionDate });
    if (existing?.wakeTime) {
      throw AppError.conflict('Wake-up already recorded for today. You can edit it via PATCH.');
    }

    const session = await DaySession.findOneAndUpdate(
      { userId, sessionDate },
      {
        $setOnInsert: { userId, sessionDate },
        $set: { wakeTime, wakeEdited: !!(req.body.edited) },
      },
      { upsert: true, new: true },
    );

    // The night that just ended started at the previous session's bedtime. Without one there is
    // no real duration, so no sleep entry is made (it used to invent an 8-hour night).
    try {
      const previous = await DaySession.findOne({ userId, sessionDate: { $lt: sessionDate }, sleepTime: { $exists: true, $ne: null } })
        .sort({ sessionDate: -1 }).lean();
      const bed = previous?.sleepTime ? new Date(previous.sleepTime) : null;
      if (bed && wakeTime.getTime() - bed.getTime() <= 16 * 3600000) {
        await upsertSleepRecord(String(userId), { wakeTime, bedtime: bed, source: 'buttons', daySessionId: session._id as mongoose.Types.ObjectId });
      }
    } catch (err) {
      console.warn('[daySessions] sleep entry not saved:', err);
    }

    res.status(201).json({ success: true, data: session });
  } catch (err) { next(err); }
});

// POST /day-sessions/sleep — record going to bed (once per day session)
daySessionsRouter.post('/sleep', validate(GoToSleepSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId!);
    const sleepTime = req.body.sleepTime ? new Date(req.body.sleepTime) : new Date();

    // Find the most recent session without a sleepTime (i.e. the open day)
    const session = await DaySession.findOne({ userId, sleepTime: { $exists: false } }).sort({ sessionDate: -1 });
    if (!session) {
      throw AppError.badRequest('No open day session found. Tap "I\'m awake" first.');
    }
    if (session.sleepTime) {
      throw AppError.conflict('Bedtime already recorded for this session.');
    }

    session.sleepTime = sleepTime;
    session.sleepEdited = !!(req.body.edited);
    await session.save();

    res.json({ success: true, data: session });
  } catch (err) { next(err); }
});

// PATCH /day-sessions/:id — backfill or correct times
daySessionsRouter.patch('/:id', validate(UpdateDaySessionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId!);
    const session = await DaySession.findOneAndUpdate(
      { _id: req.params.id, userId },
      req.body,
      { new: true },
    );
    if (!session) throw AppError.notFound();
    res.json({ success: true, data: session });
  } catch (err) { next(err); }
});

// GET /day-sessions
daySessionsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId!);
    const filter: Record<string, unknown> = { userId };
    if (req.query.from) filter.sessionDate = { $gte: req.query.from };
    if (req.query.to)   filter.sessionDate = { ...(filter.sessionDate as object || {}), $lte: req.query.to };

    const sessions = await DaySession.find(filter).sort({ sessionDate: -1 }).limit(90);
    res.json({ success: true, data: sessions });
  } catch (err) { next(err); }
});
