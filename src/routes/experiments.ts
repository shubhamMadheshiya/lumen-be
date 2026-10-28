/**
 * "Test it for 6 weeks": guided self-experiments. A random 3-with/3-without block order is
 * assigned at creation and never shown to the member in advance, so there is nothing to game.
 */
import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../utils/errors';
import { Experiment, IExperimentDoc } from '../models/Experiment';
import { loadPersistedDayRows } from '../services/insights/dayTableService';
import {
  analyseExperiment, blockWindows, experimentEndDay, experimentProgress, randomBlockOrder,
  tallyBlock, Block, BLOCKS, DEFAULT_WASHOUT_DAYS,
} from '../services/insights/experiments';
import { DEFAULT_BOUNDARY_HOUR, resolveTimeZone, trackingDayKey } from '../utils/dayKey';
import { User } from '../models/User';

export const experimentsRouter = Router();
experimentsRouter.use(authenticate);

const CreateExperimentSchema = z.object({
  exposureKey: z.string().min(1).max(200),
  exposureLabel: z.string().min(1).max(100),
  outcomeKey: z.string().min(1).max(200),
  outcomeLabel: z.string().min(1).max(100),
  startDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  washoutDays: z.number().int().min(0).max(3).default(DEFAULT_WASHOUT_DAYS),
  isMedicineRelated: z.boolean().default(false),
});

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

async function todayFor(userId: string): Promise<string> {
  const user = await User.findById(userId).select('preferences.timezone preferences.dayBoundaryHour').lean();
  const timeZone = resolveTimeZone(user?.preferences?.timezone);
  const boundaryHour = user?.preferences?.dayBoundaryHour ?? DEFAULT_BOUNDARY_HOUR;
  return trackingDayKey(new Date(), timeZone, boundaryHour);
}

async function presentExperiment(doc: IExperimentDoc, today: string, rows: Awaited<ReturnType<typeof loadPersistedDayRows>>) {
  const order = doc.blockOrder as Block[];
  const progress = experimentProgress(doc.startDay, order, today);
  const windows = blockWindows(doc.startDay, order, doc.washoutDays);

  let result = null;
  if (doc.status !== 'abandoned' && progress.readyForAnalysis) {
    const tallies = windows.map(w => tallyBlock(rows, doc.outcomeKey, w.analysisDays));
    result = analyseExperiment(windows, tallies);
  }

  return {
    id: String(doc._id),
    exposureKey: doc.exposureKey, exposureLabel: doc.exposureLabel,
    outcomeKey: doc.outcomeKey, outcomeLabel: doc.outcomeLabel,
    startDay: doc.startDay, endDay: experimentEndDay(doc.startDay),
    washoutDays: doc.washoutDays, isMedicineRelated: doc.isMedicineRelated,
    status: doc.status, progress, result,
  };
}

// POST /experiments - start a new guided experiment
experimentsRouter.post('/', validate(CreateExperimentSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = req.body as z.infer<typeof CreateExperimentSchema>;
    const today = await todayFor(req.userId!);
    const startDay = body.startDay ?? today;

    const active = await Experiment.countDocuments({ userId: uid(req), status: 'active' });
    if (active > 0) {
      throw AppError.badRequest('An experiment is already running. Finish or stop it before starting another.');
    }

    const doc = await Experiment.create({
      userId: uid(req),
      exposureKey: body.exposureKey, exposureLabel: body.exposureLabel,
      outcomeKey: body.outcomeKey, outcomeLabel: body.outcomeLabel,
      startDay, washoutDays: body.washoutDays, isMedicineRelated: body.isMedicineRelated,
      blockOrder: randomBlockOrder(),
      status: 'active',
    });

    const rows = await loadPersistedDayRows(req.userId!);
    res.status(201).json({ success: true, data: await presentExperiment(doc, today, rows) });
  } catch (err) { next(err); }
});

// GET /experiments - every experiment this member has run, most recent first
experimentsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [docs, today, rows] = await Promise.all([
      Experiment.find({ userId: uid(req) }).sort({ createdAt: -1 }),
      todayFor(req.userId!),
      loadPersistedDayRows(req.userId!),
    ]);
    res.json({ success: true, data: await Promise.all(docs.map(d => presentExperiment(d, today, rows))) });
  } catch (err) { next(err); }
});

// GET /experiments/:id
experimentsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Experiment.findOne({ _id: req.params.id, userId: uid(req) });
    if (!doc) throw AppError.notFound();
    const [today, rows] = await Promise.all([todayFor(req.userId!), loadPersistedDayRows(req.userId!)]);
    res.json({ success: true, data: await presentExperiment(doc, today, rows) });
  } catch (err) { next(err); }
});

// PATCH /experiments/:id - end it early ('completed' or 'abandoned')
const UpdateExperimentSchema = z.object({ status: z.enum(['completed', 'abandoned']) });
experimentsRouter.patch('/:id', validate(UpdateExperimentSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Experiment.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req), status: 'active' },
      { status: (req.body as z.infer<typeof UpdateExperimentSchema>).status },
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    const [today, rows] = await Promise.all([todayFor(req.userId!), loadPersistedDayRows(req.userId!)]);
    res.json({ success: true, data: await presentExperiment(doc, today, rows) });
  } catch (err) { next(err); }
});
