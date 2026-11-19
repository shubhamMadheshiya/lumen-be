import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { communityChatRouter, canAccessChannel } from '../routes/communityChat';
import { CommunityChannel } from '../models/CommunityChannel';
import { CommunityServer } from '../models/CommunityServer';
import { CommunityMessage } from '../models/CommunityMessage';
import { User } from '../models/User';
import { Media } from '../models/Media';
import { ServerTimeout } from '../models/ServerTimeout';
import { CommunityBlock } from '../models/CommunityBlock';
import { CommunityReport } from '../models/CommunityReport';

const oid = () => new mongoose.Types.ObjectId();
const me = oid();
const other = oid();
const token = jwt.sign({ sub: me.toString(), type: 'access' }, config.jwt.accessSecret);

const app = express();
app.use(express.json());
app.use('/community', communityChatRouter);
app.use((err: { message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, message: err.message });
});
const as = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

const serverFindById = (server: unknown) =>
  jest.spyOn(CommunityServer, 'findById').mockImplementation((() => ({ select: async () => server })) as never);

afterEach(() => jest.restoreAllMocks());

describe('canAccessChannel', () => {
  it('lets only the two members into a DM', async () => {
    const dm = { type: 'dm', dmMemberIds: [me, other] };
    expect(await canAccessChannel(me, dm)).toBe(true);
    expect(await canAccessChannel(oid(), dm)).toBe(false);
  });

  it('keeps private servers to their members, but public and official ones open', async () => {
    const channel = { type: 'text', serverId: oid() };
    serverFindById({ isPrivate: true, isOfficial: false, memberIds: [other] });
    expect(await canAccessChannel(me, channel)).toBe(false);
    jest.restoreAllMocks();
    serverFindById({ isPrivate: true, isOfficial: false, memberIds: [me] });
    expect(await canAccessChannel(me, channel)).toBe(true);
    jest.restoreAllMocks();
    serverFindById({ isPrivate: false, isOfficial: false, memberIds: [] });
    expect(await canAccessChannel(me, channel)).toBe(true);
  });

  it('says no when the server no longer exists', async () => {
    serverFindById(null);
    expect(await canAccessChannel(me, { type: 'text', serverId: oid() })).toBe(false);
  });
});

describe('community routes', () => {
  const dmChannel = { _id: oid(), type: 'dm', dmMemberIds: [other, oid()] };

  it('answers 404 for messages of a DM the caller is not part of', async () => {
    jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(dmChannel as never);
    const find = jest.spyOn(CommunityMessage, 'find');
    const res = await as(request(app).get(`/community/channels/${dmChannel._id}/messages`));
    expect(res.status).toBe(404);
    expect(find).not.toHaveBeenCalled();
  });

  it('refuses to post into a DM the caller is not part of', async () => {
    jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(dmChannel as never);
    const create = jest.spyOn(CommunityMessage, 'create');
    const res = await as(request(app).post(`/community/channels/${dmChannel._id}/messages`)).send({ channelId: String(dmChannel._id), content: 'hi' });
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not let a non-owner create channels', async () => {
    jest.spyOn(CommunityServer, 'findById').mockResolvedValue({ _id: oid(), slug: 's', ownerId: other } as never);
    const res = await as(request(app).post(`/community/servers/${oid()}/channels`)).send({ name: 'Secret' });
    expect(res.status).toBe(403);
  });

  it('does not reveal who wrote an anonymous message to other members', async () => {
    const channel = { _id: oid(), type: 'text', serverId: oid() };
    jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(channel as never);
    serverFindById({ isPrivate: false, isOfficial: true, memberIds: [] });
    const msg = (isAnonymous: boolean, senderId: mongoose.Types.ObjectId) => ({
      _id: oid(), channelId: channel._id, senderId, isAnonymous, content: 'x', reactions: {}, userReactions: {}, createdAt: new Date(),
    });
    jest.spyOn(CommunityMessage, 'find').mockImplementation((() => ({
      sort: () => ({ limit: () => ({ lean: async () => [msg(true, other), msg(true, me), msg(false, other)] }) }),
    })) as never);
    jest.spyOn(CommunityBlock, 'find').mockImplementation((() => ({ select: () => ({ lean: async () => [] }) })) as never);
    const res = await as(request(app).get(`/community/channels/${channel._id}/messages`));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((m: { senderId: string }) => m.senderId);
    expect(ids).toContain('anonymous');
    expect(ids).toContain(String(me));
    expect(ids.filter((i: string) => i === String(other))).toHaveLength(1);
  });

  it('shows only what the member shared in the community on their profile card', async () => {
    const target = oid();
    jest.spyOn(User, 'findById').mockImplementation((() => ({ lean: async () => ({ _id: target, name: 'Asha', conditions: ['Lupus'] }) })) as never);
    jest.spyOn(CommunityMessage, 'countDocuments').mockImplementation((async (f: { embedType?: string }) => (f.embedType === 'note' ? 3 : 1)) as never);
    jest.spyOn(CommunityMessage, 'aggregate').mockResolvedValue([{ _id: null, n: 5 }] as never);
    jest.spyOn(CommunityServer, 'exists').mockResolvedValue(null as never);
    const res = await as(request(app).get(`/community/users/${target}/popout`));
    expect(res.status).toBe(200);
    expect(res.body.data.stats).toEqual({ sharedNotesCount: 3, sharedTodosCount: 1, totalClones: 5 });
    expect(res.body.data.conditionTags).toEqual([]); // health conditions are never exposed
    expect(JSON.stringify(res.body.data)).not.toContain('Lupus');
  });

  describe('server settings', () => {
    const sid = oid();
    const server = (over: Record<string, unknown> = {}) => ({
      _id: sid, name: 'Calm', slug: 'calm', ownerId: other, isOfficial: false, isPrivate: false, memberIds: [me, other],
      membersCount: 2, save: jest.fn(), deleteOne: jest.fn(), toObject() { return { name: this.name }; }, ...over,
    });
    const found = (doc: unknown) => jest.spyOn(CommunityServer, 'findById').mockResolvedValue(doc as never);

    it('only the owner can rename a server', async () => {
      found(server());
      const res = await as(request(app).patch(`/community/servers/${sid}`)).send({ name: 'Hijacked' });
      expect(res.status).toBe(403);
    });

    it('lets the owner rename it', async () => {
      const doc = server({ ownerId: me });
      found(doc);
      const res = await as(request(app).patch(`/community/servers/${sid}`)).send({ name: 'Calm Corner' });
      expect(res.status).toBe(200);
      expect(doc.name).toBe('Calm Corner');
      expect(doc.save).toHaveBeenCalled();
    });

    it('never deletes the official server, or a server the caller does not own', async () => {
      found(server({ isOfficial: true, ownerId: me }));
      expect((await as(request(app).delete(`/community/servers/${sid}`))).status).toBe(403);
      jest.restoreAllMocks();
      found(server());
      expect((await as(request(app).delete(`/community/servers/${sid}`))).status).toBe(403);
    });

    it('lets a member leave, but not the owner', async () => {
      const doc = server();
      found(doc);
      expect((await as(request(app).post(`/community/servers/${sid}/leave`))).status).toBe(200);
      expect(doc.memberIds.map(String)).toEqual([String(other)]);
      jest.restoreAllMocks();
      found(server({ ownerId: me }));
      expect((await as(request(app).post(`/community/servers/${sid}/leave`))).status).toBe(400);
    });

    it('hides the member list of a private server from outsiders', async () => {
      found(server({ isPrivate: true, memberIds: [other] }));
      const res = await as(request(app).get(`/community/servers/${sid}/members`));
      expect(res.status).toBe(404);
    });
  });

  describe('moderators', () => {
    const sid = oid();
    const mod = oid();
    const doc = (over: Record<string, unknown> = {}) => ({
      _id: sid, ownerId: other, modIds: [mod], isOfficial: false, isPrivate: false, memberIds: [me, other, mod], save: jest.fn(), ...over,
    });
    const found = (d: unknown) =>
      jest.spyOn(CommunityServer, 'findById').mockImplementation((() => {
        const q = Promise.resolve(d) as Promise<unknown> & { select: () => Promise<unknown> };
        q.select = async () => d;
        return q;
      }) as never);

    it('serverRole tells owner, moderator and plain member apart', async () => {
      const { serverRole } = await import('../routes/communityChat');
      found(doc());
      expect(await serverRole(other, sid)).toBe('owner');
      expect(await serverRole(mod, sid)).toBe('mod');
      expect(await serverRole(me, sid)).toBeNull();
    });

    it('only the owner can appoint a moderator, and only a member', async () => {
      found(doc());
      expect((await as(request(app).post(`/community/servers/${sid}/moderators`)).send({ userId: String(me), isMod: true })).status).toBe(403);
      jest.restoreAllMocks();
      const mine = doc({ ownerId: me });
      found(mine);
      expect((await as(request(app).post(`/community/servers/${sid}/moderators`)).send({ userId: String(oid()), isMod: true })).status).toBe(400);
      const res = await as(request(app).post(`/community/servers/${sid}/moderators`)).send({ userId: String(other), isMod: true });
      expect(res.status).toBe(200);
      expect(res.body.data.modIds).toContain(String(other));
    });

    it('a moderator cannot time out the owner, and a plain member cannot time out anyone', async () => {
      const modToken = jwt.sign({ sub: mod.toString(), type: 'access' }, config.jwt.accessSecret);
      found(doc());
      const asMod = (r: request.Test) => r.set('Authorization', `Bearer ${modToken}`);
      const body = { userId: String(other), durationMinutes: 10 };
      expect((await asMod(request(app).post(`/community/servers/${sid}/timeout`)).send(body)).status).toBe(403);
      expect((await as(request(app).post(`/community/servers/${sid}/timeout`)).send({ userId: String(mod), durationMinutes: 10 })).status).toBe(403);
    });
  });

  describe('photos', () => {
    const channel = { _id: oid(), type: 'text', serverId: oid(), slug: 'general', name: 'General' };
    beforeEach(() => {
      jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(channel as never);
      jest.spyOn(ServerTimeout, 'findOne').mockResolvedValue(null as never);
      jest.spyOn(User, 'findById').mockResolvedValue({ name: 'Me' } as never);
      jest.spyOn(CommunityServer, 'findById').mockImplementation((() => {
        const d = { isPrivate: false, isOfficial: true, memberIds: [], ownerId: other, modIds: [] };
        const q = Promise.resolve(d) as Promise<unknown> & { select: () => Promise<unknown> };
        q.select = async () => d;
        return q;
      }) as never);
    });
    const post = (embedData: Record<string, unknown>) =>
      as(request(app).post(`/community/channels/${channel._id}/messages`)).send({ channelId: String(channel._id), content: '', embedType: 'photo', embedData });

    it('refuses a photo that is just a link to somewhere else', async () => {
      const create = jest.spyOn(CommunityMessage, 'create');
      const res = await post({ photoUrl: 'https://evil.example/track.png' });
      expect(res.status).toBe(400);
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses media that belongs to someone else or is not an image', async () => {
      const findMedia = jest.spyOn(Media, 'findOne');
      findMedia.mockImplementation((() => ({ select: async () => null })) as never);
      expect((await post({ photoMediaId: String(oid()) })).status).toBe(400);
      findMedia.mockImplementation((() => ({ select: async () => ({ _id: oid(), mimeType: 'application/pdf' }) })) as never);
      expect((await post({ photoMediaId: String(oid()) })).status).toBe(400);
    });
  });

  describe('block and report', () => {
    const channel = { _id: oid(), type: 'text', serverId: oid() };
    const anon = (over: Record<string, unknown> = {}) => ({
      _id: oid(), channelId: channel._id, senderId: other, isAnonymous: true, senderDisplayName: 'Anonymous Spoonie',
      content: 'buy my miracle powder', ...over,
    });
    beforeEach(() => {
      jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(channel as never);
      jest.spyOn(CommunityServer, 'findById').mockImplementation((() => {
        const d = { isPrivate: false, isOfficial: true, memberIds: [], ownerId: other, modIds: [] };
        const q = Promise.resolve(d) as Promise<unknown> & { select: () => Promise<unknown> };
        q.select = async () => d;
        return q;
      }) as never);
    });
    const message = (m: unknown) => jest.spyOn(CommunityMessage, 'findById').mockResolvedValue(m as never);

    it('blocks the author of an anonymous message without revealing who it is', async () => {
      message(anon());
      const upsert = jest.spyOn(CommunityBlock, 'findOneAndUpdate').mockImplementation((async (_f: unknown, update: { $setOnInsert: { label: string; viaAnonymous: boolean } }) => ({
        _id: oid(), blockedUserId: other, ...update.$setOnInsert,
      })) as never);
      const res = await as(request(app).post(`/community/messages/${oid()}/block`));
      expect(res.status).toBe(201);
      expect(upsert).toHaveBeenCalledWith({ userId: me, blockedUserId: other }, expect.anything(), expect.anything());
      expect(res.body.data.label).toBe('Anonymous member');
      expect(res.body.data.userId).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(String(other));
    });

    it('does not let someone block or report themselves', async () => {
      message(anon({ senderId: me, isAnonymous: false }));
      expect((await as(request(app).post(`/community/messages/${oid()}/block`))).status).toBe(400);
      expect((await as(request(app).post(`/community/messages/${oid()}/report`)).send({ reason: 'spam' })).status).toBe(400);
    });

    it('stores a report with a copy of the text, and treats a repeat report as done', async () => {
      message(anon({ isAnonymous: false, senderDisplayName: 'Ravi' }));
      const create = jest.spyOn(CommunityReport, 'create').mockResolvedValueOnce({} as never);
      expect((await as(request(app).post(`/community/messages/${oid()}/report`)).send({ reason: 'harmful_advice' })).status).toBe(201);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ reason: 'harmful_advice', snippet: 'buy my miracle powder', senderLabel: 'Ravi' }));
      create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
      expect((await as(request(app).post(`/community/messages/${oid()}/report`)).send({ reason: 'spam' })).status).toBe(201);
    });

    it('rejects an unknown report reason, and keeps reports from non-staff', async () => {
      message(anon());
      expect((await as(request(app).post(`/community/messages/${oid()}/report`)).send({ reason: 'dislike' })).status).toBe(400);
      expect((await as(request(app).get(`/community/servers/${oid()}/reports`))).status).toBe(403);
    });
  });

  describe('my settings and content warnings', () => {
    it('saves a status and the mute switch, and clears an empty status', async () => {
      const update = jest.spyOn(User, 'updateOne').mockResolvedValue({} as never);
      expect((await as(request(app).put('/community/me/settings')).send({ status: '🥄 Low spoons', push: false })).status).toBe(200);
      expect(update).toHaveBeenLastCalledWith({ _id: me }, { $set: { 'preferences.communityStatus': '🥄 Low spoons', 'preferences.communityPush': false } });
      await as(request(app).put('/community/me/settings')).send({ status: '' });
      expect(update).toHaveBeenLastCalledWith({ _id: me }, { $unset: { 'preferences.communityStatus': '' } });
      expect((await as(request(app).put('/community/me/settings')).send({})).status).toBe(400);
      expect((await as(request(app).put('/community/me/settings')).send({ status: 'x'.repeat(61) })).status).toBe(400);
    });

    it('reports the status back, defaulting to notifications on', async () => {
      jest.spyOn(User, 'findById').mockImplementation((() => ({ select: () => ({ lean: async () => ({ preferences: {} }) }) })) as never);
      const res = await as(request(app).get('/community/me/settings'));
      expect(res.body.data).toEqual({ status: '', push: true, quiet: false });
    });
  });

  describe('slow mode, message requests and translation', () => {
    const textChannel = (over: Record<string, unknown> = {}) => ({
      _id: oid(), type: 'text', serverId: oid(), slug: 'g', name: 'G', slowModeSeconds: 0, ...over,
    });
    const publicServer = () =>
      jest.spyOn(CommunityServer, 'findById').mockImplementation((() => {
        const d = { isPrivate: false, isOfficial: true, memberIds: [], ownerId: other, modIds: [] };
        const q = Promise.resolve(d) as Promise<unknown> & { select: () => Promise<unknown> };
        q.select = async () => d;
        return q;
      }) as never);
    const post = (c: { _id: unknown }) => as(request(app).post(`/community/channels/${c._id}/messages`)).send({ channelId: String(c._id), content: 'hello' });

    beforeEach(() => {
      jest.spyOn(ServerTimeout, 'findOne').mockResolvedValue(null as never);
      jest.spyOn(CommunityBlock, 'exists').mockResolvedValue(null as never);
    });

    it('makes a regular member wait in slow mode', async () => {
      const c = textChannel({ slowModeSeconds: 60 });
      jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(c as never);
      publicServer();
      jest.spyOn(CommunityMessage, 'findOne').mockImplementation((() => ({ sort: () => ({ select: () => ({ lean: async () => ({ createdAt: new Date(Date.now() - 10_000) }) }) }) })) as never);
      const res = await post(c);
      expect(res.status).toBe(429);
      expect(res.body.message).toMatch(/Slow mode/);
    });

    it('lets only staff change slow mode', async () => {
      const c = { ...textChannel(), save: jest.fn() };
      jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(c as never);
      publicServer();
      const res = await as(request(app).patch(`/community/channels/${c._id}/settings`)).send({ slowModeSeconds: 30 });
      expect(res.status).toBe(403);
      expect((await as(request(app).patch(`/community/channels/${c._id}/settings`)).send({ slowModeSeconds: -5 })).status).toBe(400);
    });

    it('limits a message request to three messages until it is accepted', async () => {
      const dm = { _id: oid(), type: 'dm', dmMemberIds: [me, other], dmInitiatorId: me, dmStatus: 'pending' };
      jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(dm as never);
      jest.spyOn(CommunityMessage, 'countDocuments').mockResolvedValue(3 as never);
      const res = await post(dm);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/accept/);
    });

    it('stops the sender once a request is declined', async () => {
      const dm = { _id: oid(), type: 'dm', dmMemberIds: [me, other], dmInitiatorId: me, dmStatus: 'declined' };
      jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(dm as never);
      expect((await post(dm)).status).toBe(403);
    });

    it('lets only the receiver answer a request', async () => {
      const mine = { _id: oid(), type: 'dm', dmMemberIds: [me, other], dmInitiatorId: me, dmStatus: 'pending', save: jest.fn() };
      jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(mine as never);
      expect((await as(request(app).post(`/community/dms/${mine._id}/accept`))).status).toBe(403);
      const theirs = { ...mine, dmInitiatorId: other, save: jest.fn() };
      jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(theirs as never);
      const res = await as(request(app).post(`/community/dms/${theirs._id}/decline`));
      expect(res.status).toBe(200);
      expect(theirs.dmStatus).toBe('declined');
    });

    it('asks for Lumen AI consent before translating, and never calls the AI without it', async () => {
      const c = textChannel();
      jest.spyOn(CommunityChannel, 'findById').mockResolvedValue(c as never);
      publicServer();
      jest.spyOn(CommunityMessage, 'findById').mockResolvedValue({ _id: oid(), channelId: c._id, senderId: other, content: 'namaste' } as never);
      jest.spyOn(User, 'findById').mockImplementation((() => ({ select: () => ({ lean: async () => ({ preferences: {} }) }) })) as never);
      const res = await as(request(app).post(`/community/messages/${oid()}/translate`)).send({ target: 'english' });
      expect(res.status).toBe(403);
    });
  });
});
