import mongoose from 'mongoose';
import {
  buildCommunityNotifications,
  makeSnippet,
  mentionNames,
  mentionsMember,
} from '../services/communityNotifications';
import { CommunityServer } from '../models/CommunityServer';
import { CommunityChannel } from '../models/CommunityChannel';
import { CommunityMessage } from '../models/CommunityMessage';

jest.mock('../models/CommunityServer', () => ({ CommunityServer: { find: jest.fn() } }));
jest.mock('../models/CommunityChannel', () => ({ CommunityChannel: { find: jest.fn() } }));
jest.mock('../models/CommunityMessage', () => ({ CommunityMessage: { find: jest.fn() } }));

/** find(...).select().sort().limit() all resolve to the same rows. */
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.sort = () => c;
  c.limit = () => c;
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
  return c;
}

const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), name: 'Asha Rao' };
const since = new Date(Date.now() - 86400000);

const chGeneral = { _id: oid(), slug: 'general', name: 'General' };
const msg = (over: Record<string, unknown>) => ({
  _id: oid(),
  channelId: chGeneral._id,
  senderId: oid(),
  senderDisplayName: 'Rahul',
  isAnonymous: false,
  content: '',
  createdAt: new Date(Date.now() - 3600000),
  ...over,
});

const find = CommunityMessage.find as unknown as jest.Mock;

function setup(opts: { own?: unknown[]; replies?: unknown[]; mentions?: unknown[]; channels?: unknown[] }) {
  (CommunityServer.find as unknown as jest.Mock).mockReturnValue(chain([{ _id: oid() }]));
  (CommunityChannel.find as unknown as jest.Mock).mockReturnValue(chain(opts.channels ?? [chGeneral]));
  find.mockReset();
  // 1st call: my own messages, 2nd: replies to them, 3rd: mention candidates
  find
    .mockReturnValueOnce(chain(opts.own ?? []))
    .mockReturnValueOnce(chain(opts.replies ?? []))
    .mockReturnValueOnce(chain(opts.mentions ?? []));
}

describe('mention matching', () => {
  it('derives full and first name', () => {
    expect(mentionNames('Asha Rao')).toEqual(['Asha Rao', 'Asha']);
    expect(mentionNames('  Q ')).toEqual([]);
    expect(mentionNames(undefined)).toEqual([]);
  });

  it('matches @name at a word boundary, not emails or longer names', () => {
    const names = mentionNames('Asha Rao');
    expect(mentionsMember('Ask @asha about salt', names)).toBe(true);
    expect(mentionsMember('@Asha Rao hi', names)).toBe(true);
    expect(mentionsMember('hello @Asha, welcome', names)).toBe(true);
    expect(mentionsMember('mail asha@example.com', names)).toBe(false);
    expect(mentionsMember('hey @Ashana', names)).toBe(false);
    expect(mentionsMember('no mention here', names)).toBe(false);
    expect(mentionsMember('@Asha', [])).toBe(false);
  });

  it('makes short plain snippets', () => {
    expect(makeSnippet('  hello \n  there ')).toBe('hello there');
    expect(makeSnippet('')).toBe('Shared something');
    const long = makeSnippet('x'.repeat(300));
    expect(long.length).toBe(120);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('buildCommunityNotifications', () => {
  it('returns replies to my messages and mentions of me, newest first', async () => {
    const mine = { _id: oid() };
    const reply = msg({ content: 'Same for me.', replyTo: { messageId: mine._id }, createdAt: new Date(Date.now() - 1000 * 60 * 20) });
    const mention = msg({ senderDisplayName: 'Priya', content: 'New here? Ask @Asha about salt', createdAt: new Date(Date.now() - 1000 * 60 * 5) });
    setup({ own: [mine], replies: [reply], mentions: [mention] });

    const out = await buildCommunityNotifications(me, since);

    expect(out.map(o => [o.type, o.senderName])).toEqual([['mention', 'Priya'], ['reply', 'Rahul']]);
    expect(out[0]).toMatchObject({ channelSlug: 'general', channelName: 'General', snippet: 'New here? Ask @Asha about salt' });
    expect(out[1].id).toBe(`community:${reply._id}`);
  });

  it('counts a message that is both a reply and a mention once, as a reply', async () => {
    const mine = { _id: oid() };
    const both = msg({ content: '@Asha yes!', replyTo: { messageId: mine._id } });
    setup({ own: [mine], replies: [both], mentions: [both] });

    const out = await buildCommunityNotifications(me, since);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('reply');
  });

  it('keeps an anonymous sender anonymous', async () => {
    const mine = { _id: oid() };
    const anon = msg({ isAnonymous: true, senderDisplayName: 'Quiet Spoonie 42', replyTo: { messageId: mine._id } });
    setup({ own: [mine], replies: [anon] });

    const out = await buildCommunityNotifications(me, since);
    expect(out[0].senderName).toBe('Someone');
  });

  it('drops a mention that only matched the loose database pattern', async () => {
    setup({ mentions: [msg({ content: 'write to asha@example.com' }), msg({ content: 'hi @Ashana' })] });
    expect(await buildCommunityNotifications(me, since)).toEqual([]);
  });

  it('ignores messages from channels the member cannot see', async () => {
    const hidden = msg({ channelId: oid(), content: '@Asha psst' });
    setup({ mentions: [hidden] });
    expect(await buildCommunityNotifications(me, since)).toEqual([]);
  });

  it('does not look for replies when the member has posted nothing, or mentions without a usable name', async () => {
    setup({});
    await buildCommunityNotifications({ _id: me._id, name: '' }, since);
    // only the "own messages" query ran
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('returns nothing when there are no visible channels', async () => {
    setup({ channels: [] });
    expect(await buildCommunityNotifications(me, since)).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('queries replies by my message ids and excludes my own replies', async () => {
    const mine = { _id: oid() };
    setup({ own: [mine] });
    await buildCommunityNotifications(me, since);
    const filter = find.mock.calls[1][0];
    expect(filter['replyTo.messageId']).toEqual({ $in: [mine._id] });
    expect(filter.senderId).toEqual({ $ne: me._id });
    expect(filter.createdAt).toEqual({ $gte: since });
  });
});
