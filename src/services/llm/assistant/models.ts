/**
 * The models Lumen AI can run on. The member picks provider + model in the app; anything not in
 * this list is refused. Prices are USD per million tokens (Claude: Anthropic list price,
 * cached 2026-11-03; Gemini: free tier, so 0). Budgets are the whole answer's time limit,
 * including every tool round.
 */
import { config } from '../../../config';

export type AiProvider = 'gemini' | 'claude';

export interface AiModelInfo {
  id: string;
  provider: AiProvider;
  label: string;
  note: string;
  inputPerM: number;
  outputPerM: number;
  budgetMs: number;
}

export const GEMINI_DEFAULT_MODEL = 'gemini-3.1-flash-lite';
export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5';

const CATALOG: AiModelInfo[] = [
  { id: 'gemini-3.1-flash-lite', provider: 'gemini', label: 'Gemini 3.1 Flash-Lite', note: 'Free · fast · the default', inputPerM: 0, outputPerM: 0, budgetMs: 60_000 },
  { id: 'gemini-3.5-flash-lite', provider: 'gemini', label: 'Gemini 3.5 Flash-Lite', note: 'Free · fast · newer', inputPerM: 0, outputPerM: 0, budgetMs: 60_000 },
  { id: 'gemini-3.5-flash', provider: 'gemini', label: 'Gemini 3.5 Flash', note: 'Free · thinks longer · can be very slow', inputPerM: 0, outputPerM: 0, budgetMs: 150_000 },
  { id: 'claude-opus-5-5', provider: 'claude', label: 'Claude Opus 5.5', note: 'Paid · very capable · the Claude default', inputPerM: 4, outputPerM: 20, budgetMs: 120_000 },
  { id: 'claude-sonnet-5-5', provider: 'claude', label: 'Claude Sonnet 5.5', note: 'Paid · capable · about half the cost of Opus', inputPerM: 2, outputPerM: 10, budgetMs: 90_000 },
  { id: 'claude-haiku-5-5', provider: 'claude', label: 'Claude Haiku 5.5', note: 'Paid · fastest · cheapest', inputPerM: 0.1, outputPerM: 0.5, budgetMs: 60_000 },
  { id: 'claude-fable-5-2', provider: 'claude', label: 'Claude Fable 5.2', note: 'Paid · most capable · slowest and most expensive', inputPerM: 8, outputPerM: 40, budgetMs: 180_000 },
];

export function isProviderConfigured(provider: AiProvider): boolean {
  return provider === 'gemini' ? !!config.gemini.apiKey : !!config.anthropic.apiKey;
}

/** The catalog, plus GEMINI_ASSISTANT_MODEL if the server owner set one that isn't listed. */
export function listModels(): AiModelInfo[] {
  const envModel = config.gemini.assistantModel;
  if (envModel && !CATALOG.some(m => m.id === envModel)) {
    return [{ id: envModel, provider: 'gemini', label: envModel, note: 'Set on the server (GEMINI_ASSISTANT_MODEL)', inputPerM: 0, outputPerM: 0, budgetMs: 60_000 }, ...CATALOG];
  }
  return CATALOG;
}

export function findModel(id: string | undefined | null): AiModelInfo | undefined {
  return id ? listModels().find(m => m.id === id) : undefined;
}

export function defaultModelFor(provider: AiProvider): AiModelInfo {
  const id = provider === 'gemini' ? config.gemini.assistantModel || GEMINI_DEFAULT_MODEL : CLAUDE_DEFAULT_MODEL;
  return findModel(id) ?? listModels().find(m => m.provider === provider)!;
}

/**
 * What the member's next answer runs on. A choice that is unknown or whose provider has no key
 * falls back to the Gemini default; `fellBack` says so, so the reply can mention it.
 */
export function resolveModel(prefs: { aiProvider?: string; aiModel?: string } | undefined): { model: AiModelInfo; fellBack: boolean } {
  const wanted = findModel(prefs?.aiModel);
  if (wanted && isProviderConfigured(wanted.provider)) return { model: wanted, fellBack: false };
  const fallback = defaultModelFor('gemini');
  return { model: fallback, fellBack: !!prefs?.aiModel && prefs.aiModel !== fallback.id };
}

export function estimateUsd(model: AiModelInfo, inputTokens: number, outputTokens: number): number {
  return (inputTokens * model.inputPerM + outputTokens * model.outputPerM) / 1_000_000;
}
