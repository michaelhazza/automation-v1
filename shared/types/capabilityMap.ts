// CapabilityMapV2 — personal-assistant-v2-operator spec §5.1
//
// V2 extends V1 by adding owner_user_id. The field is optional so old rows
// without it remain valid (no migration required for existing data).
//
// The canonical runtime shape lives in capabilityMapService.ts (the service's
// internal CapabilityMap interface). This file documents the V2 JSONB
// extension shape for consumers outside the service.

export interface CapabilityMapV2 {
  computedAt: string;
  /**
   * The Integration Reference's `schema_meta.last_updated` value at the
   * moment this map was computed. May be absent on pre-V2 rows.
   */
  referenceLastUpdated?: string;
  integrations: string[];
  read_capabilities: string[];
  write_capabilities: string[];
  skills: string[];
  primitives: string[];
  /**
   * Set when this capability map belongs to a user-owned agent.
   * Used by the two-axis matcher rule (spec §5.2).
   */
  owner_user_id?: string;
}
