# Progress — fix-route-db-support-agent

## Phase 2 (BUILD) — in flight

**Branch:** `claude/fix-route-db-support-agent`
**Spec:** `tasks/builds/fix-route-db-support-agent/spec.md`
**Branch HEAD at start:** `76377549` (origin/main, fresh fork)
**Started:** 2026-05-15
**Task class:** Standard

## Caller sweep (chunk-0 inputs, pre-architect)

Recorded by main session at S1 sync, before invoking architect.

### 1. Exports from `server/routes/support/supportAgentRoutes.ts`
- **Finding:** file exports only `export default router` (line 134). No named helpers are exported. No other file imports inline helpers from it.
- **Conclusion:** caller sweep is a no-op for inline helpers, as expected by the spec §8.

### 2. Gate baseline state for `verify-no-db-in-routes.sh`
- **Finding:** `scripts/.gate-baselines/no-db-in-routes.txt` is empty (header comments only — zero violation entries).
- **Current gate state:** `bash scripts/verify-no-db-in-routes.sh` exits 0 with 0 violations.
- **Root cause:** the gate's regex `import.*db.*from.*['"].*\/db` only matches imports of the literal `db` symbol, not schema-table imports. `import { canonicalInboxes } from '../../db/schema/index.js'` does not contain "db" between `import` and `from`, so the gate does not flag this file.
- **Spec impact:** §6.4 "no longer contains an entry for supportAgentRoutes.ts" is a no-op. §6.7 "verify-no-db-in-routes.sh exits 0" is already satisfied. The architectural breach is real (schema imports in route file) but the script does not detect it.
- **Decision required (raised at plan-gate):** keep the build as a route-layering hygiene fix even though the gate technically passes today.

### 3. `requireOrgPermission(AGENTS_VIEW)` consistency in `server/routes/agents.ts`
- **Finding:** all sibling routes use `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` (line 29, 66, 379, etc.). Pattern is consistent. F5 addition matches the established style.
- **However:** `GET /api/agents` (line 41) has two branches:
  - `ownerScope=user` → returns caller's own agents only (comment line 38 explicitly says "always allowed").
  - default → returns org-scoped list filtered by `AGENTS_EDIT` permission via `listAllAgents` vs `listAgents`.
- **Behaviour-change risk:** blanket `requireOrgPermission(AGENTS_VIEW)` middleware blocks branch (a) for callers without AGENTS_VIEW. Spec §6 says "no behaviour change visible to callers" — this contradicts the spec.
- **Decision required (raised at plan-gate):** blanket gate vs conditional gate vs accept the spec-deviation that F5 changes branch (a) behaviour.

### 4. Pre-existing service: `server/services/supportInboxService.ts`
- **Finding:** the service already exists (208 LOC, spec `tasks/builds/support-desk-canonical/spec.md §5.1.A`) with exports:
  - `listInboxes(principalCtx)` — already returns the inbox + sync-health shape the dashboard GET needs (with extra fields).
  - `getInbox(inboxId, principalCtx)` — read-by-id helper.
  - `updateAgentConfig(inboxId, config, principalCtx)` — already runs `SupportInboxAgentConfigSchema.parse` and updates with `getOrgScopedDb`.
- **Predecessor prompt** at `tasks/builds/support-agent-routes-service-extract-2026-05-14/prompt.md` explicitly recommends delegating to the existing service instead of creating `supportAgentInboxService.ts`.
- **Decision required (raised at plan-gate):** delegate to existing `supportInboxService` (DRY, recommended) vs create a parallel `supportAgentInboxService` (per spec literal).

## Environment snapshot
- last_chunk_committed: (none yet — pre-architect)
- head: 76377549101b331f2d07d73972f0596bfbcb4fb1
- captured_at: 2026-05-15T00:00:00Z

---

## Phase 2 (BUILD) — complete

**Completed:** 2026-05-15  
**Chunks shipped:** 1–5 (6 commits on branch)

### Commits
- `8994d773` feat(chunk1): extend listInboxes with activeOnly flag + test
- `9378ae15` fix(chunk1): tighten activeOnly conditional-gate regex to prevent false positives
- `5e7e2db3` feat(chunk2): migrate GET handler to use listInboxes service + fix makePrincipal async
- `b93ae7b8` feat(chunk3): migrate PATCH handler to use service + add deep-merge tests
- `4382de82` feat(chunk4): remove canonicalInboxes schema import from supportAgentRoutes
- `55488157` feat(chunk5): F5 — add AGENTS_VIEW gate to GET /api/agents default branch

### Spec-deviations applied
- **Q1** — Delegated to existing `supportInboxService.ts` instead of creating `supportAgentInboxService.ts`. Added optional `{ activeOnly?: boolean }` flag to `listInboxes`. Record: `spec_deviations: delegate to supportInboxService rather than create supportAgentInboxService — existing service covers the contract; one optional flag added to listInboxes`.
- **Q2** — Gate-baseline edit was a no-op. `scripts/.gate-baselines/no-db-in-routes.txt` is already empty; `verify-no-db-in-routes.sh` exits 0 today and stays 0. The architectural breach (`import { canonicalInboxes } from '../../db/schema/...'`) is now removed by Chunk 4. No baseline file was edited.
- **Q3** — F5 option β applied: conditional `hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_VIEW)` check inside the default branch of `GET /api/agents`, gated after the `ownerScope=user` short-circuit. The "always allowed" guarantee for `ownerScope=user` is preserved. The F5 audit comment block was removed.

### Behaviour-delta note
`makePrincipal` in `supportAgentRoutes.ts` now uses `resolveSubaccount(req.params.subaccountId, req.orgId!)` and sets `subaccountId: subaccount.id` (was always `null`). This correctly scopes results to the subaccount matching the mount-path parameter. The old route was unreachable at its mount path from any current client URL (client paths `/api/support/agent/dashboard` and `/api/support/inboxes/.../agent-config` do not match the mount `/api/subaccounts/:subaccountId/support`), so no production caller is affected.

### Pre-existing client URL bug (surfaced in Chunk 2, not fixed here)
The current client calls `/api/support/agent/dashboard` and `/api/support/inboxes/.../agent-config` but the route is mounted at `/api/subaccounts/:subaccountId/support/...`. No current client path reaches these handlers. Routed to `tasks/todo.md` as a separate ticket per CLAUDE.md §6 "Surface, don't smuggle."

### Test coverage note
Chunk 3's test file (`supportAgentRoutes.test.ts`) covers the deep-merge pure logic (4 cases) and structural service-delegation assertions. The plan §Chunk 3 also listed 404/422/403 path tests; these were deferred per `docs/testing-conventions.md §"Things explicitly NOT in scope"` (route-level integration tests discouraged in this phase). The service-level tests in `supportInboxService.activeOnly.test.ts` and the pure-function gate tests in `agentsRouteF5.test.ts` cover the critical invariants.

## Closure text for finalisation-coordinator

After PR number is known, `finalisation-coordinator` applies these edits to `tasks/todo.md`:

- Route → DB layer breach (pre-v1 lockdown critical row, Track A):
  Find the row referencing `supportAgentRoutes.ts` direct DB access and append `[status:closed:pr:<PR#>]`

- Track A F5 row:
  Find the F5 row referencing `GET /api/agents` missing `requireOrgPermission(AGENTS_VIEW)` and append `[status:closed:pr:<PR#>]`
