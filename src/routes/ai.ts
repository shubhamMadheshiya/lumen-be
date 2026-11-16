/**
 * Lumen AI: chat over all of the member's own data, photo analysis, and weekly reviews.
 * Everything here needs preferences.aiFullAccess, which only POST /ai/access can turn on (it is
 * not settable through PATCH /auth/me). Photo access additionally needs the photo PIN if set.
 * The provider/model (Gemini or Claude) and voice settings are likewise only set via PATCH /ai/settings.
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
import { defaultModelFor, estimateUsd, findModel, isProviderConfigured, listModels, resolveModel, type AiModelInfo } from '../services/llm/assistant/models';
import { DEFAULT_TTS_VOICE, isKnownVoice, MAX_TTS_CHARS, synthesizeSpeech, TTS_VOICES } from '../services/llm/tts';

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

type Prefs = {
  aiFullAccess?: boolean; aiPhotoAccess?: boolean; aiFreeTierAcknowledgedAt?: Date; aiClaudeAcknowledgedAt?: Date;
  aiProvider?: string; aiModel?: string; aiVoice?: { ttsVoice?: string; natural?: boolean; sttLang?: string };
};

const modelLabel = (id?: string) => (id ? findModel(id)?.label ?? id : undefined);

/** Everything the app needs to show Lumen AI's state; shared by GET and POST /access and PATCH /settings. */
function accessPayload(prefs: Prefs | undefined, hasPhotoPin: boolean) {
  const { model, fellBack } = resolveModel(prefs);
  return {
    fullAccess: !!prefs?.aiFullAccess,
    photoAccess: !!prefs?.aiPhotoAccess,
    freeTierAcknowledged: !!prefs?.aiFreeTierAcknowledgedAt,
    claudeAcknowledged: !!prefs?.aiClaudeAcknowledgedAt,
    hasPhotoPin,
    configured: isProviderConfigured('gemini') || isProviderConfigured('claude'),
    provider: model.provider,
    model: model.id,
    modelLabel: model.label,
    /** The member picked a model that can't run now (e.g. Claude without a key); Gemini answers instead. */
    chosenModelUnavailable: fellBack,
    voice: {
      ttsVoice: prefs?.aiVoice?.ttsVoice && isKnownVoice(prefs.aiVoice.ttsVoice) ? prefs.aiVoice.ttsVoice : DEFAULT_TTS_VOICE,
      natural: prefs?.aiVoice?.natural ?? true,
      sttLang: prefs?.aiVoice?.sttLang === 'hi-IN' ? 'hi-IN' : 'en-IN',
    },
  };
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
      provider: m.provider ?? null, model: m.llmModel ?? null, modelLabel: modelLabel(m.llmModel) ?? null,
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
    const { user } = await accessOf(req.userId!);
    res.json({ success: true, data: accessPayload(user?.preferences, !!user?.photoPinHash) });
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
    res.json({ success: true, data: accessPayload(prefs, !!user.photoPinHash) });
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
  /** Voice conversation: the reply is written to be spoken (short, no markdown). */
  voice: z.boolean().optional(),
}).refine(b => b.message.trim().length > 0 || b.mediaIds.length > 0, 'message or a photo is required');

/** Runs one turn and stores it. A failed turn is not stored, so the member can simply retry. */
async function chatTurn(userId: string, conv: IAiConversationDoc, message: string, mediaIds: string[], voice = false) {
  const history: ChatMessage[] = conv.messages.map(m => ({ role: m.role, text: m.text, mediaIds: m.mediaIds }));
  const result = await runAssistant({ userId, history, message, mediaIds, voice });
  if (result.error) return { result, saved: false };
  const now = new Date();
  conv.messages.push({ role: 'user', text: message, mediaIds, createdAt: now });
  conv.messages.push({
    role: 'assistant', text: result.text, mediaIds: [], createdAt: new Date(),
    provider: result.provider, llmModel: result.model, usage: result.usage,
  });
  await conv.save();
  return { result, saved: true };
}

aiRouter.post('/chat', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? 'Invalid request.' });
    const { conversationId, message, mediaIds, voice } = parsed.data;
    const userId = req.userId!;

    let conv = conversationId ? await AiConversation.findOne({ _id: conversationId, userId }) : null;
    if (conversationId && !conv) return res.status(404).json({ success: false, message: 'Conversation not found' });
    if (!conv) conv = new AiConversation({ userId, title: titleFrom(message || 'Photo'), messages: [] });

    const { result, saved } = await chatTurn(userId, conv, message, mediaIds, !!voice);
    res.json({
      success: true,
      data: {
        conversation: saved ? full(conv) : null,
        reply: result.text,
        error: result.error ?? null,
        requests: result.requests,
        toolCalls: result.toolCalls,
        provider: result.provider,
        model: result.model,
        modelLabel: modelLabel(result.model),
        fellBack: result.fellBack,
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
      data: reports.map(r => ({ id: String(r._id), weekStart: r.weekStart, weekEnd: r.weekEnd, text: r.text, createdAt: r.createdAt, modelLabel: modelLabel(r.llmModel) ?? null })),
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
      data: { report: { id: String(report._id), weekStart: report.weekStart, weekEnd: report.weekEnd, text: report.text, createdAt: report.createdAt, modelLabel: modelLabel(report.llmModel) ?? null }, error: null },
    });
  } catch (err) { next(err); }
});

// ── Provider, model and voice settings ──────────────────────────────────────

function modelPayload(m: AiModelInfo) {
  return {
    id: m.id, provider: m.provider, label: m.label, note: m.note,
    inputPerM: m.inputPerM, outputPerM: m.outputPerM,
    available: isProviderConfigured(m.provider),
  };
}

aiRouter.get('/models', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { user } = await accessOf(req.userId!);
    const current = resolveModel(user?.preferences);
    res.json({
      success: true,
      data: {
        models: listModels().map(modelPayload),
        defaults: { gemini: defaultModelFor('gemini').id, claude: defaultModelFor('claude').id },
        current: { provider: current.model.provider, model: current.model.id, chosenModelUnavailable: current.fellBack },
        voices: TTS_VOICES,
      },
    });
  } catch (err) { next(err); }
});

const SettingsSchema = z.object({
  model: z.string().max(80).optional(),
  acknowledgeClaude: z.boolean().optional(),
  voice: z.object({
    ttsVoice: z.string().max(40).refine(isKnownVoice, 'unknown voice').optional(),
    natural: z.boolean().optional(),
    sttLang: z.enum(['en-IN', 'hi-IN']).optional(),
  }).optional(),
});

aiRouter.patch('/settings', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = SettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? 'Invalid request.' });
    const body = parsed.data;
    const user = await User.findById(req.userId).select('+photoPinHash');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const prefs = user.preferences;

    if (body.model) {
      const m = findModel(body.model);
      if (!m) return res.status(400).json({ success: false, code: 'UNKNOWN_MODEL', message: 'Unknown model.' });
      if (!isProviderConfigured(m.provider)) {
        return res.status(409).json({
          success: false, code: 'PROVIDER_NOT_CONFIGURED',
          message: m.provider === 'claude' ? 'Claude is not set up on the server yet (add ANTHROPIC_API_KEY).' : 'Gemini is not set up on the server yet.',
        });
      }
      if (m.provider === 'claude' && !prefs.aiClaudeAcknowledgedAt) {
        if (!body.acknowledgeClaude) {
          return res.status(409).json({ success: false, code: 'CLAUDE_ACK_REQUIRED', message: 'Please read the Claude notice first.' });
        }
        prefs.aiClaudeAcknowledgedAt = new Date();
      }
      prefs.aiProvider = m.provider;
      prefs.aiModel = m.id;
    }
    if (body.voice) {
      prefs.aiVoice = { ...(prefs.aiVoice ?? {}), ...body.voice };
    }
    user.markModified('preferences');
    await user.save();
    res.json({ success: true, data: accessPayload(prefs, !!user.photoPinHash) });
  } catch (err) { next(err); }
});

const MonthSchema = z.string().regex(/^\d{4}-\d{2}$/);

/** Tokens and an estimated cost per model for one calendar month (UTC). Claude is paid; Gemini shows $0. */
aiRouter.get('/usage', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const month = MonthSchema.safeParse(req.query.month).success ? String(req.query.month) : new Date().toISOString().slice(0, 7);
    const from = new Date(`${month}-01T00:00:00Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const rows = await AiConversation.aggregate<{ _id: string; replies: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>([
      { $match: { userId: new mongoose.Types.ObjectId(req.userId) } },
      { $unwind: '$messages' },
      { $match: { 'messages.role': 'assistant', 'messages.llmModel': { $exists: true }, 'messages.createdAt': { $gte: from, $lt: to } } },
      {
        $group: {
          _id: '$messages.llmModel',
          replies: { $sum: 1 },
          inputTokens: { $sum: { $ifNull: ['$messages.usage.inputTokens', 0] } },
          outputTokens: { $sum: { $ifNull: ['$messages.usage.outputTokens', 0] } },
          cacheReadTokens: { $sum: { $ifNull: ['$messages.usage.cacheReadTokens', 0] } },
          cacheWriteTokens: { $sum: { $ifNull: ['$messages.usage.cacheWriteTokens', 0] } },
        },
      },
    ]);
    const models = rows.map(r => {
      const m = findModel(r._id);
      // Cache reads bill at 0.1x the input price and cache writes at 1.25x.
      const inputEquivalent = r.inputTokens + 0.1 * r.cacheReadTokens + 1.25 * r.cacheWriteTokens;
      return {
        model: r._id,
        label: m?.label ?? r._id,
        provider: m?.provider ?? null,
        replies: r.replies,
        inputTokens: r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens,
        outputTokens: r.outputTokens,
        estimatedUsd: m ? Math.round(estimateUsd(m, inputEquivalent, r.outputTokens) * 10_000) / 10_000 : 0,
      };
    }).sort((a, b) => b.estimatedUsd - a.estimatedUsd || b.replies - a.replies);
    const totalUsd = Math.round(models.reduce((s, m) => s + m.estimatedUsd, 0) * 10_000) / 10_000;
    res.json({ success: true, data: { month, models, totalUsd } });
  } catch (err) { next(err); }
});

// ── Spoken replies ───────────────────────────────────────────────────────────

const TTS_WINDOW_MS = 10 * 60_000;
const TTS_MAX_PER_WINDOW = 80;
const ttsCalls = new Map<string, number[]>();

/** Per-member cap so a stuck client can't burn the free tier. */
export function ttsAllowed(userId: string, now = Date.now()): boolean {
  const recent = (ttsCalls.get(userId) ?? []).filter(t => now - t < TTS_WINDOW_MS);
  if (recent.length >= TTS_MAX_PER_WINDOW) { ttsCalls.set(userId, recent); return false; }
  recent.push(now);
  ttsCalls.set(userId, recent);
  return true;
}

const TtsSchema = z.object({
  text: z.string().trim().min(1).max(MAX_TTS_CHARS),
  voice: z.string().max(40).optional(),
});

/** Always 200: `fallback: true` tells the app to use the phone's own voice instead. */
aiRouter.post('/tts', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = TtsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Text is required (max 1200 characters).' });
    if (!ttsAllowed(req.userId!)) return res.json({ success: true, data: { fallback: true, reason: 'rate_limited' } });
    const { user } = await accessOf(req.userId!);
    const voice = parsed.data.voice ?? user?.preferences?.aiVoice?.ttsVoice;
    const out = await synthesizeSpeech(parsed.data.text, voice);
    if (!out.ok) return res.json({ success: true, data: { fallback: true, reason: out.error } });
    res.json({ success: true, data: { fallback: false, mimeType: out.mimeType, base64: out.base64 } });
  } catch (err) { next(err); }
});
