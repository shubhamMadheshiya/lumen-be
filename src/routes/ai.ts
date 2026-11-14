/**
 * Lumen AI: chat over all of the member's own data, photo analysis, and weekly reviews.
 * Everything here needs preferences.aiFullAccess, which only POST /ai/access can turn on (it is
 * not settable through PATCH /auth/me). Photo access additionally needs the photo PIN if set.
 */
import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Media } from '../models/Media';
import { AiConversation, type IAiConversationDoc } from '../models/AiConversation';
import { AiWeeklyReport } from '../models/AiWeeklyReport';
import { runAssistant, type ChatMessage } from '../services/llm/assistant/assistant';
import { generateWeeklyReview } from '../services/llm/assistant/weeklyReview';
import { decideAccess } from '../services/llm/assistant/access';
import { isGeminiConfigured } from '../services/llm/geminiClient';
import { config } from '../config';

export const aiRouter = Router();
aiRouter.use(authenticate);

const MAX_ATTACHMENTS = 4;
const objectId = z.string().refine(v => mongoose.isValidObjectId(v), 'invalid id');

async function accessOf(userId: string) {
  const user = await User.findById(userId).select('+photoPinHash preferences').lean();
  return {
    user,
    fullAccess: !!user?.preferences?.aiFullAccess,
    photoAccess: !!user?.preferences?.aiPhotoAccess,
  };
}

/** 403 unless the member turned on AI full access. */
async function requireFullAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fullAccess } = await accessOf(req.userId!);
    if (!fullAccess) {
      res.status(403).json({ success: false, code: 'AI_ACCESS_OFF', message: 'Turn on Lumen AI full access in Settings first.' });
      return;
    }
    next();
  } catch (err) { next(err); }
}

function summary(c: IAiConversationDoc) {
  const last = c.messages[c.messages.length - 1];
  return {
    id: String(c._id),
    title: c.title,
    sourceMediaId: c.sourceMediaId,
    updatedAt: c.updatedAt,
    preview: last ? last.text.slice(0, 140) : '',
    messageCount: c.messages.length,
  };
}

function full(c: IAiConversationDoc) {
  return {
    ...summary(c),
    messages: c.messages.map(m => ({
      id: String((m as unknown as { _id: unknown })._id),
      role: m.role, text: m.text, mediaIds: m.mediaIds ?? [], createdAt: m.createdAt,
    })),
  };
}

const titleFrom = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || 'New chat';
};

// ── Access ───────────────────────────────────────────────────────────────────

aiRouter.get('/access', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { user, fullAccess, photoAccess } = await accessOf(req.userId!);
    res.json({
      success: true,
      data: {
        fullAccess,
        photoAccess,
        freeTierAcknowledged: !!user?.preferences?.aiFreeTierAcknowledgedAt,
        hasPhotoPin: !!user?.photoPinHash,
        configured: isGeminiConfigured(),
        model: config.gemini.assistantModel,
      },
    });
  } catch (err) { next(err); }
});

const AccessSchema = z.object({
  fullAccess: z.boolean().optional(),
  photoAccess: z.boolean().optional(),
  acknowledgeFreeTier: z.boolean().optional(),
  pin: z.string().max(12).optional(),
});

aiRouter.post('/access', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = AccessSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid request.' });
    const body = parsed.data;
    const user = await User.findById(req.userId).select('+photoPinHash');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const prefs = user.preferences;

    const pinValid = body.pin && user.photoPinHash ? await bcrypt.compare(body.pin, user.photoPinHash) : null;
    const decision = decideAccess(
      {
        fullAccess: !!prefs.aiFullAccess,
        photoAccess: !!prefs.aiPhotoAccess,
        freeTierAcknowledged: !!prefs.aiFreeTierAcknowledgedAt,
        hasPhotoPin: !!user.photoPinHash,
      },
      body,
      pinValid,
    );
    if (!decision.ok) {
      return res.status(decision.status).json({ success: false, code: decision.code, message: decision.message });
    }
    if (decision.acknowledgedNow) prefs.aiFreeTierAcknowledgedAt = new Date();
    prefs.aiFullAccess = decision.next.fullAccess;
    prefs.aiPhotoAccess = decision.next.photoAccess;

    user.markModified('preferences');
    await user.save();
    res.json({
      success: true,
      data: {
        fullAccess: !!prefs.aiFullAccess,
        photoAccess: !!prefs.aiPhotoAccess,
        freeTierAcknowledged: !!prefs.aiFreeTierAcknowledgedAt,
        hasPhotoPin: !!user.photoPinHash,
        configured: isGeminiConfigured(),
        model: config.gemini.assistantModel,
      },
    });
  } catch (err) { next(err); }
});

// ── Conversations ────────────────────────────────────────────────────────────

aiRouter.get('/conversations', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const list = await AiConversation.find({ userId: req.userId }).sort({ updatedAt: -1 }).limit(100);
    res.json({ success: true, data: list.map(summary) });
  } catch (err) { next(err); }
});

aiRouter.get('/conversations/:id', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Not found' });
    const c = await AiConversation.findOne({ _id: req.params.id, userId: req.userId });
    if (!c) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: full(c) });
  } catch (err) { next(err); }
});

aiRouter.delete('/conversations/:id', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (mongoose.isValidObjectId(req.params.id)) {
      await AiConversation.deleteOne({ _id: req.params.id, userId: req.userId });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

const ChatSchema = z.object({
  conversationId: objectId.optional(),
  message: z.string().max(4000).default(''),
  mediaIds: z.array(objectId).max(MAX_ATTACHMENTS).default([]),
}).refine(b => b.message.trim().length > 0 || b.mediaIds.length > 0, 'message or a photo is required');

/** Runs one turn and stores it. A failed turn is not stored, so the member can simply retry. */
async function chatTurn(userId: string, conv: IAiConversationDoc, message: string, mediaIds: string[]) {
  const history: ChatMessage[] = conv.messages.map(m => ({ role: m.role, text: m.text, mediaIds: m.mediaIds }));
  const result = await runAssistant({ userId, history, message, mediaIds });
  if (result.error) return { result, saved: false };
  const now = new Date();
  conv.messages.push({ role: 'user', text: message, mediaIds, createdAt: now });
  conv.messages.push({ role: 'assistant', text: result.text, mediaIds: [], createdAt: new Date() });
  await conv.save();
  return { result, saved: true };
}

aiRouter.post('/chat', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? 'Invalid request.' });
    const { conversationId, message, mediaIds } = parsed.data;
    const userId = req.userId!;

    let conv = conversationId ? await AiConversation.findOne({ _id: conversationId, userId }) : null;
    if (conversationId && !conv) return res.status(404).json({ success: false, message: 'Conversation not found' });
    if (!conv) conv = new AiConversation({ userId, title: titleFrom(message || 'Photo'), messages: [] });

    const { result, saved } = await chatTurn(userId, conv, message, mediaIds);
    res.json({
      success: true,
      data: {
        conversation: saved ? full(conv) : null,
        reply: result.text,
        error: result.error ?? null,
        requests: result.requests,
        toolCalls: result.toolCalls,
      },
    });
  } catch (err) { next(err); }
});

// ── Photo analysis ───────────────────────────────────────────────────────────

const PHOTO_PROMPT = `Analyse this photo from my Lumen logs.
- Describe exactly what you see, in plain clinical language.
- Find what I logged with it (search_logs around that day) and say how it fits.
- Use list_photos to find earlier photos of the same kind, look at up to 2 of them with view_photo, and say what changed.
- Say what it could mean, how sure you are, and whether it is something to show my doctor or get checked urgently.`;

aiRouter.post('/photos/:mediaId/analyse', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const mediaId = req.params.mediaId;
    if (!mongoose.isValidObjectId(mediaId)) return res.status(404).json({ success: false, message: 'Photo not found' });
    const [media, { photoAccess }] = await Promise.all([
      Media.findOne({ _id: mediaId, userId }).select('createdAt').lean(),
      accessOf(userId),
    ]);
    if (!media) return res.status(404).json({ success: false, message: 'Photo not found' });
    if (!photoAccess) {
      return res.status(403).json({ success: false, code: 'PHOTO_ACCESS_OFF', message: 'Allow Lumen AI to view photos in Settings first.' });
    }
    const conv = new AiConversation({
      userId,
      title: `Photo analysis · ${new Date(media.createdAt).toISOString().slice(0, 10)}`,
      sourceMediaId: mediaId,
      messages: [],
    });
    const { result, saved } = await chatTurn(userId, conv, PHOTO_PROMPT, [mediaId]);
    res.json({
      success: true,
      data: { conversation: saved ? full(conv) : null, reply: result.text, error: result.error ?? null, requests: result.requests },
    });
  } catch (err) { next(err); }
});

// ── Weekly reviews ───────────────────────────────────────────────────────────

aiRouter.get('/weekly-reports', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const reports = await AiWeeklyReport.find({ userId: req.userId }).sort({ weekStart: -1 }).limit(26).lean();
    res.json({
      success: true,
      data: reports.map(r => ({ id: String(r._id), weekStart: r.weekStart, weekEnd: r.weekEnd, text: r.text, createdAt: r.createdAt })),
    });
  } catch (err) { next(err); }
});

const GenerateSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  force: z.boolean().optional(),
});

aiRouter.post('/weekly-reports/generate', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = GenerateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid request.' });
    const { report, error } = await generateWeeklyReview(req.userId!, parsed.data);
    if (!report) return res.json({ success: true, data: { report: null, error: error ?? 'failed' } });
    res.json({
      success: true,
      data: { report: { id: String(report._id), weekStart: report.weekStart, weekEnd: report.weekEnd, text: report.text, createdAt: report.createdAt }, error: null },
    });
  } catch (err) { next(err); }
});
