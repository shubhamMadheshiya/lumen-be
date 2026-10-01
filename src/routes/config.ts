/**
 * /config — user's full config + CRUD for every configurable entity.
 * All mutations bump the user's configVersion.
 */
import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../utils/errors';
import { User } from '../models/User';
import { Category, ICategoryDoc } from '../models/Category';
import { Question, IQuestionDoc } from '../models/Question';
import { Option, IOptionDoc } from '../models/Option';
import { QuickAction, IQuickActionDoc } from '../models/QuickAction';
import { CustomUnit } from '../models/CustomUnit';
import { Medication } from '../models/Medication';
import { Reminder } from '../models/Reminder';
import { LogEntry } from '../models/LogEntry';
import {
  CreateCategorySchema, UpdateCategorySchema,
  CreateQuestionSchema, UpdateQuestionSchema,
  CreateOptionSchema, UpdateOptionSchema,
  CreateQuickActionSchema, UpdateQuickActionSchema,
  CreateCustomUnitSchema,
  CreateMedicationSchema,
  CreateReminderSchema,
  ReorderSchema,
} from '../shared';

export const configRouter = Router();
configRouter.use(authenticate);

// ── Helper to bump configVersion ──────────────

async function bumpConfig(userId: string): Promise<void> {
  await User.findByIdAndUpdate(userId, { $inc: { configVersion: 1 } });
}

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

// ═══════════════════════════════════════════════
//  GET /config — full config payload
// ═══════════════════════════════════════════════
configRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const [user, categories, questions, options, quickActions, customUnits] = await Promise.all([
      User.findById(userId).select('configVersion'),
      Category.find({ userId }).sort({ order: 1 }),
      Question.find({ userId }).sort({ order: 1 }),
      Option.find({ userId }).sort({ order: 1 }),
      QuickAction.find({ userId }).sort({ order: 1 }),
      CustomUnit.find({ userId }).sort({ symbol: 1 }),
    ]);
    res.json({
      success: true,
      data: { configVersion: user?.configVersion ?? 1, categories, questions, options, quickActions, customUnits },
    });
  } catch (err) { next(err); }
});

// ── Config export / import ────────────────────

configRouter.get('/export', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const [categories, questions, options, quickActions, customUnits] = await Promise.all([
      Category.find({ userId }),
      Question.find({ userId }),
      Option.find({ userId }),
      QuickAction.find({ userId }),
      CustomUnit.find({ userId }),
    ]);
    res.json({ success: true, data: { categories, questions, options, quickActions, customUnits, exportedAt: new Date() } });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
//  CATEGORIES
// ═══════════════════════════════════════════════

configRouter.post('/categories', validate(CreateCategorySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const count = await Category.countDocuments({ userId });
    const doc = await Category.create({ ...req.body, userId, order: req.body.order ?? count });
    await bumpConfig(req.userId!);
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.get('/categories', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const docs = await Category.find({ userId: uid(req) }).sort({ order: 1 });
    res.json({ success: true, data: docs });
  } catch (err) { next(err); }
});

configRouter.patch('/categories/:id', validate(UpdateCategorySchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Category.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      req.body,
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.post('/categories/:id/archive', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Category.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { isActive: false, archivedAt: new Date() },
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.post('/categories/:id/unarchive', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Category.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { isActive: true, $unset: { archivedAt: 1 } },
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.delete('/categories/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const catId = req.params.id;
    const cat = await Category.findOne({ _id: catId, userId });
    if (!cat) throw AppError.notFound();

    // Check if any log entries exist for this category or its child questions
    const questionIds = (await Question.find({ categoryId: catId, userId })).map(q => q._id);
    const logCount = await LogEntry.countDocuments({
      userId,
      $or: [
        { categoryId: catId },
        { questionId: { $in: questionIds } },
      ],
    });

    if (logCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot permanently delete "${cat.name}": it has ${logCount} logged tracking entries. To preserve your historical tracking data, keep it archived instead.`,
        hasLogs: true,
        logCount,
      });
    }

    // Safe to delete: remove child options, child questions, and category
    await Option.deleteMany({ questionId: { $in: questionIds }, userId });
    await Question.deleteMany({ categoryId: catId, userId });
    await Category.findOneAndDelete({ _id: catId, userId });
    await bumpConfig(req.userId!);

    res.json({ success: true, message: `Category "${cat.name}" deleted permanently.` });
  } catch (err) { next(err); }
});

configRouter.patch('/categories/reorder', validate(ReorderSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body as { ids: string[] };
    await Promise.all(ids.map((id, i) => Category.updateOne({ _id: id, userId: uid(req) }, { order: i })));
    await bumpConfig(req.userId!);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
//  QUESTIONS
// ═══════════════════════════════════════════════

configRouter.post('/questions', validate(CreateQuestionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const count = await Question.countDocuments({ userId, categoryId: req.body.categoryId });
    const doc = await Question.create({ ...req.body, userId, order: req.body.order ?? count, version: 1 });
    await bumpConfig(req.userId!);
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.get('/questions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const filter: Record<string, unknown> = { userId: uid(req) };
    if (req.query.categoryId) filter.categoryId = req.query.categoryId;
    const docs = await Question.find(filter).sort({ order: 1 });
    res.json({ success: true, data: docs });
  } catch (err) { next(err); }
});

configRouter.patch('/questions/:id', validate(UpdateQuestionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const update = { ...req.body, $inc: { version: 1 } };
    const doc = await Question.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      update,
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.post('/questions/:id/archive', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Question.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { isActive: false, archivedAt: new Date() },
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.post('/questions/:id/unarchive', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Question.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { isActive: true, $unset: { archivedAt: 1 } },
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.delete('/questions/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const qId = req.params.id;
    const question = await Question.findOne({ _id: qId, userId });
    if (!question) throw AppError.notFound();

    const optionIds = (await Option.find({ questionId: qId, userId })).map(o => o._id);
    const logCount = await LogEntry.countDocuments({
      userId,
      $or: [
        { questionId: qId },
        { 'answers.optionId': { $in: optionIds } },
      ],
    });

    if (logCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot permanently delete "${question.title}": it has ${logCount} logged tracking entries. Please keep it archived instead.`,
        hasLogs: true,
        logCount,
      });
    }

    await Option.deleteMany({ questionId: qId, userId });
    await Question.findOneAndDelete({ _id: qId, userId });
    await bumpConfig(req.userId!);

    res.json({ success: true, message: `Question "${question.title}" deleted permanently.` });
  } catch (err) { next(err); }
});

configRouter.patch('/questions/reorder', validate(ReorderSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body as { ids: string[] };
    await Promise.all(ids.map((id, i) => Question.updateOne({ _id: id, userId: uid(req) }, { order: i })));
    await bumpConfig(req.userId!);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
//  OPTIONS
// ═══════════════════════════════════════════════

configRouter.post('/options', validate(CreateOptionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const count = await Option.countDocuments({ userId, questionId: req.body.questionId });
    const doc = await Option.create({ ...req.body, userId, order: req.body.order ?? count });
    await bumpConfig(req.userId!);
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.get('/options', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const filter: Record<string, unknown> = { userId: uid(req) };
    if (req.query.questionId) filter.questionId = req.query.questionId;
    const docs = await Option.find(filter).sort({ order: 1 });
    res.json({ success: true, data: docs });
  } catch (err) { next(err); }
});

configRouter.patch('/options/:id', validate(UpdateOptionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Bump version on owning question when options change
    const existing = await Option.findOne({ _id: req.params.id, userId: uid(req) });
    if (!existing) throw AppError.notFound();

    await Question.updateOne({ _id: existing.questionId, userId: uid(req) }, { $inc: { version: 1 } });

    const doc = await Option.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      req.body,
      { new: true },
    );
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.post('/options/:id/archive', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Option.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { isActive: false, archivedAt: new Date() },
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.post('/options/:id/unarchive', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await Option.findOne({ _id: req.params.id, userId: uid(req) });
    if (!existing) throw AppError.notFound();

    await Question.updateOne({ _id: existing.questionId, userId: uid(req) }, { $inc: { version: 1 } });
    const doc = await Option.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { isActive: true, $unset: { archivedAt: 1 } },
      { new: true },
    );
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.delete('/options/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const optId = req.params.id;
    const option = await Option.findOne({ _id: optId, userId });
    if (!option) throw AppError.notFound();

    const logCount = await LogEntry.countDocuments({
      userId,
      'answers.optionId': optId,
    });

    if (logCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot permanently delete "${option.label}": it has ${logCount} logged tracking entries. Please keep it archived instead.`,
        hasLogs: true,
        logCount,
      });
    }

    await Question.updateOne({ _id: option.questionId, userId }, { $inc: { version: 1 } });
    await Option.findOneAndDelete({ _id: optId, userId });
    await bumpConfig(req.userId!);

    res.json({ success: true, message: `Option "${option.label}" deleted permanently.` });
  } catch (err) { next(err); }
});

configRouter.patch('/options/reorder', validate(ReorderSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body as { ids: string[] };
    await Promise.all(ids.map((id, i) => Option.updateOne({ _id: id, userId: uid(req) }, { order: i })));
    await bumpConfig(req.userId!);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
//  QUICK ACTIONS
// ═══════════════════════════════════════════════

configRouter.post('/quick-actions', validate(CreateQuickActionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const count = await QuickAction.countDocuments({ userId });
    const doc = await QuickAction.create({ ...req.body, userId, order: req.body.order ?? count });
    await bumpConfig(req.userId!);
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.get('/quick-actions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const docs = await QuickAction.find({ userId: uid(req) }).sort({ order: 1 });
    res.json({ success: true, data: docs });
  } catch (err) { next(err); }
});

configRouter.patch('/quick-actions/:id', validate(UpdateQuickActionSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await QuickAction.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      req.body,
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.post('/quick-actions/:id/archive', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await QuickAction.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { isVisible: false, archivedAt: new Date() },
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.post('/quick-actions/:id/unarchive', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await QuickAction.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      { isVisible: true, $unset: { archivedAt: 1 } },
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    await bumpConfig(req.userId!);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.delete('/quick-actions/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const qaId = req.params.id;
    const action = await QuickAction.findOne({ _id: qaId, userId });
    if (!action) throw AppError.notFound();

    const logCount = await LogEntry.countDocuments({
      userId,
      quickActionId: qaId,
    });

    if (logCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot permanently delete "${action.label}": it has ${logCount} logged tracking entries. Please keep it archived instead.`,
        hasLogs: true,
        logCount,
      });
    }

    await QuickAction.findOneAndDelete({ _id: qaId, userId });
    await bumpConfig(req.userId!);

    res.json({ success: true, message: `Quick action "${action.label}" deleted permanently.` });
  } catch (err) { next(err); }
});

configRouter.patch('/quick-actions/reorder', validate(ReorderSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body as { ids: string[] };
    await Promise.all(ids.map((id, i) => QuickAction.updateOne({ _id: id, userId: uid(req) }, { order: i })));
    await bumpConfig(req.userId!);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
//  CUSTOM UNITS
// ═══════════════════════════════════════════════

configRouter.post('/units', validate(CreateCustomUnitSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await CustomUnit.create({ ...req.body, userId: uid(req) });
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.get('/units', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const docs = await CustomUnit.find({ userId: uid(req) }).sort({ symbol: 1 });
    res.json({ success: true, data: docs });
  } catch (err) { next(err); }
});

configRouter.delete('/units/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await CustomUnit.findOneAndDelete({ _id: req.params.id, userId: uid(req) });
    if (!doc) throw AppError.notFound();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
//  MEDICATIONS
// ═══════════════════════════════════════════════

configRouter.post('/medications', validate(CreateMedicationSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Medication.create({ ...req.body, userId: uid(req) });
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.get('/medications', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const docs = await Medication.find({ userId: uid(req) }).sort({ name: 1 });
    res.json({ success: true, data: docs });
  } catch (err) { next(err); }
});

configRouter.patch('/medications/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Medication.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      req.body,
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.delete('/medications/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Medication.findOneAndDelete({ _id: req.params.id, userId: uid(req) });
    if (!doc) throw AppError.notFound();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
//  REMINDERS
// ═══════════════════════════════════════════════

configRouter.post('/reminders', validate(CreateReminderSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Reminder.create({ ...req.body, userId: uid(req) });
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.get('/reminders', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const docs = await Reminder.find({ userId: uid(req) });
    res.json({ success: true, data: docs });
  } catch (err) { next(err); }
});

configRouter.patch('/reminders/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Reminder.findOneAndUpdate(
      { _id: req.params.id, userId: uid(req) },
      req.body,
      { new: true },
    );
    if (!doc) throw AppError.notFound();
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
});

configRouter.delete('/reminders/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await Reminder.findOneAndDelete({ _id: req.params.id, userId: uid(req) });
    if (!doc) throw AppError.notFound();
    res.json({ success: true });
  } catch (err) { next(err); }
});
