/**
 * Turns a tracking template shared in the community into a draft proposal.
 * The embed comes from another member, so everything is re-read defensively and only the simple
 * "measure" of each option is kept; fields are rebuilt by the server like for AI drafts.
 */
import { Proposal, measureOfFields } from './aiTemplateDraft';
import type { DraftField } from '../../models/AiTemplateDraft';

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj).filter((x): x is Record<string, unknown> => !!x) : []);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function sharedTemplateToProposal(embed: unknown): Proposal | null {
  const e = obj(embed);
  if (!e) return null;

  const custom = list(e.categories)
    .map(c => ({
      category: text(c.name, 100),
      role: text(c.role, 30),
      icon: text(c.icon, 30) || undefined,
      questions: list(c.questions).map(q => ({
        title: text(q.title, 200),
        frequency: text(q.frequency, 30) || undefined,
        options: list(q.options).map(o => {
          const fields = list(o.fields) as unknown as DraftField[];
          const first = fields[0] as unknown as Record<string, unknown> | undefined;
          return {
            label: text(o.label, 100),
            measure: measureOfFields(fields),
            unit: text(first?.unit, 20) || undefined,
            min: typeof first?.min === 'number' ? first.min : undefined,
            max: typeof first?.max === 'number' ? first.max : undefined,
          };
        }),
      })),
    }))
    .filter(c => c.category && c.questions.some(q => q.title && q.options.some(o => o.label)));

  if (custom.length === 0) return null;
  return { title: text(e.title, 120) || 'Shared tracking template', summary: 'Shared in the Lumen community', custom };
}
