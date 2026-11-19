/** What a Lumen AI chat attachment ("ref") can point at. Kept apart so dataTools and attachments don't load each other at start-up. */
export const REF_KINDS = ['day', 'note', 'task', 'list', 'medication', 'record', 'flare', 'experiment', 'pattern', 'weekly_report', 'file', 'analysis'] as const;
export type RefKind = (typeof REF_KINDS)[number];

export interface ChatRef {
  kind: RefKind;
  /** YYYY-MM-DD for a day, `exposureKey|outcomeKey|lagDays` for a pattern, an Explore question token for an analysis, a Mongo id otherwise (a Media id for a file). */
  id: string;
  /** The chip label, e.g. "Mon, 17 Nov" or "blood-test.pdf". */
  title: string;
}

export const MAX_REFS = 5;
export const MAX_FILE_REFS = 2;
