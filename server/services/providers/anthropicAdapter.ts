import { env } from '../../lib/env.js';
import type { LLMProviderAdapter, ProviderCallParams, ProviderResponse } from './types.js';

// ---------------------------------------------------------------------------
// Anthropic provider adapter
// Wraps the existing fetch-based call pattern from llmService.ts
// ---------------------------------------------------------------------------

const anthropicAdapter: LLMProviderAdapter = {
  provider: 'anthropic',

  async call(params: ProviderCallParams): Promise<ProviderResponse> {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw { statusCode: 503, code: 'PROVIDER_NOT_CONFIGURED', provider: 'anthropic' };
    }

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      temperature: params.temperature ?? 0.7,
      system: params.system ?? '',
      messages: params.messages,
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

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
      providerRequestId: data.id ?? providerRequestId,
    };
  },
};

export default anthropicAdapter;
