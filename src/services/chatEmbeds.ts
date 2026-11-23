/**
 * Checks what a chat message carries besides text: photos (1–10 images the sender uploaded to Lumen)
 * and GIFs (only from the GIF service's own media hosts). Anything else is refused.
 */
import mongoose from 'mongoose';
import { Media } from '../models/Media';

export const MAX_PHOTOS = 10;

/** GIF links are only accepted from these hosts (Tenor's media servers), over https. */
export const GIF_HOSTS = new Set(['media.tenor.com', 'media1.tenor.com', 'c.tenor.com']);

export function isAllowedGifUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 600) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && GIF_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

const num = (v: unknown, max = 10000): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v) : undefined;

export type EmbedCheck =
  | { ok: true; embedData: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Photos: `embedData.photos[]` (new) or `embedData.photoMediaId` (old app versions).
 * Every photo must be an image owned by the sender. The first photo is also kept as `photoMediaId`
 * so older app versions still show it.
 */
export async function checkPhotoEmbed(embedData: any, userId: mongoose.Types.ObjectId, keepCaption = true): Promise<EmbedCheck> {
  const list: Array<{ photoMediaId?: unknown; width?: unknown; height?: unknown }> = Array.isArray(embedData?.photos) && embedData.photos.length
    ? embedData.photos
    : [{ photoMediaId: embedData?.photoMediaId }];
  if (list.length > MAX_PHOTOS) return { ok: false, message: `You can send up to ${MAX_PHOTOS} photos at once.` };
  const ids = list.map(p => String(p?.photoMediaId ?? ''));
  if (ids.some(id => !mongoose.Types.ObjectId.isValid(id))) return { ok: false, message: 'Photo could not be attached. Please upload it again.' };
  if (new Set(ids).size !== ids.length) return { ok: false, message: 'The same photo was added twice.' };
  const owned = await Media.find({ _id: { $in: ids }, userId }).select('_id mimeType');
  const okIds = new Set(owned.filter(m => String(m.mimeType || '').startsWith('image/')).map(m => String(m._id)));
  if (ids.some(id => !okIds.has(id))) return { ok: false, message: 'Photo could not be attached. Please upload it again.' };
  const gif = new Map(owned.map(m => [String(m._id), String(m.mimeType) === 'image/gif']));
  const photos = list.map((p, i) => ({
    photoMediaId: ids[i],
    ...(num(p?.width) ? { width: num(p.width) } : {}),
    ...(num(p?.height) ? { height: num(p.height) } : {}),
    ...(gif.get(ids[i]) ? { isGif: true } : {}),
  }));
  const caption = keepCaption && typeof embedData?.caption === 'string' ? embedData.caption.slice(0, 500) : undefined;
  return { ok: true, embedData: { photoMediaId: ids[0], photos, ...(caption ? { caption } : {}) } };
}

/** A GIF picked from GIF search: only https links on the GIF service's hosts. */
export function checkGifEmbed(embedData: any): EmbedCheck {
  if (!isAllowedGifUrl(embedData?.gifUrl)) return { ok: false, message: 'That GIF could not be sent. Please pick it again.' };
  const preview = isAllowedGifUrl(embedData?.previewUrl) ? embedData.previewUrl : undefined;
  return {
    ok: true,
    embedData: {
      gifUrl: embedData.gifUrl,
      ...(preview ? { previewUrl: preview } : {}),
      ...(num(embedData?.width) ? { width: num(embedData.width) } : {}),
      ...(num(embedData?.height) ? { height: num(embedData.height) } : {}),
      ...(typeof embedData?.gifId === 'string' ? { gifId: embedData.gifId.slice(0, 80) } : {}),
      ...(typeof embedData?.description === 'string' ? { description: embedData.description.slice(0, 200) } : {}),
    },
  };
}

/** Every media id a message points at (voice note, photos) so their links can be signed fresh. */
export function mediaIdsOf(m: { audioMediaId?: unknown; embedData?: any }): string[] {
  const ids: unknown[] = [m.audioMediaId, m.embedData?.photoMediaId];
  if (Array.isArray(m.embedData?.photos)) for (const p of m.embedData.photos) ids.push(p?.photoMediaId);
  return ids.filter(Boolean).map(String);
}
