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

// Token-level streaming chunk emitted by adapters that support SSE
// (Anthropic Messages API, OpenAI Responses API, OpenRouter upstream).
// Deferred-items brief §5: kept deliberately minimal — the router uses
// this to drive the in-flight progress event, not to accumulate the
// full response (the adapter still returns the complete ProviderResponse
// on stream exhaustion). Adapters that don't implement streaming fall
// back to `call()` as today.
export interface StreamTokenChunk {
  /** Incremental token text, if any. May be empty on tool-start / tool-end chunks. */
  deltaText?:   string;
  /** Total tokens generated so far, if the provider surfaces this mid-stream. */
  tokensSoFar?: number;
}

export interface LLMProviderAdapter {
  readonly provider: string;
  call(params: ProviderCallParams): Promise<ProviderResponse>;
  /**
   * Optional streaming hook. Adapters that implement this emit
   * `StreamTokenChunk`s as tokens arrive; the router listens, throttles,
   * and forwards progress events to the in-flight registry. On stream
   * exhaustion, adapters MUST return the same complete `ProviderResponse`
   * shape as `call()` — the ledger write path doesn't branch on stream
   * vs non-stream.
   *
   * The adapter is responsible for bounding its own buffers — see the
   * brief §5 tripwires for per-stream and per-process caps.
   */
  stream?(params: ProviderCallParams): AsyncIterable<StreamTokenChunk> & {
    /** Awaitable handle for the final response, resolved when the stream ends. */
    done: Promise<ProviderResponse>;
  };
}
