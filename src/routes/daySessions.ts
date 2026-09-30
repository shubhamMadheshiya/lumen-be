import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../utils/errors';
import { DaySession } from '../models/DaySession';
import { WakeUpSchema, GoToSleepSchema, UpdateDaySessionSchema } from '@lumen/shared';
import mongoose from 'mongoose';

export const daySessionsRouter = Router();
daySessionsRouter.use(authenticate);

/** Format today's date as YYYY-MM-DD in a given UTC offset, or use the day based on an ISO string. */
function toSessionDate(isoOrNow?: string): string {
  const d = isoOrNow ? new Date(isoOrNow) : new Date();
  return d.toISOString().slice(0, 10);
}

// POST /day-sessions/wake — record wake-up time (once per day session)
daySessionsRouter.post('/wake', validate(WakeUpSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId!);
    const wakeTime = req.body.wakeTime ? new Date(req.body.wakeTime) : new Date();
    const sessionDate = toSessionDate(wakeTime.toISOString());

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
