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
import { AiNotification } from '../models/AiNotification';
import { deliverAiNote } from '../services/aiNotify/run';
import { Note } from '../models/Note';
import { AiTemplateDraft } from '../models/AiTemplateDraft';
import { createAiNote } from '../services/notes/aiNoteWriter';
import { createDoctorVisitNote, NOTE_ACTIONS, runNoteAction } from '../services/notes/aiNoteActions';
import { applyDraft, DraftError, draftPayload, undoDraft } from '../services/templates/aiTemplateDraft';
import { MAX_FILE_REFS, MAX_REFS, REF_KINDS, type ChatRef } from '../services/llm/assistant/refTypes';
import { listAttachables, ATTACHABLE_KINDS } from '../services/llm/assistant/attachables';

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
  aiJournal?: boolean;
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
    /** Daily health journal note (on unless turned off). */
    journal: prefs?.aiJournal !== false,
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
      role: m.role, text: m.text, mediaIds: m.mediaIds ?? [], refs: m.refs ?? [], createdAt: m.createdAt,
      provider: m.provider ?? null, model: m.llmModel ?? null, modelLabel: modelLabel(m.llmModel) ?? null,
      artifacts: m.artifacts ?? [],
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

const RefSchema = z.object({
  kind: z.enum(REF_KINDS),
  id: z.string().min(1).max(200),
  title: z.string().trim().max(200).default(''),
});

const ChatSchema = z.object({
  conversationId: objectId.optional(),
  message: z.string().max(4000).default(''),
  mediaIds: z.array(objectId).max(MAX_ATTACHMENTS).default([]),
  /** Lumen items and PDFs attached to this message. */
  refs: z.array(RefSchema).max(MAX_REFS).default([]),
  /** Voice conversation: the reply is written to be spoken (short, no markdown). */
  voice: z.boolean().optional(),
})
  .refine(b => b.message.trim().length > 0 || b.mediaIds.length > 0 || b.refs.length > 0, 'message or an attachment is required')
  .refine(b => b.refs.filter(r => r.kind === 'file').length <= MAX_FILE_REFS, `at most ${MAX_FILE_REFS} files per message`);

/** Runs one turn and stores it. A failed turn is not stored, so the member can simply retry. */
async function chatTurn(userId: string, conv: IAiConversationDoc, message: string, mediaIds: string[], voice = false, refs: ChatRef[] = []) {
  const history: ChatMessage[] = conv.messages.map(m => ({ role: m.role, text: m.text, mediaIds: m.mediaIds, refs: m.refs }));
  const result = await runAssistant({ userId, history, message, mediaIds, refs, voice });
  if (result.error) return { result, saved: false };
  const now = new Date();
  conv.messages.push({ role: 'user', text: message, mediaIds, ...(refs.length ? { refs } : {}), createdAt: now });
  conv.messages.push({
    role: 'assistant', text: result.text, mediaIds: [], createdAt: new Date(),
    provider: result.provider, llmModel: result.model, usage: result.usage,
    ...(result.artifacts.length ? { artifacts: result.artifacts } : {}),
  });
  await conv.save();
  return { result, saved: true };
}

aiRouter.post('/chat', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.errors[0]?.message ?? 'Invalid request.' });
    const { conversationId, message, mediaIds, voice } = parsed.data;
    const refs = parsed.data.refs.map(r => ({ ...r, title: r.title || r.kind }));
    const userId = req.userId!;

    let conv = conversationId ? await AiConversation.findOne({ _id: conversationId, userId }) : null;
    if (conversationId && !conv) return res.status(404).json({ success: false, message: 'Conversation not found' });
    if (!conv) conv = new AiConversation({ userId, title: titleFrom(message || refs[0]?.title || 'Photo'), messages: [] });

    const { result, saved } = await chatTurn(userId, conv, message, mediaIds, !!voice, refs);
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
        artifacts: result.artifacts,
      },
    });
  } catch (err) { next(err); }
});

// ── Things to attach ─────────────────────────────────────────────────────────

const AttachablesSchema = z.object({
  kind: z.enum(ATTACHABLE_KINDS),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** The chat's "attach" pickers: the member's own items of one kind, newest first. */
aiRouter.get('/attachables', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = AttachablesSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Unknown kind.' });
    const { kind, q, limit } = parsed.data;
    res.json({ success: true, data: await listAttachables(req.userId!, kind, q, limit) });
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
  journal: z.boolean().optional(),
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
    if (body.journal !== undefined) prefs.aiJournal = body.journal;
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


// ── Lumen AI notifications ───────────────────────────────────────────────────

function notePayload(n: { _id: unknown; kind: string; title: string; body: string; route: string; conversationId?: string; pushed: boolean; reason?: string; dateKey: string; createdAt: Date }) {
  return {
    id: String(n._id), kind: n.kind, title: n.title, body: n.body, route: n.route,
    conversationId: n.conversationId ?? null, pushed: n.pushed, reason: n.reason ?? null, dateKey: n.dateKey, createdAt: n.createdAt,
  };
}

/** Recent AI notifications, so the app can show them in "For you today" even if the push came while it was closed. */
aiRouter.get('/notifications', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sinceRaw = typeof req.query.since === 'string' ? Date.parse(req.query.since) : NaN;
    const since = Number.isFinite(sinceRaw) ? new Date(sinceRaw) : new Date(Date.now() - 2 * 86_400_000);
    const list = await AiNotification.find({ userId: req.userId, createdAt: { $gt: since } }).sort({ createdAt: -1 }).limit(20).lean();
    res.json({ success: true, data: list.map(notePayload) });
  } catch (err) { next(err); }
});

/** Settings → "Send a test": writes a briefing now and pushes it, whatever the budget (3 a day). */
aiRouter.post('/notifications/test', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const out = await deliverAiNote(req.userId!, 'briefing', { test: true });
    if (out.status === 'limit') return res.status(429).json({ success: false, code: 'TEST_LIMIT', message: 'You can send 3 test notifications a day.' });
    if (out.status !== 'saved') {
      return res.json({ success: true, data: { notification: null, error: 'reason' in out ? out.reason : out.status } });
    }
    const n = out.notification;
    res.json({ success: true, data: { notification: notePayload(n), error: n.pushed ? null : n.reason ?? 'not_pushed' } });
  } catch (err) { next(err); }
});


// ── Lumen AI notes ───────────────────────────────────────────────────────────

/** "Save as note" on a chat reply (also photo analyses). No AI call: the reply becomes the note. */
aiRouter.post('/conversations/:id/messages/:messageId/save-note', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Not found' });
    const conv = await AiConversation.findOne({ _id: req.params.id, userId: req.userId });
    const msg = conv?.messages.find(m => String((m as unknown as { _id: unknown })._id) === req.params.messageId);
    if (!conv || !msg || !msg.text.trim()) return res.status(404).json({ success: false, message: 'Message not found' });
    const note = await createAiNote(req.userId!, { title: conv.title || 'Lumen AI', markdown: msg.text, icon: '✨' });
    res.status(201).json({ success: true, data: { noteId: String(note._id), title: note.title } });
  } catch (err) { next(err); }
});

aiRouter.post('/weekly-reports/:id/save-note', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Not found' });
    const report = await AiWeeklyReport.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!report) return res.status(404).json({ success: false, message: 'Review not found' });
    const note = await createAiNote(req.userId!, {
      title: `Weekly review · ${report.weekStart} to ${report.weekEnd}`, markdown: report.text, icon: '🗓️', tags: ['weekly-review'],
    });
    res.status(201).json({ success: true, data: { noteId: String(note._id), title: note.title } });
  } catch (err) { next(err); }
});

const DoctorVisitSchema = z.object({ weeks: z.number().int().min(2).max(12).default(4) });

aiRouter.post('/notes/doctor-visit', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = DoctorVisitSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, message: 'weeks must be 2-12' });
    const out = await createDoctorVisitNote(req.userId!, parsed.data.weeks);
    if (!out.ok) return res.json({ success: true, data: { noteId: null, error: out.reason } });
    res.status(201).json({ success: true, data: { noteId: out.noteId, error: null } });
  } catch (err) { next(err); }
});

const NoteActionSchema = z.object({ action: z.enum(NOTE_ACTIONS) });

aiRouter.post('/notes/:id/action', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = NoteActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Unknown action' });
    const out = await runNoteAction(req.userId!, req.params.id, parsed.data.action);
    if (!out.ok && out.reason === 'not_found') return res.status(404).json({ success: false, message: 'Note not found' });
    if (!out.ok) return res.json({ success: true, data: { noteId: null, created: false, note: null, error: out.reason } });
    const note = await Note.findById(out.noteId).lean();
    res.json({ success: true, data: { noteId: out.noteId, created: out.created, note, error: null } });
  } catch (err) { next(err); }
});

// ── Lumen AI log templates ───────────────────────────────────────────────────

const GenerateDraftSchema = z.object({
  request: z.string().trim().max(500).optional(),
  mode: z.enum(['create', 'improve']).default('create'),
});

aiRouter.post('/template-drafts/generate', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = GenerateDraftSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid request.' });
    const { request, mode } = parsed.data;
    const message = mode === 'improve'
      ? 'Look at my tracking setup and how I use it (get_tracking_setup), then suggest improvements with propose_log_template: options for things I keep typing under "Other", useful things missing for my conditions (reuse the Lumen library first), and archiving items I have not used for two months or more. Then tell me in one or two sentences what you suggested.'
      : `I want to track ${request ? `this: ${request}` : 'my condition(s)'}. Use what you know about me (my conditions, what I log and what we talked about). Call get_tracking_setup, then propose_log_template (reuse the Lumen library first, skip what I already track). Then tell me in one or two sentences what you proposed.`;
    const result = await runAssistant({ userId: req.userId!, history: [], message, effort: 'medium', budgetMs: 120_000 });
    const draft = result.artifacts.find(a => a.type === 'template_draft');
    res.json({ success: true, data: { draftId: draft?.id ?? null, reply: result.text, error: result.error ?? (draft ? null : 'no_draft') } });
  } catch (err) { next(err); }
});

async function ownDraft(req: AuthRequest) {
  return mongoose.isValidObjectId(req.params.id) ? AiTemplateDraft.findOne({ _id: req.params.id, userId: req.userId }) : null;
}

aiRouter.get('/template-drafts/:id', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const draft = await ownDraft(req);
    if (!draft) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: draftPayload(draft) });
  } catch (err) { next(err); }
});

const ApplyDraftSchema = z.object({
  items: z.record(z.object({ include: z.boolean().optional(), label: z.string().max(200).optional() })).default({}),
});

function draftError(res: Response, err: unknown) {
  if (err instanceof DraftError) {
    res.status(err.code === 'NOT_FOUND' ? 404 : 409).json({ success: false, code: err.code, message: err.message });
    return true;
  }
  return false;
}

aiRouter.post('/template-drafts/:id/apply', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = ApplyDraftSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid request.' });
    const draft = await applyDraft(req.userId!, req.params.id, parsed.data.items);
    res.json({ success: true, data: draftPayload(draft) });
  } catch (err) { if (!draftError(res, err)) next(err); }
});

aiRouter.post('/template-drafts/:id/undo', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const draft = await undoDraft(req.userId!, req.params.id);
    res.json({ success: true, data: draftPayload(draft) });
  } catch (err) { if (!draftError(res, err)) next(err); }
});

aiRouter.delete('/template-drafts/:id', requireFullAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const draft = await ownDraft(req);
    if (draft && draft.status === 'draft') { draft.status = 'discarded'; await draft.save(); }
    res.json({ success: true });
  } catch (err) { next(err); }
});
