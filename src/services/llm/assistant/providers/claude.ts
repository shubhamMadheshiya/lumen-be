/**
 * Claude provider (Anthropic Messages API, paid per use). Only used when ANTHROPIC_API_KEY is set
 * on the server and the member picked a Claude model.
 *
 * - Thinking is left at the model default (adaptive). The whole `response.content`, thinking
 *   blocks included, is appended back unchanged every round.
 * - Once the transcript holds tool_use blocks the tools must stay declared, so "answer now"
 *   rounds keep them and set tool_choice 'none' instead of dropping them.
 * - fallbacks: 'default' lets the API re-run a policy-declined request on its default fallback
 *   model; on a model without fallbacks the request simply runs alone.
 * - Retries are left to the loop in ../assistant.ts (it knows the time budget), so the SDK's own
 *   retries are off.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../../../config';
import type { ToolDeclaration } from '../dataTools';
import type { AssistantProvider, AssistantSession, InputPart, SessionOptions, StepResult, ToolResultInput } from './types';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type ToolParam = Anthropic.Beta.Messages.BetaTool;

const MAX_TOKENS = 16_000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let client: Anthropic | null = null;
let clientKey = '';
function getClient(): Anthropic | null {
  if (!config.anthropic.apiKey) return null;
  if (!client || clientKey !== config.anthropic.apiKey) {
    client = new Anthropic({ apiKey: config.anthropic.apiKey, maxRetries: 0 });
    clientKey = config.anthropic.apiKey;
  }
  return client;
}

/** For tests: swap the SDK client. */
export function setClaudeClientForTesting(c: unknown): void {
  client = c as Anthropic;
  clientKey = config.anthropic.apiKey;
}

export function toClaudeTools(tools: ToolDeclaration[]): ToolParam[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      properties: (t.parameters?.properties ?? {}) as Record<string, unknown>,
      ...(t.parameters?.required?.length ? { required: t.parameters.required } : {}),
    },
  }));
}

function toBlock(p: InputPart): ContentBlockParam {
  if (p.type === 'text') return { type: 'text', text: p.text };
  // PDFs (attached lab reports, a health record's documents) go as document blocks; an image block would be rejected.
  if (p.mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } };
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: p.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: p.base64 },
  };
}

export function mapClaudeError(err: unknown): { error: StepResult & { ok: false } } {
  const fail = (error: Exclude<StepResult, { ok: true }>['error'], detail?: string) => ({ error: { ok: false as const, error, detail } });
  if (err instanceof Anthropic.APIConnectionTimeoutError) return fail('timeout');
  if (err instanceof Anthropic.RateLimitError) return fail('rate_limited', err.message);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return fail('bad_key', err.message);
  // An empty prepaid balance is a 400 with no class of its own; it needs the same fix as a bad key.
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) return fail('bad_key', err.message);
  if (err instanceof Anthropic.APIError && typeof err.status === 'number' && err.status >= 500) return fail('busy', err.message);
  if (err instanceof Anthropic.APIConnectionError) return fail('busy', err.message);
  const message = err instanceof Error ? err.message : String(err);
  console.error('[claude] assistant turn failed:', message);
  return fail('failed', message);
}

class ClaudeSession implements AssistantSession {
  private messages: MessageParam[];
  private readonly tools: ToolParam[];

  constructor(private readonly opts: SessionOptions) {
    this.messages = [
      ...opts.history.map(m => ({ role: m.role, content: m.text || '(photo)' }) as MessageParam),
      // Attachments first, each file kept right after its own label, then the question.
      { role: 'user', content: [...opts.userParts.slice(1), opts.userParts[0]].filter(Boolean).map(toBlock) },
    ];
    this.tools = toClaudeTools(opts.tools);
  }

  async next({ withTools, timeoutMs }: { withTools: boolean; timeoutMs: number }): Promise<StepResult> {
    const anthropic = getClient();
    if (!anthropic) return { ok: false, error: 'not_configured' };
    const hasToolHistory = this.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_use' || b.type === 'tool_result'));
    try {
      const response = await anthropic.beta.messages.create(
        {
          model: this.opts.model,
          max_tokens: MAX_TOKENS,
          system: this.opts.system,
          messages: [...this.messages],
          ...(withTools || hasToolHistory ? { tools: this.tools } : {}),
          ...(!withTools && hasToolHistory ? { tool_choice: { type: 'none' as const } } : {}),
          output_config: { effort: this.opts.effort },
          cache_control: { type: 'ephemeral' },
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
        },
        { timeout: timeoutMs },
      );
      if (response.stop_reason === 'refusal') return { ok: false, error: 'blocked', detail: response.stop_details?.category ?? undefined };

      this.messages.push({ role: 'assistant', content: response.content as ContentBlockParam[] });
      const text = response.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
      const calls = response.content
        .filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use')
        .map(b => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }));
      const u = response.usage;
      return {
        ok: true,
        text,
        calls,
        usage: {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        },
      };
    } catch (err) {
      return mapClaudeError(err).error;
    }
  }

  addToolResults(results: ToolResultInput[]): void {
    const blocks: ContentBlockParam[] = results.map(r => ({
      type: 'tool_result',
      tool_use_id: r.id,
      content: [
        { type: 'text', text: JSON.stringify(r.response) },
        ...(r.images ?? []).flatMap(img => [
          { type: 'text' as const, text: img.label },
          toBlock({ type: 'image', mimeType: img.mimeType, base64: img.base64 }) as Anthropic.Beta.Messages.BetaImageBlockParam | Anthropic.Beta.Messages.BetaRequestDocumentBlock,
        ]),
      ],
    }));
    this.messages.push({ role: 'user', content: blocks });
  }

  addUserText(text: string): void {
    const last = this.messages[this.messages.length - 1];
    // Keep one user turn: tool results and Lumen's nudge go in the same message.
    if (last?.role === 'user' && Array.isArray(last.content)) last.content.push({ type: 'text', text });
    else this.messages.push({ role: 'user', content: text });
  }
}

export const claudeProvider: AssistantProvider = {
  startSession: opts => new ClaudeSession(opts),
};
