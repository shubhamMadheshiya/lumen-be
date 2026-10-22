import mongoose from 'mongoose';
import { CommunityChannel } from '../models/CommunityChannel';
import { CommunityMessage } from '../models/CommunityMessage';
import {
  CreateCommunityMessageSchema,
  ReactCommunityMessageSchema,
  CreateCommunityChannelSchema,
  CreateForumPostSchema,
  CreateCommunityServerSchema,
  JoinCommunityServerSchema,
} from '../shared/schemas';
import { SEED_CHANNELS } from '../routes/communityChat';

describe('Server Models & Schemas: Community Chat & Health Artifact Exchange', () => {
  it('validates seed channels configuration with chronic condition slugs and topics', () => {
    expect(SEED_CHANNELS.length).toBeGreaterThanOrEqual(5);
    const potsChannel = SEED_CHANNELS.find((c) => c.slug === 'pots-dysautonomia');
    expect(potsChannel).toBeDefined();
    expect(potsChannel?.name).toContain('POTS');
    expect(potsChannel?.icon).toBe('🫀');

    const longCovidChannel = SEED_CHANNELS.find((c) => c.slug === 'long-covid-mecfs');
    expect(longCovidChannel).toBeDefined();
    expect(longCovidChannel?.topic).toContain('Pacing');
  });

  it('validates a message payload containing a shared Lumen Note embed', () => {
    const validPayload = {
      channelId: 'channel_pots_123',
      content: 'Here is my complete morning hydration and salt pacing note! Hope this helps anyone experiencing severe morning brain fog.',
      isAnonymous: false,
      embedType: 'note' as const,
      embedData: {
        note: {
          title: 'Morning Salt & Hydration Protocol',
          icon: '🫀',
          coverGradient: 'linear-gradient(135deg, #0F172A 0%, #0369A1 100%)',
          tags: ['POTS', 'Hydration', 'Salt'],
          blocksPreview: [
            { type: 'callout', content: 'Drink 500ml water with 1g sodium before getting out of bed.' },
            { type: 'todo', content: 'Put on waist-high compression tights' },
          ],
          blocksFull: [
            { id: 'b1', type: 'callout', content: 'Drink 500ml water with 1g sodium before getting out of bed.' },
            { id: 'b2', type: 'todo', content: 'Put on waist-high compression tights', completed: false },
          ],
        },
      },
    };

    const parsed = CreateCommunityMessageSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.embedType).toBe('note');
      expect(parsed.data.embedData?.note?.title).toBe('Morning Salt & Hydration Protocol');
      expect(parsed.data.embedData?.note?.blocksFull.length).toBe(2);
    }
  });

  it('validates a message payload containing a shared Lumen ToDo routine embed', () => {
    const validTodoPayload = {
      channelId: 'channel_pacing_456',
      content: 'Gentle morning routine for low-spoon days.',
      isAnonymous: true,
      senderAvatarEmoji: '🥄',
      embedType: 'todo_list' as const,
      embedData: {
        todo: {
          listName: 'Gentle Pacing Routine',
          energyCost: 'gentle' as const,
          tasks: [
            {
              title: 'Gentle vagus nerve breathwork',
              energyCost: 'gentle' as const,
              steps: [{ title: 'Box breathing 4-4-4-4' }, { title: 'Eye palming' }],
            },
            {
              title: 'Electrolyte intake',
              energyCost: 'gentle' as const,
              steps: [{ title: 'Drink 500ml LMNT/Trioral' }],
            },
          ],
        },
      },
    };

    const parsed = CreateCommunityMessageSchema.safeParse(validTodoPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.isAnonymous).toBe(true);
      expect(parsed.data.embedType).toBe('todo_list');
      expect(parsed.data.embedData?.todo?.tasks.length).toBe(2);
    }
  });

  it('validates chronic empathy reactions (🥄, 🫂, ❤️, 💡, ✨)', () => {
    const spoonReaction = { emoji: '🥄' };
    const parsedSpoon = ReactCommunityMessageSchema.safeParse(spoonReaction);
    expect(parsedSpoon.success).toBe(true);

    const hugReaction = { emoji: '🫂' };
    const parsedHug = ReactCommunityMessageSchema.safeParse(hugReaction);
    expect(parsedHug.success).toBe(true);
  });

  it('validates a complete CommunityMessage Mongoose instance', () => {
    const channelId = new mongoose.Types.ObjectId();
    const senderId = new mongoose.Types.ObjectId();

    const message = new CommunityMessage({
      channelId,
      senderId,
      senderDisplayName: 'Anonymous Spoonie',
      senderAvatarEmoji: '🥄',
      isAnonymous: true,
      content: 'Sending spoons to everyone navigating a crash today.',
      reactions: new Map([
        ['🥄', 12],
        ['🫂', 8],
      ]),
      cloneCount: 3,
    });

    const err = message.validateSync();
    expect(err).toBeUndefined();
    expect(message.senderDisplayName).toBe('Anonymous Spoonie');
    expect(message.cloneCount).toBe(3);
  });

  it('validates Discord message with replyTo quote and role badges', () => {
    const discordPayload = {
      channelId: 'channel_pots_123',
      content: 'Here is my answer to your MCAS compression question!',
      isAnonymous: false,
      senderRoleColor: '#8B5CF6',
      senderRoleBadges: ['POTS Veteran', 'Peer Mentor'],
      replyTo: {
        messageId: 'parent_msg_999',
        senderDisplayName: 'Alex_MECFS',
        snippet: 'Does compression gear trigger MCAS rashes for anyone?',
      },
    };

    const parsed = CreateCommunityMessageSchema.safeParse(discordPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.senderRoleColor).toBe('#8B5CF6');
      expect(parsed.data.senderRoleBadges).toContain('POTS Veteran');
      expect(parsed.data.replyTo?.senderDisplayName).toBe('Alex_MECFS');
      expect(parsed.data.replyTo?.snippet).toContain('MCAS rashes');
    }
  });

  it('validates Discord Forum health story post and schema', () => {
    const forumPayload = {
      channelId: 'channel_recovery_789',
      title: 'How Low-Dose Naltrexone & Pacing Cut My Heart Rate Spikes by 40 BPM',
      tags: ['POTS', 'LDN', 'Remission'],
      content: 'I was bedbound in 2023 due to severe orthostatic intolerance. After 6 months of pacing...',
      isAnonymous: false,
    };

    const parsed = CreateForumPostSchema.safeParse(forumPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tags).toContain('POTS');
      expect(parsed.data.title).toContain('Low-Dose Naltrexone');
    }
  });

  it('validates custom Community Server creation schema', () => {
    const serverPayload = {
      name: 'EDS Zebra Lounge',
      description: 'Support group for hypermobility spectrum and Ehlers-Danlos patients.',
      icon: '🦓',
      color: '#10B981',
      conditionTags: ['EDS', 'HSD', 'Hypermobility'],
      isPrivate: true,
    };

    const parsed = CreateCommunityServerSchema.safeParse(serverPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe('EDS Zebra Lounge');
      expect(parsed.data.icon).toBe('🦓');
      expect(parsed.data.isPrivate).toBe(true);
      expect(parsed.data.conditionTags).toContain('EDS');
    }
  });

  it('validates joining Community Server via 6-character invite code', () => {
    const joinPayload = { inviteCode: 'ZEBR99' };
    const parsed = JoinCommunityServerSchema.safeParse(joinPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.inviteCode).toBe('ZEBR99');
    }
  });
});


