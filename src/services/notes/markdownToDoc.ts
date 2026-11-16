/**
 * Markdown (as Lumen AI writes it) → the TipTap/ProseMirror JSON the notes editor stores in
 * `Note.doc`. Covers what the AI uses: # headings, paragraphs, - / 1. lists, - [ ] checklists,
 * > quotes, --- dividers, ``` code, and **bold**, *italic*, `code`, [links](url) inline.
 * Output only uses node and mark types the editor allows (see shared/notes/docUtils.ts).
 */

type Node = Record<string, unknown>;
type Mark = { type: string; attrs?: Record<string, unknown> };

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/;

/** Text with bold / italic / code / link marks. */
export function inlineNodes(text: string): Node[] {
  const out: Node[] = [];
  let rest = text;
  while (rest.length) {
    const m = INLINE.exec(rest);
    if (!m) { out.push({ type: 'text', text: rest }); break; }
    if (m.index > 0) out.push({ type: 'text', text: rest.slice(0, m.index) });
    let value = '';
    let marks: Mark[] = [];
    if (m[2] ?? m[3]) { value = (m[2] ?? m[3])!; marks = [{ type: 'bold' }]; }
    else if (m[4] ?? m[5]) { value = (m[4] ?? m[5])!; marks = [{ type: 'italic' }]; }
    else if (m[6]) { value = m[6]; marks = [{ type: 'code' }]; }
    else if (m[7]) { value = m[7]; marks = [{ type: 'link', attrs: { href: m[8], target: '_blank' } }]; }
    if (value) out.push({ type: 'text', text: value, marks });
    rest = rest.slice(m.index + m[0].length);
  }
  return out.filter(n => (n.text as string).length > 0);
}

const paragraph = (text: string): Node => {
  const content = inlineNodes(text);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};

const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
const TASK = /^(\s*)[-*]\s+\[( |x|X)\]\s+(.*)$/;

export function markdownToDoc(markdown: string): Node {
  const lines = (markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const content: Node[] = [];
  let i = 0;

  const collect = (re: RegExp, build: (m: RegExpExecArray) => Node, notIf?: RegExp): Node[] => {
    const items: Node[] = [];
    while (i < lines.length) {
      const m = re.exec(lines[i]);
      if (!m || (notIf && notIf.test(lines[i]))) break;
      items.push(build(m));
      i++;
    }
    return items;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      content.push({ type: 'heading', attrs: { level: Math.min(3, heading[1].length) }, content: inlineNodes(heading[2].trim()) });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      content.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++; // closing fence
      content.push({ type: 'codeBlock', content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] });
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) quoted.push(lines[i++].trim().replace(/^>\s?/, ''));
      content.push({ type: 'blockquote', content: quoted.filter(Boolean).map(paragraph) });
      continue;
    }

    if (TASK.test(line)) {
      const items = collect(TASK, m => ({
        type: 'taskItem',
        attrs: { checked: m[2].toLowerCase() === 'x' },
        content: [paragraph(m[3].trim())],
      }));
      content.push({ type: 'taskList', content: items });
      continue;
    }

    if (BULLET.test(line)) {
      const items = collect(BULLET, m => ({ type: 'listItem', content: [paragraph(m[2].trim())] }), TASK);
      content.push({ type: 'bulletList', content: items });
      continue;
    }

    if (ORDERED.test(line)) {
      const items = collect(ORDERED, m => ({ type: 'listItem', content: [paragraph(m[2].trim())] }));
      content.push({ type: 'orderedList', content: items });
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i].trim()) && !BULLET.test(lines[i]) && !ORDERED.test(lines[i]) &&
      !lines[i].trim().startsWith('>') && !lines[i].trim().startsWith('```') && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) para.push(lines[i++].trim());
    content.push(paragraph(para.join(' ')));
  }

  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
