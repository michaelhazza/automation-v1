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
  system?:      string | { stablePrefix: string; dynamicSuffix: string };
  tools?:       ProviderTool[];
  maxTokens?:   number;
  temperature?: number;
  // Optional AbortSignal — threaded through fetch so the caller can cancel
  // a mid-flight provider call. When the signal fires, the adapter maps
  // the AbortError → { statusCode: 499, code: 'CLIENT_DISCONNECTED',
  // abortReason } using AbortSignal.reason to distinguish timeout vs cancel.
  // See spec §8.1.
  signal?:      AbortSignal;
}

export interface ProviderResponse {
  content:           string;
  toolCalls?:        Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason:        string;
  tokensIn:          number;
  tokensOut:         number;
  providerRequestId: string;
  cachedPromptTokens?: number;

  // Routing metadata — set by routeCall() (not provider adapters).
  // Consumed by agent loop for escalation decisions.
  routing?: {
    tier:           'frontier' | 'economy';
    wasDowngraded:  boolean;
    reason:         string;
  };
}

export interface LLMProviderAdapter {
  readonly provider: string;
  call(params: ProviderCallParams): Promise<ProviderResponse>;
}
