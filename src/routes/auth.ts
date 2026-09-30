import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/User';
import { Category } from '../models/Category';
import { Question } from '../models/Question';
import { Option } from '../models/Option';
import { QuickAction } from '../models/QuickAction';
import { LogEntry } from '../models/LogEntry';
import { DaySession } from '../models/DaySession';
import { InsightResult } from '../models/InsightResult';
import { Media } from '../models/Media';
import { Reminder } from '../models/Reminder';
import { Medication } from '../models/Medication';
import { CustomUnit } from '../models/CustomUnit';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { validate } from '../middleware/validate';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../utils/errors';
import { RegisterSchema, LoginSchema } from '../shared';
import { applyConditionBundle } from '../services/templateService';
import { config } from '../config';

const googleClient = new OAuth2Client();

export const authRouter = Router();

// POST /auth/register
authRouter.post('/register', validate(RegisterSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = req.body as { email: string; password: string; name: string };

    const exists = await User.findOne({ email });
    if (exists) throw AppError.conflict('An account with this email already exists');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, passwordHash, name });

    // Apply the 'general' starter bundle so the user doesn't start empty
    await applyConditionBundle(user.id as string, 'general');

    const accessToken  = signAccessToken(user.id as string);
    const refreshToken = signRefreshToken(user.id as string);

    res.status(201).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: { _id: user._id, email: user.email, name: user.name },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login
authRouter.post('/login', validate(LoginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) throw AppError.unauthorized('Invalid email or password');

    const valid = await user.comparePassword(password);
    if (!valid) throw AppError.unauthorized('Invalid email or password');

    const accessToken  = signAccessToken(user.id as string);
    const refreshToken = signRefreshToken(user.id as string);

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: { _id: user._id, email: user.email, name: user.name, preferences: user.preferences },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh
authRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) throw AppError.badRequest('refreshToken required');

    const { sub } = verifyRefreshToken(refreshToken);
    const user = await User.findById(sub);
    if (!user) throw AppError.unauthorized('User not found');

    const newAccessToken  = signAccessToken(sub);
    const newRefreshToken = signRefreshToken(sub);

    res.json({ success: true, data: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    next(err);
  }
});

// POST /auth/google  — sign in / register with a Google id_token
authRouter.post('/google', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) throw AppError.badRequest('idToken required');

    // Verify the token; audience check is optional if client IDs differ across platforms
    const ticket = await googleClient.verifyIdToken({
      idToken,
      ...(config.google.clientId ? { audience: config.google.clientId } : {}),
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw AppError.unauthorized('Invalid Google token');

    const { sub: googleId, email, name = email.split('@')[0] } = payload;

    // Find by googleId first, then fall back to email (links existing email/password accounts)
    let user = await User.findOne({ googleId }).select('+googleId') as InstanceType<typeof User> | null;
    if (!user) {
      user = await User.findOne({ email: email.toLowerCase() }).select('+googleId') as InstanceType<typeof User> | null;
      if (user) {
        // Link Google to the existing email/password account
        user.googleId = googleId;
        await user.save();
      }
    }

    let isNew = false;
    if (!user) {
      user = await User.create({ email: email.toLowerCase(), googleId, name, passwordHash: undefined });
      await applyConditionBundle(user.id as string, 'general');
      isNew = true;
    }

    const accessToken  = signAccessToken(user.id as string);
    const refreshToken = signRefreshToken(user.id as string);

    res.status(isNew ? 201 : 200).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: { _id: user._id, email: user.email, name: user.name, preferences: user.preferences },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout   (client should delete tokens on its side; no server-side blacklist in v1)
authRouter.post('/logout', authenticate, (req: Request, res: Response) => {
  res.json({ success: true, message: 'Logged out' });
});

// DELETE /me   — permanent account + data deletion
authRouter.delete('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const uid = req.userId!;
    await Promise.all([
      User.deleteOne({ _id: uid }),
      Category.deleteMany({ userId: uid }),
      Question.deleteMany({ userId: uid }),
      Option.deleteMany({ userId: uid }),
      QuickAction.deleteMany({ userId: uid }),
      LogEntry.deleteMany({ userId: uid }),
      DaySession.deleteMany({ userId: uid }),
      InsightResult.deleteMany({ userId: uid }),
      Media.deleteMany({ userId: uid }),
      Reminder.deleteMany({ userId: uid }),
      Medication.deleteMany({ userId: uid }),
      CustomUnit.deleteMany({ userId: uid }),
    ]);
    res.json({ success: true, message: 'Account and all data permanently deleted' });
  } catch (err) {
    next(err);
  }
});
