import mongoose from 'mongoose';
import { pushRecipients, pushText, notifyCommunityMessage, communityPushAllowed, lockscreenChoice, CHANNEL_COMMUNITY, CHANNEL_COMMUNITY_PUBLIC, CHANNEL_COMMUNITY_PRIVATE } from '../services/communityPush';
import { sendToUser } from '../services/push/pushService';
import { CommunityMessage } from '../models/CommunityMessage';
import { User } from '../models/User';

jest.mock('../services/push/pushService', () => ({ sendToUser: jest.fn().mockResolvedValue({ ok: true, sent: 1 }) }));

const oid = () => new mongoose.Types.ObjectId();
afterEach(() => { jest.restoreAllMocks(); (sendToUser as jest.Mock).mockClear(); });

describe('pushRecipients', () => {
  it('pings the other person in a DM but never the sender', () => {
    const r = pushRecipients({ senderId: 'a', dmMemberIds: ['a', 'b'] });
    expect([...r]).toEqual([['b', 'dm']]);
  });

  it('gives one push per person, DM before reply before mention', () => {
    const r = pushRecipients({ senderId: 'a', dmMemberIds: ['b'], replyToSenderId: 'b', mentionedUserIds: ['b', 'c', 'a'] });
    expect([...r]).toEqual([['b', 'dm'], ['c', 'mention']]);
    expect([...pushRecipients({ senderId: 'a', replyToSenderId: 'b', mentionedUserIds: ['b'] })]).toEqual([['b', 'reply']]);
  });
});

describe('communityPushAllowed', () => {
  it('honours the mute switch and quiet hours in the member own time zone', () => {
    expect(communityPushAllowed(undefined)).toBe(true);
    expect(communityPushAllowed({ communityPush: false })).toBe(false);
    // 17:30 UTC is 23:00 in India: inside 22:00-08:00
    const evening = new Date('2026-11-19T17:30:00Z');
    expect(communityPushAllowed({ communityQuiet: true, timezone: 'Asia/Kolkata' }, evening)).toBe(false);
    expect(communityPushAllowed({ communityQuiet: true, timezone: 'UTC' }, evening)).toBe(true);
    expect(communityPushAllowed({ communityQuiet: false, timezone: 'Asia/Kolkata' }, evening)).toBe(true);
    expect(communityPushAllowed({ communityQuiet: true, timezone: 'Asia/Kolkata' }, new Date('2026-11-19T06:00:00Z'))).toBe(true); // 11:30
  });
});

describe('pushText', () => {
  it('words each kind of push', () => {
    expect(pushText('dm', 'x', 'Asha', 'hello', false)).toEqual({ title: 'Asha', body: 'hello' });
    expect(pushText('reply', 'general', 'Asha', 'thanks', false).title).toBe('Asha replied to you');
    expect(pushText('mention', 'general', 'Someone', '', true).body).toBe('#general: 🎤 Voice note');
    expect(pushText('dm', 'x', 'Asha', '', false, false, false, 'photo').body).toBe('📷 Photo');
    expect(pushText('dm', 'x', 'Asha', '', false, false, false, 'gif').body).toBe('GIF');
  });
});

describe('notifyCommunityMessage', () => {
  const base = { _id: oid(), slug: 'general-lounge', name: 'General Lounge', type: 'text' };
  const prefs = (communityPush?: boolean) =>
    jest.spyOn(User, 'findById').mockImplementation((() => ({ select: () => ({ lean: async () => ({ preferences: { communityPush } }) }) })) as never);

  it('pushes a reply to the parent author and an @mention, skipping people who cannot see the channel', async () => {
    const parentAuthor = oid();
    const mentioned = oid();
    jest.spyOn(CommunityMessage, 'findById').mockImplementation((() => ({ select: () => ({ lean: async () => ({ senderId: parentAuthor }) }) })) as never);
    jest.spyOn(User, 'find').mockImplementation((() => ({ select: () => ({ limit: () => ({ lean: async () => [{ _id: mentioned }] }) }) })) as never);
    prefs(undefined);
    await notifyCommunityMessage({
      channel: base,
      message: { content: 'hi @Ravi', senderDisplayName: 'Asha', mentions: ['Ravi'] },
      senderId: String(oid()),
      replyToMessageId: oid(),
      canSee: async (id) => id !== String(mentioned),
    });
    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(sendToUser).toHaveBeenCalledWith(String(parentAuthor), expect.objectContaining({
      channelId: CHANNEL_COMMUNITY,
      categoryId: 'lumen_category_community',
      data: expect.objectContaining({ type: 'COMMUNITY', route: '/community/general-lounge', channelId: String(base._id) }),
    }));
  });

  it('skips people who muted community notifications, and hides text behind a content warning', async () => {
    const dm = { ...base, type: 'dm', dmMemberIds: [oid(), oid()] };
    prefs(false);
    await notifyCommunityMessage({ channel: dm, message: { content: 'hi', senderDisplayName: 'A' }, senderId: String(oid()), canSee: async () => true });
    expect(sendToUser).not.toHaveBeenCalled();
    prefs(true);
    await notifyCommunityMessage({ channel: dm, message: { content: 'secret hospital stuff', contentWarning: 'hospital', senderDisplayName: 'A' }, senderId: String(oid()), canSee: async () => true });
    const body = (sendToUser as jest.Mock).mock.calls[0][1].body;
    expect(body).toBe('Message with a content warning');
    expect(body).not.toContain('hospital stuff');
  });

  it('sends nothing for a message request the other person has not accepted', async () => {
    prefs(undefined);
    const dm = { ...base, type: 'dm', dmMemberIds: [oid(), oid()] };
    await notifyCommunityMessage({ channel: dm, message: { content: 'hi', senderDisplayName: 'A' }, senderId: String(oid()), dmPending: true, canSee: async () => true });
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('does not push for a plain channel message and never throws', async () => {
    await notifyCommunityMessage({ channel: base, message: { content: 'hi', senderDisplayName: 'A' }, senderId: String(oid()), canSee: async () => true });
    expect(sendToUser).not.toHaveBeenCalled();
    prefs(undefined);
    (sendToUser as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(notifyCommunityMessage({
      channel: { ...base, type: 'dm', dmMemberIds: [oid()] }, message: { content: 'x', senderDisplayName: 'A' }, senderId: String(oid()), canSee: async () => true,
    })).resolves.toBeUndefined();
  });
});

describe('WhatsApp-style delivery', () => {
  const dm = { _id: oid(), slug: 'dm-1', name: 'Ben', type: 'dm', dmMemberIds: [oid(), oid()] };
  const withPrefs = (preferences: Record<string, unknown>) =>
    jest.spyOn(User, 'findById').mockImplementation((() => ({ select: () => ({ lean: async () => ({ preferences }) }) })) as never);

  it('shows sender and text on the lock screen by default, or only "new message" when switched off', () => {
    const t = { title: 'Ben', body: 'hello' };
    expect(lockscreenChoice(true, t)).toEqual({ channelId: CHANNEL_COMMUNITY_PUBLIC, title: 'Ben', body: 'hello' });
    const hidden = lockscreenChoice(false, t);
    expect(hidden.channelId).toBe(CHANNEL_COMMUNITY_PRIVATE);
    expect(JSON.stringify(hidden)).not.toContain('hello');
    expect(JSON.stringify(hidden)).not.toContain('Ben');
  });

  it('uses the private channel and hides the text when the member turned lock-screen text off', async () => {
    withPrefs({ communityLockscreenText: false });
    await notifyCommunityMessage({ channel: dm, message: { _id: oid(), content: 'my diagnosis', senderDisplayName: 'Ben' }, senderId: String(oid()), canSee: async () => true, isViewing: () => false });
    const sent = (sendToUser as jest.Mock).mock.calls[0][1];
    expect(sent.channelId).toBe(CHANNEL_COMMUNITY_PRIVATE);
    expect(JSON.stringify(sent)).not.toContain('diagnosis');
  });

  it('carries the message id so Mark as read and Reply know what to act on', async () => {
    withPrefs({});
    const messageId = oid();
    await notifyCommunityMessage({ channel: dm, message: { _id: messageId, content: 'hi', senderDisplayName: 'Ben' }, senderId: String(oid()), canSee: async () => true, isViewing: () => false });
    expect((sendToUser as jest.Mock).mock.calls[0][1].data).toEqual(expect.objectContaining({ messageId: String(messageId), channelId: String(dm._id) }));
  });

  it('does not push to someone who has this chat open on screen right now', async () => {
    withPrefs({});
    await notifyCommunityMessage({ channel: dm, message: { _id: oid(), content: 'hi', senderDisplayName: 'Ben' }, senderId: String(oid()), canSee: async () => true, isViewing: () => true });
    expect(sendToUser).not.toHaveBeenCalled();
  });
});
