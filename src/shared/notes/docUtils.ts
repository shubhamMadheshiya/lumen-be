import { INoteBlock } from '../types';

export interface ExtractedLinks {
  noteIds: string[];
  mediaIds: string[];
}

export interface ValidateDocResult {
  valid: boolean;
  error?: string;
}

const ALLOWED_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'details',
  'detailsSummary',
  'detailsContent',
  'blockquote',
  'callout',
  'horizontalRule',
  'codeBlock',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'image',
  'file',
  'pageLink',
  'hardBreak',
]);

const ALLOWED_MARK_TYPES = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'highlight',
  'link',
  'textStyle',
]);

const MAX_DOC_DEPTH = 20;
const MAX_DOC_BYTES = 1024 * 1024; // 1 MB

export function emptyDoc(): Record<string, unknown> {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  };
}

/**
 * Validates a ProseMirror document structure against an allowlist of node & mark types,
 * a maximum depth of 20, and a maximum JSON payload size of 1 MB.
 */
export function validateDoc(doc: unknown): ValidateDocResult {
  if (!doc || typeof doc !== 'object') {
    return { valid: false, error: 'Doc must be a non-null object' };
  }

  const rawJson = JSON.stringify(doc);
  if (rawJson.length > MAX_DOC_BYTES) {
    return { valid: false, error: `Document exceeds maximum allowed size of 1MB (${rawJson.length} bytes)` };
  }

  const root = doc as Record<string, unknown>;
  if (root.type !== 'doc') {
    return { valid: false, error: `Root node must have type "doc", received "${root.type}"` };
  }

  function validateNode(node: unknown, depth: number): ValidateDocResult {
    if (depth > MAX_DOC_DEPTH) {
      return { valid: false, error: `Document nesting exceeds maximum depth of ${MAX_DOC_DEPTH}` };
    }
    if (!node || typeof node !== 'object') {
      return { valid: false, error: 'Node must be an object' };
    }

    const n = node as Record<string, unknown>;
    const nodeType = typeof n.type === 'string' ? n.type : '';
    if (!ALLOWED_NODE_TYPES.has(nodeType)) {
      return { valid: false, error: `Unknown or disallowed node type: "${nodeType}"` };
    }

    // Validate marks if present
    if (Array.isArray(n.marks)) {
      for (const m of n.marks) {
        if (!m || typeof m !== 'object') {
          return { valid: false, error: 'Mark must be an object' };
        }
        const markType = typeof (m as Record<string, unknown>).type === 'string'
          ? (m as Record<string, unknown>).type as string
          : '';
        if (!ALLOWED_MARK_TYPES.has(markType)) {
          return { valid: false, error: `Unknown or disallowed mark type: "${markType}"` };
        }
      }
    }

    // Validate child content
    if (Array.isArray(n.content)) {
      for (const child of n.content) {
        const res = validateNode(child, depth + 1);
        if (!res.valid) return res;
      }
    }

    return { valid: true };
  }

  return validateNode(root, 1);
}

/**
 * Converts legacy Lumen INoteBlock[] (covering all 12 block types and nested toggle children)
 * into a standard ProseMirror/TipTap JSON document.
 */
export function blocksToDoc(blocks: INoteBlock[]): Record<string, unknown> {
  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
    return emptyDoc();
  }

  const content: Array<Record<string, unknown>> = [];
  let i = 0;

  function inlineText(text: string): Array<Record<string, unknown>> {
    if (!text) return [];
    return [{ type: 'text', text }];
  }

  while (i < blocks.length) {
    const block = blocks[i];
    const text = block.content || '';

    switch (block.type) {
      case 'heading_1':
        content.push({
          type: 'heading',
          attrs: { level: 1 },
          content: inlineText(text),
        });
        i++;
        break;

      case 'heading_2':
        content.push({
          type: 'heading',
          attrs: { level: 2 },
          content: inlineText(text),
        });
        i++;
        break;

      case 'heading_3':
        content.push({
          type: 'heading',
          attrs: { level: 3 },
          content: inlineText(text),
        });
        i++;
        break;

      case 'bullet_list': {
        const items: Array<Record<string, unknown>> = [];
        while (i < blocks.length && blocks[i].type === 'bullet_list') {
          items.push({
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: inlineText(blocks[i].content || ''),
              },
            ],
          });
          i++;
        }
        content.push({
          type: 'bulletList',
          content: items,
        });
        break;
      }

      case 'numbered_list': {
        const items: Array<Record<string, unknown>> = [];
        while (i < blocks.length && blocks[i].type === 'numbered_list') {
          items.push({
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: inlineText(blocks[i].content || ''),
              },
            ],
          });
          i++;
        }
        content.push({
          type: 'orderedList',
          content: items,
        });
        break;
      }

      case 'todo': {
        const items: Array<Record<string, unknown>> = [];
        while (i < blocks.length && blocks[i].type === 'todo') {
          items.push({
            type: 'taskItem',
            attrs: { checked: Boolean(blocks[i].completed) },
            content: [
              {
                type: 'paragraph',
                content: inlineText(blocks[i].content || ''),
              },
            ],
          });
          i++;
        }
        content.push({
          type: 'taskList',
          content: items,
        });
        break;
      }

      case 'quote':
        content.push({
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: inlineText(text),
            },
          ],
        });
        i++;
        break;

      case 'callout':
        content.push({
          type: 'callout',
          attrs: {
            icon: block.calloutIcon || '💡',
            color: block.calloutColor || '#0284C7',
          },
          content: [
            {
              type: 'paragraph',
              content: inlineText(text),
            },
          ],
        });
        i++;
        break;

      case 'toggle': {
        const childrenDoc = block.children && block.children.length > 0
          ? blocksToDoc(block.children)
          : emptyDoc();

        const detailsContentList = Array.isArray(childrenDoc.content)
          ? childrenDoc.content
          : [{ type: 'paragraph' }];

        content.push({
          type: 'details',
          content: [
            {
              type: 'detailsSummary',
              content: inlineText(text || 'Toggle'),
            },
            {
              type: 'detailsContent',
              content: detailsContentList,
            },
          ],
        });
        i++;
        break;
      }

      case 'divider':
        content.push({
          type: 'horizontalRule',
        });
        i++;
        break;

      case 'image':
        content.push({
          type: 'image',
          attrs: {
            src: block.imageUrl || '',
            alt: text || '',
          },
        });
        i++;
        break;

      case 'paragraph':
      default:
        content.push({
          type: 'paragraph',
          content: inlineText(text),
        });
        i++;
        break;
    }
  }

  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  };
}

/**
 * Extracts pure plain text from a ProseMirror document, preserving space and block boundaries.
 */
export function docToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';

  const chunks: string[] = [];

  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;

    if (n.type === 'text' && typeof n.text === 'string') {
      chunks.push(n.text);
      return;
    }

    if (Array.isArray(n.content)) {
      for (const child of n.content) {
        traverse(child);
      }
    }

    // Add newline after block nodes
    if (
      n.type === 'paragraph' ||
      n.type === 'heading' ||
      n.type === 'listItem' ||
      n.type === 'taskItem' ||
      n.type === 'blockquote' ||
      n.type === 'callout' ||
      n.type === 'detailsSummary' ||
      n.type === 'codeBlock' ||
      n.type === 'tableRow'
    ) {
      chunks.push('\n');
    }
  }

  traverse(doc);
  return chunks.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Markdown-flavoured plain text for LLM/AI contexts, preserving headings, checklists, links.
 */
export function docToMarkdown(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';

  function renderInline(content?: unknown[]): string {
    if (!Array.isArray(content)) return '';
    return content.map((node) => {
      if (!node || typeof node !== 'object') return '';
      const n = node as Record<string, unknown>;
      if (n.type === 'text') {
        let t = typeof n.text === 'string' ? n.text : '';
        if (Array.isArray(n.marks)) {
          for (const m of n.marks) {
            if (!m || typeof m !== 'object') continue;
            const mt = (m as Record<string, unknown>).type;
            if (mt === 'bold') t = `**${t}**`;
            else if (mt === 'italic') t = `*${t}*`;
            else if (mt === 'code') t = `\`${t}\``;
            else if (mt === 'strike') t = `~~${t}~~`;
            else if (mt === 'link') {
              const href = (m as Record<string, unknown>).attrs ? ((m as Record<string, unknown>).attrs as any).href : '';
              if (href) t = `[${t}](${href})`;
            }
          }
        }
        return t;
      }
      if (n.type === 'pageLink') {
        const title = (n.attrs as any)?.title || 'Page';
        return `[[${title}]]`;
      }
      if (n.type === 'hardBreak') return '\n';
      return '';
    }).join('');
  }

  function renderNode(node: unknown, depth = 0): string {
    if (!node || typeof node !== 'object') return '';
    const n = node as Record<string, unknown>;
    const type = n.type as string;
    const content = Array.isArray(n.content) ? n.content : [];

    switch (type) {
      case 'doc':
        return content.map((c) => renderNode(c, depth)).filter(Boolean).join('\n\n');

      case 'heading': {
        const level = typeof (n.attrs as any)?.level === 'number' ? (n.attrs as any).level : 1;
        const prefix = '#'.repeat(Math.min(6, Math.max(1, level)));
        return `${prefix} ${renderInline(content)}`;
      }

      case 'paragraph':
        return renderInline(content);

      case 'blockquote':
        return `> ${content.map((c) => renderNode(c, depth)).join('\n> ')}`;

      case 'callout': {
        const icon = (n.attrs as any)?.icon || '💡';
        const inner = content.map((c) => renderNode(c, depth)).join('\n');
        return `> ${icon} ${inner}`;
      }

      case 'codeBlock': {
        const lang = (n.attrs as any)?.language || '';
        return `\`\`\`${lang}\n${renderInline(content)}\n\`\`\``;
      }

      case 'bulletList':
        return content.map((c) => renderNode(c, depth)).join('\n');

      case 'orderedList':
        return content.map((c, idx) => {
          const itemText = renderNode(c, depth);
          return `${idx + 1}. ${itemText.replace(/^[*\-]\s+/, '')}`;
        }).join('\n');

      case 'listItem':
        return `- ${content.map((c) => renderNode(c, depth)).join('\n  ')}`;

      case 'taskList':
        return content.map((c) => renderNode(c, depth)).join('\n');

      case 'taskItem': {
        const checked = Boolean((n.attrs as any)?.checked);
        const box = checked ? '[x]' : '[ ]';
        return `- ${box} ${content.map((c) => renderNode(c, depth)).join(' ')}`;
      }

      case 'details': {
        const summary = content.find((c: any) => c.type === 'detailsSummary');
        const detailsBody = content.find((c: any) => c.type === 'detailsContent');
        const summaryText = summary ? renderInline((summary as any).content) : 'Details';
        const bodyText = detailsBody && Array.isArray((detailsBody as any).content)
          ? (detailsBody as any).content.map((c: any) => renderNode(c, depth + 1)).join('\n')
          : '';
        return `<details><summary>${summaryText}</summary>\n${bodyText}\n</details>`;
      }

      case 'horizontalRule':
        return '---';

      case 'image': {
        const src = (n.attrs as any)?.src || '';
        const alt = (n.attrs as any)?.alt || 'image';
        return `![${alt}](${src})`;
      }

      case 'file': {
        const name = (n.attrs as any)?.name || 'Attachment';
        return `[📎 ${name}]`;
      }

      case 'pageLink': {
        const title = (n.attrs as any)?.title || 'Page';
        return `[[${title}]]`;
      }

      case 'table': {
        const rows = content.map((r: any) => {
          const cells = Array.isArray(r.content) ? r.content : [];
          return `| ${cells.map((cell: any) => renderInline(cell.content).replace(/\|/g, '\\|')).join(' | ')} |`;
        });
        if (rows.length > 0) {
          const firstRowCells = Array.isArray(content[0]?.content) ? content[0].content.length : 1;
          const divider = `| ${Array(firstRowCells).fill('---').join(' | ')} |`;
          return [rows[0], divider, ...rows.slice(1)].join('\n');
        }
        return '';
      }

      default:
        if (content.length > 0) {
          return content.map((c) => renderNode(c, depth)).join('\n');
        }
        return renderInline(content);
    }
  }

  return renderNode(doc).trim();
}

/**
 * Extracts noteIds (backlinks, sub-page links) and mediaIds from a ProseMirror document.
 */
export function extractLinks(doc: unknown): ExtractedLinks {
  const noteIds = new Set<string>();
  const mediaIds = new Set<string>();

  if (!doc || typeof doc !== 'object') {
    return { noteIds: [], mediaIds: [] };
  }

  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;

    // 1. Direct pageLink node
    if (n.type === 'pageLink' && n.attrs && typeof (n.attrs as any).noteId === 'string') {
      const nid = ((n.attrs as any).noteId as string).trim();
      if (nid) noteIds.add(nid);
    }

    // 2. Marks with link href matching note IDs
    if (Array.isArray(n.marks)) {
      for (const m of n.marks) {
        if (m && typeof m === 'object' && (m as any).type === 'link') {
          const href = (m as any).attrs?.href;
          if (typeof href === 'string') {
            const match = href.match(/(?:notes\/|lumen:\/\/notes\/)([0-9a-fA-F]{24})/);
            if (match && match[1]) {
              noteIds.add(match[1]);
            }
          }
        }
      }
    }

    // 3. Image or file node with mediaId
    if ((n.type === 'image' || n.type === 'file') && n.attrs && typeof (n.attrs as any).mediaId === 'string') {
      const mid = ((n.attrs as any).mediaId as string).trim();
      if (mid) mediaIds.add(mid);
    }

    // 4. Children
    if (Array.isArray(n.content)) {
      for (const child of n.content) {
        traverse(child);
      }
    }
  }

  traverse(doc);
  return {
    noteIds: Array.from(noteIds),
    mediaIds: Array.from(mediaIds),
  };
}

/**
 * Extracts a brief snippet (up to maxLength characters) suitable for card previews or search hits.
 */
export function docSnippet(doc: unknown, maxLength = 120): string {
  const plain = docToPlainText(doc).replace(/\s+/g, ' ').trim();
  if (!plain) return '';
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength).trim()}...`;
}

