import type { LLMProviderAdapter } from './types.js';
import anthropicAdapter from './anthropicAdapter.js';
import openaiAdapter from './openaiAdapter.js';
import geminiAdapter from './geminiAdapter.js';

// ---------------------------------------------------------------------------
// Provider registry — the single source of truth for available adapters.
// To add a new provider: implement LLMProviderAdapter, import it, register it.
// ---------------------------------------------------------------------------

const registry: Record<string, LLMProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai:    openaiAdapter,
  gemini:    geminiAdapter,
};

export function getProviderAdapter(provider: string): LLMProviderAdapter {
  const adapter = registry[provider];
  if (!adapter) {
    throw {
      statusCode: 400,
      code: 'PROVIDER_NOT_SUPPORTED',
      provider,
      message: `Provider '${provider}' is not supported. Supported: ${Object.keys(registry).join(', ')}`,
    };
  }
  return adapter;
}

export function getSupportedProviders(): string[] {
  return Object.keys(registry);
}
