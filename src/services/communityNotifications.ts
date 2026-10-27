/**
 * Community notifications for one member: replies to their messages and @mentions of their name,
 * limited to channels they can see. Derived from messages, so there is nothing extra to store.
 */
import mongoose from 'mongoose';
import { CommunityServer } from '../models/CommunityServer';
import { CommunityChannel } from '../models/CommunityChannel';
import { CommunityMessage } from '../models/CommunityMessage';

export type CommunityNotificationType = 'reply' | 'mention';

export interface CommunityNotification {
  id: string;
  type: CommunityNotificationType;
  messageId: string;
  channelId: string;
  channelSlug: string;
  channelName: string;
  senderName: string;
  snippet: string;
  createdAt: string;
}

export const MAX_COMMUNITY_NOTIFICATIONS = 50;
const OWN_MESSAGE_WINDOW_DAYS = 30;
const OWN_MESSAGE_LIMIT = 500;
const SNIPPET_LENGTH = 120;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Rahul Sharma" -> ["Rahul Sharma", "Rahul"], so both @Rahul and @Rahul Sharma count. */
export function mentionNames(name: string | undefined): string[] {
  const full = (name ?? '').trim().replace(/\s+/g, ' ');
  if (full.length < 2) return [];
  const first = full.split(' ')[0];
  return Array.from(new Set([full, first].filter(n => n.length >= 2)));
}

/** True when the text addresses the member with @name (not an email address, not @Rahulx). */
export function mentionsMember(content: string, names: string[]): boolean {
  if (names.length === 0) return false;
  const alt = names.map(escapeRegex).join('|');
  return new RegExp(`(^|\\s)@(${alt})(?![\\p{L}\\p{N}_])`, 'iu').test(content);
}

export function makeSnippet(content: string | undefined): string {
  const text = (content ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Shared something';
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…` : text;
}

interface MemberRef {
  _id: mongoose.Types.ObjectId;
  name?: string;
}

export async function buildCommunityNotifications(
  member: MemberRef,
  since: Date,
): Promise<CommunityNotification[]> {
  // Channels the member may see: official or public servers, plus private ones they belong to.
  const servers = await CommunityServer.find({
    $or: [{ isOfficial: true }, { isPrivate: false }, { memberIds: member._id }],
  }).select('_id');
  if (servers.length === 0) return [];

  const channels = await CommunityChannel.find({ serverId: { $in: servers.map(s => s._id) } }).select('_id slug name');
  if (channels.length === 0) return [];
  const channelById = new Map(channels.map(c => [String(c._id), c]));
  const channelIds = channels.map(c => c._id);

  const ownWindowStart = new Date(Date.now() - OWN_MESSAGE_WINDOW_DAYS * 86400000);
  const own = await CommunityMessage.find({ senderId: member._id, createdAt: { $gte: ownWindowStart } })
    .select('_id')
    .sort({ createdAt: -1 })
    .limit(OWN_MESSAGE_LIMIT);

  const replies = own.length
    ? await CommunityMessage.find({
        'replyTo.messageId': { $in: own.map(m => m._id) },
        senderId: { $ne: member._id },
        channelId: { $in: channelIds },
        createdAt: { $gte: since },
      })
        .sort({ createdAt: -1 })
        .limit(MAX_COMMUNITY_NOTIFICATIONS)
    : [];
  const replyIds = new Set(replies.map(r => String(r._id)));

  const names = mentionNames(member.name);
  const candidates = names.length
    ? await CommunityMessage.find({
        content: { $regex: `@(${names.map(escapeRegex).join('|')})`, $options: 'i' },
        senderId: { $ne: member._id },
        channelId: { $in: channelIds },
        createdAt: { $gte: since },
      })
        .sort({ createdAt: -1 })
        .limit(MAX_COMMUNITY_NOTIFICATIONS * 2)
    : [];
  const mentions = candidates.filter(m => !replyIds.has(String(m._id)) && mentionsMember(m.content ?? '', names));

  const toItem = (m: (typeof replies)[number], type: CommunityNotificationType): CommunityNotification | null => {
    const channel = channelById.get(String(m.channelId));
    if (!channel) return null;
    return {
      id: `community:${m._id}`,
      type,
      messageId: String(m._id),
      channelId: String(m.channelId),
      channelSlug: channel.slug,
      channelName: channel.name,
      // An anonymous sender stays anonymous in the notification too.
      senderName: m.isAnonymous ? 'Someone' : m.senderDisplayName,
      snippet: makeSnippet(m.content),
      createdAt: new Date(m.createdAt).toISOString(),
    };
  };

  return [...replies.map(m => toItem(m, 'reply')), ...mentions.map(m => toItem(m, 'mention'))]
    .filter((x): x is CommunityNotification => x !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_COMMUNITY_NOTIFICATIONS);
}
