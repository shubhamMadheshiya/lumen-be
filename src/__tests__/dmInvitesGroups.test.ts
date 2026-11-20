/** DM invite links, @handles and group chat rules; bad requests to the new routes. */
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { communityDmRouter } from '../routes/communityDm';
import {
  cleanGroupName, defaultGroupName, extractInviteCode, groupAddCheck, looksLikeCode, MAX_GROUP_MEMBERS, newInviteCode, nextOwner, normaliseHandle,
} from '../services/dmRules';
import { pushText } from '../services/communityPush';

describe('invite codes', () => {
  it('are 12 readable characters, different each time', () => {
    const a = newInviteCode();
    expect(a).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{12}$/);
    expect(newInviteCode()).not.toBe(a);
    expect(looksLikeCode(a)).toBe(true);
    expect(looksLikeCode('short')).toBe(false);
  });

  it('are pulled out of a pasted link or typed as they are', () => {
    const code = 'abcdefghjk23';
    expect(extractInviteCode(`lumen://community/invite/${code}`)).toBe(code);
    expect(extractInviteCode(`  LUMEN://community/invite/${code.toUpperCase()}/  `)).toBe(code);
    expect(extractInviteCode(code)).toBe(code);
    expect(extractInviteCode('lumen://community/invite/not-a-code')).toBeNull();
    expect(extractInviteCode(undefined)).toBeNull();
  });
});

describe('@handles', () => {
  it('are lowercase letters, numbers and underscores, 3 to 20 long', () => {
    expect(normaliseHandle('@Sam_K ')).toEqual({ ok: true, handle: 'sam_k' });
    expect(normaliseHandle('ab').ok).toBe(false);
    expect(normaliseHandle('has space').ok).toBe(false);
    expect(normaliseHandle('x'.repeat(21)).ok).toBe(false);
    expect(normaliseHandle('Admin')).toEqual({ ok: false, reason: 'That name is reserved.' });
  });
});

describe('group rules', () => {
  it('caps a group at 10 people and ignores people already in it', () => {
    expect(groupAddCheck(['a', 'b', 'c'], ['c', 'd'])).toEqual({ ok: true, next: ['a', 'b', 'c', 'd'] });
    const nine = Array.from({ length: 9 }, (_, i) => `u${i}`);
    expect(groupAddCheck(nine, ['x']).ok).toBe(true);
    const ten = Array.from({ length: MAX_GROUP_MEMBERS }, (_, i) => `u${i}`);
    expect(groupAddCheck(ten, ['x']).ok).toBe(false);
  });

  it('hands ownership to the longest-standing member', () => {
    expect(nextOwner(['owner', 'b', 'c'], 'owner')).toBe('b');
    expect(nextOwner(['owner'], 'owner')).toBeNull();
  });

  it('names a group from its people, or cleans the name given', () => {
    expect(defaultGroupName(['Sam', 'Priya'])).toBe('Sam and Priya');
    expect(defaultGroupName(['Sam', 'Priya', 'Ali', 'Jo'])).toBe('Sam, Priya and 2 more');
    expect(defaultGroupName([])).toBe('Group chat');
    expect(cleanGroupName('  Family   chat  ')).toBe('Family chat');
    expect(cleanGroupName('x'.repeat(80))).toHaveLength(50);
  });

  it('shows who wrote in a group push', () => {
    expect(pushText('dm', 'Family', 'Sam', 'hi', false, false, true).title).toBe('Sam in Family');
    expect(pushText('dm', 'Sam', 'Sam', 'hi', false).title).toBe('Sam');
  });
});

describe('new DM routes reject bad requests', () => {
  const app = express();
  app.use(express.json());
  app.use('/community', communityDmRouter);
  app.use((err: { statusCode?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });
  const me = new mongoose.Types.ObjectId().toString();
  const token = jwt.sign({ sub: me, type: 'access' }, config.jwt.accessSecret);
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const oid = () => new mongoose.Types.ObjectId().toString();

  it('needs a signed-in member', async () => {
    expect((await request(app).get('/community/me/invite')).status).toBe(401);
    expect((await request(app).post('/community/dms/groups').send({})).status).toBe(401);
  });

  it('refuses groups that are too small or too big, and unreadable bodies', async () => {
    expect((await auth(request(app).post('/community/dms/groups').send({ memberIds: [oid()] }))).status).toBe(400);
    expect((await auth(request(app).post('/community/dms/groups').send({ memberIds: Array.from({ length: 10 }, oid) }))).status).toBe(400);
    expect((await auth(request(app).post('/community/dms/groups').send({ name: 5 }))).status).toBe(400);
    expect((await auth(request(app).post(`/community/dms/${oid()}/members`).send({ userIds: [] }))).status).toBe(400);
    expect((await auth(request(app).patch(`/community/dms/${oid()}`).send({ name: '' }))).status).toBe(400);
    expect((await auth(request(app).put('/community/me/invite/enabled').send({ enabled: 'yes' }))).status).toBe(400);
    expect((await auth(request(app).post('/community/dms/by-invite').send({ code: 'x' }))).status).toBe(400);
  });

  it('answers 404 to a malformed group id', async () => {
    expect((await auth(request(app).post('/community/dms/not-an-id/leave'))).status).toBe(404);
    expect((await auth(request(app).delete(`/community/dms/not-an-id/members/${oid()}`))).status).toBe(404);
  });
});
