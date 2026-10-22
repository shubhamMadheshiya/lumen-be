import mongoose from 'mongoose';
import { CommunityChannel } from '../models/CommunityChannel';
import { CommunityMessage } from '../models/CommunityMessage';
import {
  CreateCommunityMessageSchema,
  ReactCommunityMessageSchema,
  CreateCommunityChannelSchema,
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
});
