import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../utils/errors';
import { LogEntry } from '../models/LogEntry';
import { CreateLogEntrySchema, BatchLogEntrySchema } from '../shared';
import { z } from 'zod';
import { evaluateRedFlags, mergeFlags, RED_FLAG_CONFIG, FlagEntry, RedFlag } from '../services/safety/redFlags';

export const logsRouter = Router();
logsRouter.use(authenticate);

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

/** "Contact your doctor" flags for entries that were just saved. A failure here never blocks saving. */
async function flagsForNewEntries(userId: mongoose.Types.ObjectId, saved: FlagEntry[]): Promise<RedFlag[]> {
  try {
    if (saved.length === 0) return [];
    const since = new Date(Date.now() - RED_FLAG_CONFIG.freshWindowMs - RED_FLAG_CONFIG.relatedWindowMs);
    const recent = await LogEntry.find({ userId, deletedAt: { $exists: false }, occurredAt: { $gte: since } })
      .select('occurredAt answers').lean();
    return mergeFlags(saved.flatMap(e => evaluateRedFlags(e, recent as FlagEntry[])));
  } catch (err) {
    console.error('[safety] red flag check failed:', err);
    return [];
  }
}

// POST /logs — create a single log entry
logsRouter.post('/', validate(CreateLogEntrySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const body = req.body as z.infer<typeof CreateLogEntrySchema>;

    // Dedup by clientId
    const existing = await LogEntry.findOne({ userId, clientId: body.clientId });
    if (existing) {
      return res.json({ success: true, data: existing, duplicate: true });
    }

    const entry = await LogEntry.create({
      ...body,
      userId,
      loggedAt: new Date(),
    });
    const flags = await flagsForNewEntries(userId, [body]);
    res.status(201).json({ success: true, data: entry, ...(flags.length ? { safety: { flags } } : {}) });
  } catch (err) { next(err); }
});

// POST /logs/batch — create multiple entries (offline sync)
logsRouter.post('/batch', validate(BatchLogEntrySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { entries } = req.body as z.infer<typeof BatchLogEntrySchema>;

    const created: typeof entries = [];
    const results = await Promise.all(entries.map(async (body) => {
      const existing = await LogEntry.findOne({ userId, clientId: body.clientId });
      if (existing) return { clientId: body.clientId, status: 'duplicate', id: existing._id };
      const entry = await LogEntry.create({ ...body, userId, loggedAt: new Date() });
      created.push(body);
      return { clientId: body.clientId, status: 'created', id: entry._id };
    }));

    const flags = await flagsForNewEntries(userId, created);
    res.status(201).json({ success: true, data: results, ...(flags.length ? { safety: { flags } } : {}) });
  } catch (err) { next(err); }
});

// GET /logs
logsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const filter: Record<string, unknown> = { userId, deletedAt: { $exists: false } };

    if (req.query.from)       filter.occurredAt = { $gte: new Date(req.query.from as string) };
    if (req.query.to)         filter.occurredAt = { ...(filter.occurredAt as object || {}), $lte: new Date(req.query.to as string) };
    if (req.query.category)   filter.categoryId = new mongoose.Types.ObjectId(req.query.category as string);
    if (req.query.quickAction)filter.quickActionId = new mongoose.Types.ObjectId(req.query.quickAction as string);

    const limit = Math.min(parseInt(req.query.limit as string || '200', 10), 500);
    const skip  = parseInt(req.query.skip as string || '0', 10);

    const entries = await LogEntry.find(filter)
      .sort({ occurredAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({ success: true, data: entries });
  } catch (err) { next(err); }
});

// GET /logs/:id
logsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const entry = await LogEntry.findOne({ _id: req.params.id, userId: uid(req) });
    if (!entry) throw AppError.notFound();
    res.json({ success: true, data: entry });
  } catch (err) { next(err); }
});

// PATCH /logs/:id
logsRouter.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const entry = await LogEntry.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { ...req.body, updatedAt: new Date() },
      { new: true },
    );
    if (!entry) throw AppError.notFound();
    res.json({ success: true, data: entry });
  } catch (err) { next(err); }
});

// DELETE /logs/:id — soft delete
logsRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const entry = await LogEntry.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { deletedAt: new Date() },
      { new: true },
    );
    if (!entry) throw AppError.notFound();
    res.json({ success: true });
  } catch (err) { next(err); }
});
