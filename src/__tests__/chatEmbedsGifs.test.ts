import mongoose from 'mongoose';
import { Media } from '../models/Media';
import { checkPhotoEmbed, checkGifEmbed, isAllowedGifUrl, mediaIdsOf, MAX_PHOTOS } from '../services/chatEmbeds';
import { parseGiphy, search, trending, _clearGifCache, GifNotConfigured } from '../services/gifs/giphy';

const oid = () => new mongoose.Types.ObjectId();
afterEach(() => { jest.restoreAllMocks(); delete process.env.GIPHY_API_KEY; _clearGifCache(); });

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
    expect(isAllowedGifUrl('https://media2.giphy.com/media/abc/giphy.gif')).toBe(true);
    expect(isAllowedGifUrl('https://media.giphy.com/media/abc/giphy.gif')).toBe(true);
    expect(isAllowedGifUrl('https://i.giphy.com/abc.gif')).toBe(true);
    expect(isAllowedGifUrl('http://media2.giphy.com/abc.gif')).toBe(false);
    expect(isAllowedGifUrl('https://media.tenor.com/abc.gif')).toBe(false); // that service is gone
    expect(isAllowedGifUrl('https://evil.example.com/giphy.com/x.gif')).toBe(false);
    expect(isAllowedGifUrl('https://media2.giphy.com.evil.com/x.gif')).toBe(false);
    expect(isAllowedGifUrl('https://mediagiphy.com/x.gif')).toBe(false);
    expect(isAllowedGifUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedGifUrl(undefined)).toBe(false);
  });

  it('keeps only the known fields, and drops a preview from an unknown host', () => {
    const r = checkGifEmbed({ gifUrl: 'https://media2.giphy.com/a.gif', previewUrl: 'https://evil.com/p.gif', width: 320, height: 240, gifId: 'g1', extra: 'x' });
    expect(r).toEqual({ ok: true, embedData: { gifUrl: 'https://media2.giphy.com/a.gif', width: 320, height: 240, gifId: 'g1' } });
    expect(checkGifEmbed({ gifUrl: 'https://evil.com/a.gif' }).ok).toBe(false);
  });
});

describe('GIF search proxy (GIPHY)', () => {
  const reply = {
    data: [
      { id: 'a1', title: 'cat dancing', images: {
        downsized_medium: { url: 'https://media2.giphy.com/media/a1/giphy-downsized-medium.gif', width: '480', height: '270' },
        original: { url: 'https://media2.giphy.com/media/a1/giphy.gif', width: '500', height: '281' },
        fixed_width_small: { url: 'https://media2.giphy.com/media/a1/100w.gif', width: '100', height: '56' } } },
      { id: 'a2', title: 'no small version', images: { original: { url: 'https://media3.giphy.com/media/a2/giphy.gif', width: '300', height: '300' } } },
      { id: 'bad', title: 'other host', images: { original: { url: 'https://evil.example.com/b.gif' }, fixed_width_small: { url: 'https://evil.example.com/b_s.gif' } } },
      { id: 'none', images: {} },
    ],
    pagination: { total_count: 90, count: 24, offset: 0 },
  };
  const fakeFetch = (body: unknown = reply, ok = true) => jest.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;

  it('reads the answer into our shape, prefers a message-sized GIF, and skips other hosts', () => {
    const page = parseGiphy(reply);
    expect(page.results.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(page.results[0]).toEqual({ id: 'a1', previewUrl: 'https://media2.giphy.com/media/a1/100w.gif', url: 'https://media2.giphy.com/media/a1/giphy-downsized-medium.gif', width: 480, height: 270, description: 'cat dancing' });
    expect(page.results[1].previewUrl).toBe(page.results[1].url); // no small version: use the GIF itself
    expect(page.next).toBe('24');
    expect(parseGiphy({})).toEqual({ results: [], next: null });
  });

  it('stops paging at the last page', () => {
    expect(parseGiphy({ data: [], pagination: { total_count: 30, count: 6, offset: 24 } }).next).toBeNull();
    expect(parseGiphy({ data: [], pagination: { total_count: 30, count: 0, offset: 24 } }).next).toBeNull();
  });

  it('says it is not set up when there is no key', async () => {
    await expect(trending(undefined, fakeFetch())).rejects.toBeInstanceOf(GifNotConfigured);
  });

  it('searches with the key, family-friendly rating, and caches the answer', async () => {
    process.env.GIPHY_API_KEY = 'secret-key';
    const f = fakeFetch();
    const one = await search('happy cat', undefined, f);
    const two = await search('happy cat', undefined, f);
    expect(one).toEqual(two);
    expect(f).toHaveBeenCalledTimes(1);
    const url = String((f as jest.Mock).mock.calls[0][0]);
    expect(url).toContain('/search?');
    expect(url).toContain('q=happy+cat');
    expect(url).toContain('rating=pg');
    expect(url).toContain('api_key=secret-key');
  });

  it('pages with an offset, and ignores a junk page value', async () => {
    process.env.GIPHY_API_KEY = 'secret-key';
    const f = fakeFetch();
    await trending('24', f);
    await trending('24; drop', f);
    const urls = (f as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain('offset=24');
    expect(urls[1]).not.toContain('offset');
  });

  it('fails clearly when the GIF service answers with an error', async () => {
    process.env.GIPHY_API_KEY = 'secret-key';
    await expect(trending(undefined, fakeFetch({}, false))).rejects.toThrow(/GIF service/);
  });
});
