/**
 * What Lumen AI's tool loop (../assistant.ts) needs from a model provider. Each provider keeps
 * its own native transcript inside the session, so provider-specific pieces (Gemini thought
 * signatures, Claude thinking blocks) go back to the model unchanged between tool rounds.
 */
import type { ToolDeclaration } from '../dataTools';

export type AssistantError = 'not_configured' | 'bad_key' | 'rate_limited' | 'busy' | 'blocked' | 'timeout' | 'failed';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Claude prompt caching: tokens read from / written to the cache (billed at 0.1x / 1.25x). */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** A piece of the member's message: text, or an image (base64). */
export type InputPart = { type: 'text'; text: string } | { type: 'image'; mimeType: string; base64: string };

export interface HistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultInput {
  id: string;
  name: string;
  response: Record<string, unknown>;
  images?: { label: string; mimeType: string; base64: string }[];
}

export type StepResult =
  | { ok: true; text: string; calls: ToolCall[]; usage?: Usage }
  | { ok: false; error: AssistantError; detail?: string };

export type Effort = 'low' | 'medium' | 'high';

export interface SessionOptions {
  model: string;
  system: string;
  history: HistoryMessage[];
  userParts: InputPart[];
  tools: ToolDeclaration[];
  /** How hard the model should think (Claude effort; ignored by Gemini). */
  effort: Effort;
}

export interface AssistantSession {
  /** One model call. `withTools: false` makes the model answer from what it already has. */
  next(opts: { withTools: boolean; timeoutMs: number }): Promise<StepResult>;
  /** Results for every call the last step asked for, in one go. */
  addToolResults(results: ToolResultInput[]): void;
  /** An extra instruction from Lumen (e.g. "answer now"). */
  addUserText(text: string): void;
}

export interface AssistantProvider {
  startSession(opts: SessionOptions): AssistantSession;
}
