import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { User } from '../models/User';
import { NotificationEvent } from '../models/NotificationEvent';
import {
  getOrCreatePolicy,
  INTELLIGENCE_CAPABILITIES,
  INotificationPolicyDoc,
} from '../models/NotificationPolicy';
import { evaluateFlareMode } from '../services/flareModeService';

export const notificationPolicyRouter = Router();
notificationPolicyRouter.use(authenticate);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const NOTIFICATION_TYPES = ['SAFETY', 'MEDICATION', 'PACING', 'FLARE_RISK', 'TRIGGER_WATCH', 'HYGIENE'];

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

function serialize(p: INotificationPolicyDoc) {
  return {
    masterEnabled: p.masterEnabled,
    dailyBudget: p.dailyBudget,
    quietHours: p.quietHours,
    flareMode: p.flareMode,
    capabilities: p.capabilities,
    mutedUntil: p.mutedUntil ?? null,
    suppressedTypes: p.suppressedTypes,
    careTeamPhone: p.careTeamPhone ?? null,
    safetyConsentAt: p.safetyConsentAt ?? null,
    updatedAt: p.updatedAt,
  };
}

// GET /notification-policy
notificationPolicyRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const policy = await getOrCreatePolicy(uid(req));
    res.json({ success: true, data: serialize(policy) });
  } catch (err) { next(err); }
});

// PUT /notification-policy — partial update of patient-controlled settings
notificationPolicyRouter.put('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const policy = await getOrCreatePolicy(uid(req));
    const b = req.body ?? {};
    const errors: string[] = [];

    if (b.masterEnabled !== undefined) {
      if (typeof b.masterEnabled !== 'boolean') errors.push('masterEnabled must be a boolean');
      else policy.masterEnabled = b.masterEnabled;
    }
    if (b.dailyBudget !== undefined) {
      if (!Number.isInteger(b.dailyBudget) || b.dailyBudget < 1 || b.dailyBudget > 5) {
        errors.push('dailyBudget must be an integer from 1 to 5');
      } else policy.dailyBudget = b.dailyBudget;
    }
    if (b.quietHours !== undefined) {
      const q = b.quietHours;
      if (typeof q?.enabled === 'boolean') policy.quietHours.enabled = q.enabled;
      for (const k of ['start', 'end'] as const) {
        if (q?.[k] !== undefined) {
          if (typeof q[k] !== 'string' || !HHMM.test(q[k])) errors.push(`quietHours.${k} must be HH:mm`);
          else policy.quietHours[k] = q[k];
        }
      }
    }
    if (b.capabilities !== undefined) {
      for (const cap of INTELLIGENCE_CAPABILITIES) {
        const v = b.capabilities?.[cap];
        if (v === undefined) continue;
        if (typeof v !== 'boolean') { errors.push(`capabilities.${cap} must be a boolean`); continue; }
        // Safety alerts need explicit consent, recorded separately.
        if (cap === 'safety' && v && !policy.safetyConsentAt && b.safetyConsent !== true) {
          errors.push('Enabling safety alerts requires safetyConsent: true');
          continue;
        }
        policy.capabilities[cap] = v;
      }
    }
    if (b.safetyConsent === true && !policy.safetyConsentAt) policy.safetyConsentAt = new Date();
    if (b.flareAutoDetect !== undefined) {
      if (typeof b.flareAutoDetect !== 'boolean') errors.push('flareAutoDetect must be a boolean');
      else policy.flareMode.auto = b.flareAutoDetect;
    }
    if (b.mutedUntil !== undefined) {
      if (b.mutedUntil === null) policy.mutedUntil = undefined;
      else if (Number.isNaN(Date.parse(b.mutedUntil))) errors.push('mutedUntil must be an ISO date or null');
      else policy.mutedUntil = new Date(b.mutedUntil);
    }
    if (b.careTeamPhone !== undefined) {
      if (b.careTeamPhone === null || b.careTeamPhone === '') policy.careTeamPhone = undefined;
      else if (typeof b.careTeamPhone !== 'string' || !/^[+\d][\d\s().-]{4,38}$/.test(b.careTeamPhone)) {
        errors.push('careTeamPhone must be a phone number');
      } else policy.careTeamPhone = b.careTeamPhone;
    }
    if (b.suppressedTypes !== undefined) {
      if (!Array.isArray(b.suppressedTypes) || b.suppressedTypes.some((t: unknown) => !NOTIFICATION_TYPES.includes(t as string))) {
        errors.push(`suppressedTypes must be a subset of ${NOTIFICATION_TYPES.join(', ')}`);
      } else {
        // SAFETY and MEDICATION can only be controlled through their own settings.
        policy.suppressedTypes = b.suppressedTypes.filter((t: string) => t !== 'SAFETY' && t !== 'MEDICATION');
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Invalid notification settings', errors });
    }
    await policy.save();
    res.json({ success: true, data: serialize(policy) });
  } catch (err) { next(err); }
});

// POST /notification-policy/flare-mode  { active: boolean } — manual override
notificationPolicyRouter.post('/flare-mode', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (typeof req.body?.active !== 'boolean') {
      return res.status(400).json({ success: false, message: 'active must be a boolean' });
    }
    const policy = await getOrCreatePolicy(uid(req));
    policy.flareMode.active = req.body.active;
    policy.flareMode.source = req.body.active ? 'manual' : undefined;
    policy.flareMode.activatedAt = req.body.active ? new Date() : undefined;
    await policy.save();
    res.json({ success: true, data: serialize(policy) });
  } catch (err) { next(err); }
});

// POST /notification-policy/flare-mode/evaluate — run auto-detection now
notificationPolicyRouter.post('/flare-mode/evaluate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const user = await User.findById(userId).select('preferences.timezone').lean();
    const timeZone = user?.preferences?.timezone || 'UTC';
    const result = await evaluateFlareMode(userId, timeZone);
    const policy = await getOrCreatePolicy(userId);
    res.json({
      success: true,
      data: {
        changed: result.changed,
        state: result.assessment?.state ?? 'skipped',
        policy: serialize(policy),
      },
    });
  } catch (err) { next(err); }
});

// POST /notification-policy/events — record an intelligent notification outcome
notificationPolicyRouter.post('/events', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { notificationType, status, feedback, scheduledFor, actionTaken, clientId } = req.body ?? {};
    if (!NOTIFICATION_TYPES.includes(notificationType)) {
      return res.status(400).json({ success: false, message: 'Unknown notificationType' });
    }
    if (status !== undefined && !['TRIGGERED', 'COMPLETED', 'SNOOZED', 'DISMISSED', 'MISSED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    if (feedback !== undefined && !['helpful', 'not_useful'].includes(feedback)) {
      return res.status(400).json({ success: false, message: 'Invalid feedback' });
    }

    const userId = uid(req);
    const eventClientId = typeof clientId === 'string' && clientId ? clientId : new mongoose.Types.ObjectId().toString();
    // Idempotent per device event so a retried sync cannot double-count against the budget.
    const event = await NotificationEvent.findOneAndUpdate(
      { userId, clientId: eventClientId },
      {
        $set: {
          notificationType,
          status: status ?? 'TRIGGERED',
          ...(feedback ? { feedback } : {}),
          ...(actionTaken ? { actionTaken: String(actionTaken).slice(0, 100) } : {}),
          ...(status && status !== 'TRIGGERED' ? { respondedAt: new Date() } : {}),
        },
        $setOnInsert: {
          userId,
          clientId: eventClientId,
          scheduledFor: scheduledFor && !Number.isNaN(Date.parse(scheduledFor)) ? new Date(scheduledFor) : new Date(),
          triggeredAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
    res.status(201).json({ success: true, data: event });
  } catch (err) { next(err); }
});
