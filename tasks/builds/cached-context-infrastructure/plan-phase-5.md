# Phase 5 — Ledger attribution + HITL block path

**Spec anchors:** §10 Phase 5 · §4.5 HITL payload · §5.9 llm_requests additions · §6.6 router write-through · §11.2 integration test
**Migrations:** 0210 (`llm_requests` columns)
**Pre-condition:** Phases 1–4 merged. Orchestrator works end-to-end with stubbed router output. `agent_runs` columns exist.

## Purpose

Land the cost ledger's two new columns (`cache_creation_tokens`, `prefix_hash`) so the router can persist cache attribution. Register the `cached_context_budget_breach` action type so HITL rendering works in the review queue. Wire the `anthropicAdapter` response handler to populate both cache-token columns, plus the `prefixHash` write-through. Add the one integration test asserting the full pipeline.

Exit state: a successful run writes a `llm_requests` row with non-zero `cache_read_input_tokens` or `cache_creation_input_tokens` and a non-null `prefix_hash`. A budget-breach run creates an `actions` row with the structured payload and the review-queue renderer resolves it via the registered handler.

## Chunked deliverables

- Chunk 5.1 — Migration 0210 + `llmRequests.ts` schema diff
- Chunk 5.2 — `actionRegistry` entry for `cached_context_budget_breach`
- Chunk 5.3 — Router + adapter cache-attribution write-through
- Chunk 5.4 — Integration test `cachedContextOrchestrator.integration.test.ts`

### Chunk 5.1 — Migration 0210 + `llmRequests.ts` schema diff

- Create `migrations/0210_llm_requests_cached_context.sql` per §5.9:
  - `ALTER TABLE llm_requests ADD COLUMN cache_creation_tokens integer NOT NULL DEFAULT 0;`
  - `ALTER TABLE llm_requests ADD COLUMN prefix_hash text;`
  - `CREATE INDEX llm_requests_prefix_hash_idx ON llm_requests (prefix_hash) WHERE prefix_hash IS NOT NULL;`
- Update `server/db/schema/llmRequests.ts` with the two new columns.
- No new RLS policy — `llm_requests` already has its policy from the existing ledger surface.

### Chunk 5.2 — `actionRegistry` entry for `cached_context_budget_breach`

- Modify `server/config/actionRegistry.ts`:
  - Register `cached_context_budget_breach` with a Zod schema matching `HitlBudgetBlockPayload` (§4.5).
  - `gateLevel: 'block'` by default.
  - `actionScope: 'subaccount'` per §15 Q4 decision.
- No code change to `actionService.ts` — the service already accepts arbitrary action types; the registry is config-only.
- Verify the existing HITL review-queue renderer resolves the new action type without additional wiring (it should, since it looks up by `actionType` in the registry).

### Chunk 5.3 — Router + adapter cache-attribution write-through

- Modify `server/services/llmRouter.ts`:
  - Enable `prefixHash` write-through: when `prefixHash` is supplied on `routeCall`, write it to `llm_requests.prefix_hash` at row insert time. Remove the Phase 4 TODO + discard branch.
- Modify `server/services/providers/anthropicAdapter.ts`:
  - Capture `response.usage.cache_creation_input_tokens` and return it alongside `cache_read_input_tokens` in the adapter's normalized response shape. The existing `cache_read_input_tokens` capture path is already in place (see `anthropicAdapter.ts` lines 38–62 per §Related artefacts); add a parallel capture for creation.
- Modify the router's `llm_requests` insert path:
  - Populate `cachedPromptTokens = cache_read_input_tokens` (existing).
  - Populate `cacheCreationTokens = cache_creation_input_tokens` (new).
  - Populate `prefixHash = routeCall input` (new).
- Verify: non-cached-context calls continue to leave `prefix_hash` NULL and `cache_creation_tokens = 0` (the default). Dashboards filter on `WHERE prefix_hash IS NOT NULL` for cache-attribution queries.

### Chunk 5.4 — Integration test

Create `server/services/__tests__/cachedContextOrchestrator.integration.test.ts` per §11.2 (declared carve-out — DB-backed, stubs only `anthropicAdapter.call`).

Seven-step flow:

1. Seed: org, subaccount, 3 reference documents, 1 bundle with all 3 as members, 1 attachment to a synthetic task.
2. Stub `anthropicAdapter.call` to return a canned response with `cache_creation_input_tokens=1000, cache_read_input_tokens=0`.
3. Invoke `cachedContextOrchestrator.execute` with a fixture variable input.
4. Assert: `bundle_resolution_snapshots` row created (count = 1); `agent_runs` row has `bundle_snapshot_ids` JSONB (length 1), `variable_input_hash` non-null, `run_outcome='completed'`, `degraded_reason` NULL; `llm_requests` row has `prefix_hash` non-null (call-level assembled hash per §4.4) and `cache_creation_tokens=1000`.
5. Second invocation with identical inputs. Stub returns `cache_creation_input_tokens=0, cache_read_input_tokens=1000`. Assert: same snapshot row (no new insert — dedup by `(bundle_id, prefix_hash)`); `run_outcome='completed'`; the new `llm_requests` row has `cachedPromptTokens=1000` and `prefix_hash` equal to the first call's.
6. Third invocation with budget-breach setup (e.g. task config narrows `maxInputTokens` below the assembled prefix size). Stub NEVER called. Assert: `actions` row created with `actionType='cached_context_budget_breach'`, `gateLevel='block'`, `payloadJson` matching `HitlBudgetBlockPayload` shape.
7. Fourth invocation: approve the block (simulated via `hitlService` test helper) but leave bundle unchanged so re-assembly still breaches. Assert: `run_outcome='failed'`, `failureReason='hitl_second_breach'`, stub never called — exercises the one-retry cap (§6.6 step 4).

This is one of the two declared §11.5 carve-outs from `pure_function_only`. No API-contract tests, no supertest, no playwright.

## Acceptance (Phase 5 complete)

- [ ] Migration 0210 applies cleanly.
- [ ] `npm run db:generate` produces no diff after `llmRequests.ts` changes.
- [ ] `cachedContextOrchestrator.integration.test.ts` passes all seven assertion steps from §11.2.
- [ ] `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` green.
- [ ] Manual smoke: run the orchestrator twice within 1 hour against the same bundle + variable input; second call's `llm_requests` row shows non-zero `cache_read_input_tokens`. Deliberate budget-breach test blocks at HITL and renders via the action registry.
- [ ] `npm run typecheck` + `npm run lint` green.
- [ ] `spec-conformance` Phase 5 subset clean. `pr-reviewer` clean.

## Out of scope for Phase 5

- Pilot task configuration (Phase 6).
- `bundleUtilizationJob` schedule enablement (Phase 6).
- `architecture.md` + `docs/capabilities.md` documentation sync (Phase 6).
- Any UI rendering of HITL block UX — the action registry entry is the backend contract; UI lives in whichever page consumes the review queue (already existing from Universal Brief).
