/**
 * Push notifications for the community: direct messages, replies to your message, and @mentions.
 * Never a broadcast to a whole channel. Sent after the message is saved; failures are only logged.
 */
import { CommunityMessage } from '../models/CommunityMessage';
import { User } from '../models/User';
import { sendToUser } from './push/pushService';
import { makeSnippet } from './communityNotifications';
import { isQuietAt, localMinutes } from './aiNotify/gate';

export const CHANNEL_COMMUNITY = 'lumen_community_v1';

export type PushReason = 'dm' | 'reply' | 'mention';

/** Who gets pinged and why. One push per person, DM beats reply beats mention. The sender never gets one. */
export function pushRecipients(input: {
  senderId: string;
  dmMemberIds?: string[];
  replyToSenderId?: string;
  mentionedUserIds?: string[];
}): Map<string, PushReason> {
  const out = new Map<string, PushReason>();
  const add = (id: string | undefined, reason: PushReason) => {
    if (id && id !== input.senderId && !out.has(id)) out.set(id, reason);
  };
  (input.dmMemberIds ?? []).forEach(id => add(id, 'dm'));
  add(input.replyToSenderId, 'reply');
  (input.mentionedUserIds ?? []).forEach(id => add(id, 'mention'));
  return out;
}

/** Mute switch and quiet hours (22:00 to 08:00 local time) for community push. */
export function communityPushAllowed(
  prefs: { communityPush?: boolean; communityQuiet?: boolean; timezone?: string } | undefined,
  now: Date = new Date(),
): boolean {
  if (prefs?.communityPush === false) return false;
  if (prefs?.communityQuiet) {
    const minutes = localMinutes(now, prefs.timezone || 'UTC');
    if (isQuietAt(minutes, { enabled: true, start: '22:00', end: '08:00' })) return false;
  }
  return true;
}

export function pushText(reason: PushReason, channelName: string, senderName: string, content: string, hasVoice: boolean, hasWarning = false) {
  // A content warning means the text is hidden in the app, so it stays out of the notification too.
  const body = hasWarning ? 'Message with a content warning' : makeSnippet(content || (hasVoice ? 'Sent a voice note' : ''));
  if (reason === 'dm') return { title: senderName, body };
  if (reason === 'reply') return { title: `${senderName} replied to you`, body: `#${channelName}: ${body}` };
  return { title: `${senderName} mentioned you`, body: `#${channelName}: ${body}` };
}

export async function notifyCommunityMessage(args: {
  channel: { _id: unknown; slug: string; name: string; type?: string; dmMemberIds?: unknown[] };
  message: { content?: string; contentWarning?: string; audioUrl?: string; audioMediaId?: unknown; isAnonymous?: boolean; senderDisplayName: string; mentions?: string[] };
  senderId: string;
  replyToMessageId?: unknown;
  /** A message request that the other person has not accepted yet: no push until they do. */
  dmPending?: boolean;
  canSee: (userId: string) => Promise<boolean>;
}): Promise<void> {
  try {
    const { channel, message, senderId } = args;

    let replyToSenderId: string | undefined;
    if (args.replyToMessageId) {
      const parent = await CommunityMessage.findById(args.replyToMessageId).select('senderId').lean();
      replyToSenderId = parent ? String(parent.senderId) : undefined;
    }

    const names = (message.mentions ?? []).filter(n => typeof n === 'string' && n.trim()).slice(0, 5);
    const mentioned = names.length ? await User.find({ name: { $in: names } }).select('_id').limit(10).lean() : [];

    const recipients = pushRecipients({
      senderId,
      dmMemberIds: channel.type === 'dm' && !args.dmPending ? (channel.dmMemberIds ?? []).map(String) : undefined,
      replyToSenderId,
      mentionedUserIds: mentioned.map(u => String(u._id)),
    });

    const sender = message.isAnonymous ? 'Someone' : message.senderDisplayName;
    for (const [userId, reason] of recipients) {
      if (!(await args.canSee(userId))) continue;
      const prefs = await User.findById(userId).select('preferences.communityPush preferences.communityQuiet preferences.timezone').lean();
      if (!communityPushAllowed(prefs?.preferences as Parameters<typeof communityPushAllowed>[0])) continue;
      const text = pushText(reason, channel.name, sender, message.content ?? '', Boolean(message.audioUrl || message.audioMediaId), Boolean(message.contentWarning));
      await sendToUser(userId, {
        ...text,
        channelId: CHANNEL_COMMUNITY,
        data: { type: 'COMMUNITY', route: `/community/${channel.slug}` },
      });
    }
  } catch (err) {
    console.error('[community-push] failed:', (err as Error).message);
  }
}
