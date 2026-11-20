/**
 * The extra bits of a group chat as one person sees them: its photo (a fresh signed link each time),
 * its description, and whether THEY muted it. Other people's mute choice is never sent.
 */
import { Media } from '../models/Media';
import { getDownloadUrl } from '../utils/s3';

export const MAX_GROUP_ABOUT = 300;

export function cleanGroupAbout(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_ABOUT) : '';
}

export function isMutedFor(mutedBy: unknown[] | undefined, userId: string): boolean {
  return (mutedBy ?? []).some(id => String(id) === userId);
}

/** Replaces the private fields (`mutedBy`, `photoMediaId`) with what the viewer may see. */
export async function withGroupExtras<T extends Record<string, any>>(obj: T, viewerId: string): Promise<Omit<T, 'mutedBy' | 'photoMediaId'> & { photoUrl: string | null; about: string; muted: boolean }> {
  const { mutedBy, photoMediaId, ...rest } = obj as any;
  let photoUrl: string | null = null;
  if (photoMediaId) {
    try {
      const m = await Media.findById(photoMediaId).select('storageKey');
      if (m) photoUrl = await getDownloadUrl(m.storageKey);
    } catch { /* no photo shown rather than a failed list */ }
  }
  return { ...rest, photoUrl, about: typeof obj.about === 'string' ? obj.about : '', muted: isMutedFor(mutedBy, viewerId) };
}
