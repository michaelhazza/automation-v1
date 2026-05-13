// RoutingContextV2 — personal-assistant-v2-operator spec §5.2
//
// Type-only: matcher behaviour ships in Chunk 2.
// HTTP-supplied target_owner_user_id values MUST be discarded before building
// this object — it is server-side-only.

export interface RoutingContextV2 {
  requester_user_id: string;
  /** Server-side-only; HTTP-supplied values must be discarded before building. */
  target_owner_user_id?: string;
  addressed_agent?: string;
  address_parse_result?: AddressParseResult;
  subaccountId: string;
  organisationId: string;
}

export type AddressParseKind = 'direct' | 'not_found' | 'collision' | 'unsupported_cross_owner';

export interface AddressParseResult {
  kind: AddressParseKind;
  /** Populated when kind is 'collision'. */
  candidates?: string[];
}
