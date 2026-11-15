import mongoose from 'mongoose';
import { Note } from '../models/Note';
import {
  blocksToDoc,
  docToPlainText,
  docToMarkdown,
  extractLinks,
  docSnippet,
  validateDoc,
  emptyDoc,
} from '../shared/notes/docUtils';
import { INoteBlock } from '../shared/types';
import { HEALTH_NOTE_TEMPLATES, purgeExpiredTrash } from '../routes/notes';

describe('Notion-Style Notes: docUtils & Model', () => {
  describe('docUtils: blocksToDoc conversion', () => {
    it('converts legacy blocks (headings, lists, tasks, callouts, toggles, quotes, divider, image)', () => {
      const legacyBlocks: INoteBlock[] = [
        { id: 'h1', type: 'heading_1', content: 'Main Title' },
        { id: 'h2', type: 'heading_2', content: 'Subtitle' },
        { id: 'h3', type: 'heading_3', content: 'Section' },
        { id: 'p1', type: 'paragraph', content: 'Introductory text' },
        { id: 'b1', type: 'bullet_list', content: 'First bullet' },
        { id: 'b2', type: 'bullet_list', content: 'Second bullet' },
        { id: 'o1', type: 'numbered_list', content: 'Step 1' },
        { id: 't1', type: 'todo', content: 'Action item', completed: true },
        { id: 't2', type: 'todo', content: 'Pending item', completed: false },
        { id: 'q1', type: 'quote', content: 'Wise quote' },
        { id: 'c1', type: 'callout', content: 'Alert', calloutIcon: '⚠️', calloutColor: '#EF4444' },
        { id: 'd1', type: 'divider', content: '' },
        { id: 'img1', type: 'image', content: 'Photo caption', imageUrl: 'https://example.com/p.jpg' },
        {
          id: 'tog1',
          type: 'toggle',
          content: 'Toggle Header',
          isCollapsed: false,
          children: [
            { id: 'tog_c1', type: 'paragraph', content: 'Nested toggle secret content' },
          ],
        },
      ];

      const doc = blocksToDoc(legacyBlocks);
      expect(doc.type).toBe('doc');
      expect(Array.isArray(doc.content)).toBe(true);

      const content = doc.content as any[];
      // Heading 1
      expect(content[0].type).toBe('heading');
      expect(content[0].attrs.level).toBe(1);
      expect(content[0].content[0].text).toBe('Main Title');

      // Bullet list grouping
      const bulletList = content.find((c) => c.type === 'bulletList');
      expect(bulletList).toBeDefined();
      expect(bulletList.content.length).toBe(2);

      // Task list grouping
      const taskList = content.find((c) => c.type === 'taskList');
      expect(taskList).toBeDefined();
      expect(taskList.content.length).toBe(2);
      expect(taskList.content[0].attrs.checked).toBe(true);
      expect(taskList.content[1].attrs.checked).toBe(false);

      // Callout
      const callout = content.find((c) => c.type === 'callout');
      expect(callout).toBeDefined();
      expect(callout.attrs.icon).toBe('⚠️');

      // Details (toggle)
      const details = content.find((c) => c.type === 'details');
      expect(details).toBeDefined();
      expect(details.content[0].type).toBe('detailsSummary');
      expect(details.content[1].type).toBe('detailsContent');
    });

    it('returns emptyDoc for null or empty input', () => {
      const doc = blocksToDoc([]);
      expect(doc).toEqual(emptyDoc());
    });
  });

  describe('docUtils: docToPlainText & docToMarkdown', () => {
    it('produces clean plain text and markdown representation', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'My Health Doc' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Daily reflection.' }] },
          {
            type: 'taskList',
            content: [
              { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Take electrolytes' }] }] },
              { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rest 20 min' }] }] },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'pageLink', attrs: { noteId: '507f1f77bcf86cd799439011', title: 'Cardiology Notes' } },
            ],
          },
        ],
      };

      const plain = docToPlainText(doc);
      expect(plain).toContain('My Health Doc');
      expect(plain).toContain('Daily reflection.');
      expect(plain).toContain('Take electrolytes');

      const markdown = docToMarkdown(doc);
      expect(markdown).toContain('# My Health Doc');
      expect(markdown).toContain('- [x] Take electrolytes');
      expect(markdown).toContain('- [ ] Rest 20 min');
      expect(markdown).toContain('[[Cardiology Notes]]');
    });
  });

  describe('docUtils: extractLinks & docSnippet', () => {
    it('extracts noteIds and mediaIds from links and custom nodes', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'pageLink', attrs: { noteId: '607f1f77bcf86cd799439012', title: 'Sub page' } },
              {
                type: 'text',
                text: 'Link to note',
                marks: [{ type: 'link', attrs: { href: 'lumen://notes/707f1f77bcf86cd799439013' } }],
              },
            ],
          },
          {
            type: 'image',
            attrs: { mediaId: 'med_photo_999', src: 'https://cdn.lumen/p.jpg' },
          },
          {
            type: 'file',
            attrs: { mediaId: 'med_pdf_888', name: 'Lab_Results.pdf' },
          },
        ],
      };

      const links = extractLinks(doc);
      expect(links.noteIds).toContain('607f1f77bcf86cd799439012');
      expect(links.noteIds).toContain('707f1f77bcf86cd799439013');
      expect(links.mediaIds).toContain('med_photo_999');
      expect(links.mediaIds).toContain('med_pdf_888');

      const snippet = docSnippet(doc, 30);
      expect(snippet.length).toBeLessThanOrEqual(35);
    });
  });

  describe('docUtils: validateDoc', () => {
    it('approves a valid document', () => {
      const doc = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Valid' }] }],
      };
      const res = validateDoc(doc);
      expect(res.valid).toBe(true);
    });

    it('rejects disallowed node types', () => {
      const doc = {
        type: 'doc',
        content: [{ type: 'maliciousScriptNode', content: [] }],
      };
      const res = validateDoc(doc);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('disallowed node type');
    });

    it('rejects documents exceeding maximum depth', () => {
      let deepNode: any = { type: 'paragraph', content: [{ type: 'text', text: 'Bottom' }] };
      for (let d = 0; d < 25; d++) {
        deepNode = { type: 'details', content: [deepNode] };
      }
      const doc = { type: 'doc', content: [deepNode] };
      const res = validateDoc(doc);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('maximum depth');
    });
  });

  describe('Note Model & Templates', () => {
    it('validates a Note with kind, database properties, sortOrder, and favorite status', () => {
      const userId = new mongoose.Types.ObjectId();
      const note = new Note({
        userId,
        title: 'Medication Tracker Database',
        kind: 'database',
        sortOrder: 1,
        isFavorite: true,
        database: {
          properties: [
            { id: 'p1', name: 'Medication', type: 'text' },
            { id: 'p2', name: 'Dosage (mg)', type: 'number' },
            {
              id: 'p3',
              name: 'Status',
              type: 'select',
              options: [
                { id: 'opt1', name: 'Active', color: '#10B981' },
                { id: 'opt2', name: 'Paused', color: '#F59E0B' },
              ],
            },
          ],
          views: [
            { id: 'v1', name: 'All Meds', type: 'table' },
            { id: 'v2', name: 'By Status', type: 'board', groupByPropId: 'p3' },
          ],
        },
      });

      const err = note.validateSync();
      expect(err).toBeUndefined();
      expect(note.kind).toBe('database');
      expect(note.database?.properties.length).toBe(3);
    });

    it('HEALTH_NOTE_TEMPLATES all have valid ProseMirror docs', () => {
      for (const t of HEALTH_NOTE_TEMPLATES) {
        expect(t.doc).toBeDefined();
        const validRes = validateDoc(t.doc);
        expect(validRes.valid).toBe(true);
      }
    });
  });
});

