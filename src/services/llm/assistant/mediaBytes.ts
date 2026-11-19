/**
 * Turns one of the member's own photos into something Gemini can look at. Ownership is checked
 * here, and photos are only released when the member has turned on AI photo access (which needs
 * their photo PIN when one is set — see routes/ai.ts POST /access).
 */
import mongoose from 'mongoose';
import sharp from 'sharp';
import { Media } from '../../../models/Media';
import { getObjectBytes } from '../../../utils/s3';

/** Long edge in pixels. Enough detail for skin, stool or a lab report, and keeps tokens down. */
const MAX_EDGE = 1600;

export interface PhotoForAi {
  mimeType: string;
  base64: string;
  takenAt: Date;
  sensitive: boolean;
}

export type PhotoLookup =
  | { ok: true; photo: PhotoForAi }
  | { ok: false; reason: 'not_found' | 'photo_access_off' | 'not_an_image' | 'unreadable' };

/** Swappable so tests and local verification never touch the real S3 bucket. */
export let fetchBytes: (storageKey: string) => Promise<Buffer> = getObjectBytes;
export function setFetchBytesForTesting(fn: (storageKey: string) => Promise<Buffer>): void {
  fetchBytes = fn;
}

/** PDFs the member attaches to a chat message. Both providers read up to ~32 MB; keep well under. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type FileLookup =
  | { ok: true; file: PhotoForAi }
  | { ok: false; reason: 'not_found' | 'not_a_pdf' | 'too_large' | 'unreadable' };

/**
 * A PDF the member attached to a chat message themselves. Unlike logged photos this needs only full
 * access (checked by the route): they picked the file for this question just now.
 */
export async function getFileForAi(userId: string, mediaId: string): Promise<FileLookup> {
  if (!mongoose.isValidObjectId(mediaId)) return { ok: false, reason: 'not_found' };
  const media = await Media.findOne({ _id: mediaId, userId }).lean();
  if (!media) return { ok: false, reason: 'not_found' };
  if (media.mimeType !== 'application/pdf') return { ok: false, reason: 'not_a_pdf' };
  if (media.size && media.size > MAX_FILE_BYTES) return { ok: false, reason: 'too_large' };
  try {
    const bytes = await fetchBytes(media.storageKey);
    if (bytes.length > MAX_FILE_BYTES) return { ok: false, reason: 'too_large' };
    return { ok: true, file: { mimeType: 'application/pdf', base64: bytes.toString('base64'), takenAt: media.createdAt, sensitive: media.sensitive } };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

export async function getPhotoForAi(userId: string, mediaId: string, photoAccess: boolean): Promise<PhotoLookup> {
  if (!photoAccess) return { ok: false, reason: 'photo_access_off' };
  if (!mongoose.isValidObjectId(mediaId)) return { ok: false, reason: 'not_found' };
  const media = await Media.findOne({ _id: mediaId, userId }).lean();
  if (!media) return { ok: false, reason: 'not_found' };

  if (media.mimeType === 'application/pdf') {
    try {
      const bytes = await fetchBytes(media.storageKey);
      return { ok: true, photo: { mimeType: 'application/pdf', base64: bytes.toString('base64'), takenAt: media.createdAt, sensitive: media.sensitive } };
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  }
  if (!media.mimeType.startsWith('image/')) return { ok: false, reason: 'not_an_image' };

  try {
    const raw = await fetchBytes(media.storageKey);
    const jpeg = await sharp(raw)
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { ok: true, photo: { mimeType: 'image/jpeg', base64: jpeg.toString('base64'), takenAt: media.createdAt, sensitive: media.sensitive } };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
