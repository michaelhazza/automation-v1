import { env } from '../../lib/env.js';
import type { LLMProviderAdapter, ProviderCallParams, ProviderResponse, ProviderContentBlock } from './types.js';

// ---------------------------------------------------------------------------
// Gemini provider adapter
// Maps our provider interface to Google's Gemini generateContent API.
// ---------------------------------------------------------------------------

const geminiAdapter: LLMProviderAdapter = {
  provider: 'gemini',

  async call(params: ProviderCallParams): Promise<ProviderResponse> {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      throw { statusCode: 503, code: 'PROVIDER_NOT_CONFIGURED', provider: 'gemini', message: 'Gemini adapter not configured. Set GEMINI_API_KEY.' };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${apiKey}`;

    const body: Record<string, unknown> = {
      contents: toGeminiContents(params.messages),
      generationConfig: {
        maxOutputTokens: params.maxTokens ?? 4096,
        temperature: params.temperature ?? 0.7,
      },
    };

    if (params.system) {
      const systemText = typeof params.system === 'object'
        ? params.system.stablePrefix + params.system.dynamicSuffix
        : params.system;
      body.systemInstruction = { parts: [{ text: systemText }] };
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = [{
        functionDeclarations: params.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      }];
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorDetail = '';
      try {
        const err = await response.json() as { error?: { message?: string } };
        errorDetail = err?.error?.message ?? response.statusText;
      } catch {
        errorDetail = response.statusText;
      }

      if (response.status === 503 || response.status === 529) {
        throw { statusCode: 503, code: 'PROVIDER_UNAVAILABLE', provider: 'gemini', message: `Gemini unavailable: ${errorDetail}` };
      }

      throw { statusCode: response.status >= 500 ? 503 : 400, message: `Gemini API error: ${errorDetail}`, code: 'PROVIDER_ERROR' };
    }

    const data = await response.json() as GeminiResponse;
    return fromGeminiResponse(data);
  },
};

// ---------------------------------------------------------------------------
// Message translation: our format → Gemini format
// ---------------------------------------------------------------------------

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: unknown } };

function toGeminiContents(messages: ProviderCallParams['messages']): GeminiContent[] {
  const result: GeminiContent[] = [];

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (typeof msg.content === 'string') {
      result.push({ role, parts: [{ text: msg.content }] });
      continue;
    }

    const parts: GeminiPart[] = [];
    for (const block of msg.content as ProviderContentBlock[]) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'tool_use') {
        parts.push({ functionCall: { name: block.name, args: block.input } });
      } else if (block.type === 'tool_result') {
        // Gemini expects functionResponse with the tool name; we only have tool_use_id.
        // Pass the content as the response object.
        parts.push({
          functionResponse: {
            name: block.tool_use_id, // best-effort — Gemini uses name, we have id
            response: { result: block.content },
          },
        });
      }
    }

    if (parts.length > 0) {
      result.push({ role, parts });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Response translation: Gemini format → our format
// ---------------------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{
    content: { parts: GeminiPart[] };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    cachedContentTokenCount?: number;
  };
}

function fromGeminiResponse(data: GeminiResponse): ProviderResponse {
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  const textParts = parts
    .filter((p): p is { text: string } => 'text' in p)
    .map(p => p.text);

  const toolCalls = parts
    .filter((p): p is { functionCall: { name: string; args: Record<string, unknown> } } => 'functionCall' in p)
    .map((p, i) => ({
      id: `gemini-tc-${i}`,
      name: p.functionCall.name,
      input: p.functionCall.args,
    }));

  return {
    content:            textParts.join('\n'),
    toolCalls:          toolCalls.length > 0 ? toolCalls : undefined,
    stopReason:         candidate?.finishReason ?? 'unknown',
    tokensIn:           data.usageMetadata?.promptTokenCount ?? 0,
    tokensOut:          data.usageMetadata?.candidatesTokenCount ?? 0,
    cachedPromptTokens: data.usageMetadata?.cachedContentTokenCount ?? 0,
    providerRequestId:  '',
  };
}

export default geminiAdapter;
