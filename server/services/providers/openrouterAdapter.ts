import { env } from '../../lib/env.js';
import type { LLMProviderAdapter, ProviderCallParams, ProviderResponse } from './types.js';
import { toOpenAIMessages, toOpenAITools, fromOpenAIResponse, buildOpenAIRequestBody } from './openaiFormat.js';
import { assertCalledFromRouter } from './callerAssert.js';
import { mapAbortError, mapHttp499, isAbortError } from './adapterErrors.js';

// ---------------------------------------------------------------------------
// OpenRouter provider adapter
// OpenAI-compatible API with different base URL and auth.
// Reuses shared openaiFormat utilities.
// See anthropicAdapter.ts for the observability contract (signal + 499 + abort).
// ---------------------------------------------------------------------------

const openrouterAdapter: LLMProviderAdapter = {
  provider: 'openrouter',

  async call(params: ProviderCallParams): Promise<ProviderResponse> {
    assertCalledFromRouter();

    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw { statusCode: 503, code: 'PROVIDER_NOT_CONFIGURED', provider: 'openrouter', message: 'OpenRouter adapter not configured. Set OPENROUTER_API_KEY.' };
    }

    const messages = toOpenAIMessages(params.messages, params.system);
    const tools = params.tools ? toOpenAITools(params.tools) : undefined;
    const body = buildOpenAIRequestBody({
      model: params.model,
      messages,
      tools,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });

    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://automationos.app',
          'X-Title': 'Automation OS',
        },
        body: JSON.stringify(body),
        signal: params.signal,
      });
    } catch (err) {
      if (isAbortError(err)) throw mapAbortError('openrouter', params.signal);
      throw err;
    }

    const providerRequestId = response.headers.get('x-request-id') ?? '';

    if (!response.ok) {
      let errorDetail: string;
      try {
        const err = await response.json() as { error?: { message?: string } };
        errorDetail = err?.error?.message ?? response.statusText;
      } catch {
        errorDetail = response.statusText;
      }

      if (response.status === 499) {
        throw mapHttp499('openrouter', errorDetail);
      }

      if (response.status === 503 || response.status === 529) {
        throw { statusCode: 503, code: 'PROVIDER_UNAVAILABLE', provider: 'openrouter', message: `OpenRouter unavailable: ${errorDetail}` };
      }

      throw { statusCode: response.status >= 500 ? 503 : 400, message: `OpenRouter API error: ${errorDetail}`, code: 'PROVIDER_ERROR' };
    }

    const data = await response.json();
    return fromOpenAIResponse(data, providerRequestId);
  },
};

export default openrouterAdapter;
