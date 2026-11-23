/**
 * GIF search through GIPHY. The phone never talks to GIPHY directly: it asks Lumen's server, which adds
 * the API key, caches answers, and returns only what the app needs. (Google shut Tenor's public API down
 * on 30 June 2026; the app talks to /community/gifs/* only, so the provider can change again.)
 */
import { isAllowedGifUrl } from '../chatEmbeds';

export interface GifResult {
  id: string;
  /** Small, fast preview for the picker grid. */
  previewUrl: string;
  /** The GIF that is sent in chat. */
  url: string;
  width: number;
  height: number;
  description: string;
}

export interface GifPage {
  results: GifResult[];
  next: string | null;
}

export class GifNotConfigured extends Error {
  constructor() { super("GIF search isn't set up on the server yet."); }
}

const BASE = 'https://api.giphy.com/v1/gifs';
const LIMIT = 24;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; page: GifPage }>();

const rendition = (images: any, ...names: string[]) => {
  for (const n of names) if (images?.[n]?.url) return images[n];
  return null;
};

/** Reads GIPHY's answer into our shape; skips anything on a host we would not accept when it is sent. */
export function parseGiphy(json: any): GifPage {
  const results: GifResult[] = [];
  for (const r of Array.isArray(json?.data) ? json.data : []) {
    // A message-sized GIF (under about 2 MB), and a small one for the grid.
    const full = rendition(r?.images, 'downsized_medium', 'downsized', 'fixed_height', 'original');
    const tiny = rendition(r?.images, 'fixed_width_small', 'fixed_width', 'preview_gif') ?? full;
    if (!full || !tiny || !isAllowedGifUrl(full.url) || !isAllowedGifUrl(tiny.url)) continue;
    results.push({
      id: String(r.id ?? ''),
      previewUrl: tiny.url,
      url: full.url,
      width: Number(full.width) || 0,
      height: Number(full.height) || 0,
      description: String(r.title ?? '').slice(0, 200),
    });
  }
  const p = json?.pagination;
  const nextOffset = Number(p?.offset) + Number(p?.count);
  const more = Number.isFinite(nextOffset) && Number(p?.count) > 0 && nextOffset < Number(p?.total_count);
  return { results, next: more ? String(nextOffset) : null };
}

async function call(path: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<GifPage> {
  const key = process.env.GIPHY_API_KEY;
  if (!key) throw new GifNotConfigured();
  const qs = new URLSearchParams({ api_key: key, limit: String(LIMIT), rating: 'pg', bundle: 'messaging_non_clips', ...params });
  const cacheKey = `${path}?${[...qs.entries()].filter(([k]) => k !== 'api_key').map(([k, v]) => `${k}=${v}`).join('&')}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.page;
  const res = await fetchImpl(`${BASE}/${path}?${qs.toString()}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GIF service answered ${res.status}`);
  const page = parseGiphy(await res.json());
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(cacheKey, { at: Date.now(), page });
  return page;
}

const offsetOf = (pos?: string): Record<string, string> => (pos && /^\d{1,5}$/.test(pos) ? { offset: pos } : {});

export const trending = (pos?: string, fetchImpl: typeof fetch = fetch) =>
  call('trending', offsetOf(pos), fetchImpl);

export const search = (q: string, pos?: string, fetchImpl: typeof fetch = fetch) =>
  call('search', { q: q.slice(0, 50), lang: 'en', ...offsetOf(pos) }, fetchImpl);

export function _clearGifCache(): void { cache.clear(); }
