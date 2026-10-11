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
import { ActivitySession } from '../models/ActivitySession';
import { NotificationEvent } from '../models/NotificationEvent';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { validate } from '../middleware/validate';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../utils/errors';
import { RegisterSchema, LoginSchema, UpdateProfileSchema, UpdateProfileDto } from '../shared';
import { applyConditionBundle } from '../services/templateService';
import { config } from '../config';

const googleClient = new OAuth2Client();

export const authRouter = Router();

// POST /auth/register — Direct registration disabled: all users must enter via Google
authRouter.post('/register', (_req: Request, _res: Response, next: NextFunction) => {
  next(AppError.forbidden('Direct account creation is disabled. Please sign in with Google to create your account.'));
});

// POST /auth/login
authRouter.post('/login', validate(LoginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    const user = await User.findOne({ email }).select('+passwordHash +photoPinHash');
    if (!user) throw AppError.unauthorized('Invalid email or password');

    if (!user.passwordHash) {
      throw AppError.badRequest('This account was registered with Google and has no password configured. Please use "Continue with Google" to sign in.');
    }

    const valid = await user.comparePassword(password);
    if (!valid) throw AppError.unauthorized('Invalid email or password');

    const accessToken  = signAccessToken(user.id as string, 'password');
    const refreshToken = signRefreshToken(user.id as string, 'password');

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          _id: user._id,
          email: user.email,
          name: user.name,
          preferences: user.preferences,
          hasPassword: true,
          hasPhotoPin: Boolean(user.photoPinHash),
          authMethod: 'password',
        },
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

    const { sub, authMethod = 'password' } = verifyRefreshToken(refreshToken);
    const user = await User.findById(sub);
    if (!user) throw AppError.unauthorized('User not found');

    const newAccessToken  = signAccessToken(sub, authMethod);
    const newRefreshToken = signRefreshToken(sub, authMethod);

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

    // Find by googleId first, then fall back to email (links existing email accounts)
    let user = await User.findOne({ googleId }).select('+googleId +passwordHash +photoPinHash') as InstanceType<typeof User> | null;
    if (!user) {
      user = await User.findOne({ email: email.toLowerCase() }).select('+googleId +passwordHash +photoPinHash') as InstanceType<typeof User> | null;
      if (user) {
        // Link Google to the existing account
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

    const accessToken  = signAccessToken(user.id as string, 'google');
    const refreshToken = signRefreshToken(user.id as string, 'google');

    res.status(isNew ? 201 : 200).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          _id: user._id,
          email: user.email,
          name: user.name,
          preferences: user.preferences,
          hasPassword: Boolean(user.passwordHash),
          hasPhotoPin: Boolean(user.photoPinHash),
          authMethod: 'google',
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/set-password — set or reset account password (ONLY permitted when authenticated via Google)
authRouter.post('/set-password', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.authMethod !== 'google') {
      throw AppError.forbidden('Password can only be set or changed when signed in with Google. Please re-authenticate with Google.');
    }

    const { password } = req.body as { password?: string };
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw AppError.badRequest('Password must be at least 8 characters long');
    }

    const user = await User.findById(req.userId).select('+passwordHash');
    if (!user) throw AppError.notFound('User not found');

    user.passwordHash = await bcrypt.hash(password, 12);
    await user.save();

    res.json({
      success: true,
      message: 'Password saved successfully',
      data: { hasPassword: true },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/photo-pin — set or reset sensitive photo PIN (ONLY permitted when authenticated via Google)
authRouter.post('/photo-pin', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.authMethod !== 'google') {
      throw AppError.forbidden('Photo PIN can only be set or changed when signed in with Google. Please re-authenticate with Google.');
    }

    const { pin } = req.body as { pin?: string };
    if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      throw AppError.badRequest('Photo PIN must be exactly 4 numeric digits');
    }

    const user = await User.findById(req.userId).select('+photoPinHash');
    if (!user) throw AppError.notFound('User not found');

    user.photoPinHash = await bcrypt.hash(pin, 12);
    await user.save();

    res.json({
      success: true,
      message: 'Photo PIN saved successfully',
      data: { hasPhotoPin: true },
    });
  } catch (err) {
    next(err);
  }
});

// POST /auth/verify-photo-pin — verify candidate Photo PIN
authRouter.post('/verify-photo-pin', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { pin } = req.body as { pin?: string };
    if (!pin || typeof pin !== 'string') {
      throw AppError.badRequest('PIN is required');
    }

    const user = await User.findById(req.userId).select('+photoPinHash');
    if (!user) throw AppError.notFound('User not found');

    if (!user.photoPinHash) {
      // No PIN configured
      res.json({ success: true, valid: true, isConfigured: false });
      return;
    }

    const isValid = await bcrypt.compare(pin, user.photoPinHash);
    res.json({ success: true, valid: isValid, isConfigured: true });
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout   (client should delete tokens on its side; no server-side blacklist in v1)
authRouter.post('/logout', authenticate, (req: Request, res: Response) => {
  res.json({ success: true, message: 'Logged out' });
});

// GET /auth/me — get current user profile details
authRouter.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.userId).select('+passwordHash +photoPinHash');
    if (!user) throw AppError.notFound('User not found');

    res.json({
      success: true,
      data: {
        _id: user._id,
        email: user.email,
        name: user.name,
        conditions: user.conditions || [],
        age: user.age,
        weight: user.weight,
        gender: user.gender,
        preferences: user.preferences,
        configVersion: user.configVersion,
        hasPassword: Boolean(user.passwordHash),
        hasPhotoPin: Boolean(user.photoPinHash),
        authMethod: req.authMethod || 'password',
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /auth/me — update user profile (name, conditions, preferences, vitals)
authRouter.patch('/me', authenticate, validate(UpdateProfileSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, conditions, age, weight, gender, preferences } = req.body as UpdateProfileDto;
    const user = await User.findById(req.userId);
    if (!user) throw AppError.notFound('User not found');

    if (name !== undefined) {
      user.name = name.trim();
    }
    if (conditions !== undefined) {
      user.conditions = conditions;
    }
    if (age !== undefined) {
      user.age = age;
    }
    if (weight !== undefined) {
      user.weight = weight;
    }
    if (gender !== undefined) {
      user.gender = gender;
    }
    if (preferences) {
      user.preferences = {
        ...user.preferences,
        ...preferences,
      };
    }

    await user.save();

    res.json({
      success: true,
      data: {
        _id: user._id,
        email: user.email,
        name: user.name,
        conditions: user.conditions || [],
        age: user.age,
        weight: user.weight,
        gender: user.gender,
        preferences: user.preferences,
        configVersion: user.configVersion,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      message: 'Profile updated successfully',
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /me — permanent account + data deletion (ONLY permitted for Primary User authenticated via Google)
authRouter.delete('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.authMethod !== 'google') {
      throw AppError.forbidden('Account deletion is restricted to the Primary Account Owner. Please sign in with Google to delete this account.');
    }
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
      ActivitySession.deleteMany({ userId: uid }),
      NotificationEvent.deleteMany({ userId: uid }),
    ]);
    res.json({ success: true, message: 'Account and all data permanently deleted' });
  } catch (err) {
    next(err);
  }
});
