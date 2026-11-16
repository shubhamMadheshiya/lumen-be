/**
 * Gemini provider. Current Gemini models reject the old 'function' role: tool results go back as
 * the user's turn, and photos ride in that same turn (an image can't sit inside a function response).
 * The model's own parts (incl. thought signatures) are pushed back unchanged.
 */
import type { Content, FunctionDeclaration, Part } from '@google/generative-ai';
import { generateTurn } from '../../geminiClient';
import type { ToolDeclaration } from '../dataTools';
import type { AssistantProvider, AssistantSession, InputPart, SessionOptions, StepResult, ToolResultInput } from './types';

function toPart(p: InputPart): Part {
  return p.type === 'text' ? { text: p.text } : { inlineData: { mimeType: p.mimeType, data: p.base64 } };
}

/** Our JSON Schema already uses Gemini's type names ('object', 'string', ...). */
export function toGeminiTools(tools: ToolDeclaration[]): FunctionDeclaration[] {
  return tools as unknown as FunctionDeclaration[];
}

class GeminiSession implements AssistantSession {
  private contents: Content[];
  private readonly tools: FunctionDeclaration[];

  constructor(private readonly opts: SessionOptions) {
    this.contents = [
      ...opts.history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
      { role: 'user', parts: opts.userParts.map(toPart) },
    ];
    this.tools = toGeminiTools(opts.tools);
  }

  async next({ withTools, timeoutMs }: { withTools: boolean; timeoutMs: number }): Promise<StepResult> {
    const turn = await generateTurn({
      model: this.opts.model,
      systemPrompt: this.opts.system,
      contents: this.contents,
      tools: withTools ? this.tools : undefined,
      timeoutMs,
    });
    if (!turn.ok) return { ok: false, error: turn.error, detail: turn.detail };
    if (turn.functionCalls.length) this.contents.push({ role: 'model', parts: turn.parts });
    return {
      ok: true,
      text: turn.text,
      calls: turn.functionCalls.map((c, i) => ({ id: String(i), name: c.name, args: (c.args ?? {}) as Record<string, unknown> })),
      usage: turn.usage,
    };
  }

  addToolResults(results: ToolResultInput[]): void {
    const responseParts: Part[] = results.map(r => ({ functionResponse: { name: r.name, response: r.response } }));
    const imageParts: Part[] = results.flatMap(r => (r.images ?? []).flatMap(img => [
      { text: img.label },
      { inlineData: { mimeType: img.mimeType, data: img.base64 } },
    ]));
    this.contents.push({ role: 'user', parts: [...responseParts, ...imageParts] });
  }

  addUserText(text: string): void {
    this.contents.push({ role: 'user', parts: [{ text }] });
  }
}

export const geminiProvider: AssistantProvider = {
  startSession: opts => new GeminiSession(opts),
};
