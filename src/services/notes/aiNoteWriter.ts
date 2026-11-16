/**
 * Notes written by Lumen AI (chat, "Save as note", doctor-visit prep, note actions, the health
 * journal). Stored exactly like notes made in the app: TipTap JSON in `doc`, with plainText and
 * links derived the same way POST /notes derives them. Always scoped to the owner.
 */
import mongoose from 'mongoose';
import { Note, type INoteDoc } from '../../models/Note';
import { docToMarkdown, docToPlainText, extractLinks, validateDoc } from '../../shared/notes/docUtils';
import { markdownToDoc } from './markdownToDoc';

export const AI_NOTE_TAG = 'lumen-ai';
const MAX_MARKDOWN = 60_000;

export interface NewAiNote {
  title: string;
  markdown: string;
  icon?: string;
  tags?: string[];
  parentNoteId?: string | null;
}

function derived(doc: Record<string, unknown>) {
  const { noteIds, mediaIds } = extractLinks(doc);
  return { plainText: docToPlainText(doc), linkedNoteIds: noteIds, mediaIds };
}

function cleanTitle(title: string): string {
  const t = (title ?? '').replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim();
  return (t || 'Lumen AI note').slice(0, 120);
}

function docFrom(markdown: string): Record<string, unknown> {
  const doc = markdownToDoc((markdown ?? '').slice(0, MAX_MARKDOWN));
  const check = validateDoc(doc);
  if (!check.valid) throw new Error(`AI note could not be stored: ${check.error}`);
  return doc;
}

export async function createAiNote(userId: string, input: NewAiNote): Promise<INoteDoc> {
  const uid = new mongoose.Types.ObjectId(userId);
  let parentNoteId: mongoose.Types.ObjectId | null = null;
  if (input.parentNoteId && mongoose.isValidObjectId(input.parentNoteId)) {
    const parent = await Note.findOne({ _id: input.parentNoteId, userId: uid, deletedAt: null }).select('_id').lean();
    if (parent) parentNoteId = parent._id as mongoose.Types.ObjectId;
  }
  const doc = docFrom(input.markdown);
  const tags = [...new Set([AI_NOTE_TAG, ...(input.tags ?? [])].map(t => String(t).trim().toLowerCase().slice(0, 50)).filter(Boolean))].slice(0, 10);
  return Note.create({
    userId: uid,
    title: cleanTitle(input.title),
    icon: (input.icon || '✨').slice(0, 30),
    doc,
    ...derived(doc),
    tags,
    parentNoteId,
    blocks: [],
    deletedAt: null,
    trashRootId: null,
  });
}

/** The member's own note (not in Trash), or null. */
export async function findOwnNote(userId: string, noteId: string): Promise<INoteDoc | null> {
  if (!mongoose.isValidObjectId(noteId)) return null;
  return Note.findOne({ _id: noteId, userId: new mongoose.Types.ObjectId(userId), deletedAt: null });
}

/** Adds markdown at the end of the note's document. */
export async function appendToNote(userId: string, noteId: string, markdown: string): Promise<INoteDoc | null> {
  const note = await findOwnNote(userId, noteId);
  if (!note) return null;
  const current = (note.doc && typeof note.doc === 'object' ? note.doc : { type: 'doc', content: [] }) as { type: string; content?: unknown[] };
  const addition = docFrom(markdown) as { content: unknown[] };
  // Drop the empty placeholder paragraph a brand-new note starts with.
  const existing = (current.content ?? []).filter(n => !(n && (n as { type?: string; content?: unknown[] }).type === 'paragraph' && !(n as { content?: unknown[] }).content?.length));
  const doc = { type: 'doc', content: [...existing, ...addition.content] };
  const check = validateDoc(doc);
  if (!check.valid) throw new Error(`AI note could not be stored: ${check.error}`);
  note.doc = doc;
  Object.assign(note, derived(doc));
  note.markModified('doc');
  await note.save();
  return note;
}

/** The note as markdown, for the AI to read (actions, summaries). */
export function noteMarkdown(note: Pick<INoteDoc, 'doc' | 'plainText'>): string {
  return note.doc ? docToMarkdown(note.doc) : note.plainText || '';
}
