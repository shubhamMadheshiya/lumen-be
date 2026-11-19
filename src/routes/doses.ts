/**
 * Medicine doses: today's checklist, marking a dose Taken / Skipped / Extra, clearing a mark,
 * and adherence over a range. Mounted at /api/v1/medications before the generic medication
 * routes; anything it doesn't handle falls through to them.
 */
import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../utils/errors';
import { Medication } from '../models/Medication';
import { DoseEvent } from '../models/DoseEvent';
import { DoseMarkSchema } from '../shared';
import { userDayContext } from '../utils/userDay';
import { dayKeysBetween, shiftDayKey } from '../utils/dayKey';
import { doseDay, slotStates } from '../services/meds/doses';
import { markDaysDirty } from '../services/analytics/freshness';

export const dosesRouter = Router();
dosesRouter.use(authenticate);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const oid = (req: AuthRequest) => new mongoose.Types.ObjectId(req.userId!);

function hhmmIn(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  } catch { return date.toISOString().slice(11, 16); }
}

// GET /medications/doses?day=YYYY-MM-DD — every medicine's planned doses that day with their marks.
dosesRouter.get('/doses', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = oid(req);
    const ctx = await userDayContext(userId);
    const today = ctx.dayKeyOf(new Date());
    const day = typeof req.query.day === 'string' && DAY.test(req.query.day) ? req.query.day : today;
    const [meds, marks] = await Promise.all([
      Medication.find({ userId }).sort({ name: 1 }).lean(),
      DoseEvent.find({ userId, dayKey: day }).sort({ at: 1 }).lean(),
    ]);
    const now = day === today ? hhmmIn(new Date(), ctx.timeZone) : undefined;
    const items = meds
      .filter(m => (!m.startedOn || m.startedOn <= day) && (!m.stoppedOn || m.stoppedOn >= day) && (m.active || !!m.stoppedOn))
      .map(m => {
        const slots = slotStates(m, marks, day, now);
        const extras = marks.filter(x => String(x.medicationId) === String(m._id) && (x.status === 'extra' || x.slot === 'prn' || x.slot === 'unscheduled'));
        return {
          medicationId: String(m._id), name: m.name, dose: m.dose ?? null, unit: m.unit ?? null, prn: !!m.prn,
          slots: slots.map(s => ({
            slot: s.slot, amount: s.amount ?? null, state: s.state,
            doseId: s.mark ? String((s.mark as { _id?: unknown })._id) : null,
          })),
          extras: extras.map(x => ({ doseId: String(x._id), slot: x.slot, status: x.status, at: x.at })),
          totals: doseDay(m, marks, day),
        };
      })
      .filter(i => i.slots.length > 0 || i.prn || i.extras.length > 0);
    res.json({ success: true, data: { day, today, items } });
  } catch (err) { next(err); }
});

// PUT /medications/:id/doses — mark one dose. The same clientId is the same mark (offline retries
// are safe); a planned slot holds one mark; a stale offline edit never overwrites a newer one.
dosesRouter.put('/:id/doses', validate(DoseMarkSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = oid(req);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw AppError.notFound();
    const body = req.body as z.infer<typeof DoseMarkSchema>;
    const med = await Medication.findOne({ _id: req.params.id, userId }).select('name').lean();
    if (!med) throw AppError.notFound('Medicine not found');
    const ctx = await userDayContext(userId);
    if (body.dayKey > shiftDayKey(ctx.dayKeyOf(new Date()), 1)) throw AppError.badRequest('That day has not happened yet.');

    const clientUpdatedAt = body.clientUpdatedAt ? new Date(body.clientUpdatedAt) : new Date();
    const fields = {
      status: body.status, at: body.at ? new Date(body.at) : new Date(), source: body.source,
      nameSnapshot: med.name, note: body.note, clientUpdatedAt,
    };

    const sameClient = await DoseEvent.findOne({ userId, clientId: body.clientId });
    const repeatable = body.slot === 'prn' || body.status === 'extra';
    const existing = sameClient ?? (repeatable
      ? null
      : await DoseEvent.findOne({ userId, medicationId: med._id, dayKey: body.dayKey, slot: body.slot, status: { $ne: 'extra' } }));
    if (existing) {
      if (existing.clientUpdatedAt && existing.clientUpdatedAt > clientUpdatedAt) {
        return res.json({ success: true, data: existing, stale: true });
      }
      const oldDay = existing.dayKey;
      Object.assign(existing, fields, { dayKey: body.dayKey, slot: body.slot });
      await existing.save();
      if (oldDay !== body.dayKey) await markDaysDirty(String(userId), [oldDay]);
      return res.json({ success: true, data: existing });
    }
    const created = await DoseEvent.create({
      ...fields, userId, medicationId: med._id, dayKey: body.dayKey, slot: body.slot, clientId: body.clientId,
    });
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
});

// DELETE /medications/:id/doses/:doseId — clear a mark (the dose goes back to "not marked").
dosesRouter.delete('/:id/doses/:doseId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.doseId) || !mongoose.Types.ObjectId.isValid(req.params.id)) throw AppError.notFound();
    const gone = await DoseEvent.findOneAndDelete({ _id: req.params.doseId, userId: oid(req), medicationId: req.params.id });
    if (!gone) throw AppError.notFound();
    // A deletion leaves no updatedAt behind, so analytics is told about the day directly.
    await markDaysDirty(String(oid(req)), [gone.dayKey]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /medications/:id/adherence?days=30 — taken / skipped / not marked over the last N days.
dosesRouter.get('/:id/adherence', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = oid(req);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw AppError.notFound();
    const days = Math.max(1, Math.min(365, parseInt(String(req.query.days ?? '30'), 10) || 30));
    const med = await Medication.findOne({ _id: req.params.id, userId }).lean();
    if (!med) throw AppError.notFound();
    const ctx = await userDayContext(userId);
    const to = ctx.dayKeyOf(new Date());
    const from = shiftDayKey(to, -(days - 1));
    const marks = await DoseEvent.find({ userId, medicationId: med._id, dayKey: { $gte: from, $lte: to } }).lean();
    const perDay = dayKeysBetween(from, to).map(d => ({ day: d, ...doseDay(med, marks, d) }));
    const sum = (k: 'scheduled' | 'taken' | 'skipped' | 'unmarked' | 'extra') => perDay.reduce((a, r) => a + r[k], 0);
    const scheduled = sum('scheduled');
    const marked = scheduled - sum('unmarked');
    res.json({
      success: true,
      data: {
        from, to, scheduled, taken: sum('taken'), skipped: sum('skipped'), unmarked: sum('unmarked'), extra: sum('extra'),
        // Share of MARKED planned doses that were taken; unmarked doses are left out, not counted as missed.
        takenShareOfMarked: marked > 0 ? Math.round((Math.min(sum('taken'), marked) / marked) * 1000) / 1000 : null,
        days: perDay,
      },
    });
  } catch (err) { next(err); }
});
