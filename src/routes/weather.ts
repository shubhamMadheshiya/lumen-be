/**
 * Weather: the app sends a rounded location (≈1 km); the server keeps daily weather for it.
 */
import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { User } from '../models/User';
import { WeatherDay } from '../models/WeatherDay';
import { userDayContext } from '../utils/userDay';
import { refreshWeather, roundCoord } from '../services/weather/weatherDays';

export const weatherRouter = Router();
weatherRouter.use(authenticate);

const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

/** Weather is fetched again only when the place changed by more than this (≈5 km) or it is stale. */
const MOVE_DEG = 0.05;
const REFRESH_MS = 6 * 3600000;

// PUT /weather/location — store the rounded location; backfill ~3 months the first time.
weatherRouter.put('/location', validate(LocationSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { lat, lon } = req.body as z.infer<typeof LocationSchema>;
    const rLat = roundCoord(lat);
    const rLon = roundCoord(lon);
    const user = await User.findById(userId).select('preferences.weatherLocation').lean();
    const prev = user?.preferences?.weatherLocation;
    const moved = !prev || Math.abs(prev.lat - rLat) > MOVE_DEG || Math.abs(prev.lon - rLon) > MOVE_DEG;
    const stale = !prev?.updatedAt || Date.now() - new Date(prev.updatedAt).getTime() > REFRESH_MS;
    if (!moved && !stale) return res.json({ success: true, data: { refreshed: false } });

    await User.updateOne({ _id: userId }, { $set: { 'preferences.weatherLocation': { lat: rLat, lon: rLon, updatedAt: new Date() } } });
    const has = await WeatherDay.exists({ userId: new mongoose.Types.ObjectId(userId) });
    const ctx = await userDayContext(userId);
    // Never block the app on the weather service.
    refreshWeather(userId, rLat, rLon, ctx.timeZone, has ? 3 : 92)
      .catch(err => console.warn('[weather] refresh failed:', err instanceof Error ? err.message : err));
    res.json({ success: true, data: { refreshed: true } });
  } catch (err) { next(err); }
});

// GET /weather/days?from&to — stored weather days.
weatherRouter.get('/days', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const filter: Record<string, unknown> = { userId: new mongoose.Types.ObjectId(req.userId!) };
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const range: Record<string, string> = {};
    if (typeof req.query.from === 'string' && day.test(req.query.from)) range.$gte = req.query.from;
    if (typeof req.query.to === 'string' && day.test(req.query.to)) range.$lte = req.query.to;
    if (Object.keys(range).length) filter.dayKey = range;
    const rows = await WeatherDay.find(filter).sort({ dayKey: -1 }).limit(400).select('-_id -userId -__v').lean();
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});
