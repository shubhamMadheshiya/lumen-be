/**
 * Lumen AI working on notes: actions on an existing note (summarise, checklist, continue,
 * translate), the doctor-visit prep note, and the daily health journal. The AI only returns
 * Markdown here (allowWrites: false); this module decides where it goes.
 */
import mongoose from 'mongoose';
import { User } from '../../models/User';
import { runAssistant } from '../llm/assistant/assistant';
import { appendToNote, createAiNote, findOwnNote, noteMarkdown } from './aiNoteWriter';
import { localDateKey } from '../aiNotify/gate';

export const NOTE_ACTIONS = ['summarize', 'checklist', 'continue', 'hinglish', 'english'] as const;
export type NoteAction = (typeof NOTE_ACTIONS)[number];

export type NoteAiResult =
  | { ok: true; noteId: string; created: boolean }
  | { ok: false; reason: 'not_found' | 'empty' | string };

/** Model output → plain Markdown: no code fences around it, no "Here is…" preface. */
export function cleanMarkdown(text: string): string {
  return text
    .replace(/^\s*```(?:markdown|md)?\s*\n/i, '')
    .replace(/\n```\s*$/, '')
    .replace(/^(here(?:'s| is)[^\n]*:\s*\n)/i, '')
    .trim();
}

const NOTE_LIMIT = 12_000;

const ACTION_PROMPT: Record<NoteAction, string> = {
  summarize: 'Summarise this note in 3-6 short bullet points. Keep facts, numbers and dates exactly as written.',
  checklist: 'Turn the actions and to-dos in this note into a Markdown checklist ("- [ ] …"). Only things that are actually actions.',
  continue: 'Continue writing this note in the same style and language, adding the next useful section (about 80-150 words). Do not repeat what is already there.',
  hinglish: 'Rewrite the whole note in simple Hinglish (Hindi in Roman letters mixed with English, as people text in India). Keep headings, lists and numbers.',
  english: 'Rewrite the whole note in simple, clear English. Keep headings, lists and numbers.',
};

const HEADING: Partial<Record<NoteAction, string>> = { summarize: '## Summary', checklist: '## Action items' };

async function askForMarkdown(userId: string, message: string, budgetMs = 60_000): Promise<string | null> {
  const res = await runAssistant({ userId, history: [], message, effort: 'low', budgetMs, allowWrites: false });
  if (res.error) return null;
  const md = cleanMarkdown(res.text);
  return md || null;
}

export async function runNoteAction(userId: string, noteId: string, action: NoteAction): Promise<NoteAiResult> {
  const note = await findOwnNote(userId, noteId);
  if (!note) return { ok: false, reason: 'not_found' };
  const body = noteMarkdown(note).slice(0, NOTE_LIMIT);
  if (!body.trim()) return { ok: false, reason: 'empty' };

  const md = await askForMarkdown(userId, `${ACTION_PROMPT[action]}
Reply with Markdown only (no preface). Use only this note; do not use the tools.

Note title: ${note.title}
---
${body}
---`);
  if (!md) return { ok: false, reason: 'ai_failed' };

  if (action === 'hinglish' || action === 'english') {
    const copy = await createAiNote(userId, {
      title: `${note.title} · ${action === 'hinglish' ? 'Hinglish' : 'English'}`,
      markdown: md, icon: note.icon, parentNoteId: String(note._id), tags: note.tags,
    });
    return { ok: true, noteId: String(copy._id), created: true };
  }
  const heading = HEADING[action];
  const updated = await appendToNote(userId, noteId, heading ? `${heading}\n\n${md}` : md);
  return updated ? { ok: true, noteId: String(updated._id), created: false } : { ok: false, reason: 'not_found' };
}

export async function createDoctorVisitNote(userId: string, weeks = 4, now = new Date()): Promise<NoteAiResult> {
  const w = Math.min(12, Math.max(2, Math.round(weeks)));
  const md = await askForMarkdown(userId, `Prepare my doctor-visit note covering the last ${w} weeks. Use the tools to look at my day summaries, symptoms and flares, sleep and activity, medicines (and any changes), lab results and notes.
Write it as my own note (I / my), in Markdown, with exactly these headings:
## Since my last visit
## Symptoms
## Flares
## Medicines
## Tests and results
## What seemed to help or make things worse
## Questions to ask my doctor
What goes under them: 2-3 sentences overall; symptoms as bullets with how often, how bad, best and worst days, with dates and numbers; flares; medicines I take, changes, missed doses and side effects I logged; lab results; patterns (say they are patterns, not proof); and a "- [ ]" checklist of 4-6 questions.
Leave out a section only if there is truly nothing for it. Be factual and concise. Reply with the Markdown only.`, 120_000);
  if (!md) return { ok: false, reason: 'ai_failed' };
  const user = await User.findById(userId).select('preferences.timezone').lean();
  const date = localDateKey(now, user?.preferences?.timezone ?? 'UTC');
  const note = await createAiNote(userId, { title: `Doctor visit prep · ${date}`, markdown: md, icon: '🩺', tags: ['doctor-visit'] });
  return { ok: true, noteId: String(note._id), created: true };
}

// ── Health journal ───────────────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "16 Nov (Sun)" for a YYYY-MM-DD day. */
export function journalHeading(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} (${WEEKDAYS[d.getUTCDay()]})`;
}

/** The member's journal note: the remembered one if it still exists, otherwise a new one. */
async function journalNote(userId: string): Promise<{ id: string; text: string }> {
  const user = await User.findById(userId).select('preferences.aiJournalNoteId').lean();
  const known = user?.preferences?.aiJournalNoteId;
  if (known) {
    const note = await findOwnNote(userId, known);
    if (note) return { id: String(note._id), text: note.plainText ?? '' };
  }
  const note = await createAiNote(userId, {
    title: 'Health journal',
    icon: '📔',
    tags: ['journal'],
    markdown: 'Lumen AI adds a short entry here every morning about the day before.',
  });
  await User.updateOne({ _id: new mongoose.Types.ObjectId(userId) }, { $set: { 'preferences.aiJournalNoteId': String(note._id) } });
  return { id: String(note._id), text: note.plainText ?? '' };
}

/** Adds the entry for `dayKey` (once). Returns false when there was nothing to write or it exists. */
export async function writeJournalEntry(userId: string, dayKey: string): Promise<boolean> {
  const heading = journalHeading(dayKey);
  const journal = await journalNote(userId);
  if (journal.text.includes(heading)) return false;
  const md = await askForMarkdown(userId, `Write my health journal entry for ${dayKey}. Use the tools to look at that day (get_day) and how it compares with the days before.
3-5 short bullets, under 120 words: how the day went, symptoms with numbers, sleep/activity, food or anything notable, and one thing worth watching. Use my language (the one in my notes and chats). If I logged nothing that day, write one bullet saying so.
Reply with the bullets only (Markdown).`);
  if (!md) return false;
  return !!(await appendToNote(userId, journal.id, `### ${heading}\n\n${md}`));
}
