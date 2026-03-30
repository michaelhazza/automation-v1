import type { LLMProviderAdapter, ProviderCallParams, ProviderResponse } from './types.js';

// ---------------------------------------------------------------------------
// Gemini provider adapter — stub
// Implement when GEMINI_API_KEY is configured and the provider is needed.
// The router, billing, and budget systems require zero changes to enable this.
// ---------------------------------------------------------------------------

const geminiAdapter: LLMProviderAdapter = {
  provider: 'gemini',

  async call(_params: ProviderCallParams): Promise<ProviderResponse> {
    throw { statusCode: 501, code: 'PROVIDER_NOT_IMPLEMENTED', provider: 'gemini', message: 'Gemini adapter not yet implemented. Configure GEMINI_API_KEY and implement this adapter.' };
  },
};

export default geminiAdapter;
