import type { AiProvider } from '../models';
import { claudeProvider } from './claude';
import { geminiProvider } from './gemini';
import type { AssistantProvider } from './types';

export function getProvider(provider: AiProvider): AssistantProvider {
  return provider === 'claude' ? claudeProvider : geminiProvider;
}
