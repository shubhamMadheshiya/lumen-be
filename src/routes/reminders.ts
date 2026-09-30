import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { Reminder } from '../models/Reminder';
import { NotificationEvent } from '../models/NotificationEvent';

export const remindersRouter = Router();
remindersRouter.use(authenticate);

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

// GET /api/v1/reminders
remindersRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const reminders = await Reminder.find({ userId, archivedAt: { $exists: false } }).sort({ createdAt: -1 });
    res.json({ success: true, data: reminders });
  } catch (err) { next(err); }
});

// POST /api/v1/reminders
remindersRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const body = req.body;
    
    // If updating by clientId or _id
    if (body.clientId) {
      const existing = await Reminder.findOne({ userId, clientId: body.clientId });
      if (existing) {
        Object.assign(existing, body);
        await existing.save();
        return res.json({ success: true, data: existing });
      }
    }

    const reminder = await Reminder.create({
      ...body,
      userId,
    });
    res.status(201).json({ success: true, data: reminder });
  } catch (err) { next(err); }
});

// GET /api/v1/reminders/:id
remindersRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const reminder = await Reminder.findOne({ _id: req.params.id, userId });
    if (!reminder) return res.status(404).json({ success: false, error: 'Reminder not found' });
    res.json({ success: true, data: reminder });
  } catch (err) { next(err); }
});

// PUT /api/v1/reminders/:id
remindersRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const reminder = await Reminder.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: req.body },
      { new: true }
    );
    if (!reminder) return res.status(404).json({ success: false, error: 'Reminder not found' });
    res.json({ success: true, data: reminder });
  } catch (err) { next(err); }
});

// DELETE /api/v1/reminders/:id
remindersRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const reminder = await Reminder.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { archivedAt: new Date(), enabled: false } },
      { new: true }
    );
    if (!reminder) return res.status(404).json({ success: false, error: 'Reminder not found' });
    res.json({ success: true, data: { archived: true } });
  } catch (err) { next(err); }
});

// POST /api/v1/reminders/:id/enable
remindersRouter.post('/:id/enable', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const reminder = await Reminder.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { enabled: true, isActive: true } },
      { new: true }
    );
    if (!reminder) return res.status(404).json({ success: false, error: 'Reminder not found' });
    res.json({ success: true, data: reminder });
  } catch (err) { next(err); }
});

// POST /api/v1/reminders/:id/disable
remindersRouter.post('/:id/disable', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const reminder = await Reminder.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { enabled: false, isActive: false } },
      { new: true }
    );
    if (!reminder) return res.status(404).json({ success: false, error: 'Reminder not found' });
    res.json({ success: true, data: reminder });
  } catch (err) { next(err); }
});

// POST /api/v1/reminders/:id/snooze
remindersRouter.post('/:id/snooze', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const snoozeMinutes = req.body.snoozeMinutes || 10;
    const rescheduledFor = new Date(Date.now() + snoozeMinutes * 60 * 1000);

    await NotificationEvent.create({
      userId,
      reminderId: req.params.id,
      clientId: req.body.clientId || new mongoose.Types.ObjectId().toString(),
      scheduledFor: rescheduledFor,
      status: 'SNOOZED',
      actionTaken: `SNOOZED_${snoozeMinutes}M`,
    });

    res.json({ success: true, data: { reminderId: req.params.id, rescheduledFor } });
  } catch (err) { next(err); }
});

// POST /api/v1/reminders/:id/event
remindersRouter.post('/:id/event', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const { status, scheduledFor, actionTaken, linkedLogEntryId, clientId } = req.body;

    const event = await NotificationEvent.create({
      userId,
      reminderId: req.params.id,
      clientId: clientId || new mongoose.Types.ObjectId().toString(),
      scheduledFor: scheduledFor ? new Date(scheduledFor) : new Date(),
      triggeredAt: new Date(),
      status: status || 'COMPLETED',
      respondedAt: new Date(),
      actionTaken,
      linkedLogEntryId,
    });

    res.status(201).json({ success: true, data: event });
  } catch (err) { next(err); }
});
