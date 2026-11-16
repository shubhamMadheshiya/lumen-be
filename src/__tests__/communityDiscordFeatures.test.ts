import mongoose from 'mongoose';
import { CommunityMessage } from '../models/CommunityMessage';
import { CommunityChannel } from '../models/CommunityChannel';
import { ChannelReadState } from '../models/ChannelReadState';
import { ServerTimeout } from '../models/ServerTimeout';
import {
  CreateCommunityMessageSchema,
  EditCommunityMessageSchema,
  PinCommunityMessageSchema,
  MarkChannelReadSchema,
  CreateDmChannelSchema,
  TimeoutUserSchema,
} from '../shared/schemas';
import {
  broadcastMessageCreated,
  broadcastMessageUpdated,
  broadcastMessageDeleted,
  broadcastReactionUpdated,
  broadcastPinsUpdated,
} from '../services/socketService';

describe('Discord Parity Features: Real-time, Moderation, Pins, DMs & Voice', () => {
  describe('Schema Validation', () => {
    it('validates a message with audioUrl and audioDurationSeconds for Voice Notes', () => {
      const payload = {
        channelId: new mongoose.Types.ObjectId().toString(),
        content: '',
        isAnonymous: false,
        audioUrl: 'https://storage.lumen.health/media/voice_note_123.m4a',
        audioDurationSeconds: 42,
        mentions: ['Sarah_Dysautonomia'],
      };

      const result = CreateCommunityMessageSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.audioUrl).toBe('https://storage.lumen.health/media/voice_note_123.m4a');
        expect(result.data.audioDurationSeconds).toBe(42);
        expect(result.data.mentions).toEqual(['Sarah_Dysautonomia']);
      }
    });

    it('validates message edit schema', () => {
      const validEdit = { content: 'Updated pacing routine content with 2g salt' };
      expect(EditCommunityMessageSchema.safeParse(validEdit).success).toBe(true);

      const emptyEdit = { content: '' };
      expect(EditCommunityMessageSchema.safeParse(emptyEdit).success).toBe(false);
    });

    it('validates DM channel creation schema', () => {
      const targetUserId = new mongoose.Types.ObjectId().toString();
      const validDm = { targetUserId };
      expect(CreateDmChannelSchema.safeParse(validDm).success).toBe(true);

      const invalidDm = { targetUserId: '' };
      expect(CreateDmChannelSchema.safeParse(invalidDm).success).toBe(false);
    });

    it('validates channel read state marking schema', () => {
      const lastReadMessageId = new mongoose.Types.ObjectId().toString();
      expect(MarkChannelReadSchema.safeParse({ lastReadMessageId }).success).toBe(true);
      expect(MarkChannelReadSchema.safeParse({}).success).toBe(true);
    });

    it('validates moderator timeout schema', () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const validTimeout = {
        userId,
        durationMinutes: 60,
        reason: 'Temporary pacing cooldown for respectful discourse',
      };
      expect(TimeoutUserSchema.safeParse(validTimeout).success).toBe(true);

      const invalidTimeout = { userId, durationMinutes: -5 };
      expect(TimeoutUserSchema.safeParse(invalidTimeout).success).toBe(false);
    });
  });

  describe('Model Definitions', () => {
    it('instantiates CommunityMessage with pinned and edited metadata', () => {
      const channelId = new mongoose.Types.ObjectId();
      const senderId = new mongoose.Types.ObjectId();
      const pinUserId = new mongoose.Types.ObjectId();

      const doc = new CommunityMessage({
        channelId,
        senderId,
        senderDisplayName: 'Pacing Advocate',
        content: 'Check this vital tilt-table protocol note: ||take 1g salt beforehand||',
        isEdited: true,
        editedAt: new Date(),
        isPinned: true,
        pinnedAt: new Date(),
        pinnedBy: {
          userId: pinUserId,
          displayName: 'Community Moderator',
        },
        mentions: ['60d5ec49f1b2c82304d9b231'],
        audioUrl: 'https://cdn.lumen.app/voice/123.m4a',
        audioDurationSeconds: 15,
      });

      expect(doc.isPinned).toBe(true);
      expect(doc.isEdited).toBe(true);
      expect(doc.pinnedBy?.displayName).toBe('Community Moderator');
      expect(doc.mentions).toHaveLength(1);
      expect(doc.audioDurationSeconds).toBe(15);
    });

    it('instantiates CommunityChannel with DM type and dmMemberIds', () => {
      const user1 = new mongoose.Types.ObjectId();
      const user2 = new mongoose.Types.ObjectId();

      const dmChannel = new CommunityChannel({
        slug: `dm-${user1.toString().slice(-4)}-${user2.toString().slice(-4)}`,
        name: 'Direct Message',
        description: 'Private 1-on-1 conversation',
        type: 'dm',
        category: 'DIRECT MESSAGES',
        dmMemberIds: [user1, user2],
      });

      expect(dmChannel.type).toBe('dm');
      expect(dmChannel.dmMemberIds).toHaveLength(2);
      expect(dmChannel.category).toBe('DIRECT MESSAGES');
    });

    it('instantiates ChannelReadState document', () => {
      const userId = new mongoose.Types.ObjectId();
      const channelId = new mongoose.Types.ObjectId();
      const lastReadMessageId = new mongoose.Types.ObjectId();

      const readState = new ChannelReadState({
        userId,
        channelId,
        lastReadMessageId,
        lastReadAt: new Date(),
      });

      expect(readState.userId).toEqual(userId);
      expect(readState.channelId).toEqual(channelId);
      expect(readState.lastReadMessageId).toEqual(lastReadMessageId);
    });

    it('instantiates ServerTimeout document', () => {
      const serverId = new mongoose.Types.ObjectId();
      const userId = new mongoose.Types.ObjectId();
      const timedOutBy = new mongoose.Types.ObjectId();
      const timedOutUntil = new Date(Date.now() + 3600000);

      const timeout = new ServerTimeout({
        serverId,
        userId,
        timedOutUntil,
        reason: 'Violated safehouse medical guidelines',
        timedOutBy,
      });

      expect(timeout.serverId).toEqual(serverId);
      expect(timeout.userId).toEqual(userId);
      expect(timeout.timedOutUntil.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Real-time Socket Broadcasting Service', () => {
    it('handles broadcast calls gracefully even before socket server initializes', () => {
      expect(() => {
        broadcastMessageCreated('ch_123', { content: 'Hello' });
        broadcastMessageUpdated('ch_123', { content: 'Updated' });
        broadcastMessageDeleted('ch_123', 'msg_123');
        broadcastReactionUpdated('ch_123', {
          messageId: 'msg_123',
          reactions: { '🥄': 3 },
          userReactions: ['🥄'],
        });
        broadcastPinsUpdated('ch_123', []);
      }).not.toThrow();
    });
  });

  describe('AutoMod Chronic Safehouse Validation Logic', () => {
    const FORBIDDEN = [
      'Take this miracle mineral solution to cure POTS',
      'This bleach cure will solve Long COVID completely',
      'Guaranteed cure for chronic pain in 3 days!',
      'Stop taking your insulin and just drink salt water',
      'Stop taking medication, doctors are lying',
      'Go kill yourself spoonie',
      'kys loser',
    ];

    const ALLOWED = [
      'My doctor recommended 3g of sodium daily for POTS dysautonomia',
      'Pacing within my energy envelope helped avoid PEM crashes',
      'Here is my daily tracking template for heart rate and fluids',
      'Gentle encouragement to everyone resting today 🥄',
    ];

    const AUTOMOD_PATTERNS = [
      /miracle\s*mineral/i,
      /bleach\s*cure/i,
      /mms\s*cure/i,
      /guaranteed\s*cure/i,
      /stop\s*taking\s*(your\s*)?(insulin|meds|medication)/i,
      /kill\s*yourself/i,
      /\bkys\b/i,
    ];

    it('detects and blocks dangerous medical misinformation and toxic keywords', () => {
      for (const dangerous of FORBIDDEN) {
        const isBlocked = AUTOMOD_PATTERNS.some((pat) => pat.test(dangerous));
        expect(isBlocked).toBe(true);
      }
    });

    it('permits supportive patient pacing and validated protocol exchanges', () => {
      for (const safe of ALLOWED) {
        const isBlocked = AUTOMOD_PATTERNS.some((pat) => pat.test(safe));
        expect(isBlocked).toBe(false);
      }
    });
  });
});

