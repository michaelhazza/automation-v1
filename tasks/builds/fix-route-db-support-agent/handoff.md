# Handoff — fix-route-db-support-agent

## Phase 2 (BUILD) — complete

**Completed:** 2026-05-15
**Branch:** `claude/fix-route-db-support-agent`
**Spec:** `tasks/builds/fix-route-db-support-agent/spec.md`
**Plan:** `tasks/builds/fix-route-db-support-agent/plan.md`
**Task class:** Standard
**PR number:** TBD (created in Phase 3)

### What shipped

Two bounded fixes:

1. **Route→DB breach fix** (`server/routes/support/supportAgentRoutes.ts`): all inline Drizzle DB calls and schema imports removed. Route now delegates to existing `supportInboxService.ts` (extended with `activeOnly` flag) via `listInboxes` and `getInbox` + `updateAgentConfig`. The `makePrincipal` helper was fixed to call `resolveSubaccount(req.params.subaccountId, req.orgId!)` via `Router({ mergeParams: true })` instead of hardcoding `subaccountId: null`.

2. **F5 permission gate** (`server/routes/agents.ts`): added conditional `hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_VIEW)` check inside the default branch of `GET /api/agents`, after the `ownerScope=user` short-circuit. The "always allowed" guarantee for `ownerScope=user` is preserved.

3. **Pure helper extracted**: `server/services/supportInboxConfigMergePure.ts` — `mergeAgentConfigPatch(existingConfig, patch)` eliminates deep-merge logic duplication between route and tests.

### Commits on branch

- `8994d773` feat(chunk1): extend listInboxes with activeOnly flag + test
- `9378ae15` fix(chunk1): tighten activeOnly conditional-gate regex to prevent false positives
- `5e7e2db3` feat(chunk2): migrate GET handler to use listInboxes service + fix makePrincipal async
- `b93ae7b8` feat(chunk3): migrate PATCH handler to use service + add deep-merge tests
- `4382de82` feat(chunk4): remove canonicalInboxes schema import from supportAgentRoutes
- `55488157` feat(chunk5): F5 — add AGENTS_VIEW gate to GET /api/agents default branch
- `d840a349` docs(chunk6): Phase 2 close summary + KNOWLEDGE.md patterns
- `de0b2bae` fix(adv-c1): getInbox subaccount predicate + ownerScope comment
- `558bf143` docs: branch-level review results + REVIEW_GAP

### Files changed (key)

- `server/routes/support/supportAgentRoutes.ts` — schema imports removed, handlers delegate to service
- `server/services/supportInboxService.ts` — extended with `activeOnly` flag + `getInbox` subaccount predicate
- `server/services/supportInboxConfigMergePure.ts` — new pure helper
- `server/routes/agents.ts` — F5 AGENTS_VIEW conditional gate
- `server/services/__tests__/supportInboxService.activeOnly.test.ts` — new tests
- `server/routes/support/__tests__/supportAgentRoutes.test.ts` — new tests
- `server/routes/__tests__/agentsRouteF5.test.ts` — new tests

### spec_deviations

- **Q1** — Delegated to existing `supportInboxService.ts` instead of creating `supportAgentInboxService.ts`. Added optional `{ activeOnly?: boolean }` flag to `listInboxes`. Record: `spec_deviations: delegate to supportInboxService rather than create supportAgentInboxService — existing service covers the contract; one optional flag added to listInboxes`.
- **Q2** — Gate-baseline edit was a no-op. `scripts/.gate-baselines/no-db-in-routes.txt` is already empty; `verify-no-db-in-routes.sh` exits 0 today and stays 0. The architectural breach (`import { canonicalInboxes } from '../../db/schema/...'`) is now removed by Chunk 4.
- **Q3** — F5 option β applied: conditional `hasOrgPermission` check inside the default branch of `GET /api/agents`, gated after the `ownerScope=user` short-circuit.

### Branch-level review pass results

| Reviewer | Result | Notes |
|---|---|---|
| spec-conformance | CONFORMANT | All 14 requirements met; Q1/Q2/Q3 deviations operator-approved |
| adversarial-reviewer | HOLES_FOUND — closed | C1 `getInbox` subaccount predicate added; C2 `ownerScope=user` bypass documented as intentional |
| pr-reviewer | APPROVED | 4 should-fix resolved: mergeAgentConfigPatch extracted, tests strengthened |
| reality-checker | READY | All 6 success criteria verified |
| dual-reviewer | REVIEW_GAP | Codex CLI unavailable locally |

### REVIEW_GAP entries

```
REVIEW_GAP: dual-reviewer | task-class: Standard | reason: Codex CLI not installed in local session | operator-override: no | remediation: chatgpt-pr-review serves as primary second-opinion pass at Phase 3 (enforced by finalisation-coordinator)
```

### Open issues for finalisation

1. **Pre-existing client URL bug** (not fixed here): client calls `/api/support/agent/dashboard` and `/api/support/inboxes/.../agent-config` but route is mounted at `/api/subaccounts/:subaccountId/support/...`. Routed to `tasks/todo.md`. No current production caller affected (route unreachable from current client paths).

### tasks/todo.md closures (after PR# known)

After PR number is known, `finalisation-coordinator` applies these edits to `tasks/todo.md`:

- Route → DB layer breach (pre-v1 lockdown critical row, Track A): find the row referencing `supportAgentRoutes.ts` direct DB access and append `[status:closed:pr:<PR#>]`
- Track A F5 row: find the F5 row referencing `GET /api/agents` missing `requireOrgPermission(AGENTS_VIEW)` and append `[status:closed:pr:<PR#>]`
