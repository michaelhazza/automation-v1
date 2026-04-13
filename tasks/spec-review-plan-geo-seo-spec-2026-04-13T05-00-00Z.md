# Spec Review Plan — geo-seo-spec

**Spec path:** `docs/geo-seo-spec.md`
**Spec commit hash at start of review:** `d3401cab3ba36b0813a1172c249bfd3a8a1f2775`
**Spec-context hash at start of review:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Expected iteration count cap (MAX_ITERATIONS):** 5
**Stopping heuristic:** Two consecutive mechanical-only rounds → stop before cap.

## Pre-loop context check

- Spec framing: "Draft — pending review", Classification: Significant, pre-production. No staged rollout language, no feature flags for new migration. Testing posture: pure function unit test included, no E2E/frontend tests. Consistent with spec-context.yaml framing.
- No context mismatch detected. Proceeding to iteration 1.

## Scope

- 8 GEO methodology skill files
- Action registry additions (methodology batch)
- Topic registry addition (`geo` topic)
- Schema + migration `0110`
- Service layer (geoAuditService + pure companion + unit tests)
- System agent + seed script
- Routes + permissions
- Doc updates (architecture.md, capabilities.md, KNOWLEDGE.md)
