/**
 * Reaching people for a direct message without sharing a community (personal invite link and
 * @handle), and group chats of 3 to 10 people. Mounted at /api/v1/community next to the chat router.
 *
 * Rules that keep it safe:
 * - A link or @handle can be switched off or replaced at any time; blocks apply both ways.
 * - Someone who opens your link starts an accepted chat (you handed them the link yourself);
 *   an @handle only starts a message request, because handles can be guessed.
 * - You can only add people you already chat with (an accepted 1-on-1), like Discord friends.
 */
import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../utils/errors';
import { User } from '../models/User';
import { CommunityChannel, ICommunityChannelDoc } from '../models/CommunityChannel';
import { CommunityBlock } from '../models/CommunityBlock';
import { DmInvite } from '../models/DmInvite';
import { CommunityMessage } from '../models/CommunityMessage';
import { isUserOnline, broadcastMessageCreated } from '../services/socketService';
import { Media } from '../models/Media';
import { withGroupExtras, cleanGroupAbout } from '../services/groupExtras';
import { sendToUser } from '../services/push/pushService';
import { CHANNEL_COMMUNITY, communityPushAllowed } from '../services/communityPush';
import {
  cleanGroupName, defaultGroupName, extractInviteCode, groupAddCheck, MAX_GROUP_MEMBERS, MIN_GROUP_MEMBERS, newInviteCode,
  nextOwner, normaliseHandle,
} from '../services/dmRules';

export const communityDmRouter = Router();
communityDmRouter.use(authenticate);

const uid = (req: AuthRequest) => new mongoose.Types.ObjectId(req.userId!);
const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v);
export const INVITE_LINK_PREFIX = 'lumen://community/invite/';

async function eitherBlocked(a: mongoose.Types.ObjectId | string, b: mongoose.Types.ObjectId | string): Promise<boolean> {
  return !!(await CommunityBlock.exists({ $or: [{ userId: a, blockedUserId: b }, { userId: b, blockedUserId: a }] }));
}

/** Everyone I have an accepted 1-on-1 chat with: the people I am allowed to add to a group. */
async function acceptedContacts(me: mongoose.Types.ObjectId): Promise<Set<string>> {
  // Chats from before message requests existed have no status; they count as accepted.
  const chats = await CommunityChannel.find({
    type: 'dm', isGroup: { $ne: true }, dmMemberIds: me,
    $or: [{ dmStatus: 'accepted' }, { dmStatus: { $exists: false } }],
  }).select('dmMemberIds').lean();
  const out = new Set<string>();
  for (const c of chats) for (const m of c.dmMemberIds ?? []) if (String(m) !== String(me)) out.add(String(m));
  return out;
}

async function ensureInvite(userId: mongoose.Types.ObjectId) {
  const existing = await DmInvite.findOne({ userId });
  if (existing) return existing;
  for (let i = 0; i < 5; i++) {
    try { return await DmInvite.create({ userId, code: newInviteCode(), enabled: true }); } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      const raced = await DmInvite.findOne({ userId });
      if (raced) return raced;
    }
  }
  throw AppError.badRequest('Could not make an invite link. Please try again.');
}

const inviteView = (d: { code: string; handle?: string | null; enabled: boolean }) => ({
  code: d.code, handle: d.handle ?? null, enabled: d.enabled, link: `${INVITE_LINK_PREFIX}${d.code}`,
});

// GET /community/me/invite — my link, code and handle (created on first use).
communityDmRouter.get('/me/invite', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json({ success: true, data: inviteView(await ensureInvite(uid(req))) }); } catch (err) { next(err); }
});

// PUT /community/me/invite/handle {handle|null}
communityDmRouter.put('/me/invite/handle', validate(z.object({ handle: z.string().max(40).nullable() })), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invite = await ensureInvite(uid(req));
    const raw = (req.body as { handle: string | null }).handle;
    if (raw === null || raw.trim() === '') {
      await DmInvite.updateOne({ _id: invite._id }, { $unset: { handle: 1 } });
      return res.json({ success: true, data: inviteView({ ...invite.toObject(), handle: null }) });
    }
    const h = normaliseHandle(raw);
    if (!h.ok) throw AppError.badRequest(h.reason);
    const taken = await DmInvite.exists({ handle: h.handle, userId: { $ne: invite.userId } });
    if (taken) throw AppError.conflict('That @name is taken.');
    invite.handle = h.handle;
    await invite.save();
    res.json({ success: true, data: inviteView(invite) });
  } catch (err) { next(err); }
});

// POST /community/me/invite/rotate — a new link; the old one stops working.
communityDmRouter.post('/me/invite/rotate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invite = await ensureInvite(uid(req));
    invite.code = newInviteCode();
    await invite.save();
    res.json({ success: true, data: inviteView(invite) });
  } catch (err) { next(err); }
});

// PUT /community/me/invite/enabled {enabled} — switches the link and @handle off or on.
communityDmRouter.put('/me/invite/enabled', validate(z.object({ enabled: z.boolean() })), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invite = await ensureInvite(uid(req));
    invite.enabled = (req.body as { enabled: boolean }).enabled;
    await invite.save();
    res.json({ success: true, data: inviteView(invite) });
  } catch (err) { next(err); }
});

/** The member behind a code or handle, or null (unknown, switched off, yourself, or blocked either way). */
async function resolveTarget(me: mongoose.Types.ObjectId, by: { code?: string; handle?: string }) {
  const invite = by.code ? await DmInvite.findOne({ code: by.code, enabled: true }) : by.handle ? await DmInvite.findOne({ handle: by.handle, enabled: true }) : null;
  if (!invite || String(invite.userId) === String(me)) return null;
  if (await eitherBlocked(me, invite.userId)) return null;
  const user = await User.findById(invite.userId).select('name').lean();
  return user ? { userId: String(user._id), displayName: user.name || 'Lumen Member', handle: invite.handle ?? null } : null;
}

// GET /community/invite/:code — who the link belongs to (name only), before opening a chat.
communityDmRouter.get('/invite/:code', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const code = extractInviteCode(req.params.code);
    const target = code ? await resolveTarget(uid(req), { code }) : null;
    if (!target) throw AppError.notFound('This invite link is not valid any more.');
    res.json({ success: true, data: { displayName: target.displayName, handle: target.handle } });
  } catch (err) { next(err); }
});

// GET /community/people/handle/:handle — exact @handle only (never a fuzzy search).
communityDmRouter.get('/people/handle/:handle', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const h = normaliseHandle(req.params.handle);
    const target = h.ok ? await resolveTarget(uid(req), { handle: h.handle }) : null;
    if (!target) throw AppError.notFound('No one with that @name.');
    res.json({ success: true, data: { userId: target.userId, displayName: target.displayName, handle: target.handle } });
  } catch (err) { next(err); }
});

async function dmView(channel: ICommunityChannelDoc | Record<string, any>, targetUserId: string, displayName: string) {
  const obj = typeof (channel as ICommunityChannelDoc).toObject === 'function' ? (channel as ICommunityChannelDoc).toObject() : channel;
  return { ...obj, _id: String(obj._id), dmUser: { _id: targetUserId, displayName, avatarEmoji: '🌟', isOnline: isUserOnline(targetUserId) } };
}

// POST /community/dms/by-invite {code | link} — open a chat with whoever's link this is.
communityDmRouter.post('/dms/by-invite', validate(z.object({ code: z.string().min(8).max(200) })), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = uid(req);
    const code = extractInviteCode((req.body as { code: string }).code);
    const target = code ? await resolveTarget(me, { code }) : null;
    if (!target) throw AppError.notFound('This invite link is not valid any more.');
    const other = new mongoose.Types.ObjectId(target.userId);

    let chat = await CommunityChannel.findOne({ type: 'dm', isGroup: { $ne: true }, dmMemberIds: { $all: [me, other], $size: 2 } });
    if (!chat) {
      chat = await CommunityChannel.create({
        slug: `dm-${String(me).slice(-4)}-${target.userId.slice(-4)}-${Date.now().toString(36)}`,
        name: target.displayName, description: `Direct conversation with ${target.displayName}`, icon: '💬', color: '#EC4899',
        topic: 'Private 1-on-1 conversation', category: 'DIRECT MESSAGES', type: 'dm',
        dmMemberIds: [me, other], order: 0, memberCount: 2, messageCount: 0,
        dmInitiatorId: me,
        // They gave out the link themselves, so there is no request to wait for.
        dmStatus: 'accepted',
      });
    } else if (chat.dmStatus !== 'accepted') {
      chat.dmStatus = 'accepted';
      await chat.save();
    }
    res.status(201).json({ success: true, data: await dmView(chat, target.userId, target.displayName) });
  } catch (err) { next(err); }
});

// ────────── Group chats ──────────

const GroupSchema = z.object({
  name: z.string().max(100).optional(),
  memberIds: z.array(z.string()).min(MIN_GROUP_MEMBERS - 1).max(MAX_GROUP_MEMBERS - 1),
});

/** Checks every person may be added by `me`; returns the reason or null. */
async function addProblem(me: mongoose.Types.ObjectId, ids: string[]): Promise<string | null> {
  if (ids.some(i => !isId(i))) return 'Pick people from your chats.';
  const contacts = await acceptedContacts(me);
  const notContacts = ids.filter(i => !contacts.has(i));
  if (notContacts.length) {
    const names = (await User.find({ _id: { $in: notContacts } }).select('name').lean()).map(u => u.name || 'Someone');
    return `You can add people you already chat with. Start a chat with ${names.join(', ') || 'them'} first and wait for them to accept.`;
  }
  for (const id of ids) if (await eitherBlocked(me, id)) return 'You cannot add someone you have blocked or who has blocked you.';
  return null;
}

async function groupView(channel: any, viewerId: string) {
  const obj = typeof channel.toObject === 'function' ? channel.toObject() : channel;
  const ids: string[] = (obj.dmMemberIds ?? []).map(String);
  const users = await User.find({ _id: { $in: ids } }).select('name').lean();
  const byId = new Map(users.map(u => [String(u._id), u.name || 'Lumen Member']));
  const members = ids.map(id => ({ _id: id, displayName: byId.get(id) ?? 'Lumen Member', isOwner: id === String(obj.dmInitiatorId), isMe: id === viewerId }));
  return withGroupExtras({ ...obj, _id: String(obj._id), groupMembers: members, dmUser: null }, viewerId);
}
export { groupView };

/** Puts a centred notice in the group ("Ana added Cy") and tells open chats. Never blocks the action. */
async function groupNotice(group: any, actorId: string, text: string): Promise<void> {
  try {
    const actor = await User.findById(actorId).select('name').lean();
    const msg = await CommunityMessage.create({
      channelId: group._id, senderId: actorId, senderDisplayName: actor?.name || 'Lumen Member',
      isAnonymous: false, isSystem: true, content: text.slice(0, 300),
    });
    group.messageCount = (group.messageCount ?? 0) + 1;
    await group.save();
    broadcastMessageCreated(String(group._id), { ...msg.toObject(), _id: String(msg._id), channelId: String(group._id), senderId: actorId }, (group.dmMemberIds ?? []).map(String));
  } catch (err) { console.error('[group-notice] failed:', (err as Error).message); }
}

/** Tells people they were added: one push each, honouring mute and quiet hours. */
async function pushAdded(group: any, actorId: string, addedIds: string[]): Promise<void> {
  try {
    const actor = await User.findById(actorId).select('name').lean();
    for (const userId of addedIds) {
      const prefs = await User.findById(userId).select('preferences.communityPush preferences.communityQuiet preferences.timezone').lean();
      if (!communityPushAllowed(prefs?.preferences as Parameters<typeof communityPushAllowed>[0])) continue;
      await sendToUser(userId, {
        title: group.name,
        body: `${actor?.name || 'Someone'} added you to this group`,
        channelId: CHANNEL_COMMUNITY,
        data: { type: 'COMMUNITY', route: `/community/${group.slug}` },
      });
    }
  } catch (err) { console.error('[group-added-push] failed:', (err as Error).message); }
}

async function namesOf(ids: string[]): Promise<string> {
  const users = await User.find({ _id: { $in: ids } }).select('name').lean();
  const names = users.map(u => u.name || 'Someone');
  return names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join(' and ');
}

async function myGroup(req: AuthRequest, id: string) {
  if (!isId(id)) throw AppError.notFound();
  const g = await CommunityChannel.findOne({ _id: id, type: 'dm', isGroup: true, dmMemberIds: uid(req) });
  if (!g) throw AppError.notFound('Group not found');
  return g;
}

// POST /community/dms/groups {name?, memberIds} — start a group with people I already chat with.
communityDmRouter.post('/dms/groups', validate(GroupSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = uid(req);
    const { name, memberIds } = req.body as z.infer<typeof GroupSchema>;
    const ids = Array.from(new Set(memberIds)).filter(i => i !== String(me));
    if (ids.length < MIN_GROUP_MEMBERS - 1) throw AppError.badRequest('Pick at least 2 other people.');
    const problem = await addProblem(me, ids);
    if (problem) throw AppError.badRequest(problem);
    const users = await User.find({ _id: { $in: ids } }).select('name').lean();
    const finalName = cleanGroupName(name) || defaultGroupName(users.map(u => u.name || ''));
    const group = await CommunityChannel.create({
      slug: `grp-${String(me).slice(-4)}-${Date.now().toString(36)}`,
      name: finalName, description: 'Group chat', icon: '👥', color: '#8B5CF6', topic: 'Private group chat', category: 'DIRECT MESSAGES',
      type: 'dm', isGroup: true, dmMemberIds: [me, ...ids.map(i => new mongoose.Types.ObjectId(i))],
      dmInitiatorId: me, dmStatus: 'accepted', order: 0, memberCount: ids.length + 1, messageCount: 0,
    });
    await groupNotice(group, String(me), `${(await User.findById(me).select('name').lean())?.name || 'Someone'} created the group`);
    void pushAdded(group, String(me), ids);
    res.status(201).json({ success: true, data: await groupView(group, String(me)) });
  } catch (err) { next(err); }
});

// POST /community/dms/:id/members {userIds} — any member can add people they already chat with.
communityDmRouter.post('/dms/:id/members', validate(z.object({ userIds: z.array(z.string()).min(1).max(MAX_GROUP_MEMBERS) })), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = uid(req);
    const group = await myGroup(req, req.params.id);
    const add = Array.from(new Set((req.body as { userIds: string[] }).userIds)).filter(i => !(group.dmMemberIds ?? []).some(m => String(m) === i));
    if (add.length === 0) return res.json({ success: true, data: await groupView(group, String(me)) });
    const size = groupAddCheck((group.dmMemberIds ?? []).map(String), add);
    if (!size.ok) throw AppError.badRequest(size.reason);
    const problem = await addProblem(me, add);
    if (problem) throw AppError.badRequest(problem);
    group.dmMemberIds = size.next.map(i => new mongoose.Types.ObjectId(i));
    group.memberCount = size.next.length;
    await group.save();
    await groupNotice(group, String(me), `${(await User.findById(me).select('name').lean())?.name || 'Someone'} added ${await namesOf(add)}`);
    void pushAdded(group, String(me), add);
    res.json({ success: true, data: await groupView(group, String(me)) });
  } catch (err) { next(err); }
});

// DELETE /community/dms/:id/members/:userId — only the owner removes someone else.
communityDmRouter.delete('/dms/:id/members/:userId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = uid(req);
    const group = await myGroup(req, req.params.id);
    if (String(group.dmInitiatorId) !== String(me)) throw AppError.forbidden('Only the person who started the group can remove people.');
    if (req.params.userId === String(me)) throw AppError.badRequest('Use Leave group instead.');
    const removedName = await namesOf([req.params.userId]);
    group.dmMemberIds = (group.dmMemberIds ?? []).filter(m => String(m) !== req.params.userId);
    group.memberCount = group.dmMemberIds.length;
    await group.save();
    await groupNotice(group, String(me), `${(await User.findById(me).select('name').lean())?.name || 'Someone'} removed ${removedName}`);
    res.json({ success: true, data: await groupView(group, String(me)) });
  } catch (err) { next(err); }
});

// POST /community/dms/:id/leave — leave a group; the longest-standing member becomes owner if the owner leaves.
communityDmRouter.post('/dms/:id/leave', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = String(uid(req));
    const group = await myGroup(req, req.params.id);
    const ids = (group.dmMemberIds ?? []).map(String);
    if (String(group.dmInitiatorId) === me) {
      const owner = nextOwner(ids, me);
      if (owner) group.dmInitiatorId = new mongoose.Types.ObjectId(owner);
    }
    group.mutedBy = (group.mutedBy ?? []).filter(m => String(m) !== me);
    group.dmMemberIds = ids.filter(i => i !== me).map(i => new mongoose.Types.ObjectId(i));
    group.memberCount = group.dmMemberIds.length;
    await group.save();
    await groupNotice(group, me, `${(await User.findById(me).select('name').lean())?.name || 'Someone'} left the group`);
    res.json({ success: true });
  } catch (err) { next(err); }
});

const GroupEditSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  about: z.string().max(1000).optional(),
  /** An image the member uploaded; null removes the photo. */
  photoMediaId: z.string().nullable().optional(),
}).refine(b => b.name !== undefined || b.about !== undefined || b.photoMediaId !== undefined, { message: 'Nothing to change.' });

// PATCH /community/dms/:id {name?, about?, photoMediaId?} — any member can change the name, description or photo.
communityDmRouter.patch('/dms/:id', validate(GroupEditSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = String(uid(req));
    const group = await myGroup(req, req.params.id);
    const body = req.body as z.infer<typeof GroupEditSchema>;
    const notices: string[] = [];
    if (body.name !== undefined) {
      const name = cleanGroupName(body.name);
      if (!name) throw AppError.badRequest('Give the group a name.');
      if (name !== group.name) { group.name = name; notices.push(`renamed the group to “${name}”`); }
    }
    if (body.about !== undefined) {
      const about = cleanGroupAbout(body.about);
      if (about !== (group.about ?? '')) { group.about = about; notices.push(about ? 'changed the group description' : 'removed the group description'); }
    }
    if (body.photoMediaId !== undefined) {
      if (body.photoMediaId === null) {
        if (group.photoMediaId) { group.photoMediaId = undefined; notices.push('removed the group photo'); }
      } else {
        if (!isId(body.photoMediaId)) throw AppError.badRequest('That photo could not be used. Please upload it again.');
        const photo = await Media.findOne({ _id: body.photoMediaId, userId: uid(req) }).select('_id mimeType');
        if (!photo || !String(photo.mimeType || '').startsWith('image/')) throw AppError.badRequest('That photo could not be used. Please upload it again.');
        group.photoMediaId = photo._id as mongoose.Types.ObjectId;
        notices.push('changed the group photo');
      }
    }
    await group.save();
    if (notices.length) {
      const who = (await User.findById(me).select('name').lean())?.name || 'Someone';
      await groupNotice(group, me, `${who} ${notices.join(' and ')}`);
    }
    res.json({ success: true, data: await groupView(group, me) });
  } catch (err) { next(err); }
});

// PUT /community/dms/:id/mute {muted} — silence this group's pushes for me only. Messages still arrive.
communityDmRouter.put('/dms/:id/mute', validate(z.object({ muted: z.boolean() })), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = uid(req);
    await myGroup(req, req.params.id);
    const { muted } = req.body as { muted: boolean };
    const update = muted ? { $addToSet: { mutedBy: me } } : { $pull: { mutedBy: me } };
    const group = await CommunityChannel.findOneAndUpdate({ _id: req.params.id, type: 'dm', isGroup: true, dmMemberIds: me }, update, { new: true });
    if (!group) throw AppError.notFound('Group not found');
    res.json({ success: true, data: await groupView(group, String(me)) });
  } catch (err) { next(err); }
});
