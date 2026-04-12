// ---------------------------------------------------------------------------
// Shared OpenAI-format message/tool translation utilities.
// Used by both openaiAdapter and openrouterAdapter (OpenAI-compatible API).
// ---------------------------------------------------------------------------

import type { ProviderMessage, ProviderContentBlock, ProviderTool, ProviderResponse } from './types.js';

// ---------------------------------------------------------------------------
// Types — OpenAI chat completion format
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Message translation: our format → OpenAI format
// ---------------------------------------------------------------------------

export function toOpenAIMessages(
  messages: ProviderMessage[],
  system?: string | { stablePrefix: string; dynamicSuffix: string },
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  if (system) {
    const systemText = typeof system === 'object'
      ? system.stablePrefix + system.dynamicSuffix
      : system;
    result.push({ role: 'system', content: systemText });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Content is an array of blocks
    const blocks = msg.content as ProviderContentBlock[];

    if (msg.role === 'assistant') {
      // Assistant message may contain text + tool_use blocks
      const textParts = blocks.filter((b): b is Extract<ProviderContentBlock, { type: 'text' }> => b.type === 'text');
      const toolUseParts = blocks.filter((b): b is Extract<ProviderContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');

      const openaiMsg: OpenAIMessage = {
        role: 'assistant',
        content: textParts.map(t => t.text).join('\n') || null,
      };

      if (toolUseParts.length > 0) {
        openaiMsg.tool_calls = toolUseParts.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input),
          },
        }));
      }

      result.push(openaiMsg);
    } else {
      // User message may contain text or tool_result blocks
      for (const block of blocks) {
        if (block.type === 'text') {
          result.push({ role: 'user', content: block.text });
        } else if (block.type === 'tool_result') {
          result.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: block.content,
          });
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool translation: our format → OpenAI format
// ---------------------------------------------------------------------------

export function toOpenAITools(tools: ProviderTool[]): OpenAITool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// ---------------------------------------------------------------------------
// Response translation: OpenAI format → our format
// ---------------------------------------------------------------------------

export function fromOpenAIResponse(data: OpenAIResponse, providerRequestId: string): ProviderResponse {
  const choice = data.choices[0];

  const toolCalls = choice?.message?.tool_calls?.map(tc => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  }));

  return {
    content:            choice?.message?.content ?? '',
    toolCalls:          toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    stopReason:         choice?.finish_reason ?? 'unknown',
    tokensIn:           data.usage.prompt_tokens,
    tokensOut:          data.usage.completion_tokens,
    cachedPromptTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
    providerRequestId:  data.id ?? providerRequestId,
  };
}

// ---------------------------------------------------------------------------
// Build the request body for OpenAI-compatible endpoints
// ---------------------------------------------------------------------------

export function buildOpenAIRequestBody(params: {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  maxTokens?: number;
  temperature?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    max_tokens: params.maxTokens ?? 4096,
    temperature: params.temperature ?? 0.7,
  };

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools;
  }

  return body;
}
