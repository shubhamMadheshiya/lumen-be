import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { buildCommunityNotifications } from '../services/communityNotifications';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { CommunityServer } from '../models/CommunityServer';
import { CommunityChannel } from '../models/CommunityChannel';
import { CommunityMessage } from '../models/CommunityMessage';
import { ChannelReadState } from '../models/ChannelReadState';
import { ServerTimeout } from '../models/ServerTimeout';
import { ForumPost } from '../models/ForumPost';
import { User } from '../models/User';
import { Media } from '../models/Media';
import { CommunityBlock } from '../models/CommunityBlock';
import { CommunityReport, ReportReason } from '../models/CommunityReport';
import { getDownloadUrl } from '../utils/s3';
import { notifyCommunityMessage } from '../services/communityPush';
import { runAssistant } from '../services/llm/assistant/assistant';
import { createDraft, draftPayload } from '../services/templates/aiTemplateDraft';
import { sharedTemplateToProposal } from '../services/templates/sharedTemplate';
import { Note } from '../models/Note';
import { Task } from '../models/Task';
import {
  broadcastMessageCreated,
  broadcastMessageUpdated,
  broadcastMessageDeleted,
  broadcastReactionUpdated,
  broadcastPinsUpdated,
} from '../services/socketService';
import {
  CreateCommunityMessageSchema,
  EditCommunityMessageSchema,
  PinCommunityMessageSchema,
  MarkChannelReadSchema,
  CreateDmChannelSchema,
  TimeoutUserSchema,
  ReactCommunityMessageSchema,
  CreateForumPostSchema,
  CreateCommunityServerSchema,
  JoinCommunityServerSchema,
  UpdateCommunityServerSchema,
  SetModeratorSchema,
  ReportMessageSchema,
  CommunitySettingsSchema,
  ChannelSettingsSchema,
  TranslateMessageSchema,
  CreateCommunityChannelSchema,
} from '../shared/schemas';

export const communityChatRouter = Router();
communityChatRouter.use(authenticate);

// ── AutoMod Keyword & Safehouse Filter ──────────────────
const AUTOMOD_FORBIDDEN_PATTERNS = [
  /miracle\s*mineral/i,
  /bleach\s*cure/i,
  /mms\s*cure/i,
  /guaranteed\s*cure/i,
  /stop\s*taking\s*(your\s*)?(insulin|meds|medication)/i,
  /kill\s*yourself/i,
  /\bkys\b/i,
];

function validateAutoMod(content: string): { blocked: boolean; reason?: string } {
  for (const pattern of AUTOMOD_FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      return {
        blocked: true,
        reason:
          'AutoMod: This message was blocked because it appears to contain unverified medical prescriptions or harmful advice. Lumen is a safe chronic illness pacing community.',
      };
    }
  }
  return { blocked: false };
}

/** Forum posts keep an anonymous author's id from everyone but the author. */
function hidePostAuthor<T extends { author?: { isAnonymous?: boolean; senderId?: unknown } }>(post: T, viewerId: string): T {
  if (post.author?.isAnonymous && String(post.author.senderId) !== viewerId) {
    return { ...post, author: { ...post.author, senderId: 'anonymous' } };
  }
  return post;
}

type MediaCarrier = {
  audioMediaId?: unknown;
  audioUrl?: string;
  embedType?: string;
  embedData?: { photoMediaId?: unknown; photoUrl?: string; [k: string]: unknown };
};

/** Voice notes and photos are stored by media id; the signed link is made fresh each time so it never goes stale. */
async function withFreshAudio<T extends MediaCarrier>(messages: T[]): Promise<T[]> {
  const idsOf = (m: T) => [m.audioMediaId, m.embedData?.photoMediaId].filter(Boolean).map(String);
  const ids = Array.from(new Set(messages.flatMap(idsOf)));
  if (ids.length === 0) return messages;
  const media = await Media.find({ _id: { $in: ids } }).select('storageKey');
  const urls = new Map<string, string>();
  await Promise.all(media.map(async (m) => {
    try { urls.set(String(m._id), await getDownloadUrl(m.storageKey)); } catch { /* keep the old link */ }
  }));
  return messages.map((m) => {
    let out = m;
    const audio = m.audioMediaId ? urls.get(String(m.audioMediaId)) : undefined;
    if (audio) out = { ...out, audioUrl: audio };
    const photo = m.embedData?.photoMediaId ? urls.get(String(m.embedData.photoMediaId)) : undefined;
    if (photo) out = { ...out, embedData: { ...out.embedData, photoUrl: photo } };
    return out;
  });
}

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

// ── Access control ───────────────────────────────────────
// A channel is visible when it is a DM the caller belongs to, or sits in a server that is public/official
// or that the caller is a member of. Anything else answers 404 so private channels are not revealed.
export async function loadChannel(idOrSlug: string) {
  if (mongoose.Types.ObjectId.isValid(idOrSlug)) return CommunityChannel.findById(idOrSlug);
  return CommunityChannel.findOne({ slug: idOrSlug });
}

export async function canAccessChannel(
  userId: mongoose.Types.ObjectId | string,
  channel: { type?: string; dmMemberIds?: unknown[]; serverId?: unknown },
): Promise<boolean> {
  const me = String(userId);
  if (channel.type === 'dm') return (channel.dmMemberIds ?? []).some(m => String(m) === me);
  if (!channel.serverId) return true;
  const server = await CommunityServer.findById(channel.serverId).select('isPrivate isOfficial memberIds');
  if (!server) return false;
  if (server.isOfficial || !server.isPrivate) return true;
  return server.memberIds.some(m => String(m) === me);
}

/** Loads a channel and checks access; sends the 404 itself and returns null when the caller may not see it. */
async function accessibleChannel(req: AuthRequest, res: Response, idOrSlug: string) {
  const channel = await loadChannel(idOrSlug);
  if (!channel || !(await canAccessChannel(req.userId!, channel))) {
    res.status(404).json({ success: false, message: 'Channel not found' });
    return null;
  }
  return channel;
}

/** Same for the channel a message lives in. */
async function accessibleMessage(req: AuthRequest, res: Response, messageId: string) {
  const message = mongoose.Types.ObjectId.isValid(messageId) ? await CommunityMessage.findById(messageId) : null;
  const channel = message ? await CommunityChannel.findById(message.channelId) : null;
  if (!message || !channel || !(await canAccessChannel(req.userId!, channel))) {
    res.status(404).json({ success: false, message: 'Message not found' });
    return null;
  }
  return { message, channel };
}

export type ServerRole = 'owner' | 'mod' | null;

/** The owner and the moderators the owner appointed are the staff of a server. */
export async function serverRole(userId: mongoose.Types.ObjectId | string, serverId: unknown): Promise<ServerRole> {
  if (!serverId) return null;
  const server = await CommunityServer.findById(serverId).select('ownerId modIds');
  if (!server) return null;
  if (String(server.ownerId) === String(userId)) return 'owner';
  return (server.modIds ?? []).some((m) => String(m) === String(userId)) ? 'mod' : null;
}

/** Members this member has hidden. */
async function blockedUserIds(userId: mongoose.Types.ObjectId | string): Promise<mongoose.Types.ObjectId[]> {
  const rows = await CommunityBlock.find({ userId }).select('blockedUserId').lean();
  return rows.map((r) => r.blockedUserId as mongoose.Types.ObjectId);
}

/** True when either person in a pair has blocked the other. */
async function eitherBlocked(a: mongoose.Types.ObjectId | string, b: mongoose.Types.ObjectId | string): Promise<boolean> {
  return !!(await CommunityBlock.exists({ $or: [{ userId: a, blockedUserId: b }, { userId: b, blockedUserId: a }] }));
}

/** An anonymous message must not carry its author's id to anyone but the author. */
function hideAnonymousSender<T extends { isAnonymous?: boolean; senderId?: unknown }>(msg: T, viewerId?: string): T {
  if (msg.isAnonymous && String(msg.senderId) !== viewerId) return { ...msg, senderId: 'anonymous' };
  return msg;
}

export const DISCORD_SEED_CHANNELS = [
  // Category: COMMUNITY & WELCOME
  {
    slug: 'welcome-and-rules',
    name: 'Welcome & Rules',
    description: 'Community guidelines, Spoonie culture etiquette, and medical disclaimers.',
    icon: '📢',
    color: '#6366F1',
    topic: 'Welcome to Lumen Community! Review community values, privacy, and pacing guidelines.',
    category: 'COMMUNITY & WELCOME',
    type: 'announcement' as const,
    order: 1,
    isFeatured: true,
  },
  {
    slug: 'general-lounge',
    name: 'General Lounge',
    description: 'Casual Spoonie chatter, gentle encouragement, and daily life shares.',
    icon: '💬',
    color: '#EC4899',
    topic: 'Relaxed conversations, mutual empathy, and gentle encouragement.',
    category: 'COMMUNITY & WELCOME',
    type: 'text' as const,
    order: 2,
    isFeatured: true,
  },

  // Category: CONDITION HUBS
  {
    slug: 'pots-dysautonomia',
    name: 'POTS & Dysautonomia',
    description: 'Postural tachycardia, orthostatic intolerance, salt pacing, and compression routines.',
    icon: '🫀',
    color: '#38BDF8',
    topic: 'Hydration & salt protocols, heart rate stability, and tilt table management.',
    category: 'CONDITION HUBS',
    type: 'text' as const,
    order: 3,
    isFeatured: true,
  },
  {
    slug: 'long-covid-mecfs',
    name: 'Long COVID & ME/CFS',
    description: 'Post-exertional malaise (PEM), cognitive fog, pacing checklists, and energy envelopes.',
    icon: '⚡',
    color: '#818CF8',
    topic: 'Pacing strategies, low-energy habit building, and crash recovery.',
    category: 'CONDITION HUBS',
    type: 'text' as const,
    order: 4,
    isFeatured: true,
  },
  {
    slug: 'chronic-pain-fibro',
    name: 'Chronic Pain & Fibromyalgia',
    description: 'Nerve pain management, sensory pacing, gentle physical therapy, and flare retrospectives.',
    icon: '🌿',
    color: '#10B981',
    topic: 'Gentle somatic relief, pacing routines, and pain journals.',
    category: 'CONDITION HUBS',
    type: 'text' as const,
    order: 5,
    isFeatured: true,
  },

  // Category: HEALTH STORIES & FORUMS (Discord Forum Mode)
  {
    slug: 'recovery-journeys',
    name: 'Recovery Journeys',
    description: 'Long-form patient recovery stories, diagnostic milestones, and breakthroughs.',
    icon: '🏷️',
    color: '#F59E0B',
    topic: 'Share your chronic illness story, timeline of diagnoses, and what made a difference.',
    category: 'HEALTH STORIES & FORUMS',
    type: 'forum' as const,
    order: 6,
    isFeatured: true,
  },
  {
    slug: 'treatment-trials',
    name: 'Treatments & Doctor Prep',
    description: 'Medication tracking notes, specialist appointment debriefs, and trial logs.',
    icon: '🔬',
    color: '#06B6D4',
    topic: 'Clinical appointment preparation, questions for specialists, and trial logs.',
    category: 'HEALTH STORIES & FORUMS',
    type: 'forum' as const,
    order: 7,
    isFeatured: false,
  },

  // Category: TEMPLATE & NOTE EXCHANGE
  {
    slug: 'notion-notes-hub',
    name: 'Notion Notes Hub',
    description: 'Exchange structured Lumen Notion notes, symptom summaries, and doctor prep sheets.',
    icon: '📑',
    color: '#A855F7',
    topic: '1-tap clone Notion-style health notes and clinical summaries into your personal library.',
    category: 'TEMPLATE & NOTE EXCHANGE',
    type: 'text' as const,
    order: 8,
    isFeatured: true,
  },
  {
    slug: 'todo-pacing-routines',
    name: 'ToDo Pacing Routines',
    description: 'Share energy-budgeted To-Do lists, crash-day routines, and morning ramps.',
    icon: '✅',
    color: '#14B8A6',
    topic: 'Import gentle To-Do routines with sub-steps and spoon energy tags.',
    category: 'TEMPLATE & NOTE EXCHANGE',
    type: 'text' as const,
    order: 9,
    isFeatured: false,
  },
  {
    slug: 'custom-log-trackers',
    name: 'Custom Log Trackers',
    description: 'Exchange custom log questions, multi-choice trackers, and quick-tap templates.',
    icon: '📊',
    color: '#F97316',
    topic: 'Discover and install customized log categories and quick-tap shortcuts.',
    category: 'TEMPLATE & NOTE EXCHANGE',
    type: 'text' as const,
    order: 10,
    isFeatured: false,
  },

  // Category: CARE & COMFORT
  {
    slug: 'flare-safehouse',
    name: 'Flare Safehouse',
    description: 'Low-energy zone for when you are actively in a crash. Anonymous posting enabled.',
    icon: '🚨',
    color: '#EF4444',
    topic: 'Safe space during flare-ups. No judgment, gentle spoon support only.',
    category: 'CARE & COMFORT',
    type: 'text' as const,
    order: 11,
    isFeatured: true,
  },
  {
    slug: 'small-wins-celebrations',
    name: 'Small Wins & Celebrations',
    description: 'Celebrate small steps: made the bed, 10 min walk, survived a medical appointment.',
    icon: '✨',
    color: '#EAB308',
    topic: 'Celebrate the wins only chronic illness warriors truly understand.',
    category: 'CARE & COMFORT',
    type: 'text' as const,
    order: 12,
    isFeatured: false,
  },
];

export const SEED_CHANNELS = DISCORD_SEED_CHANNELS;

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper: Seed or update official Discord server & channels.
// Requests can arrive together (the app opens the directory and a channel list at once), so this
// runs as one shared in-flight call and creates the server with an upsert on its unique slug.
let ensuringOfficial: Promise<InstanceType<typeof CommunityServer>> | null = null;

export function ensureOfficialServer(): Promise<InstanceType<typeof CommunityServer>> {
  if (!ensuringOfficial) {
    ensuringOfficial = seedOfficialServer().finally(() => { ensuringOfficial = null; });
  }
  return ensuringOfficial;
}

async function seedOfficialServer() {
  let official = await CommunityServer.findOne({ isOfficial: true });
  if (!official) {
    const adminUser = await User.findOne();
    const ownerId = adminUser ? adminUser._id : new mongoose.Types.ObjectId();
    try {
      official = await CommunityServer.findOneAndUpdate(
        { slug: 'lumen-spoonie-hub' },
        {
          $setOnInsert: {
            name: 'Lumen Spoonie Hub',
            slug: 'lumen-spoonie-hub',
            description: 'Official global community for chronic illness, neurodivergent pacing, and protocol sharing.',
            icon: '🫀',
            color: '#38BDF8',
            conditionTags: ['All Conditions', 'Pacing', 'Dysautonomia', 'ME/CFS', 'Fibromyalgia'],
            isPrivate: false,
            inviteCode: 'LUMEN1',
            ownerId,
            memberIds: [ownerId],
            membersCount: 1,
            isOfficial: true,
          },
        },
        { upsert: true, new: true }
      );
    } catch (err) {
      // Another instance created it between our read and write: use that one.
      if ((err as { code?: number }).code !== 11000) throw err;
      official = await CommunityServer.findOne({ slug: 'lumen-spoonie-hub' });
    }
  }
  if (!official) throw new Error('Official community server could not be created');
  const server = official;

  for (const seed of DISCORD_SEED_CHANNELS) {
    await CommunityChannel.findOneAndUpdate(
      { slug: seed.slug },
      { $set: { ...seed, serverId: server._id } },
      { upsert: true, new: true }
    );
  }

  return server;
}

// GET /api/v1/community/servers - list all accessible and public community servers
communityChatRouter.get('/servers', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const official = await ensureOfficialServer();

    const servers = await CommunityServer.find({
      $or: [
        { isOfficial: true },
        { isPrivate: false },
        { memberIds: userId },
      ],
    }).sort({ isOfficial: -1, membersCount: -1, createdAt: 1 });

    const formatted = servers.map((s) => {
      const obj = s.toObject();
      return {
        ...obj,
        isMember: s.memberIds.some((m) => m.toString() === userId.toString()),
      };
    });

    res.json({ success: true, data: formatted });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/community/servers - create custom community server with starter channels
communityChatRouter.post(
  '/servers',
  validate(CreateCommunityServerSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = uid(req);
      const { name, description, icon, color, conditionTags, isPrivate } = req.body;

      const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const uniqueSuffix = Math.random().toString(36).substring(2, 6);
      const slug = `${baseSlug}-${uniqueSuffix}`;
      const inviteCode = generateInviteCode();

      const server = await CommunityServer.create({
        name,
        slug,
        description: description || '',
        icon: icon || '🌟',
        color: color || '#38BDF8',
        conditionTags: conditionTags || ['Chronic Health'],
        isPrivate: Boolean(isPrivate),
        inviteCode,
        ownerId: userId,
        memberIds: [userId],
        membersCount: 1,
        isOfficial: false,
      });

      // Initialize 4 starter channels for the new server
      const starterChannels = [
        {
          serverId: server._id,
          name: 'General Chat',
          slug: `${slug}-general`,
          description: `General discussion for ${name}`,
          icon: '💬',
          color: color || '#38BDF8',
          topic: `Welcome to ${name}! Check in and say hello.`,
          category: 'COMMUNITY',
          type: 'text' as const,
          order: 1,
        },
        {
          serverId: server._id,
          name: 'Journey Stories',
          slug: `${slug}-stories`,
          description: 'Long-form stories, flare timelines, and recovery milestones.',
          icon: '🏷️',
          color: '#F59E0B',
          topic: 'Share your personal journey and protocol experiments.',
          category: 'STORIES & FORUMS',
          type: 'forum' as const,
          order: 2,
        },
        {
          serverId: server._id,
          name: 'Notes & Routines',
          slug: `${slug}-notes`,
          description: 'Exchange Lumen Notes, To-Do routines, and daily checklists.',
          icon: '📑',
          color: '#A855F7',
          topic: '1-tap clone shared templates from community members.',
          category: 'RESOURCE EXCHANGE',
          type: 'text' as const,
          order: 3,
        },
        {
          serverId: server._id,
          name: 'Flare Support',
          slug: `${slug}-flare`,
          description: 'Safe space during crash days. Anonymous posting enabled.',
          icon: '🚨',
          color: '#EF4444',
          topic: 'Low energy only. No pressure, gentle spoons.',
          category: 'CARE & COMFORT',
          type: 'text' as const,
          order: 4,
        },
      ];

      for (const ch of starterChannels) {
        await CommunityChannel.create(ch);
      }

      res.status(201).json({ success: true, data: server });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/community/servers/join - join community server by ID or invite code
communityChatRouter.post(
  '/servers/join',
  validate(JoinCommunityServerSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = uid(req);
      const { serverId, inviteCode } = req.body;

      let server;
      if (inviteCode) {
        server = await CommunityServer.findOne({
          inviteCode: inviteCode.trim().toUpperCase(),
        });
      } else if (serverId && mongoose.Types.ObjectId.isValid(serverId)) {
        server = await CommunityServer.findById(serverId);
        // A private server can only be joined with its invite code, never by id.
        if (server && server.isPrivate && !server.isOfficial && !server.memberIds.some((m) => m.toString() === userId.toString())) {
          server = null;
        }
      }

      if (!server) {
        return res.status(404).json({ success: false, message: 'Community server not found or invalid invite code' });
      }

      // If user not already member, add them
      const alreadyMember = server.memberIds.some((m) => m.toString() === userId.toString());
      if (!alreadyMember) {
        server.memberIds.push(userId);
        server.membersCount = server.memberIds.length;
        await server.save();
      }

      res.json({ success: true, data: server });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/community/servers/:serverId - owner edits name, description, icon, colour
communityChatRouter.patch(
  '/servers/:serverId',
  validate(UpdateCommunityServerSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const server = mongoose.Types.ObjectId.isValid(req.params.serverId) ? await CommunityServer.findById(req.params.serverId) : null;
      if (!server) return res.status(404).json({ success: false, message: 'Community server not found' });
      if (server.ownerId.toString() !== req.userId) {
        return res.status(403).json({ success: false, message: 'Only the server owner can change settings' });
      }
      const { name, description, icon, color } = req.body;
      if (name !== undefined) server.name = name;
      if (description !== undefined) server.description = description;
      if (icon !== undefined) server.icon = icon;
      if (color !== undefined) server.color = color;
      await server.save();
      res.json({ success: true, data: { ...server.toObject(), isMember: true } });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/v1/community/servers/:serverId - owner deletes a server with all its channels and messages
communityChatRouter.delete('/servers/:serverId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const server = mongoose.Types.ObjectId.isValid(req.params.serverId) ? await CommunityServer.findById(req.params.serverId) : null;
    if (!server) return res.status(404).json({ success: false, message: 'Community server not found' });
    if (server.isOfficial) return res.status(403).json({ success: false, message: 'The official community cannot be deleted' });
    if (server.ownerId.toString() !== req.userId) {
      return res.status(403).json({ success: false, message: 'Only the server owner can delete it' });
    }
    const channelIds = (await CommunityChannel.find({ serverId: server._id }).select('_id').lean()).map((c) => c._id);
    await Promise.all([
      CommunityMessage.deleteMany({ channelId: { $in: channelIds } }),
      ForumPost.deleteMany({ channelId: { $in: channelIds } }),
      ChannelReadState.deleteMany({ channelId: { $in: channelIds } }),
      ServerTimeout.deleteMany({ serverId: server._id }),
    ]);
    await CommunityChannel.deleteMany({ serverId: server._id });
    await server.deleteOne();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/community/servers/:serverId/moderators - owner appoints or removes a moderator
communityChatRouter.post(
  '/servers/:serverId/moderators',
  validate(SetModeratorSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const server = mongoose.Types.ObjectId.isValid(req.params.serverId) ? await CommunityServer.findById(req.params.serverId) : null;
      if (!server) return res.status(404).json({ success: false, message: 'Community server not found' });
      if (server.ownerId.toString() !== req.userId) {
        return res.status(403).json({ success: false, message: 'Only the server owner can appoint moderators' });
      }
      const { userId, isMod } = req.body as { userId: string; isMod: boolean };
      if (userId === req.userId) return res.status(400).json({ success: false, message: 'The owner already has full control' });
      if (!server.memberIds.some((m) => String(m) === userId)) {
        return res.status(400).json({ success: false, message: 'Only members of this community can be moderators' });
      }
      const others = (server.modIds ?? []).filter((m) => String(m) !== userId);
      server.modIds = (isMod ? [...others, new mongoose.Types.ObjectId(userId)] : others) as typeof server.modIds;
      await server.save();
      res.json({ success: true, data: { modIds: server.modIds.map(String) } });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/community/servers/:serverId/leave - a member leaves (the owner must delete instead)
communityChatRouter.post('/servers/:serverId/leave', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const server = mongoose.Types.ObjectId.isValid(req.params.serverId) ? await CommunityServer.findById(req.params.serverId) : null;
    if (!server) return res.status(404).json({ success: false, message: 'Community server not found' });
    if (server.ownerId.toString() === req.userId) {
      return res.status(400).json({ success: false, message: 'You own this server. Delete it instead of leaving.' });
    }
    server.memberIds = server.memberIds.filter((m) => m.toString() !== req.userId) as typeof server.memberIds;
    server.membersCount = server.memberIds.length;
    await server.save();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/community/servers/:serverId/members - names of the members (never tied to anonymous posts)
communityChatRouter.get('/servers/:serverId/members', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const server = mongoose.Types.ObjectId.isValid(req.params.serverId) ? await CommunityServer.findById(req.params.serverId) : null;
    const me = String(req.userId);
    if (!server || (server.isPrivate && !server.isOfficial && !server.memberIds.some((m) => String(m) === me))) {
      return res.status(404).json({ success: false, message: 'Community server not found' });
    }
    const users = await User.find({ _id: { $in: server.memberIds.slice(0, 200) } }).select('name').lean();
    const data = users
      .map((u) => ({
        userId: String(u._id),
        displayName: u.name || 'Lumen Member',
        isOwner: String(u._id) === String(server.ownerId),
        isMod: (server.modIds ?? []).some((m) => String(m) === String(u._id)),
      }))
      .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.displayName.localeCompare(b.displayName));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/community/servers/:serverId/channels - create custom channel inside server
communityChatRouter.post(
  '/servers/:serverId/channels',
  validate(CreateCommunityChannelSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { serverId } = req.params;
      const { name, description, icon, color, topic, category, type } = req.body;

      if (!mongoose.Types.ObjectId.isValid(serverId)) {
        return res.status(400).json({ success: false, message: 'Invalid server ID' });
      }

      const server = await CommunityServer.findById(serverId);
      if (!server) {
        return res.status(404).json({ success: false, message: 'Community server not found' });
      }
      if (server.ownerId.toString() !== req.userId) {
        return res.status(403).json({ success: false, message: 'Only the server owner can create channels' });
      }

      const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const uniqueSuffix = Math.random().toString(36).substring(2, 6);
      const slug = `${server.slug}-${baseSlug}-${uniqueSuffix}`;

      const count = await CommunityChannel.countDocuments({ serverId: server._id });

      const channel = await CommunityChannel.create({
        serverId: server._id,
        name,
        slug,
        description: description || '',
        icon: icon || '💬',
        color: color || server.color,
        topic: topic || '',
        category: category || 'COMMUNITY',
        type: type || 'text',
        order: count + 1,
      });

      res.status(201).json({ success: true, data: channel });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/community/notifications?since=<ISO date> - replies to my messages and @mentions of me
communityChatRouter.get('/notifications', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = uid(req);
    const user = await User.findById(userId).select('name');
    const asked = req.query.since ? new Date(String(req.query.since)) : null;
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const monthAgo = new Date(Date.now() - 30 * 86400000);
    let since = asked && !isNaN(asked.getTime()) ? asked : weekAgo;
    if (since < monthAgo) since = monthAgo;

    const data = await buildCommunityNotifications({ _id: userId, name: user?.name }, since);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/community/channels - list all community channels for current/specified server
communityChatRouter.get('/channels', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const official = await ensureOfficialServer();
    const serverIdParam = req.query.serverId as string;

    let targetServerId: mongoose.Types.ObjectId;
    if (serverIdParam && mongoose.Types.ObjectId.isValid(serverIdParam)) {
      targetServerId = new mongoose.Types.ObjectId(serverIdParam);
    } else {
      targetServerId = official._id as mongoose.Types.ObjectId;
    }

    const targetServer = await CommunityServer.findById(targetServerId).select('isPrivate isOfficial memberIds');
    const me = String(req.userId);
    if (!targetServer || (targetServer.isPrivate && !targetServer.isOfficial && !targetServer.memberIds.some((m) => String(m) === me))) {
      return res.status(404).json({ success: false, message: 'Community server not found' });
    }

    const channels = await CommunityChannel.find({ serverId: targetServerId, type: { $ne: 'dm' } }).sort({ order: 1, createdAt: 1 }).lean();

    // Unread = other people's messages after the member last opened the channel. A channel they never
    // opened shows no badge (it is all new, which is not useful to count).
    const meId = new mongoose.Types.ObjectId(String(req.userId));
    const states = await ChannelReadState.find({ userId: meId, channelId: { $in: channels.map((c) => c._id) } }).select('channelId lastReadAt').lean();
    const readAt = new Map(states.map((s) => [String(s.channelId), s.lastReadAt]));
    const withUnread = await Promise.all(channels.map(async (c) => {
      const since = readAt.get(String(c._id));
      if (!since || c.type === 'forum') return { ...c, unreadCount: 0 };
      const unreadCount = await CommunityMessage.countDocuments({ channelId: c._id, createdAt: { $gt: since }, senderId: { $ne: meId } }).limit(99);
      return { ...c, unreadCount };
    }));

    res.json({ success: true, data: withUnread });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/community/channels/:channelId/messages - get channel messages stream
communityChatRouter.get(
  '/channels/:channelId/messages',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { channelId } = req.params;
      const userId = uid(req);
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);

      const filter: Record<string, unknown> = {};
      const channel = await accessibleChannel(req, res, channelId);
      if (!channel) return;
      filter.channelId = channel._id;
      const hidden = await blockedUserIds(userId);
      if (hidden.length) filter.senderId = { $nin: hidden };

      if (req.query.before) {
        filter.createdAt = { $lt: new Date(req.query.before as string) };
      }

      const messages = await CommunityMessage.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      const userStr = userId.toString();
      const withAudio = await withFreshAudio(messages as any[]);
      const formatted = withAudio.reverse().map((msg: any) => {
        const reactionsObj: Record<string, number> = {};
        if (msg.reactions) {
          if (msg.reactions instanceof Map) {
            msg.reactions.forEach((count: number, key: string) => {
              if (count > 0) reactionsObj[key] = count;
            });
          } else if (typeof msg.reactions === 'object') {
            for (const [k, v] of Object.entries(msg.reactions)) {
              if (Number(v) > 0) reactionsObj[k] = Number(v);
            }
          }
        }

        let userReacts: string[] = [];
        if (msg.userReactions) {
          if (msg.userReactions instanceof Map) {
            userReacts = msg.userReactions.get(userStr) || [];
          } else if (typeof msg.userReactions === 'object') {
            userReacts = (msg.userReactions as Record<string, string[]>)[userStr] || [];
          }
        }

        return hideAnonymousSender({
          ...msg,
          reactions: reactionsObj,
          userReactions: userReacts,
        }, userStr);
      });

      res.json({ success: true, data: formatted });
    } catch (err) {
      next(err);
    }
  }
);

// Helper to format messages with lean reaction objects
function formatLeanMessage(msg: any, currentUserIdStr?: string) {
  const reactionsObj: Record<string, number> = {};
  if (msg.reactions) {
    if (msg.reactions instanceof Map) {
      msg.reactions.forEach((count: number, key: string) => {
        if (count > 0) reactionsObj[key] = count;
      });
    } else if (typeof msg.reactions === 'object') {
      for (const [k, v] of Object.entries(msg.reactions)) {
        if (Number(v) > 0) reactionsObj[k] = Number(v);
      }
    }
  }

  let userReacts: string[] = [];
  if (currentUserIdStr && msg.userReactions) {
    if (msg.userReactions instanceof Map) {
      userReacts = msg.userReactions.get(currentUserIdStr) || [];
    } else if (typeof msg.userReactions === 'object') {
      userReacts = (msg.userReactions as Record<string, string[]>)[currentUserIdStr] || [];
    }
  }

  const raw = typeof msg.toObject === 'function' ? msg.toObject() : msg;
  return {
    ...raw,
    _id: raw._id.toString(),
    channelId: raw.channelId.toString(),
    senderId: raw.senderId.toString(),
    reactions: reactionsObj,
    userReactions: userReacts,
  };
}

// POST /api/v1/community/channels/:channelId/messages - post message with Discord inline reply and rich embed
communityChatRouter.post(
  '/channels/:channelId/messages',
  validate(CreateCommunityMessageSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { channelId } = req.params;
      const userId = uid(req);
      const {
        content,
        contentWarning,
        isAnonymous,
        senderAvatarEmoji,
        senderRoleColor,
        senderRoleBadges,
        mentions,
        audioUrl,
        audioMediaId,
        audioDurationSeconds,
        replyTo,
        embedType,
        embedData,
      } = req.body;

      // AutoMod safehouse inspection
      if (content) {
        const check = validateAutoMod(content);
        if (check.blocked) {
          return res.status(400).json({ success: false, message: check.reason });
        }
      }

      // Validate channel and access
      const targetChannel: any = await accessibleChannel(req, res, channelId);
      if (!targetChannel) return;

      if (targetChannel.type === 'dm') {
        const peer = (targetChannel.dmMemberIds ?? []).find((m: any) => String(m) !== userId.toString());
        if (peer && (await eitherBlocked(userId, peer))) {
          return res.status(403).json({ success: false, message: 'You cannot message this person' });
        }
      }

      // A DM from someone new is a request: a few messages are allowed, then they wait for it to be accepted.
      let dmPending = false;
      if (targetChannel.type === 'dm') {
        const iStarted = String(targetChannel.dmInitiatorId ?? '') === userId.toString();
        const status = targetChannel.dmStatus ?? 'accepted';
        if (status === 'declined' && iStarted) {
          return res.status(403).json({ success: false, message: 'This person did not accept your message request' });
        }
        if (status === 'pending' && iStarted) {
          dmPending = true;
          const already = await CommunityMessage.countDocuments({ channelId: targetChannel._id, senderId: userId });
          if (already >= 3) {
            return res.status(403).json({ success: false, message: 'Wait until they accept your message request before sending more' });
          }
        } else if (status !== 'accepted') {
          // Replying to a request accepts it.
          await CommunityChannel.findByIdAndUpdate(targetChannel._id, { $set: { dmStatus: 'accepted' } });
        }
      }

      const callerRole = await serverRole(userId, targetChannel.serverId);
      if (targetChannel.type === 'announcement' && !callerRole) {
        return res.status(403).json({ success: false, message: 'Only the server owner and moderators can post in an announcement channel' });
      }

      // Slow mode: regular members wait between messages; the staff are exempt.
      if (targetChannel.slowModeSeconds > 0 && !callerRole) {
        const last = await CommunityMessage.findOne({ channelId: targetChannel._id, senderId: userId }).sort({ createdAt: -1 }).select('createdAt').lean();
        const waitMs = last ? targetChannel.slowModeSeconds * 1000 - (Date.now() - new Date(last.createdAt).getTime()) : 0;
        if (waitMs > 0) {
          return res.status(429).json({ success: false, message: `Slow mode is on. You can send again in ${Math.ceil(waitMs / 1000)} seconds.` });
        }
      }

      const targetChannelId = targetChannel._id as mongoose.Types.ObjectId;

      // Moderation timeout check: verify user is not timed out in this server
      if (targetChannel.serverId) {
        const activeTimeout = await ServerTimeout.findOne({
          serverId: targetChannel.serverId,
          userId,
          timedOutUntil: { $gt: new Date() },
        });
        if (activeTimeout) {
          return res.status(403).json({
            success: false,
            message: `You are temporarily timed out in this server until ${activeTimeout.timedOutUntil.toLocaleTimeString()}. Reason: ${activeTimeout.reason || 'Community guidelines violation'}`,
          });
        }
      }

      // Fetch user profile info
      const user = await User.findById(userId);
      const displayName = isAnonymous
        ? 'Anonymous Spoonie'
        : user?.name || 'Lumen Member';

      // Badges and colour are decided here, never taken from the client.
      const avatarEmoji = isAnonymous ? '🥄' : senderAvatarEmoji || '🌟';
      const roleColor = isAnonymous ? '#94A3B8' : callerRole === 'owner' ? '#F59E0B' : callerRole === 'mod' ? '#22C55E' : '#38BDF8';
      const roleBadges = isAnonymous ? ['Anonymous Spoonie'] : callerRole === 'owner' ? ['Owner'] : callerRole === 'mod' ? ['Moderator'] : ['Community Member'];

      // The quoted name and text come from the real parent message in this channel, not from the client.
      let replyToData;
      if (replyTo && replyTo.messageId && mongoose.Types.ObjectId.isValid(replyTo.messageId)) {
        const parent = await CommunityMessage.findOne({ _id: replyTo.messageId, channelId: targetChannel._id });
        if (parent) {
          replyToData = {
            messageId: parent._id,
            senderDisplayName: parent.senderDisplayName,
            snippet: (parent.content || (parent.audioUrl ? 'Voice note' : 'Shared something')).slice(0, 150),
          };
          await CommunityMessage.findByIdAndUpdate(parent._id, {
            $inc: { 'threadMeta.replyCount': 1 },
            $set: { 'threadMeta.lastReplyAt': new Date() },
          });
        } else {
          // Not a chat message: it may be a forum post in this channel, whose replies are stored as messages.
          const post = await ForumPost.findOneAndUpdate(
            { _id: replyTo.messageId, channelId: targetChannel._id },
            { $inc: { 'stats.replyCount': 1 } },
            { new: true },
          );
          if (post) {
            replyToData = { messageId: post._id, senderDisplayName: post.author.isAnonymous ? 'Anonymous Spoonie' : post.author.senderDisplayName, snippet: post.title.slice(0, 150) };
          }
        }
      }

      // A photo must be an image the sender uploaded to Lumen; links to anywhere else are not accepted.
      let messageEmbedData = embedData;
      if (embedType === 'photo') {
        const photoId = embedData?.photoMediaId;
        const photo = photoId && mongoose.Types.ObjectId.isValid(photoId) ? await Media.findOne({ _id: photoId, userId }).select('_id mimeType') : null;
        if (!photo || !String(photo.mimeType || '').startsWith('image/')) {
          return res.status(400).json({ success: false, message: 'Photo could not be attached. Please upload it again.' });
        }
        messageEmbedData = { photoMediaId: String(photo._id), caption: embedData?.caption };
      }

      let voiceMediaId: mongoose.Types.ObjectId | undefined;
      if (audioMediaId && mongoose.Types.ObjectId.isValid(audioMediaId)) {
        const owned = await Media.findOne({ _id: audioMediaId, userId }).select('_id');
        if (owned) voiceMediaId = owned._id as mongoose.Types.ObjectId;
      }

      const message = await CommunityMessage.create({
        channelId: targetChannelId,
        senderId: userId,
        senderDisplayName: displayName,
        senderAvatarEmoji: avatarEmoji,
        senderRoleColor: roleColor,
        senderRoleBadges: roleBadges,
        isAnonymous: Boolean(isAnonymous),
        content: content || '',
        contentWarning: contentWarning || undefined,
        mentions: mentions || [],
        audioUrl: voiceMediaId ? undefined : audioUrl,
        audioMediaId: voiceMediaId,
        audioDurationSeconds,
        replyTo: replyToData,
        threadMeta: { replyCount: 0 },
        embedType,
        embedData: messageEmbedData,
        reactions: {},
        userReactions: {},
        cloneCount: 0,
      });

      // Increment channel message count
      await CommunityChannel.findByIdAndUpdate(targetChannelId, { $inc: { messageCount: 1 } });

      const [formatted] = await withFreshAudio([formatLeanMessage(message, userId.toString())]);
      const publicView = hideAnonymousSender(formatted);

      // Broadcast real-time message creation via Socket.IO
      const dmUserIds =
        targetChannel.type === 'dm' && targetChannel.dmMemberIds
          ? targetChannel.dmMemberIds.map((m: any) => m.toString())
          : undefined;
      broadcastMessageCreated(targetChannelId.toString(), publicView, dmUserIds);

      // Push for DMs, replies and @mentions only; runs after the response and never blocks it.
      void notifyCommunityMessage({
        channel: targetChannel,
        message,
        senderId: userId.toString(),
        replyToMessageId: replyToData?.messageId,
        dmPending,
        canSee: async (id) => (await canAccessChannel(id, targetChannel)) && !(await eitherBlocked(id, userId)),
      });

      res.status(201).json({
        success: true,
        data: formatted,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/community/messages/:id/react - toggle chronic empathy reaction
communityChatRouter.post(
  '/messages/:id/react',
  validate(ReactCommunityMessageSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = uid(req).toString();
      const { emoji } = req.body;

      const found = await accessibleMessage(req, res, req.params.id);
      if (!found) return;
      const { message } = found;

      if (!message.reactions) message.reactions = new Map();
      if (!message.userReactions) message.userReactions = new Map();

      const userList: string[] = message.userReactions.get(userId) || [];
      const hasReacted = userList.includes(emoji);

      const currentCount = message.reactions.get(emoji) || 0;

      if (hasReacted) {
        const nextList = userList.filter((e) => e !== emoji);
        message.userReactions.set(userId, nextList);
        message.reactions.set(emoji, Math.max(0, currentCount - 1));
      } else {
        userList.push(emoji);
        message.userReactions.set(userId, userList);
        message.reactions.set(emoji, currentCount + 1);
      }

      await message.save();

      const reactionsObj: Record<string, number> = {};
      message.reactions.forEach((count, key) => {
        if (count > 0) reactionsObj[key] = count;
      });

      const userReactions = message.userReactions.get(userId) || [];

      // Broadcast reaction update to all users in channel room
      broadcastReactionUpdated(message.channelId.toString(), {
        messageId: message._id.toString(),
        reactions: reactionsObj,
        userReactions,
      });

      res.json({
        success: true,
        data: {
          messageId: message._id,
          reactions: reactionsObj,
          userReactions,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/community/channels/:channelId/messages/:messageId - Edit message content
communityChatRouter.patch(
  '/channels/:channelId/messages/:messageId',
  validate(EditCommunityMessageSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { channelId, messageId } = req.params;
      const userId = uid(req);
      const { content } = req.body;

      // AutoMod inspection on edit
      const check = validateAutoMod(content);
      if (check.blocked) {
        return res.status(400).json({ success: false, message: check.reason });
      }

      const found = await accessibleMessage(req, res, messageId);
      if (!found) return;
      const { message } = found;

      // Only message author can edit
      if (message.senderId.toString() !== userId.toString()) {
        return res.status(403).json({ success: false, message: 'Only author can edit this message' });
      }

      message.content = content;
      message.isEdited = true;
      message.editedAt = new Date();
      await message.save();

      const formatted = formatLeanMessage(message, userId.toString());
      broadcastMessageUpdated(message.channelId.toString(), hideAnonymousSender(formatted));

      res.json({ success: true, data: formatted });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/v1/community/channels/:channelId/messages/:messageId - Delete message
communityChatRouter.delete(
  '/channels/:channelId/messages/:messageId',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { channelId, messageId } = req.params;
      const userId = uid(req);

      const found = await accessibleMessage(req, res, messageId);
      if (!found) return;
      const { message } = found;

      // Check authorization: the author, or the staff of the server (owner or moderator)
      const canDelete = message.senderId.toString() === userId.toString() || Boolean(await serverRole(userId, found.channel.serverId));

      if (!canDelete) {
        return res.status(403).json({ success: false, message: 'Not authorized to delete this message' });
      }

      await CommunityMessage.findByIdAndDelete(messageId);
      await CommunityChannel.findByIdAndUpdate(message.channelId, { $inc: { messageCount: -1 } });

      broadcastMessageDeleted(message.channelId.toString(), messageId);

      res.json({ success: true, messageId });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/community/channels/:channelId/messages/:messageId/pin - Toggle pin status
communityChatRouter.post(
  '/channels/:channelId/messages/:messageId/pin',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { channelId, messageId } = req.params;
      const userId = uid(req);

      const found = await accessibleMessage(req, res, messageId);
      if (!found) return;
      const { message, channel: pinChannel } = found;

      const mayPin = message.senderId.toString() === userId.toString() || Boolean(await serverRole(userId, pinChannel.serverId));
      if (!mayPin) {
        return res.status(403).json({ success: false, message: 'Only the author, a moderator or the server owner can pin this message' });
      }

      const user = await User.findById(userId);
      const isCurrentlyPinned = Boolean(message.isPinned);

      if (isCurrentlyPinned) {
        message.isPinned = false;
        message.pinnedAt = undefined;
        message.pinnedBy = undefined;
      } else {
        message.isPinned = true;
        message.pinnedAt = new Date();
        message.pinnedBy = {
          userId,
          displayName: user?.name || 'Community Member',
        };
      }

      await message.save();

      const formatted = formatLeanMessage(message, userId.toString());
      broadcastMessageUpdated(message.channelId.toString(), hideAnonymousSender(formatted));

      res.json({ success: true, data: formatted });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/community/channels/:channelId/pins - List pinned messages in channel
communityChatRouter.get(
  '/channels/:channelId/pins',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { channelId } = req.params;
      const userId = uid(req);

      const gated = await accessibleChannel(req, res, channelId);
      if (!gated) return;
      const targetChannelId = gated._id as mongoose.Types.ObjectId;

      const hiddenPinAuthors = await blockedUserIds(userId);
      const pins = await CommunityMessage.find({
        channelId: targetChannelId,
        isPinned: true,
        ...(hiddenPinAuthors.length ? { senderId: { $nin: hiddenPinAuthors } } : {}),
      })
        .sort({ pinnedAt: -1, createdAt: -1 })
        .lean();

      const formatted = (await withFreshAudio(pins as any[])).map((p) => hideAnonymousSender(formatLeanMessage(p, userId.toString()), userId.toString()));
      res.json({ success: true, data: formatted });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/community/channels/:channelId/read - Mark channel as read up to messageId
communityChatRouter.post(
  '/channels/:channelId/read',
  validate(MarkChannelReadSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { channelId } = req.params;
      const userId = uid(req);
      const { lastReadMessageId } = req.body;

      const gated = await accessibleChannel(req, res, channelId);
      if (!gated) return;
      const targetChannelId = gated._id as mongoose.Types.ObjectId;

      const readState = await ChannelReadState.findOneAndUpdate(
        { userId, channelId: targetChannelId },
        {
          $set: {
            lastReadMessageId: lastReadMessageId && mongoose.Types.ObjectId.isValid(lastReadMessageId)
              ? new mongoose.Types.ObjectId(lastReadMessageId)
              : undefined,
            lastReadAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );

      res.json({ success: true, data: readState });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/community/channels/:channelId/read - Get user's read state in channel
communityChatRouter.get(
  '/channels/:channelId/read',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { channelId } = req.params;
      const userId = uid(req);

      const gated = await accessibleChannel(req, res, channelId);
      if (!gated) return;
      const targetChannelId = gated._id as mongoose.Types.ObjectId;

      const readState = await ChannelReadState.findOne({ userId, channelId: targetChannelId });
      res.json({
        success: true,
        data: readState
          ? {
              lastReadMessageId: readState.lastReadMessageId?.toString(),
              lastReadAt: readState.lastReadAt,
            }
          : null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ────────── Direct Messages (DMs) API ──────────

// GET /api/v1/community/people?q=name - find someone to message, without opening a channel first.
// Only people the member could already see in the community: members of communities they can open, and
// people who posted under their own name in those channels. Never anonymous posters, never blocked people.
communityChatRouter.get('/people', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q ?? '').trim().slice(0, 40);
    if (q.length < 2) return res.json({ success: true, data: [] });
    const me = uid(req);

    const servers = await CommunityServer.find({ $or: [{ isOfficial: true }, { isPrivate: false }, { memberIds: me }] })
      .select('_id memberIds ownerId')
      .limit(200)
      .lean();
    const channelIds = (await CommunityChannel.find({ serverId: { $in: servers.map((s) => s._id) }, type: { $ne: 'dm' } }).select('_id').limit(500).lean()).map((c) => c._id);
    const posters = await CommunityMessage.distinct('senderId', {
      channelId: { $in: channelIds },
      isAnonymous: false,
      createdAt: { $gte: new Date(Date.now() - 60 * 86_400_000) },
    });

    const candidates = new Set<string>();
    servers.forEach((s) => {
      candidates.add(String(s.ownerId));
      (s.memberIds ?? []).forEach((m) => candidates.add(String(m)));
    });
    posters.forEach((p: unknown) => candidates.add(String(p)));
    candidates.delete(me.toString());

    const [mine, blockedMe] = await Promise.all([
      blockedUserIds(me),
      CommunityBlock.find({ blockedUserId: me }).select('userId').lean(),
    ]);
    [...mine, ...blockedMe.map((b) => b.userId)].forEach((id) => candidates.delete(String(id)));

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ids = Array.from(candidates).filter((id) => mongoose.Types.ObjectId.isValid(id)).slice(0, 1000);
    const users = ids.length
      ? await User.find({ _id: { $in: ids }, name: { $regex: escaped, $options: 'i' } }).select('name').limit(20).lean()
      : [];
    res.json({
      success: true,
      data: users.map((u) => ({ userId: String(u._id), displayName: u.name || 'Lumen Member' })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/community/dms - List all 1-on-1 DMs for current user
communityChatRouter.get(
  '/dms',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = uid(req);

      const dmChannels = await CommunityChannel.find({
        type: 'dm',
        dmMemberIds: userId,
      })
        .sort({ updatedAt: -1 })
        .lean();

      // Enrich with target user profile
      const enriched = await Promise.all(
        dmChannels.map(async (c: any) => {
          const targetUserId = (c.dmMemberIds || []).find((id: any) => id.toString() !== userId.toString());
          let dmUser: any = null;
          if (targetUserId) {
            const u = await User.findById(targetUserId).lean();
            if (u) {
              dmUser = {
                _id: u._id.toString(),
                displayName: u.name || 'Lumen Member',
                avatarEmoji: '🌟',
              };
            }
          }

          // Fetch read state
          const readState = await ChannelReadState.findOne({ userId, channelId: c._id });

          return {
            ...c,
            _id: c._id.toString(),
            name: dmUser?.displayName || c.name,
            dmUser,
            lastReadMessageId: readState?.lastReadMessageId?.toString(),
          };
        })
      );

      res.json({ success: true, data: enriched });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/community/dms - Find or create 1-on-1 DM channel
communityChatRouter.post(
  '/dms',
  validate(CreateDmChannelSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = uid(req);
      const { targetUserId } = req.body;

      if (userId.toString() === targetUserId) {
        return res.status(400).json({ success: false, message: 'Cannot start DM with yourself' });
      }

      const targetObjectId = new mongoose.Types.ObjectId(targetUserId);
      const targetUser = await User.findById(targetObjectId);
      if (!targetUser) {
        return res.status(404).json({ success: false, message: 'Target user not found' });
      }

      if (await eitherBlocked(userId, targetObjectId)) {
        return res.status(403).json({ success: false, message: 'You cannot message this person' });
      }

      // Check existing DM
      let dmChannel = await CommunityChannel.findOne({
        type: 'dm',
        dmMemberIds: { $all: [userId, targetObjectId], $size: 2 },
      });

      if (!dmChannel) {
        const slug = `dm-${userId.toString().slice(-4)}-${targetUserId.slice(-4)}-${Date.now().toString(36)}`;
        dmChannel = await CommunityChannel.create({
          slug,
          name: targetUser.name || 'Direct Message',
          description: `Direct conversation with ${targetUser.name || 'Member'}`,
          icon: '💬',
          color: '#EC4899',
          topic: 'Private 1-on-1 conversation',
          category: 'DIRECT MESSAGES',
          type: 'dm',
          dmMemberIds: [userId, targetObjectId],
          order: 0,
          memberCount: 2,
          messageCount: 0,
          dmInitiatorId: userId,
          dmStatus: 'pending',
        });
      } else if (dmChannel.dmStatus === 'declined' && String(dmChannel.dmInitiatorId) !== userId.toString()) {
        // The person who declined now reaches out themselves: that opens the conversation.
        dmChannel.dmStatus = 'accepted';
        await dmChannel.save();
      }

      const resObj = dmChannel.toObject();
      res.status(201).json({
        success: true,
        data: {
          ...resObj,
          _id: resObj._id.toString(),
          dmUser: {
            _id: targetUser._id.toString(),
            displayName: targetUser.name || 'Lumen Member',
            avatarEmoji: '🌟',
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ────────── Moderation API ──────────

// POST /api/v1/community/servers/:serverId/timeout - Timeout / mute a member in a server
communityChatRouter.post(
  '/servers/:serverId/timeout',
  validate(TimeoutUserSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const callerId = uid(req);
      const { serverId } = req.params;
      const { userId, durationMinutes, reason } = req.body;

      const server = await CommunityServer.findById(serverId);
      if (!server) {
        return res.status(404).json({ success: false, message: 'Server not found' });
      }

      // Owner and moderators can time members out. Nobody can time out the owner, and only the owner can time out a moderator.
      const callerStaff = await serverRole(callerId, server._id);
      if (!callerStaff) {
        return res.status(403).json({ success: false, message: 'Only the server owner and moderators can timeout members' });
      }
      const targetStaff = await serverRole(userId, server._id);
      if (targetStaff === 'owner' || (targetStaff === 'mod' && callerStaff !== 'owner')) {
        return res.status(403).json({ success: false, message: 'You cannot timeout this member' });
      }

      const timedOutUntil = new Date(Date.now() + durationMinutes * 60 * 1000);

      const timeoutRecord = await ServerTimeout.findOneAndUpdate(
        { serverId: server._id, userId: new mongoose.Types.ObjectId(userId) },
        {
          $set: {
            timedOutUntil,
            reason: reason || 'Violation of community pacing/respect guidelines',
            timedOutBy: callerId,
          },
        },
        { upsert: true, new: true }
      );

      res.json({
        success: true,
        message: `User timed out until ${timedOutUntil.toLocaleTimeString()}`,
        data: timeoutRecord,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/community/messages/:id/clone - track artifact remix/clone count
communityChatRouter.post(
  '/messages/:id/clone',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const found = await accessibleMessage(req, res, req.params.id);
      if (!found) return;
      const message = await CommunityMessage.findByIdAndUpdate(found.message._id, { $inc: { cloneCount: 1 } }, { new: true });
      res.json({ success: true, cloneCount: message?.cloneCount ?? 0 });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/community/messages/:id/install-template - turn a shared tracking template into a draft the
// member reviews (and can undo) in the same screen used for AI template drafts. Nothing is added until they confirm.
communityChatRouter.post(
  '/messages/:id/install-template',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const found = await accessibleMessage(req, res, req.params.id);
      if (!found) return;
      const embed = (found.message.embedData as { logTemplate?: unknown } | undefined)?.logTemplate;
      if (found.message.embedType !== 'log_template' || !embed) {
        return res.status(400).json({ success: false, message: 'This message is not a tracking template' });
      }
      const proposal = sharedTemplateToProposal(embed);
      const draft = proposal ? await createDraft(String(req.userId), proposal, { request: 'Installed from community' }) : null;
      if (!draft) {
        return res.status(422).json({ success: false, message: 'This shared template has nothing new to add, or was shared by an older version of the app.' });
      }
      await CommunityMessage.findByIdAndUpdate(found.message._id, { $inc: { cloneCount: 1 } });
      res.status(201).json({ success: true, data: { draftId: String(draft._id), draft: draftPayload(draft) } });
    } catch (err) {
      next(err);
    }
  }
);

// ────────── Personal community settings ──────────

// GET /api/v1/community/me/settings - my status and whether community push is on
communityChatRouter.get('/me/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = await User.findById(uid(req)).select('preferences.communityStatus preferences.communityPush preferences.communityQuiet').lean();
    const prefs = (me?.preferences ?? {}) as { communityStatus?: string; communityPush?: boolean; communityQuiet?: boolean };
    res.json({ success: true, data: { status: prefs.communityStatus ?? '', push: prefs.communityPush !== false, quiet: prefs.communityQuiet === true } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/community/me/settings - set a short status and/or mute community push
communityChatRouter.put(
  '/me/settings',
  validate(CommunitySettingsSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { status, push, quiet } = req.body as { status?: string; push?: boolean; quiet?: boolean };
      const set: Record<string, unknown> = {};
      const unset: Record<string, ''> = {};
      if (status !== undefined) {
        if (status) set['preferences.communityStatus'] = status;
        else unset['preferences.communityStatus'] = '';
      }
      if (push !== undefined) set['preferences.communityPush'] = push;
      if (quiet !== undefined) set['preferences.communityQuiet'] = quiet;
      await User.updateOne({ _id: uid(req) }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Channel settings, message requests, translation ──────────

// PATCH /api/v1/community/channels/:channelId/settings - staff set slow mode
communityChatRouter.patch(
  '/channels/:channelId/settings',
  validate(ChannelSettingsSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const channel = await accessibleChannel(req, res, req.params.channelId);
      if (!channel) return;
      if (channel.type === 'dm' || !(await serverRole(uid(req), channel.serverId))) {
        return res.status(403).json({ success: false, message: 'Only the server owner and moderators can change this' });
      }
      channel.slowModeSeconds = req.body.slowModeSeconds;
      await channel.save();
      res.json({ success: true, data: { slowModeSeconds: channel.slowModeSeconds } });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/community/dms/:channelId/accept|decline - answer a message request
for (const action of ['accept', 'decline'] as const) {
  communityChatRouter.post(`/dms/:channelId/${action}`, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const channel = await accessibleChannel(req, res, req.params.channelId);
      if (!channel || channel.type !== 'dm') {
        if (channel) res.status(404).json({ success: false, message: 'Channel not found' });
        return;
      }
      if (String(channel.dmInitiatorId ?? '') === String(req.userId)) {
        return res.status(403).json({ success: false, message: 'Only the person who received the request can answer it' });
      }
      channel.dmStatus = action === 'accept' ? 'accepted' : 'declined';
      await channel.save();
      res.json({ success: true, data: { dmStatus: channel.dmStatus } });
    } catch (err) {
      next(err);
    }
  });
}

// POST /api/v1/community/messages/:id/translate {target} - Lumen AI translates one message for the reader.
// Needs the member's own Lumen AI consent, because the text goes to the AI provider they chose.
const translateTimes = new Map<string, number[]>();
communityChatRouter.post(
  '/messages/:id/translate',
  validate(TranslateMessageSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const found = await accessibleMessage(req, res, req.params.id);
      if (!found) return;
      const me = await User.findById(uid(req)).select('preferences.aiFullAccess').lean();
      if (!(me?.preferences as { aiFullAccess?: boolean } | undefined)?.aiFullAccess) {
        return res.status(403).json({ success: false, message: 'Turn on Lumen AI in Settings to translate messages.' });
      }
      const text = (found.message.content || '').trim().slice(0, 1500);
      if (!text) return res.status(400).json({ success: false, message: 'There is no text to translate' });

      const now = Date.now();
      const recent = (translateTimes.get(String(req.userId)) ?? []).filter((t) => now - t < 3_600_000);
      if (recent.length >= 30) return res.status(429).json({ success: false, message: 'Too many translations this hour. Try again later.' });
      translateTimes.set(String(req.userId), [...recent, now]);

      const target = req.body.target === 'hinglish' ? 'Hinglish (Hindi written in the Roman alphabet, mixed with English the way people text)' : 'plain English';
      const result = await runAssistant({
        userId: String(req.userId),
        history: [],
        message: `Translate this community message into ${target}. Reply with the translation only: no quotes, no preface, no notes. Do not use the tools. Keep names, emojis and @mentions as they are.\n\n---\n${text}`,
        effort: 'low',
        budgetMs: 30_000,
        allowWrites: false,
      });
      const translated = (result.text || '').trim();
      if (result.error || !translated) {
        return res.status(502).json({ success: false, message: 'Could not translate this message right now.' });
      }
      res.json({ success: true, data: { text: translated } });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Blocking and reporting ──────────

// GET /api/v1/community/blocks - the members I have hidden (anonymous ones carry no user id)
communityChatRouter.get('/blocks', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const blocks = await CommunityBlock.find({ userId: uid(req) }).sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      data: blocks.map((b) => ({ id: String(b._id), label: b.label, userId: b.viaAnonymous ? undefined : String(b.blockedUserId) })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/community/messages/:id/block - hide the author of this message (works for anonymous ones too)
communityChatRouter.post('/messages/:id/block', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const found = await accessibleMessage(req, res, req.params.id);
    if (!found) return;
    const me = uid(req);
    if (found.message.senderId.toString() === me.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot block yourself' });
    }
    const label = found.message.isAnonymous ? 'Anonymous member' : found.message.senderDisplayName || 'Community member';
    const block = await CommunityBlock.findOneAndUpdate(
      { userId: me, blockedUserId: found.message.senderId },
      { $setOnInsert: { label, viaAnonymous: Boolean(found.message.isAnonymous) } },
      { upsert: true, new: true },
    );
    res.status(201).json({
      success: true,
      data: { id: String(block!._id), label: block!.label, userId: block!.viaAnonymous ? undefined : String(block!.blockedUserId) },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/community/blocks/:id - unblock
communityChatRouter.delete('/blocks/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (mongoose.Types.ObjectId.isValid(req.params.id)) {
      await CommunityBlock.deleteOne({ _id: req.params.id, userId: uid(req) });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/community/messages/:id/report - tell the server's staff about a message
communityChatRouter.post(
  '/messages/:id/report',
  validate(ReportMessageSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const found = await accessibleMessage(req, res, req.params.id);
      if (!found) return;
      const me = uid(req);
      if (found.message.senderId.toString() === me.toString()) {
        return res.status(400).json({ success: false, message: 'You cannot report your own message' });
      }
      const { reason, note } = req.body as { reason: ReportReason; note?: string };
      try {
        await CommunityReport.create({
          reporterId: me,
          messageId: found.message._id,
          channelId: found.channel._id,
          serverId: found.channel.serverId,
          reason,
          note,
          snippet: (found.message.content || (found.message.audioMediaId ? 'Voice note' : found.message.embedType ? `Shared ${found.message.embedType}` : '')).slice(0, 300),
          senderLabel: found.message.isAnonymous ? 'Anonymous member' : found.message.senderDisplayName,
        });
      } catch (err) {
        // Reporting the same message twice is fine; it is already with the staff.
        if ((err as { code?: number }).code !== 11000) throw err;
      }
      res.status(201).json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/community/servers/:serverId/reports - open reports, for the owner and moderators
communityChatRouter.get('/servers/:serverId/reports', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.serverId) || !(await serverRole(uid(req), req.params.serverId))) {
      return res.status(403).json({ success: false, message: 'Only the owner and moderators can see reports' });
    }
    const reports = await CommunityReport.find({ serverId: req.params.serverId, status: 'open' }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({
      success: true,
      data: reports.map((r) => ({
        id: String(r._id), messageId: String(r.messageId), channelId: String(r.channelId), reason: r.reason, note: r.note,
        snippet: r.snippet, senderLabel: r.senderLabel, createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/community/reports/:id/resolve {action: 'dismiss' | 'delete'} - close a report, optionally removing the message
communityChatRouter.post('/reports/:id/resolve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const report = mongoose.Types.ObjectId.isValid(req.params.id) ? await CommunityReport.findById(req.params.id) : null;
    if (!report || !report.serverId || !(await serverRole(uid(req), report.serverId))) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }
    if (req.body?.action === 'delete') {
      const message = await CommunityMessage.findByIdAndDelete(report.messageId);
      if (message) {
        await CommunityChannel.findByIdAndUpdate(message.channelId, { $inc: { messageCount: -1 } });
        broadcastMessageDeleted(message.channelId.toString(), String(message._id));
      }
      report.status = 'actioned';
    } else {
      report.status = 'dismissed';
    }
    await report.save();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────── Discord Threads API ──────────

// GET /api/v1/community/messages/:id/thread - get threaded replies for a message
communityChatRouter.get(
  '/messages/:id/thread',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const viewer = String(req.userId);
      let parentMessage: any;
      const asMessage = mongoose.Types.ObjectId.isValid(req.params.id) ? await CommunityMessage.exists({ _id: req.params.id }) : null;
      if (asMessage) {
        const found = await accessibleMessage(req, res, req.params.id);
        if (!found) return;
        parentMessage = hideAnonymousSender(found.message.toObject(), viewer);
      } else {
        const post = mongoose.Types.ObjectId.isValid(req.params.id) ? await ForumPost.findById(req.params.id).lean() : null;
        const postChannel = post ? await CommunityChannel.findById(post.channelId) : null;
        if (!post || !postChannel || !(await canAccessChannel(viewer, postChannel))) {
          return res.status(404).json({ success: false, message: 'Parent message not found' });
        }
        const author = hidePostAuthor(post, viewer).author;
        parentMessage = {
          _id: String(post._id), channelId: String(post.channelId), senderId: String(author.senderId),
          senderDisplayName: author.senderDisplayName, senderAvatarEmoji: author.senderAvatarEmoji,
          senderRoleColor: author.senderRoleColor, senderRoleBadges: author.senderRoleBadges, isAnonymous: author.isAnonymous,
          content: `${post.title}

${post.content}`, contentWarning: post.contentWarning, reactions: {}, createdAt: post.createdAt, updatedAt: post.updatedAt,
          embedType: post.embedType, embedData: (await withFreshAudio([{ embedData: post.embedData as any }]))[0].embedData,
        };
      }

      const hiddenReplyAuthors = await blockedUserIds(viewer);
      const replies = await CommunityMessage.find({
        'replyTo.messageId': new mongoose.Types.ObjectId(req.params.id),
        ...(hiddenReplyAuthors.length ? { senderId: { $nin: hiddenReplyAuthors } } : {}),
      })
        .sort({ createdAt: 1 })
        .lean();

      res.json({
        success: true,
        data: {
          parent: parentMessage,
          replies: replies.map((r) => hideAnonymousSender(r as any, viewer)),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ────────── Discord Forum Posts API ──────────

// GET /api/v1/community/forums/:channelId/posts - list forum posts with tags
communityChatRouter.get(
  '/forums/:channelId/posts',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { channelId } = req.params;
      const tag = req.query.tag as string;
      const search = req.query.search as string;

      const gated = await accessibleChannel(req, res, channelId);
      if (!gated) return;
      const targetChannelId = gated._id as mongoose.Types.ObjectId;

      const filter: Record<string, any> = { channelId: targetChannelId };
      const hiddenPostAuthors = await blockedUserIds(String(req.userId));
      if (hiddenPostAuthors.length) filter['author.senderId'] = { $nin: hiddenPostAuthors };
      if (tag && tag !== 'All') {
        filter.tags = tag;
      }
      if (search) {
        filter.$or = [
          { title: { $regex: search, $options: 'i' } },
          { content: { $regex: search, $options: 'i' } },
        ];
      }

      const posts = await ForumPost.find(filter).sort({ createdAt: -1 }).lean();
      const fresh = await withFreshAudio(posts as any[]);
      res.json({ success: true, data: fresh.map((p) => hidePostAuthor(p, String(req.userId))) });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/community/forums/:channelId/posts - create forum post (health story)
communityChatRouter.post(
  '/forums/:channelId/posts',
  validate(CreateForumPostSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { channelId } = req.params;
      const userId = uid(req);
      const { title, tags, content, contentWarning, isAnonymous, senderAvatarEmoji, embedType } = req.body;
      let embedData = req.body.embedData;
      if (embedType === 'photo') {
        const photoId = embedData?.photoMediaId;
        const photo = photoId && mongoose.Types.ObjectId.isValid(photoId) ? await Media.findOne({ _id: photoId, userId }).select('_id mimeType') : null;
        if (!photo || !String(photo.mimeType || '').startsWith('image/')) {
          return res.status(400).json({ success: false, message: 'Photo could not be attached. Please upload it again.' });
        }
        embedData = { photoMediaId: String(photo._id) };
      }

      const gated = await accessibleChannel(req, res, channelId);
      if (!gated) return;
      const targetChannelId = gated._id as mongoose.Types.ObjectId;

      const user = await User.findById(userId);
      const displayName = isAnonymous ? 'Anonymous Spoonie' : user?.name || 'Lumen Member';
      const avatarEmoji = isAnonymous ? '🥄' : senderAvatarEmoji || '🌟';

      const post = await ForumPost.create({
        channelId: targetChannelId,
        title,
        tags: tags || ['Journey'],
        author: {
          senderId: userId,
          senderDisplayName: displayName,
          senderAvatarEmoji: avatarEmoji,
          isAnonymous: Boolean(isAnonymous),
          senderRoleColor: isAnonymous ? '#94A3B8' : '#F59E0B',
          senderRoleBadges: isAnonymous ? ['Anonymous Spoonie'] : ['Storyteller', 'Pacing Advocate'],
        },
        content,
        contentWarning: contentWarning || undefined,
        embedType,
        embedData,
        stats: {
          replyCount: 0,
          spoonsCount: 1,
          cloneCount: 0,
        },
      });

      const [freshPost] = await withFreshAudio([post.toObject() as any]);
      res.status(201).json({ success: true, data: freshPost });
    } catch (err) {
      next(err);
    }
  }
);

// ────────── Discord User Profile Popout API ──────────

// GET /api/v1/community/users/:userId/popout - get Discord-style profile sheet
communityChatRouter.get(
  '/users/:userId/popout',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ success: false, message: 'Invalid user ID' });
      }

      const targetUser = await User.findById(userId).lean();
      if (!targetUser) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Only what the member has actually shared in the community (never their private notes or tasks).
      // Anonymous posts are left out so they cannot be tied back to a person.
      const mine = { senderId: targetUser._id, isAnonymous: false };
      const [sharedNotesCount, sharedTodosCount, cloned, ownsServer] = await Promise.all([
        CommunityMessage.countDocuments({ ...mine, embedType: 'note' }),
        CommunityMessage.countDocuments({ ...mine, embedType: 'todo_list' }),
        CommunityMessage.aggregate([{ $match: mine }, { $group: { _id: null, n: { $sum: '$cloneCount' } } }]),
        CommunityServer.exists({ ownerId: targetUser._id, isOfficial: false }),
      ]);

      const popoutData = {
        userId: targetUser._id.toString(),
        displayName: targetUser.name || 'Lumen Member',
        avatarEmoji: '🌟',
        bannerGradient: ['#38BDF8', '#818CF8'] as [string, string],
        bio: '',
        energyStatus: (targetUser.preferences as { communityStatus?: string } | undefined)?.communityStatus ?? '',
        // Health conditions stay private; nothing here is read from the member's profile.
        conditionTags: [] as string[],
        roleBadges: ownsServer ? ['Server Owner'] : ['Community Member'],
        roleColor: '#38BDF8',
        stats: { sharedNotesCount, sharedTodosCount, totalClones: cloned[0]?.n ?? 0 },
      };

      res.json({ success: true, data: popoutData });
    } catch (err) {
      next(err);
    }
  }
);
