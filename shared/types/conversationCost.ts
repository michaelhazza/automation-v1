// ---------------------------------------------------------------------------
// Conversation cost API response shape — Chunk B cost/token meter.
//
// GET /api/agents/:id/conversations/:convId/cost returns this shape.
// Values are sourced directly from agent_messages.cost_cents / tokens_in /
// tokens_out columns populated by conversationService.sendMessage().
// Returns zero-defaults (not 404) when the conversation exists but has no
// cost data yet (e.g. pre-migration messages or brand-new conversations).
// ---------------------------------------------------------------------------

export interface ConversationCostModelBreakdown {
  modelId: string;
  costCents: number;
  tokensIn: number;
  tokensOut: number;
  messageCount: number;
}

export interface ConversationCostResponse {
  conversationId: string;
  totalCostCents: number;
  totalTokensIn: number;
  totalTokensOut: number;
  /** Sum of tokensIn + tokensOut */
  totalTokens: number;
  messageCount: number;
  /** Sorted by costCents DESC */
  modelBreakdown: ConversationCostModelBreakdown[];
  /** ISO timestamp when this response was computed */
  computedAt: string;
}
