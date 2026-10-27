import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { buildCommunityNotifications } from '../services/communityNotifications';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { CommunityServer } from '../models/CommunityServer';
import { CommunityChannel } from '../models/CommunityChannel';
import { CommunityMessage } from '../models/CommunityMessage';
import { ForumPost } from '../models/ForumPost';
import { User } from '../models/User';
import { Note } from '../models/Note';
import { Task } from '../models/Task';
import {
  CreateCommunityMessageSchema,
  ReactCommunityMessageSchema,
  CreateForumPostSchema,
  CreateCommunityServerSchema,
  JoinCommunityServerSchema,
  CreateCommunityChannelSchema,
} from '../shared/schemas';

export const communityChatRouter = Router();
communityChatRouter.use(authenticate);

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
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
            membersCount: 1420,
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

    const channels = await CommunityChannel.find({
      $or: [{ serverId: targetServerId }, { serverId: { $exists: false } }],
    }).sort({ order: 1, createdAt: 1 });

    res.json({ success: true, data: channels });
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
      if (mongoose.Types.ObjectId.isValid(channelId)) {
        filter.channelId = new mongoose.Types.ObjectId(channelId);
      } else {
        const channel = await CommunityChannel.findOne({ slug: channelId });
        if (!channel) {
          return res.status(404).json({ success: false, message: 'Channel not found' });
        }
        filter.channelId = channel._id;
      }

      if (req.query.before) {
        filter.createdAt = { $lt: new Date(req.query.before as string) };
      }

      const messages = await CommunityMessage.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      const userStr = userId.toString();
      const formatted = messages.reverse().map((msg: any) => {
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

        return {
          ...msg,
          reactions: reactionsObj,
          userReactions: userReacts,
        };
      });

      res.json({ success: true, data: formatted });
    } catch (err) {
      next(err);
    }
  }
);

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
        isAnonymous,
        senderAvatarEmoji,
        senderRoleColor,
        senderRoleBadges,
        replyTo,
        embedType,
        embedData,
      } = req.body;

      // Validate channel
      let targetChannelId: mongoose.Types.ObjectId;
      if (mongoose.Types.ObjectId.isValid(channelId)) {
        targetChannelId = new mongoose.Types.ObjectId(channelId);
      } else {
        const channel = await CommunityChannel.findOne({ slug: channelId });
        if (!channel) {
          return res.status(404).json({ success: false, message: 'Channel not found' });
        }
        targetChannelId = channel._id as mongoose.Types.ObjectId;
      }

      // Fetch user profile info
      const user = await User.findById(userId);
      const displayName = isAnonymous
        ? 'Anonymous Spoonie'
        : user?.name || 'Lumen Member';

      const avatarEmoji = isAnonymous ? '🥄' : senderAvatarEmoji || '🌟';
      const roleColor = isAnonymous ? '#94A3B8' : senderRoleColor || '#38BDF8';
      const roleBadges = isAnonymous ? ['Anonymous Spoonie'] : senderRoleBadges || ['Community Member'];

      let replyToData;
      if (replyTo && replyTo.messageId) {
        replyToData = {
          messageId: new mongoose.Types.ObjectId(replyTo.messageId),
          senderDisplayName: replyTo.senderDisplayName,
          snippet: replyTo.snippet.slice(0, 150),
        };
        // Update parent message's thread count
        await CommunityMessage.findByIdAndUpdate(replyTo.messageId, {
          $inc: { 'threadMeta.replyCount': 1 },
          $set: { 'threadMeta.lastReplyAt': new Date() },
        });
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
        replyTo: replyToData,
        threadMeta: { replyCount: 0 },
        embedType,
        embedData,
        reactions: {},
        userReactions: {},
        cloneCount: 0,
      });

      // Increment channel message count
      await CommunityChannel.findByIdAndUpdate(targetChannelId, { $inc: { messageCount: 1 } });

      const resObj = message.toObject();
      res.status(201).json({
        success: true,
        data: {
          ...resObj,
          reactions: {},
          userReactions: [],
        },
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

      const message = await CommunityMessage.findById(req.params.id);
      if (!message) {
        return res.status(404).json({ success: false, message: 'Message not found' });
      }

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

      res.json({
        success: true,
        data: {
          messageId: message._id,
          reactions: reactionsObj,
          userReactions: message.userReactions.get(userId) || [],
        },
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
      const message = await CommunityMessage.findByIdAndUpdate(
        req.params.id,
        { $inc: { cloneCount: 1 } },
        { new: true }
      );
      if (!message) {
        return res.status(404).json({ success: false, message: 'Message not found' });
      }
      res.json({ success: true, cloneCount: message.cloneCount });
    } catch (err) {
      next(err);
    }
  }
);

// ────────── Discord Threads API ──────────

// GET /api/v1/community/messages/:id/thread - get threaded replies for a message
communityChatRouter.get(
  '/messages/:id/thread',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parentMessage = await CommunityMessage.findById(req.params.id).lean();
      if (!parentMessage) {
        return res.status(404).json({ success: false, message: 'Parent message not found' });
      }

      const replies = await CommunityMessage.find({
        'replyTo.messageId': new mongoose.Types.ObjectId(req.params.id),
      })
        .sort({ createdAt: 1 })
        .lean();

      res.json({
        success: true,
        data: {
          parent: parentMessage,
          replies,
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

      let targetChannelId: mongoose.Types.ObjectId;
      if (mongoose.Types.ObjectId.isValid(channelId)) {
        targetChannelId = new mongoose.Types.ObjectId(channelId);
      } else {
        const channel = await CommunityChannel.findOne({ slug: channelId });
        if (!channel) {
          return res.status(404).json({ success: false, message: 'Channel not found' });
        }
        targetChannelId = channel._id as mongoose.Types.ObjectId;
      }

      const filter: Record<string, any> = { channelId: targetChannelId };
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
      res.json({ success: true, data: posts });
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
      const { title, tags, content, isAnonymous, senderAvatarEmoji, embedType, embedData } = req.body;

      let targetChannelId: mongoose.Types.ObjectId;
      if (mongoose.Types.ObjectId.isValid(channelId)) {
        targetChannelId = new mongoose.Types.ObjectId(channelId);
      } else {
        const channel = await CommunityChannel.findOne({ slug: channelId });
        if (!channel) {
          return res.status(404).json({ success: false, message: 'Channel not found' });
        }
        targetChannelId = channel._id as mongoose.Types.ObjectId;
      }

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
        embedType,
        embedData,
        stats: {
          replyCount: 0,
          spoonsCount: 1,
          cloneCount: 0,
        },
      });

      res.status(201).json({ success: true, data: post });
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

      // Count public shared artifacts
      const sharedNotesCount = await Note.countDocuments({ userId: targetUser._id });
      const sharedTodosCount = await Task.countDocuments({ userId: targetUser._id });

      const popoutData = {
        userId: targetUser._id.toString(),
        displayName: targetUser.name || 'Lumen Spoonie',
        avatarEmoji: '🌟',
        bannerGradient: ['#38BDF8', '#818CF8'] as [string, string],
        bio: 'Pacing navigator, daily tracker, and community member.',
        energyStatus: 'Pacing & Resting 🥄',
        conditionTags: ['Dysautonomia', 'Pacing Warrior', 'Long-COVID'],
        roleBadges: ['POTS Veteran', 'Community Guide', 'Lumen Pioneer'],
        roleColor: '#38BDF8',
        stats: {
          sharedNotesCount,
          sharedTodosCount,
          totalClones: sharedNotesCount * 7 + 12,
        },
      };

      res.json({ success: true, data: popoutData });
    } catch (err) {
      next(err);
    }
  }
);
