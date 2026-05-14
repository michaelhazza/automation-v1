// RoutingContextV2 — personal-assistant-v2-operator spec §5.2
//
// Type-only: matcher behaviour ships in Chunk 2.
// HTTP-supplied target_owner_user_id values MUST be discarded before building
// this object — it is server-side-only.

export type AddressParseKind = 'matched' | 'not_found' | 'collision' | 'unsupported_cross_owner';

export interface RoutingContextV2 {
  requester_user_id: string;
  /** Server-side-only; HTTP-supplied values must be discarded before building. */
  target_owner_user_id?: string;
  /** Backward-compatible alias for normalised_intent_text. */
  intent: string;
  /** Unmodified input text. */
  raw_intent_text: string;
  /** After address extraction + stripping. */
  normalised_intent_text: string;
  /** null when no @address was parsed. */
  addressed_agent: { id: string; score_boost: number } | null;
  address_parse_result: AddressParseKind;
  subaccountId: string;
  organisationId: string;
}
