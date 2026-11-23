import { showOnlineOn, presenceFor } from '../services/presence';
import { ForwardMessageSchema } from '../shared/schemas';

jest.mock('../services/socketService', () => ({
  isUserOnline: (id: string) => id === 'online-user',
  broadcastToUsers: jest.fn(),
}));

describe('online status privacy', () => {
  const seen = new Date('2026-11-23T10:00:00Z');

  it('is on unless a person switched it off', () => {
    expect(showOnlineOn(undefined)).toBe(true);
    expect(showOnlineOn({})).toBe(true);
    expect(showOnlineOn({ communityShowOnline: false })).toBe(false);
  });

  it('shows online, or when they were last seen, when both of you allow it', () => {
    expect(presenceFor({}, { _id: 'online-user', lastSeenAt: seen })).toEqual({ isOnline: true, lastSeenAt: null, hidden: false });
    expect(presenceFor({}, { _id: 'other', lastSeenAt: seen })).toEqual({ isOnline: false, lastSeenAt: seen, hidden: false });
  });

  it('hides everything, as unknown, when either side switched it off (reciprocal)', () => {
    const hidden = { isOnline: false, lastSeenAt: null, hidden: true };
    expect(presenceFor({ communityShowOnline: false }, { _id: 'online-user', lastSeenAt: seen })).toEqual(hidden);
    expect(presenceFor({}, { _id: 'online-user', lastSeenAt: seen, preferences: { communityShowOnline: false } })).toEqual(hidden);
  });
});

describe('forward request', () => {
  it('takes 1 to 5 chats', () => {
    expect(ForwardMessageSchema.safeParse({ channelIds: ['a'] }).success).toBe(true);
    expect(ForwardMessageSchema.safeParse({ channelIds: [] }).success).toBe(false);
    expect(ForwardMessageSchema.safeParse({ channelIds: ['1', '2', '3', '4', '5', '6'] }).success).toBe(false);
    expect(ForwardMessageSchema.safeParse({}).success).toBe(false);
  });
});
