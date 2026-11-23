/**
 * Online status and "last seen" for direct chats. Reciprocal like WhatsApp: when you switch
 * "Show when I'm online" off, others can't see yours and you can't see theirs.
 */
import mongoose from 'mongoose';
import { User } from '../models/User';
import { CommunityChannel } from '../models/CommunityChannel';
import { isUserOnline, broadcastToUsers } from './socketService';

export const showOnlineOn = (prefs: { communityShowOnline?: boolean } | undefined | null): boolean => prefs?.communityShowOnline !== false;

export interface PresenceView {
  isOnline: boolean;
  /** Null when the person is online, has hidden it, or has never been seen. */
  lastSeenAt: Date | null;
}

/** What the viewer may see of someone's presence. Hidden (either side off) looks like "unknown", not "offline". */
export function presenceFor(viewerPrefs: any, target: { _id: unknown; lastSeenAt?: Date | null; preferences?: any }): PresenceView & { hidden: boolean } {
  if (!showOnlineOn(viewerPrefs) || !showOnlineOn(target.preferences)) return { isOnline: false, lastSeenAt: null, hidden: true };
  const online = isUserOnline(String(target._id));
  return { isOnline: online, lastSeenAt: online ? null : target.lastSeenAt ?? null, hidden: false };
}

/** The accepted direct-chat contacts of a person (one-to-one chats and groups). */
async function contactsOf(userId: string): Promise<string[]> {
  const channels = await CommunityChannel.find({
    type: 'dm',
    dmMemberIds: new mongoose.Types.ObjectId(userId),
    $or: [{ dmStatus: 'accepted' }, { dmStatus: { $exists: false } }],
  }).select('dmMemberIds').limit(300).lean();
  const ids = new Set<string>();
  for (const c of channels) for (const m of c.dmMemberIds ?? []) if (String(m) !== userId) ids.add(String(m));
  return [...ids];
}

/** A person came online or went offline: tell contacts whose apps are open (only those who may see it). */
export async function announcePresence(userId: string, online: boolean): Promise<void> {
  try {
    const at = new Date();
    if (!online) await User.updateOne({ _id: userId }, { $set: { lastSeenAt: at } });
    const me = await User.findById(userId).select('preferences.communityShowOnline').lean();
    if (!showOnlineOn(me?.preferences as any)) return;
    const contacts = await contactsOf(userId);
    if (!contacts.length) return;
    const people = await User.find({ _id: { $in: contacts } }).select('preferences.communityShowOnline').lean();
    const visibleTo = people.filter((p) => showOnlineOn(p.preferences as any)).map((p) => String(p._id));
    broadcastToUsers(visibleTo, 'presence', { userId, online, lastSeenAt: online ? null : at });
  } catch (err) {
    console.error('[presence] announce failed:', (err as Error).message);
  }
}
