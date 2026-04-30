/**
 * Inline integration-setup card — shared types and state derivation.
 *
 * IntegrationCardContent is the payload stored in agent_messages.meta when
 * a run is paused waiting for an OAuth connection. The card renders inline
 * in the conversation and drives the popup OAuth flow.
 *
 * State is NOT stored — it is derived at read-time from the card fields and
 * the run's runMetadata. See deriveCardState() below.
 */

export interface IntegrationCardContent {
  kind: 'integration_card';
  schemaVersion: 1;
  integrationId: string;       // e.g. 'notion', 'slack'
  blockSequence: number;       // monotonic block counter for this run (1, 2, 3…)
  title: string;               // ≤ 80 chars
  description: string;         // ≤ 240 chars
  actionLabel: string;         // e.g. 'Connect Notion'
  actionUrl: string;           // OAuth start URL with ?resumeToken=…&conversationId=…
  resumeToken: string;         // plaintext bearer token; never stored in DB column
  expiresAt: string;           // ISO 8601; 24h after issue
  dismissed: boolean;          // ONLY client-side state in v1 (TODO: persist via PATCH endpoint)
}

export type MessageMeta =
  | IntegrationCardContent
  | { kind: 'reserved_for_future' };

// ---------------------------------------------------------------------------
// State derivation — NOT stored, computed at read time.
//
// 'dismissed'  → dismissed === true
// 'connected'  → blockSequence ∈ runMetadata.completedBlockSequences
// 'expired'    → !dismissed && expiresAt < now() && blockSequence not yet completed
// 'active'     → !dismissed && expiresAt >= now() && blockSequence === runMetadata.currentBlockSequence
// ---------------------------------------------------------------------------
export type IntegrationCardState = 'active' | 'dismissed' | 'expired' | 'connected';

export function deriveCardState(
  card: IntegrationCardContent,
  runMetadata: { completedBlockSequences?: number[]; currentBlockSequence?: number } | null,
): IntegrationCardState {
  if (card.dismissed) return 'dismissed';
  const completed = runMetadata?.completedBlockSequences ?? [];
  if (completed.includes(card.blockSequence)) return 'connected';
  if (new Date(card.expiresAt) < new Date()) return 'expired';
  return 'active';
}
