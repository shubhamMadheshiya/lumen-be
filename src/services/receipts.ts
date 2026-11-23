/**
 * Delivered and seen ticks for direct messages and groups.
 * - Delivered: the person's app received the message (always shown to the sender).
 * - Seen: the person opened the chat. Reciprocal like WhatsApp: if you switch seen-ticks off you neither
 *   send nor see them. Message requests that are not accepted yet show no ticks at all.
 * Message ids are ObjectIds, which sort by time, so "later" is just a larger id.
 */
import mongoose from 'mongoose';
import { ChannelReadState } from '../models/ChannelReadState';
import { CommunityMessage } from '../models/CommunityMessage';
import { User } from '../models/User';
import { broadcastToUsers } from './socketService';

export interface ReceiptChannel {
  _id: mongoose.Types.ObjectId | string;
  type: string;
  dmStatus?: string;
  dmMemberIds?: Array<mongoose.Types.ObjectId | string>;
}

export interface MemberReceipt {
  userId: string;
  displayName?: string;
  lastDeliveredMessageId: string | null;
  lastDeliveredAt: Date | null;
  /** Null when the person turned seen-ticks off, or you did. */
  lastReadMessageId: string | null;
  lastReadAt: Date | null;
}

/** Ticks only exist in accepted direct chats and groups. */
export function receiptsApply(channel: ReceiptChannel): boolean {
  return channel.type === 'dm' && (channel.dmStatus === undefined || channel.dmStatus === 'accepted');
}

export const readReceiptsOn = (prefs: { communityReadReceipts?: boolean } | undefined | null): boolean => prefs?.communityReadReceipts !== false;

/** What `viewer` may see of one member's row: delivery always, "seen" only when both of you have it on. */
export function visibleRow(row: MemberReceipt, viewerReadOn: boolean, memberReadOn: boolean): MemberReceipt {
  if (viewerReadOn && memberReadOn) return row;
  return { ...row, lastReadMessageId: null, lastReadAt: null };
}

const oidOrNull = (v: unknown) => (v && mongoose.Types.ObjectId.isValid(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null);

async function latestMessageId(channelId: mongoose.Types.ObjectId | string): Promise<mongoose.Types.ObjectId | null> {
  const m = await CommunityMessage.findOne({ channelId }).sort({ _id: -1 }).select('_id').lean();
  return m ? (m._id as mongoose.Types.ObjectId) : null;
}

/** Moves the person's "read up to" forward (never back). Without an id, up to the newest message. */
export async function markRead(userId: mongoose.Types.ObjectId, channelId: mongoose.Types.ObjectId, messageId?: string) {
  const id = oidOrNull(messageId) ?? (await latestMessageId(channelId));
  const now = new Date();
  const state = await ChannelReadState.findOneAndUpdate(
    { userId, channelId },
    { $set: { lastReadAt: now }, ...(id ? { $max: { lastReadMessageId: id, lastDeliveredMessageId: id } } : {}), $setOnInsert: { lastDeliveredAt: now } },
    { upsert: true, new: true },
  );
  return state;
}

/** Moves the person's "delivered up to" forward (never back). */
export async function markDelivered(userId: mongoose.Types.ObjectId, channelId: mongoose.Types.ObjectId, messageId?: string) {
  const id = oidOrNull(messageId) ?? (await latestMessageId(channelId));
  if (!id) return null;
  return ChannelReadState.findOneAndUpdate(
    { userId, channelId },
    { $max: { lastDeliveredMessageId: id }, $set: { lastDeliveredAt: new Date() }, $setOnInsert: { lastReadAt: new Date(0) } },
    { upsert: true, new: true },
  );
}

/** Everyone else in the chat, with what the viewer may know about them. */
export async function receiptsFor(channel: ReceiptChannel, viewerId: string): Promise<{ applies: boolean; viewerReadOn: boolean; members: MemberReceipt[] }> {
  const viewer = await User.findById(viewerId).select('preferences.communityReadReceipts').lean();
  const viewerReadOn = readReceiptsOn(viewer?.preferences as any);
  if (!receiptsApply(channel)) return { applies: false, viewerReadOn, members: [] };
  const others = (channel.dmMemberIds ?? []).map(String).filter(id => id !== viewerId);
  const [states, users] = await Promise.all([
    ChannelReadState.find({ channelId: channel._id, userId: { $in: others } }).lean(),
    User.find({ _id: { $in: others } }).select('name preferences.communityReadReceipts').lean(),
  ]);
  const stateBy = new Map(states.map(s => [String(s.userId), s]));
  const userBy = new Map(users.map(u => [String(u._id), u]));
  const members = others.map(id => {
    const s: any = stateBy.get(id);
    const u: any = userBy.get(id);
    const row: MemberReceipt = {
      userId: id,
      displayName: u?.name || 'Lumen Member',
      lastDeliveredMessageId: s?.lastDeliveredMessageId ? String(s.lastDeliveredMessageId) : null,
      lastDeliveredAt: s?.lastDeliveredAt ?? null,
      lastReadMessageId: s?.lastReadMessageId ? String(s.lastReadMessageId) : null,
      lastReadAt: s?.lastReadMessageId ? s.lastReadAt ?? null : null,
    };
    return visibleRow(row, viewerReadOn, readReceiptsOn(u?.preferences));
  });
  return { applies: true, viewerReadOn, members };
}

/** Tells the other members' open apps that someone's ticks moved (each gets only what they may see). */
export async function announceReceipt(channel: ReceiptChannel, userId: string, change: { read?: string; delivered?: string; at: Date }): Promise<void> {
  try {
    if (!receiptsApply(channel)) return;
    const others = (channel.dmMemberIds ?? []).map(String).filter(id => id !== userId);
    if (others.length === 0) return;
    const [me, people] = await Promise.all([
      User.findById(userId).select('preferences.communityReadReceipts').lean(),
      User.find({ _id: { $in: others } }).select('preferences.communityReadReceipts').lean(),
    ]);
    const myReadOn = readReceiptsOn(me?.preferences as any);
    for (const p of people) {
      const both = myReadOn && readReceiptsOn(p.preferences as any);
      broadcastToUsers([String(p._id)], 'receipt_updated', {
        channelId: String(channel._id),
        userId,
        ...(change.delivered ? { lastDeliveredMessageId: change.delivered } : {}),
        ...(both && change.read ? { lastReadMessageId: change.read } : {}),
        at: change.at,
      });
    }
  } catch (err) {
    console.error('[receipts] announce failed:', (err as Error).message);
  }
}
