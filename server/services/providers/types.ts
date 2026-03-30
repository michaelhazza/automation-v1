// ---------------------------------------------------------------------------
// Provider adapter interface — every LLM provider implements this
// Adding a new provider: implement this interface, register in registry.ts
// ---------------------------------------------------------------------------

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string | ProviderContentBlock[];
}

export type ProviderContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface ProviderTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

export interface ProviderCallParams {
  model:        string;
  messages:     ProviderMessage[];
  system?:      string;
  tools?:       ProviderTool[];
  maxTokens?:   number;
  temperature?: number;
}

export interface ProviderResponse {
  content:           string;
  toolCalls?:        Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason:        string;
  tokensIn:          number;
  tokensOut:         number;
  providerRequestId: string;
}

export interface LLMProviderAdapter {
  readonly provider: string;
  call(params: ProviderCallParams): Promise<ProviderResponse>;
}
