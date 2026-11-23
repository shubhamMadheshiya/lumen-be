/**
 * GET /community/gifs/trending and /community/gifs/search?q= — GIF picker data for chat.
 * Logged-in members only, at most 60 requests a minute each.
 */
import { Router, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../utils/errors';
import { trending, search, GifNotConfigured } from '../services/gifs/tenor';

export const gifRouter = Router();
gifRouter.use(authenticate);
gifRouter.use(rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthRequest).userId || req.ip || 'anon',
  message: { success: false, message: 'Too many GIF searches. Please wait a moment.' },
}));

const cleanPos = (v: unknown) => (typeof v === 'string' && v.length <= 200 ? v : undefined);

function fail(err: unknown, next: NextFunction) {
  if (err instanceof GifNotConfigured) return next(new AppError(err.message, 503));
  console.error('[gifs] failed:', (err as Error).message);
  return next(new AppError('GIF search is not available right now. Please try again.', 502));
}

gifRouter.get('/trending', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await trending(cleanPos(req.query.pos)) });
  } catch (err) { fail(err, next); }
});

gifRouter.get('/search', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) return res.json({ success: true, data: await trending(cleanPos(req.query.pos)) });
    res.json({ success: true, data: await search(q, cleanPos(req.query.pos)) });
  } catch (err) { fail(err, next); }
});
