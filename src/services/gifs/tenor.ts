/**
 * GIF search through Google's Tenor API (v2). The phone never talks to Tenor directly: it asks Lumen's
 * server, which adds the API key, caches answers, and returns only what the app needs.
 * Kept behind a tiny interface so another provider could replace it.
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

const BASE = 'https://tenor.googleapis.com/v2';
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; page: GifPage }>();

/** Reads Tenor's reply into our shape; skips anything with a host we would not accept later. */
export function parseTenor(json: any): GifPage {
  const results: GifResult[] = [];
  for (const r of Array.isArray(json?.results) ? json.results : []) {
    const full = r?.media_formats?.gif;
    const tiny = r?.media_formats?.tinygif ?? r?.media_formats?.nanogif ?? full;
    if (!full?.url || !tiny?.url) continue;
    if (!isAllowedGifUrl(full.url) || !isAllowedGifUrl(tiny.url)) continue;
    const [w, h] = Array.isArray(full.dims) ? full.dims : [0, 0];
    results.push({
      id: String(r.id ?? ''),
      previewUrl: tiny.url,
      url: full.url,
      width: Number(w) || 0,
      height: Number(h) || 0,
      description: String(r.content_description ?? '').slice(0, 200),
    });
  }
  return { results, next: json?.next ? String(json.next) : null };
}

async function call(path: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<GifPage> {
  const key = process.env.TENOR_API_KEY;
  if (!key) throw new GifNotConfigured();
  const qs = new URLSearchParams({
    key, client_key: 'lumen', limit: '24', contentfilter: 'medium', media_filter: 'tinygif,gif', ...params,
  });
  const cacheKey = `${path}?${[...qs.entries()].filter(([k]) => k !== 'key').map(([k, v]) => `${k}=${v}`).join('&')}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.page;
  const res = await fetchImpl(`${BASE}/${path}?${qs.toString()}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GIF service answered ${res.status}`);
  const page = parseTenor(await res.json());
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(cacheKey, { at: Date.now(), page });
  return page;
}

export const trending = (pos?: string, fetchImpl: typeof fetch = fetch) =>
  call('featured', pos ? { pos } : {}, fetchImpl);

export const search = (q: string, pos?: string, fetchImpl: typeof fetch = fetch) =>
  call('search', { q: q.slice(0, 80), ...(pos ? { pos } : {}) }, fetchImpl);

export function _clearGifCache(): void { cache.clear(); }
