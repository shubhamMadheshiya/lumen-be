/** Pure rules for direct-message invites and group chats. */
import crypto from 'crypto';

export const MAX_GROUP_MEMBERS = 10;
export const MIN_GROUP_MEMBERS = 3;
export const MAX_GROUP_NAME = 50;
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set(['lumen', 'admin', 'support', 'official', 'moderator', 'mod', 'system', 'anonymous', 'everyone', 'here']);
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (0/o, 1/l/i)
export const CODE_LENGTH = 12;

/** A random invite code, 12 characters (~59 bits), easy to read aloud. */
export function newInviteCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export const looksLikeCode = (s: string) => new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(s);

/** "@Sam_K " → "sam_k"; null when it is not an allowed handle. */
export function normaliseHandle(raw: unknown): { ok: true; handle: string } | { ok: false; reason: string } {
  const h = String(raw ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE_RE.test(h)) return { ok: false, reason: 'Use 3 to 20 letters, numbers or underscores.' };
  if (RESERVED.has(h)) return { ok: false, reason: 'That name is reserved.' };
  return { ok: true, handle: h };
}

/** Pulls the code out of a pasted link ("lumen://community/invite/abc…") or a bare code. */
export function extractInviteCode(input: unknown): string | null {
  const s = String(input ?? '').trim().toLowerCase();
  const fromLink = /(?:^|\/)invite\/([a-z0-9]+)\/?(?:[?#].*)?$/.exec(s)?.[1];
  const code = fromLink ?? s;
  return looksLikeCode(code) ? code : null;
}

export function cleanGroupName(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME);
}

/** Group size after adding: everyone distinct, never above the cap. */
export function groupAddCheck(current: string[], toAdd: string[]): { ok: true; next: string[] } | { ok: false; reason: string } {
  const next = Array.from(new Set([...current, ...toAdd]));
  if (next.length > MAX_GROUP_MEMBERS) return { ok: false, reason: `A group can have up to ${MAX_GROUP_MEMBERS} people.` };
  return { ok: true, next };
}

/** The member who becomes owner when the owner leaves: the one who has been there longest (first in the list). */
export function nextOwner(memberIds: string[], leaving: string): string | null {
  return memberIds.find(m => m !== leaving) ?? null;
}

/** "Sam, Priya and Ali" for a group with no name. */
export function defaultGroupName(names: string[]): string {
  const n = names.map(x => x.trim()).filter(Boolean);
  if (n.length === 0) return 'Group chat';
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  return `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`;
}
