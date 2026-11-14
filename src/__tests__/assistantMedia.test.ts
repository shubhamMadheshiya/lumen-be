import mongoose from 'mongoose';
import sharp from 'sharp';
import { Media } from '../models/Media';
import { getPhotoForAi, setFetchBytesForTesting } from '../services/llm/assistant/mediaBytes';

jest.mock('../models/Media', () => ({ Media: { findOne: jest.fn() } }));

const ME = new mongoose.Types.ObjectId().toString();
const id = new mongoose.Types.ObjectId().toString();
const fetchBytes = jest.fn();

beforeAll(() => setFetchBytesForTesting(fetchBytes));
beforeEach(() => {
  jest.clearAllMocks();
  (Media.findOne as jest.Mock).mockReturnValue({
    lean: async () => ({ _id: id, storageKey: `users/${ME}/x.png`, mimeType: 'image/png', sensitive: true, createdAt: new Date('2026-11-01') }),
  });
});

describe('getPhotoForAi', () => {
  it('releases nothing, and touches no storage, while photo access is off', async () => {
    await expect(getPhotoForAi(ME, id, false)).resolves.toEqual({ ok: false, reason: 'photo_access_off' });
    expect(Media.findOne).not.toHaveBeenCalled();
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it('looks the photo up by id AND owner, so another member\'s photo is not found', async () => {
    (Media.findOne as jest.Mock).mockReturnValue({ lean: async () => null });
    await expect(getPhotoForAi(ME, id, true)).resolves.toEqual({ ok: false, reason: 'not_found' });
    expect(Media.findOne).toHaveBeenCalledWith({ _id: id, userId: ME });
  });

  it('shrinks a large photo to a JPEG no bigger than 1600 px', async () => {
    fetchBytes.mockResolvedValue(await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#a33' } }).png().toBuffer());
    const res = await getPhotoForAi(ME, id, true);
    if (!res.ok) throw new Error(res.reason);
    expect(res.photo.mimeType).toBe('image/jpeg');
    expect(res.photo.sensitive).toBe(true);
    const meta = await sharp(Buffer.from(res.photo.base64, 'base64')).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1600);
  });

  it('reports an unreadable file instead of throwing', async () => {
    fetchBytes.mockRejectedValue(new Error('S3 down'));
    await expect(getPhotoForAi(ME, id, true)).resolves.toEqual({ ok: false, reason: 'unreadable' });
  });
});
