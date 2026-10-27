import { CommunityServer } from '../models/CommunityServer';
import { CommunityChannel } from '../models/CommunityChannel';
import { User } from '../models/User';
import { ensureOfficialServer } from '../routes/communityChat';

jest.mock('../models/CommunityServer', () => ({
  CommunityServer: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../models/CommunityChannel', () => ({
  CommunityChannel: { findOneAndUpdate: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../models/User', () => ({ User: { findOne: jest.fn().mockResolvedValue(null) } }));

const server = CommunityServer as unknown as { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
const channel = CommunityChannel as unknown as { findOneAndUpdate: jest.Mock };
const official = { _id: 'srv1', slug: 'lumen-spoonie-hub', isOfficial: true };

describe('ensureOfficialServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (User as unknown as { findOne: jest.Mock }).findOne.mockResolvedValue(null);
    channel.findOneAndUpdate.mockResolvedValue({});
  });

  it('runs once when many requests arrive together', async () => {
    server.findOne.mockImplementation(() => new Promise(r => setTimeout(() => r(null), 10)));
    server.findOneAndUpdate.mockResolvedValue(official);

    const results = await Promise.all(Array.from({ length: 8 }, () => ensureOfficialServer()));

    expect(server.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(results.every(r => (r as unknown) === official)).toBe(true);
  });

  it('creates the server with an upsert on its slug, never a plain create', async () => {
    server.findOne.mockResolvedValue(null);
    server.findOneAndUpdate.mockResolvedValue(official);

    await ensureOfficialServer();

    const [filter, update, options] = server.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ slug: 'lumen-spoonie-hub' });
    expect(update.$setOnInsert.isOfficial).toBe(true);
    expect(options).toMatchObject({ upsert: true, new: true });
  });

  it('uses the existing official server without writing it again', async () => {
    server.findOne.mockResolvedValue(official);

    const result: unknown = await ensureOfficialServer();

    expect(result).toBe(official);
    expect(server.findOneAndUpdate).not.toHaveBeenCalled();
    expect(channel.findOneAndUpdate).toHaveBeenCalled();
  });

  it('falls back to reading it when another instance created it first (duplicate key)', async () => {
    server.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(official);
    server.findOneAndUpdate.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

    await expect(ensureOfficialServer()).resolves.toBe(official as never);
  });

  it('still reports other database errors', async () => {
    server.findOne.mockResolvedValue(null);
    server.findOneAndUpdate.mockRejectedValue(new Error('connection lost'));

    await expect(ensureOfficialServer()).rejects.toThrow('connection lost');
  });

  it('can run again after a failure (the shared call is cleared)', async () => {
    server.findOne.mockResolvedValue(null);
    server.findOneAndUpdate.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(official);

    await expect(ensureOfficialServer()).rejects.toThrow('boom');
    await expect(ensureOfficialServer()).resolves.toBe(official as never);
  });
});
