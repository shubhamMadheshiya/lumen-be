import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { CommunityChannel } from '../models/CommunityChannel';
import { CommunityMessage } from '../models/CommunityMessage';
import { User } from '../models/User';
import {
  CreateCommunityMessageSchema,
  ReactCommunityMessageSchema,
} from '../shared/schemas';

export const communityChatRouter = Router();
communityChatRouter.use(authenticate);

function uid(req: AuthRequest): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(req.userId!);
}

export const SEED_CHANNELS = [
  {
    slug: 'pots-dysautonomia',
    name: 'POTS & Dysautonomia',
    description: 'Postural tachycardia, orthostatic intolerance, salt pacing, and compression routines.',
    icon: '🫀',
    color: '#38BDF8',
    topic: 'Hydration & salt protocols, heart rate stability, and tilt table management.',
    isFeatured: true,
  },
  {
    slug: 'long-covid-mecfs',
    name: 'Long COVID & ME/CFS',
    description: 'Post-exertional malaise (PEM), cognitive fog, pacing checklists, and energy envelopes.',
    icon: '⚡',
    color: '#818CF8',
    topic: 'Pacing strategies, low-energy habit building, and crash recovery.',
    isFeatured: true,
  },
  {
    slug: 'chronic-pain-fibro',
    name: 'Chronic Pain & Fibromyalgia',
    description: 'Nerve pain management, sensory pacing, gentle physical therapy, and flare retrospective notes.',
    icon: '🌿',
    color: '#10B981',
    topic: 'Gentle somatic relief, pacing routines, and pain journals.',
    isFeatured: true,
  },
  {
    slug: 'treatment-trials',
    name: 'Treatments & Doctor Prep',
    description: 'Medication tracking notes, clinical debrief sheets, and lab analysis summaries.',
    icon: '💊',
    color: '#F59E0B',
    topic: 'Clinical appointment preparation, questions for specialists, and trial logs.',
    isFeatured: false,
  },
  {
    slug: 'general-lounge',
    name: 'Gentle Lounge & Daily Wins',
    description: 'Daily check-ins, supportive encouragement, celebrating small milestones, and sharing spoons.',
    icon: '💬',
    color: '#EC4899',
    topic: 'Open community support, mutual empathy, and gentle encouragement.',
    isFeatured: false,
  },
];

// Helper: Seed channels if none exist
async function ensureSeedChannels() {
  const count = await CommunityChannel.countDocuments();
  if (count === 0) {
    for (const seed of SEED_CHANNELS) {
      await CommunityChannel.create(seed);
    }
  }
}

// GET /api/v1/community/channels - list all community channels
communityChatRouter.get('/channels', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await ensureSeedChannels();
    const channels = await CommunityChannel.find().sort({ isFeatured: -1, memberCount: -1, createdAt: 1 });
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
        // Find channel by slug
        const channel = await CommunityChannel.findOne({ slug: channelId });
        if (channel) {
          filter.channelId = channel._id;
        } else {
          return res.status(404).json({ success: false, message: 'Channel not found' });
        }
      }

      const rawMessages = await CommunityMessage.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit);

      // Transform messages to include current user's reaction list
      const messages = rawMessages.map((m) => {
        const obj = m.toObject();
        const userReactionsMap = m.userReactions as Map<string, string[]> | undefined;
        let myReactions: string[] = [];

        if (userReactionsMap && typeof userReactionsMap.get === 'function') {
          myReactions = userReactionsMap.get(userId.toString()) || [];
        } else if (userReactionsMap && (userReactionsMap as any)[userId.toString()]) {
          myReactions = (userReactionsMap as any)[userId.toString()] || [];
        }

        const reactionsObj: Record<string, number> = {};
        if (m.reactions && typeof m.reactions.forEach === 'function') {
          m.reactions.forEach((count, emoji) => {
            if (count > 0) reactionsObj[emoji] = count;
          });
        } else if (m.reactions) {
          Object.assign(reactionsObj, m.reactions);
        }

        return {
          ...obj,
          reactions: reactionsObj,
          userReactions: myReactions,
        };
      });

      // Reverse so oldest is first in chat order
      res.json({ success: true, data: messages.reverse() });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/community/channels/:channelId/messages - post message with optional rich embed
communityChatRouter.post(
  '/channels/:channelId/messages',
  validate(CreateCommunityMessageSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { channelId } = req.params;
      const userId = uid(req);
      const { content, isAnonymous, senderAvatarEmoji, embedType, embedData } = req.body;

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

      // Fetch user profile name
      const user = await User.findById(userId);
      const displayName = isAnonymous
        ? 'Anonymous Spoonie'
        : user?.name || 'Lumen Member';

      const avatarEmoji = isAnonymous ? '🥄' : senderAvatarEmoji || '🌟';

      const message = await CommunityMessage.create({
        channelId: targetChannelId,
        senderId: userId,
        senderDisplayName: displayName,
        senderAvatarEmoji: avatarEmoji,
        isAnonymous: Boolean(isAnonymous),
        content: content || '',
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
        // Remove reaction
        const nextList = userList.filter((e) => e !== emoji);
        message.userReactions.set(userId, nextList);
        message.reactions.set(emoji, Math.max(0, currentCount - 1));
      } else {
        // Add reaction
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
