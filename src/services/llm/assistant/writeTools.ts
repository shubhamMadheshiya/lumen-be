/**
 * Lumen AI tools that make something for the member: notes, and log-template proposals.
 * Notes are written when the member asks. A template is only ever a proposal: it becomes a draft
 * the member reviews in the app; nothing is added to their tracking setup from here.
 * get_tracking_setup is read-only but lives here because it serves the template tools.
 */
import { appendToNote, createAiNote } from '../../notes/aiNoteWriter';
import { createDraft, MEASURES, type Proposal } from '../../templates/aiTemplateDraft';
import { getTrackingSetup } from '../../templates/trackingSetup';
import type { ToolContext, ToolDeclaration, ToolResult, ToolSchema } from './dataTools';

const S = { OBJECT: 'object', STRING: 'string', INTEGER: 'integer', NUMBER: 'number', ARRAY: 'array' } as const;

const optionSchema: ToolSchema = {
  type: S.OBJECT,
  properties: {
    label: { type: S.STRING, description: 'What the member taps, e.g. "Jaw pain".' },
    measure: { type: S.STRING, description: `How it is measured: ${MEASURES.join(', ')}. severity = 0-10 slider.` },
    unit: { type: S.STRING, description: 'Only for measure "number", e.g. "glasses", "mg".' },
    min: { type: S.NUMBER },
    max: { type: S.NUMBER },
  },
  required: ['label', 'measure'],
};

export const WRITE_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'create_note',
    description: 'Create a note in the member\'s Notes & Docs. Only when they ask for a note (or accept your offer). Write the content as Markdown: # headings, - bullets, - [ ] checklists, **bold**.',
    parameters: {
      type: S.OBJECT,
      properties: {
        title: { type: S.STRING, description: 'Short title.' },
        markdown: { type: S.STRING, description: 'The note body in Markdown.' },
        icon: { type: S.STRING, description: 'One emoji.' },
        tags: { type: S.ARRAY, items: { type: S.STRING } },
      },
      required: ['title', 'markdown'],
    },
  },
  {
    name: 'append_to_note',
    description: 'Add Markdown to the end of one of the member\'s existing notes (find its id with get_notes). Only when they ask.',
    parameters: {
      type: S.OBJECT,
      properties: { note_id: { type: S.STRING }, markdown: { type: S.STRING } },
      required: ['note_id', 'markdown'],
    },
  },
  {
    name: 'get_tracking_setup',
    description: 'The member\'s current tracking setup (categories → questions → options with ids), how often each was used in the last 90 days, what they keep typing under "Other", and the Lumen template library (keys) to reuse first. Call before propose_log_template.',
  },
  {
    name: 'propose_log_template',
    description: 'Propose tracking for a condition or symptoms as a DRAFT the member reviews and adds in the app (nothing is added by this). Reuse library categories and quick actions by key first; add custom items only for what the library lacks; skip what they already track. You may also propose options for an existing question (e.g. something they keep typing under "Other") and archiving categories/questions/options unused for months.',
    parameters: {
      type: S.OBJECT,
      properties: {
        title: { type: S.STRING, description: 'e.g. "Rheumatoid arthritis tracking".' },
        summary: { type: S.STRING, description: 'One or two sentences: why these, in the member\'s language.' },
        library: {
          type: S.OBJECT,
          properties: {
            categories: { type: S.ARRAY, items: { type: S.STRING }, description: 'Library category keys, e.g. cat_symptoms.' },
            quickActions: { type: S.ARRAY, items: { type: S.STRING }, description: 'Library quick action keys, e.g. qa_water.' },
          },
        },
        custom: {
          type: S.ARRAY,
          description: 'New categories, or more questions under a category they already have (use its exact name).',
          items: {
            type: S.OBJECT,
            properties: {
              category: { type: S.STRING },
              role: { type: S.STRING, description: 'symptom, trigger_candidate (food, habits, exposures) or context.' },
              icon: { type: S.STRING, description: 'One emoji.' },
              questions: {
                type: S.ARRAY,
                items: {
                  type: S.OBJECT,
                  properties: {
                    title: { type: S.STRING },
                    selectionType: { type: S.STRING, description: 'single or multiple' },
                    frequency: { type: S.STRING, description: 'anytime, once_per_day, morning or evening' },
                    options: { type: S.ARRAY, items: optionSchema },
                  },
                  required: ['title', 'options'],
                },
              },
            },
            required: ['category', 'questions'],
          },
        },
        addOptions: {
          type: S.ARRAY,
          description: 'More options for an existing question (by its id from get_tracking_setup).',
          items: { type: S.OBJECT, properties: { questionId: { type: S.STRING }, options: { type: S.ARRAY, items: optionSchema } }, required: ['questionId', 'options'] },
        },
        customQuickActions: {
          type: S.ARRAY,
          items: {
            type: S.OBJECT,
            properties: { label: { type: S.STRING }, mode: { type: S.STRING, description: 'counter, timer or toggle' }, unit: { type: S.STRING }, dailyGoal: { type: S.NUMBER } },
            required: ['label'],
          },
        },
        archive: {
          type: S.ARRAY,
          description: 'Existing items to hide (by id): only ones added more than 2 months ago (addedOn) that have not been used for 2+ months. Logged data is kept.',
          items: { type: S.OBJECT, properties: { kind: { type: S.STRING, description: 'category, question or option' }, id: { type: S.STRING }, reason: { type: S.STRING } }, required: ['kind', 'id'] },
        },
      },
      required: ['title'],
    },
  },
];

/** Tools that change something: not offered to background runs (weekly review, notifications). */
export const WRITING_TOOLS = new Set(['create_note', 'append_to_note', 'propose_log_template']);
export const WRITE_TOOL_NAMES = new Set(WRITE_TOOL_DECLARATIONS.map(t => t.name));

type Handler = (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;

const handlers: Record<string, Handler> = {
  async create_note(ctx, args) {
    const markdown = String(args.markdown ?? '').trim();
    if (!markdown) return { response: { ok: false, error: 'markdown is empty' } };
    const note = await createAiNote(ctx.userId, {
      title: String(args.title ?? ''),
      markdown,
      icon: typeof args.icon === 'string' ? args.icon : undefined,
      tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
    });
    return { response: { ok: true, noteId: String(note._id), title: note.title }, artifact: { type: 'note', id: String(note._id), title: note.title } };
  },

  async append_to_note(ctx, args) {
    const note = await appendToNote(ctx.userId, String(args.note_id ?? ''), String(args.markdown ?? ''));
    if (!note) return { response: { ok: false, error: 'Note not found' } };
    return { response: { ok: true, noteId: String(note._id), title: note.title }, artifact: { type: 'note', id: String(note._id), title: note.title } };
  },

  async get_tracking_setup(ctx) {
    return { response: await getTrackingSetup(ctx.userId) };
  },

  async propose_log_template(ctx, args) {
    const draft = await createDraft(ctx.userId, args as Proposal);
    if (!draft) return { response: { ok: false, error: 'Nothing new to propose: the member already tracks all of this, or no valid items were given.' } };
    const added = draft.categories.filter(c => c.include).length;
    return {
      response: { ok: true, draftId: String(draft._id), note: 'Draft saved. Tell the member to tap "Review" to check and add it; it is NOT added yet.', categories: added, archiveSuggestions: draft.archive.length },
      artifact: { type: 'template_draft', id: String(draft._id), title: draft.title },
    };
  },
};

export async function runWriteTool(ctx: ToolContext, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const handler = handlers[name];
  if (!handler) return { response: { error: `Unknown tool ${name}` } };
  try {
    return await handler(ctx, args ?? {});
  } catch (err) {
    console.error(`[assistant] tool ${name} failed:`, err);
    return { response: { ok: false, error: (err as Error).message?.slice(0, 200) || 'That could not be saved just now.' } };
  }
}
