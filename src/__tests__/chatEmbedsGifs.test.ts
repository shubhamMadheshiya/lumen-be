import mongoose from 'mongoose';
import { Media } from '../models/Media';
import { checkPhotoEmbed, checkGifEmbed, isAllowedGifUrl, mediaIdsOf, MAX_PHOTOS } from '../services/chatEmbeds';
import { parseTenor, search, trending, _clearGifCache, GifNotConfigured } from '../services/gifs/tenor';

const oid = () => new mongoose.Types.ObjectId();
afterEach(() => { jest.restoreAllMocks(); delete process.env.TENOR_API_KEY; _clearGifCache(); });

const mockOwned = (docs: Array<{ _id: mongoose.Types.ObjectId; mimeType: string }>) =>
  jest.spyOn(Media, 'find').mockImplementation((() => ({ select: async () => docs })) as never);

describe('photos in a chat message', () => {
  const me = oid();

  it('accepts up to 10 images the sender owns, and keeps the first one for older app versions', async () => {
    const a = oid(); const b = oid();
    mockOwned([{ _id: a, mimeType: 'image/jpeg' }, { _id: b, mimeType: 'image/gif' }]);
    const r = await checkPhotoEmbed({ photos: [{ photoMediaId: String(a), width: 800, height: 600, photoUrl: 'file:///x.jpg' }, { photoMediaId: String(b) }], caption: 'Day 3' }, me);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.embedData.photoMediaId).toBe(String(a));
    expect((r.embedData as any).photos).toEqual([
      { photoMediaId: String(a), width: 800, height: 600 },
      { photoMediaId: String(b), isGif: true },
    ]);
    expect(JSON.stringify(r.embedData)).not.toContain('file:///'); // phone-local links are dropped
    expect(r.embedData.caption).toBe('Day 3');
  });

  it('still takes the old single-photo shape', async () => {
    const a = oid();
    mockOwned([{ _id: a, mimeType: 'image/png' }]);
    const r = await checkPhotoEmbed({ photoMediaId: String(a) }, me);
    expect(r.ok && (r.embedData as any).photos).toEqual([{ photoMediaId: String(a) }]);
  });

  it('refuses more than 10, repeats, bad ids, other peoples uploads, and non-images', async () => {
    const ids = Array.from({ length: MAX_PHOTOS + 1 }, () => String(oid()));
    expect((await checkPhotoEmbed({ photos: ids.map(photoMediaId => ({ photoMediaId })) }, me)).ok).toBe(false);
    const a = oid();
    expect((await checkPhotoEmbed({ photos: [{ photoMediaId: String(a) }, { photoMediaId: String(a) }] }, me)).ok).toBe(false);
    expect((await checkPhotoEmbed({ photos: [{ photoMediaId: 'nope' }] }, me)).ok).toBe(false);
    mockOwned([]); // none owned by the sender
    expect((await checkPhotoEmbed({ photos: [{ photoMediaId: String(a) }] }, me)).ok).toBe(false);
    mockOwned([{ _id: a, mimeType: 'application/pdf' }]);
    expect((await checkPhotoEmbed({ photos: [{ photoMediaId: String(a) }] }, me)).ok).toBe(false);
  });

  it('lists every media id a message points at, so each link is signed fresh', () => {
    expect(mediaIdsOf({ audioMediaId: 'v1', embedData: { photoMediaId: 'p1', photos: [{ photoMediaId: 'p1' }, { photoMediaId: 'p2' }] } })).toEqual(['v1', 'p1', 'p1', 'p2']);
    expect(mediaIdsOf({})).toEqual([]);
  });
});

describe('GIFs in a chat message', () => {
  it('only accepts https links on the GIF service hosts', () => {
    expect(isAllowedGifUrl('https://media.tenor.com/abc/x.gif')).toBe(true);
    expect(isAllowedGifUrl('https://media1.tenor.com/m/abc/x.gif')).toBe(true);
    expect(isAllowedGifUrl('http://media.tenor.com/abc.gif')).toBe(false);
    expect(isAllowedGifUrl('https://evil.example.com/tenor.com/x.gif')).toBe(false);
    expect(isAllowedGifUrl('https://media.tenor.com.evil.com/x.gif')).toBe(false);
    expect(isAllowedGifUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedGifUrl(undefined)).toBe(false);
  });

  it('keeps only the known fields, and drops a preview from an unknown host', () => {
    const r = checkGifEmbed({ gifUrl: 'https://media.tenor.com/a.gif', previewUrl: 'https://evil.com/p.gif', width: 320, height: 240, gifId: 'g1', extra: 'x' });
    expect(r).toEqual({ ok: true, embedData: { gifUrl: 'https://media.tenor.com/a.gif', width: 320, height: 240, gifId: 'g1' } });
    expect(checkGifEmbed({ gifUrl: 'https://evil.com/a.gif' }).ok).toBe(false);
  });
});

describe('Tenor proxy', () => {
  const reply = {
    results: [
      { id: '1', content_description: 'cat dancing', media_formats: { gif: { url: 'https://media.tenor.com/a.gif', dims: [498, 280] }, tinygif: { url: 'https://media.tenor.com/a_tiny.gif', dims: [220, 124] } } },
      { id: '2', media_formats: { gif: { url: 'https://evil.com/b.gif', dims: [1, 1] }, tinygif: { url: 'https://evil.com/b_t.gif' } } },
      { id: '3', media_formats: {} },
    ],
    next: 'CAoQ',
  };
  const fakeFetch = (body: unknown = reply, ok = true) => jest.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;

  it('reads the answer into our shape and skips results from other hosts', () => {
    const page = parseTenor(reply);
    expect(page.next).toBe('CAoQ');
    expect(page.results).toEqual([{ id: '1', previewUrl: 'https://media.tenor.com/a_tiny.gif', url: 'https://media.tenor.com/a.gif', width: 498, height: 280, description: 'cat dancing' }]);
    expect(parseTenor({})).toEqual({ results: [], next: null });
  });

  it('says it is not set up when there is no key', async () => {
    await expect(trending(undefined, fakeFetch())).rejects.toBeInstanceOf(GifNotConfigured);
  });

  it('searches with the key, asks for small previews, and caches the answer', async () => {
    process.env.TENOR_API_KEY = 'secret-key';
    const f = fakeFetch();
    const one = await search('happy cat', undefined, f);
    const two = await search('happy cat', undefined, f);
    expect(one).toEqual(two);
    expect(f).toHaveBeenCalledTimes(1);
    const url = String((f as jest.Mock).mock.calls[0][0]);
    expect(url).toContain('/search?');
    expect(url).toContain('q=happy+cat');
    expect(url).toContain('media_filter=tinygif%2Cgif');
    expect(url).toContain('contentfilter=medium');
  });

  it('fails clearly when the GIF service answers with an error', async () => {
    process.env.TENOR_API_KEY = 'secret-key';
    await expect(trending(undefined, fakeFetch({}, false))).rejects.toThrow(/GIF service/);
  });
});
