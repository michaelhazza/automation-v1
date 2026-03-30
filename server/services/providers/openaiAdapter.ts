import type { LLMProviderAdapter, ProviderCallParams, ProviderResponse } from './types.js';

// ---------------------------------------------------------------------------
// OpenAI provider adapter — stub
// Implement when OPENAI_API_KEY is configured and the provider is needed.
// The router, billing, and budget systems require zero changes to enable this.
// ---------------------------------------------------------------------------

const openaiAdapter: LLMProviderAdapter = {
  provider: 'openai',

  async call(_params: ProviderCallParams): Promise<ProviderResponse> {
    throw { statusCode: 501, code: 'PROVIDER_NOT_IMPLEMENTED', provider: 'openai', message: 'OpenAI adapter not yet implemented. Configure OPENAI_API_KEY and implement this adapter.' };
  },
};

export default openaiAdapter;
