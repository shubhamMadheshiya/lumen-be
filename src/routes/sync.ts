/**
 * Offline sync endpoint.
 * The mobile app pushes batched changes (logs + config) and pulls changes since a timestamp.
 * Strategy: last-write-wins by updatedAt. Conflicts are logged but not rejected.
 */
import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { LogEntry } from '../models/LogEntry';
import { Category } from '../models/Category';
import { Question } from '../models/Question';
import { Option } from '../models/Option';
import { QuickAction } from '../models/QuickAction';
import { Reminder } from '../models/Reminder';
import { ActivitySession } from '../models/ActivitySession';
import { User } from '../models/User';

export const syncRouter = Router();
syncRouter.use(authenticate);

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

// POST /sync/push
syncRouter.post('/push', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const {
      logs = [],
      activitySessions = [],
      reminders = [],
      configChanges = {},
    } = req.body as {
      logs?: Array<Record<string, unknown>>;
      activitySessions?: Array<Record<string, unknown>>;
      reminders?: Array<Record<string, unknown>>;
      configChanges?: {
        categories?: Array<Record<string, unknown>>;
        questions?: Array<Record<string, unknown>>;
        options?: Array<Record<string, unknown>>;
        quickActions?: Array<Record<string, unknown>>;
      };
    };

    const results: Record<string, unknown[]> = {
      logs: [],
      activitySessions: [],
      reminders: [],
      configChanges: [],
    };

    // ── Sync logs ─────────────────────────────
    for (const entry of logs) {
      const clientId = entry.clientId as string;
      const updatedAt = entry.updatedAt ? new Date(entry.updatedAt as string) : new Date();
      const deletedAt = entry.deletedAt ? new Date(entry.deletedAt as string) : undefined;

      const existing = await LogEntry.findOne({ userId, clientId });

      if (existing) {
        if (!existing.updatedAt || updatedAt > existing.updatedAt) {
          if (deletedAt) {
            existing.deletedAt = deletedAt;
          } else {
            Object.assign(existing, entry);
          }
          await existing.save();
          results.logs.push({ clientId, status: 'updated' });
        } else {
          results.logs.push({ clientId, status: 'skipped_older' });
        }
      } else {
        await LogEntry.create({ ...entry, userId, loggedAt: new Date() });
        results.logs.push({ clientId, status: 'created' });
      }
    }

    // ── Sync activity sessions ────────────────
    for (const session of activitySessions) {
      const clientId = session.clientId as string;
      if (!clientId) continue;
      const updatedAt = session.updatedAt ? new Date(session.updatedAt as string) : new Date();

      const existing = await ActivitySession.findOne({ userId, clientId });
      if (existing) {
        if (!existing.updatedAt || updatedAt > existing.updatedAt) {
          Object.assign(existing, session);
          await existing.save();
          results.activitySessions.push({ clientId, status: 'updated' });
        } else {
          results.activitySessions.push({ clientId, status: 'skipped_older' });
        }
      } else {
        await ActivitySession.create({ ...session, userId });
        results.activitySessions.push({ clientId, status: 'created' });
      }
    }

    // ── Sync reminders ────────────────────────
    for (const rem of reminders) {
      const clientId = rem.clientId as string;
      const id = rem._id as string;
      const query = clientId ? { userId, clientId } : { userId, _id: id };
      const updatedAt = rem.updatedAt ? new Date(rem.updatedAt as string) : new Date();

      const existing = await Reminder.findOne(query);
      if (existing) {
        if (!existing.updatedAt || updatedAt > existing.updatedAt) {
          Object.assign(existing, rem);
          await existing.save();
          results.reminders.push({ id: existing._id, status: 'updated' });
        } else {
          results.reminders.push({ id: existing._id, status: 'skipped_older' });
        }
      } else {
        const created = await Reminder.create({ ...rem, userId });
        results.reminders.push({ id: created._id, status: 'created' });
      }
    }

    // ── Sync config changes ───────────────────
    const models = [
      { name: 'categories',   Model: Category  },
      { name: 'questions',    Model: Question  },
      { name: 'options',      Model: Option    },
      { name: 'quickActions', Model: QuickAction },
    ] as const;

    for (const { name, Model } of models) {
      const items = (configChanges as Record<string, Array<Record<string, unknown>>>)[name] || [];
      for (const item of items) {
        if (!item._id) continue;
        const model = Model as mongoose.Model<any>;
        const existing = await model.findOne({
          _id: item._id as string,
          userId,
        });
        if (existing) {
          const itemDate = item.updatedAt ? new Date(item.updatedAt as string) : new Date(0);
          const existingDate = (existing as unknown as { updatedAt?: Date }).updatedAt ?? new Date(0);
          if (itemDate > existingDate) {
            await model.updateOne(
              { _id: item._id as string, userId },
              { ...item, userId },
            );
            results.configChanges.push({ id: item._id, type: name, status: 'updated' });
          } else {
            results.configChanges.push({ id: item._id, type: name, status: 'skipped_older' });
          }
        } else {
          await model.create({ ...item, userId });
          results.configChanges.push({ id: item._id, type: name, status: 'created' });
        }
      }
    }

    // Bump configVersion if any config changed
    if (results.configChanges.length > 0) {
      await User.findByIdAndUpdate(userId, { $inc: { configVersion: 1 } });
    }

    res.json({ success: true, data: results });
  } catch (err) { next(err); }
});

// GET /sync/pull?since=<ISO datetime>
syncRouter.get('/pull', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const since = req.query.since ? new Date(req.query.since as string) : new Date(0);

    const [logs, categories, questions, options, quickActions, reminders, activitySessions, user] = await Promise.all([
      LogEntry.find({ userId, updatedAt: { $gt: since } }).limit(1000),
      Category.find({ userId, updatedAt: { $gt: since } }),
      Question.find({ userId, updatedAt: { $gt: since } }),
      Option.find({ userId, updatedAt: { $gt: since } }),
      QuickAction.find({ userId, updatedAt: { $gt: since } }),
      Reminder.find({ userId, updatedAt: { $gt: since } }),
      ActivitySession.find({ userId, updatedAt: { $gt: since } }).limit(500),
      User.findById(userId).select('configVersion'),
    ]);

    res.json({
      success: true,
      data: {
        configVersion: user?.configVersion ?? 1,
        logs,
        activitySessions,
        reminders,
        configChanges: { categories, questions, options, quickActions },
        pulledAt: new Date(),
      },
    });
  } catch (err) { next(err); }
});

