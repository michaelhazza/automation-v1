import { env } from '../../lib/env.js';
import type { LLMProviderAdapter, ProviderCallParams, ProviderResponse } from './types.js';
import { assertCalledFromRouter } from './callerAssert.js';
import { mapAbortError, mapHttp499, isAbortError } from './adapterErrors.js';

// ---------------------------------------------------------------------------
// Anthropic provider adapter
// Wraps the existing fetch-based call pattern from llmService.ts
//
// Rev §6 observability:
//   - `params.signal` is threaded through fetch so AbortController from the
//     caller actually terminates the underlying HTTP request (previously a
//     Promise.race() abandoned the fetch but didn't cancel it — see §2.3).
//   - AbortError is mapped to 499 CLIENT_DISCONNECTED with abortReason
//     preserved (caller_timeout vs caller_cancel per AbortSignal.reason).
//   - HTTP 499 from upstream (rare for direct Anthropic, possible via proxies)
//     maps to the same error shape with abortReason = null.
// ---------------------------------------------------------------------------

const anthropicAdapter: LLMProviderAdapter = {
  provider: 'anthropic',

  async call(params: ProviderCallParams): Promise<ProviderResponse> {
    assertCalledFromRouter();

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw { statusCode: 503, code: 'PROVIDER_NOT_CONFIGURED', provider: 'anthropic', message: 'ANTHROPIC_API_KEY is not set' };
    }

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.7,
      messages: params.messages,
    };

    // Prompt caching: multi-breakpoint when structured, single-breakpoint for plain string
    if (params.system) {
      if (typeof params.system === 'object') {
        body.system = [
          { type: 'text', text: params.system.stablePrefix, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: params.system.dynamicSuffix },
        ];
      } else {
        body.system = [
          { type: 'text', text: params.system, cache_control: { type: 'ephemeral' } },
        ];
      }
    } else {
      body.system = '';
    }

    // Prompt caching: mark last tool definition for cache_control
    if (params.tools && params.tools.length > 0) {
      const toolsCopy = params.tools.map((t, i) =>
        i === params.tools!.length - 1
          ? { ...t, cache_control: { type: 'ephemeral' } }
          : t,
      );
      body.tools = toolsCopy;
    }

    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: params.signal,
      });
    } catch (err) {
      if (isAbortError(err)) throw mapAbortError('anthropic', params.signal);
      throw err;
    }

    // Extract provider request ID from headers (invaluable for Anthropic support tickets)
    const providerRequestId = response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? '';

    if (!response.ok) {
      let errorDetail = '';
      try {
        const err = await response.json() as { error?: { message?: string } };
        errorDetail = err?.error?.message ?? response.statusText;
      } catch {
        errorDetail = response.statusText;
      }

      if (response.status === 499) {
        throw mapHttp499('anthropic', errorDetail);
      }

      if (response.status === 503 || response.status === 529) {
        throw { statusCode: 503, code: 'PROVIDER_UNAVAILABLE', provider: 'anthropic', message: `Anthropic unavailable: ${errorDetail}` };
      }

      throw { statusCode: response.status >= 500 ? 503 : 400, message: `Anthropic API error: ${errorDetail}`, code: 'PROVIDER_ERROR' };
    }

    const data = await response.json() as {
      id: string;
      content: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      stop_reason: string;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };

    const textBlock = data.content.find((b) => b.type === 'text');
    const toolUseBlocks = data.content.filter((b) => b.type === 'tool_use');

    return {
      content: textBlock?.text ?? '',
      toolCalls: toolUseBlocks.length > 0
        ? toolUseBlocks.map((b) => ({ id: b.id!, name: b.name!, input: b.input! }))
        : undefined,
      stopReason: data.stop_reason,
      tokensIn:   data.usage.input_tokens,
      tokensOut:  data.usage.output_tokens,
      cachedPromptTokens: data.usage.cache_read_input_tokens ?? 0,
      providerRequestId: data.id ?? providerRequestId,
    };
  },
};

export default anthropicAdapter;

// ---------------------------------------------------------------------------
// Token counting — standalone helper, NOT on the routeCall path.
// Called by referenceDocumentService at document create / update-content time
// to pre-compute per-model-family token counts stored on version rows.
// ---------------------------------------------------------------------------

const SUPPORTED_MODEL_FAMILIES = [
  'anthropic.claude-sonnet-4-6',
  'anthropic.claude-opus-4-7',
  'anthropic.claude-haiku-4-5',
] as const;

export type SupportedModelFamily = typeof SUPPORTED_MODEL_FAMILIES[number];

// Maps our model-family identifiers to the Anthropic model IDs used for token counting.
const MODEL_FAMILY_TO_ANTHROPIC_MODEL: Record<SupportedModelFamily, string> = {
  'anthropic.claude-sonnet-4-6': 'claude-sonnet-4-6',
  'anthropic.claude-opus-4-7': 'claude-opus-4-7',
  'anthropic.claude-haiku-4-5': 'claude-haiku-4-5-20251001',
};

/**
 * Counts tokens for a text string against one model family using the
 * Anthropic count_tokens endpoint. Throws CACHED_CONTEXT_DOC_TOKEN_COUNT_FAILED
 * on upstream error — callers roll back the whole operation.
 */
export async function countTokens(args: {
  modelFamily: SupportedModelFamily;
  content: string;
}): Promise<number> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw { statusCode: 503, code: 'PROVIDER_NOT_CONFIGURED', message: 'ANTHROPIC_API_KEY is not set' };
  }

  const model = MODEL_FAMILY_TO_ANTHROPIC_MODEL[args.modelFamily];
  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: args.content }],
      }),
    });
  } catch (err) {
    throw {
      statusCode: 502,
      code: 'CACHED_CONTEXT_DOC_TOKEN_COUNT_FAILED',
      message: `Token count request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errBody = await response.json() as { error?: { message?: string } };
      errorDetail = errBody?.error?.message ?? response.statusText;
    } catch {
      errorDetail = response.statusText;
    }
    throw {
      statusCode: 502,
      code: 'CACHED_CONTEXT_DOC_TOKEN_COUNT_FAILED',
      message: `Token count API error: ${errorDetail}`,
    };
  }

  const data = await response.json() as { input_tokens: number };
  return data.input_tokens;
}

export { SUPPORTED_MODEL_FAMILIES };
