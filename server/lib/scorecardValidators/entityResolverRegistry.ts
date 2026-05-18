// Entity-resolver registry for deterministic_external validators.
// Typed map from string key → async existence check.
// Validators accessing tenant data must use this registry; direct db/drizzle/pg
// imports are rejected by scripts/check-validator-isolation.ts.
// Deterministic-validators spec §6.4.
//
// Phase 1: no services in this codebase currently expose an existsById method,
// so the map ships empty. The cited_entity_exists validator (Chunk 4) tests
// against mocked resolvers only. Add entries here when real service methods land.
// Example shape when a resolver is available:
//   'customerService.existsById': (id, subaccountId) => customerService.existsById(id, subaccountId),

export const ENTITY_RESOLVERS: Record<
  string,
  (id: string, subaccountId: string) => Promise<boolean>
> = {};
