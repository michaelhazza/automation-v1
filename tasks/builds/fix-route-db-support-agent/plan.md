---
status: APPROVED
date: 2026-05-15
author: architect (claude opus 4.7 [1m])
scope_class: Standard
build_slug: fix-route-db-support-agent
spec: tasks/builds/fix-route-db-support-agent/spec.md
branch: claude/fix-route-db-support-agent
branch_head_at_start: 76377549
---

# Implementation plan — fix-route-db-support-agent

Wave 1 Env C — remove direct `db.select` / `db.update` calls from
`server/routes/support/supportAgentRoutes.ts` and add
`requireOrgPermission(AGENTS_VIEW)` to `GET /api/agents` (F5).

This is a Standard-class build. Architecture decisions are below; the bulk of
the work is mechanical delegation to an existing service.

## Table of contents

1. Model-collapse check
2. Architecture notes
3. Open questions surfaced for plan-gate
4. Caller sweep summary (chunk-0 already completed)
5. File inventory
6. Contracts
7. Chunk decomposition
8. Per-chunk detail
9. Risks and mitigations
10. Self-consistency pass
11. Executor notes
12. Plan-gate decisions requested from operator

## 1. Model-collapse check

This build is a code-organisation refactor inside a typed backend, not an
ingest-extract-transform-render pipeline. No multimodal model call is in scope.
Collapsed-call alternative is N/A and rejected: the work is moving Drizzle
queries from a route file into a service that already exists. There is no AI
pipeline to collapse.

## 2. Architecture notes

### Key decisions

1. **Delegate to the existing `supportInboxService` rather than create a parallel `supportAgentInboxService`.**
   Problem: spec §1.2 / §5 names a new file `supportAgentInboxService.ts`. The
   existing `server/services/supportInboxService.ts` (208 LOC) already exports
   `listInboxes`, `getInbox`, `updateAgentConfig` covering exactly the DB
   shapes the two route handlers need. Creating a second service violates
   CLAUDE.md §6 ("Never duplicate logic") and DEVELOPMENT_GUIDELINES §8.4
   ("Prefer existing primitives over new abstractions").
   Pattern: delegation. The route is a thin HTTP adapter; the service owns ORM
   access.
   Rejected: a parallel service named per the spec literal — duplicates 90% of
   the existing surface, introduces drift risk between two services that touch
   the same table.
   This is a spec-deviation; recorded under §3 "Open questions surfaced for
   plan-gate" below for operator approval.

2. **Route owns the partial-PATCH merge; service receives an already-merged config.**
   Problem: the route currently deep-merges `collisionWindow`, `draftExpiry`,
   `optIns` (lines 100-109 of `supportAgentRoutes.ts`) BEFORE running
   `SupportInboxAgentConfigSchema.parse`. The existing service's
   `updateAgentConfig(inboxId, config, principalCtx)` takes a FULL
   `SupportInboxAgentConfig`. Two options: keep the merge in the route, or
   move it into the service.
   Decision: keep the merge in the route. It is pure data shaping at the HTTP
   edge where the partial-PATCH semantic lives. Moving it would force the
   service to load `existingConfig` to merge against — but the service already
   loads `existingRow` inside `updateAgentConfig` for the ownership check, so
   the merge would have to happen AFTER that load, tangling two
   responsibilities. Cleaner: route loads via `getInbox`, merges, validates,
   then writes via `updateAgentConfig`.
   Pattern: adapter. Route adapts partial-PATCH HTTP semantics to the
   service's full-shape contract.
   Rejected: an `updateAgentConfigPartial` service method — leaks HTTP
   semantics into the service.

3. **Extend `listInboxes` with an optional `{ activeOnly?: boolean }` flag rather than add a wrapper.**
   Problem: the route filters `eq(canonicalInboxes.isActive, true)`.
   `listInboxes` returns all inboxes for the principal scope.
   Decision: add an optional second arg `options?: { activeOnly?: boolean }`
   defaulting to `false`. Existing caller `supportInboxesRoutes.ts` keeps
   current behaviour (no flag passed). New caller `supportAgentRoutes.ts`
   passes `{ activeOnly: true }`.
   Pattern: optional parameter with backwards-compatible default.
   Rejected: a wrapper `listActiveInboxes(principalCtx)` — adds a second
   export for one boolean toggle; over-decomposes. Rejected: in-memory
   filtering in the route — wastes DB rows and bypasses the service contract.

4. **The route's `makePrincipal` must include the subaccountId (bug-fix in-scope).**
   Problem: the route mount is `/api/subaccounts/:subaccountId/support`
   (server/index.ts:512). Sibling `supportInboxesRoutes.ts` calls
   `resolveSubaccount(req.params.subaccountId, req.orgId!)` and passes
   `subaccount.id` into the principal. Current `supportAgentRoutes.ts`
   hard-codes `subaccountId: null` — divergent from the sibling pattern. Once
   we delegate to `supportInboxService.listInboxes` / `updateAgentConfig`,
   those functions branch on `principalCtx.subaccountId` to scope queries.
   Passing `null` would return ALL org-scoped inboxes — a privilege widening.
   Decision: replace the route's `makePrincipal` with the
   `supportInboxesRoutes.ts` async pattern. The existing route (with
   `subaccountId: null`) is dead code anyway: client paths
   `/api/support/agent/dashboard` and `/api/support/inboxes/.../agent-config`
   do not match the mount path, so no current caller reaches the route.
   Fixing `makePrincipal` is a no-cost correctness win.
   Not a spec-deviation — §3 requires `req.orgId` and §6 forbids visible
   behaviour change; today's route is unreachable from any current client
   URL, so no observable change. Recorded in risks for awareness.

5. **F5 chosen option β (conditional gate inside the handler).**
   Problem: `GET /api/agents` has two branches per the inline comment on
   `server/routes/agents.ts:36-40`: (a) `ownerScope=user` "always allowed",
   (b) default service-layer filter. Spec §6 says "no behaviour change
   visible to callers". Blanket `requireOrgPermission(AGENTS_VIEW)` middleware
   (option α) breaks branch (a) for users without AGENTS_VIEW.
   Decision: option β. Apply `hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_VIEW)`
   inside the handler, gated on `req.query.ownerScope !== 'user'`. Honours the
   "always allowed" guarantee for the owner-scope branch; closes F5 for the
   default branch.
   Pattern: programmatic permission check via `hasOrgPermission` (already
   used in the same file, lines 47 and 69).
   Rejected: option α (blanket middleware) — visible behaviour change against
   spec §6. Rejected: option γ (route-level middleware, identical effect to α).

6. **Gate-baseline edit is a no-op (chunk 4 confined to the import removal).**
   Problem: `scripts/.gate-baselines/no-db-in-routes.txt` is already empty
   (progress.md caller sweep §2). Removing a non-existent entry is undefined.
   The breach is real; the gate's regex (`import.*db.*from.*['"].*\/db`) does
   not catch `import { canonicalInboxes }` from `db/schema/`.
   Decision: build proceeds as a route-layering hygiene fix. After the
   import is removed, the file contains zero `from '../../db/...'` value
   imports; the gate continues to pass. We do NOT tighten the regex in this
   build (out of scope per CLAUDE.md §6 "Surface, don't smuggle"). Surfaced
   to operator at plan-gate.

### What stays unchanged

- `canonicalInboxes` schema and `agentConfig` JSONB shape.
- `SupportInboxAgentConfigSchema` (the Zod parser).
- `validatePromptOverride` pure helper.
- All other files in the `verify-no-db-in-routes.sh` baseline (each is its
  own ticket per spec §2).
- `supportInboxService.ts` structure — only an optional `activeOnly` parameter
  is added to `listInboxes`.
- The `getOrgScopedDb` primitive and its caller contract.

## 3. Open questions surfaced for plan-gate

The operator must explicitly approve these three decisions before construction
begins. Each is recorded as a spec-deviation candidate in the Phase 2 handoff
if approved.

### Q1 — Delegate to existing `supportInboxService` (recommend: yes)

**Spec instruction:** §1.2 and §5 require creating
`server/services/supportAgentInboxService.ts` with two new exports.

**Recommendation:** delegate to the existing
`server/services/supportInboxService.ts`. Its `listInboxes` (extended with
an `activeOnly` flag) and `updateAgentConfig` cover exactly the DB shapes
both route handlers need. Creating a parallel service duplicates 90% of an
existing 208-LOC file. The predecessor prompt
(`tasks/builds/support-agent-routes-service-extract-2026-05-14/prompt.md` §
"The fix is smaller than the finding suggests") explicitly anticipates and
endorses this path.

**Spec-deviation classification:** mechanical / DRY-driven. Record as
`spec_deviations: delegate to supportInboxService rather than create
supportAgentInboxService — existing service covers the contract; one
optional flag added to listInboxes`.

**Action if rejected:** create `supportAgentInboxService.ts` as a thin
re-export of the three needed methods plus the activeOnly variant — still
no duplicate DB logic, but two service files instead of one. Adds a chunk;
raises test surface; no functional difference.

### Q2 — Gate-baseline cleanup is a no-op (recommend: accept)

**Spec instruction:** §6.4 "remove the entry for `supportAgentRoutes.ts`
from the baseline." §6.7 "`verify-no-db-in-routes.sh` exits 0."

**Reality:** the baseline file is already empty. The gate already exits 0
today because its regex `import.*db.*from.*['"].*\/db` does not match the
`import { canonicalInboxes }` form actually present in the route. The
architectural breach is real (route imports a schema table object) but
the gate mechanically does not detect it.

**Recommendation:** proceed with the route-layering hygiene fix despite
the gate technically passing today. The fix closes ADR-0024's intent and
stops a future tightening of the regex from regressing. Document §6.4
as a no-op in the handoff.

**Spec-deviation classification:** factual correction to spec — no work
to remove. §6.4 reads "no longer contains an entry", which is vacuously
true on a baseline file that already contains zero entries; the gate test
§6.7 is satisfied today and stays satisfied after the build. No edit to
the baseline file is required.

**Action if rejected:** tighten `verify-no-db-in-routes.sh`'s regex to also
match `from '.*\/db/schema'` imports — out of scope for a Standard build;
recommend deferring to a separate `audit-prevention-gates-v2` ticket.

### Q3 — F5 option β (conditional gate, recommend: yes)

**Spec instruction:** §1 task 2 adds `requireOrgPermission(AGENTS_VIEW)`
to `GET /api/agents`. §6 "no behaviour change visible to callers."

**Tension:** the current handler has two branches. Branch (a)
`ownerScope=user` is "always allowed" per the inline comment on line 38.
Blanket middleware breaks branch (a) for callers without AGENTS_VIEW —
a visible behaviour change.

**Three options reviewed:**

- **α — Blanket `requireOrgPermission(AGENTS_VIEW)` middleware.**
  Simplest; closes F5 fully. Breaks the §6 no-behaviour-change clause
  for branch (a). Spec-deviation required.
- **β — Conditional handler-internal gate.** Skip AGENTS_VIEW when
  `req.query.ownerScope === 'user'`; enforce it for the default branch.
  Matches the existing inline comment's intent. Honours §6.
- **γ — Route-level middleware.** Mechanically identical to α.

**Recommendation:** β. Rationale: F5 was deferred specifically because
the ownerScope=user branch is "always allowed" — gating the whole route
would contradict that prior product call AND visibly break callers.
β closes F5 for the default branch (the actual concern: an org-wide list
of agents leaking to users without AGENTS_VIEW) while preserving the
owner-only branch's promise. The audit-of-record cited only the default
branch as the F5 concern.

**Action if α preferred:** trivial swap; the chunk changes from "add a
programmatic `hasOrgPermission` check" to "add a middleware". Operator
records an explicit spec-deviation against §6.

## 4. Caller sweep summary

Full sweep recorded in `tasks/builds/fix-route-db-support-agent/progress.md`
under `## Caller sweep`. Summary of findings folded into the plan:

| Finding | Status | Plan impact |
|---|---|---|
| `supportAgentRoutes.ts` has no exported helpers | No-op | No code outside the file references its handlers |
| `verify-no-db-in-routes.sh` baseline is empty | Gate technically passes today | Q2 — proceed as hygiene fix |
| `requireOrgPermission(AGENTS_VIEW)` pattern is consistent across `agents.ts` | Confirmed | F5 addition uses the canonical primitive |
| `supportInboxService.ts` already covers the DB needs | Confirmed | Q1 — delegate rather than duplicate |
| Mount path is `/api/subaccounts/:subaccountId/support` | Discovered during plan phase | Decision 4 — fix `makePrincipal` to match sibling convention |
| Client URLs `/api/support/agent/dashboard` and `/api/support/inboxes/.../agent-config` do not match the mount | Pre-existing bug | Out of scope; tracked as a separate finding (chunk 6 doc-note) |

## 5. File inventory

### Files modified

| Path | What changes | Chunks |
|---|---|---|
| `server/services/supportInboxService.ts` | Add optional `{ activeOnly?: boolean }` second arg to `listInboxes`; conditional `where`-clause | 1 |
| `server/routes/support/supportAgentRoutes.ts` | Remove `canonicalInboxes` import. Replace inline `db.select` / `db.update` with delegation to `supportInboxService`. Replace `makePrincipal` with the `resolveSubaccount`-using sibling pattern | 2, 3, 4 |
| `server/routes/agents.ts` | F5 — add programmatic `hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_VIEW)` check inside the `GET /api/agents` handler, gated on `req.query.ownerScope !== 'user'`. Remove the F5-deferred audit comment block | 5 |
| `server/services/__tests__/supportInboxService.activeOnly.test.ts` (new) | Vitest cases for the `activeOnly` flag | 1 |
| `server/routes/support/__tests__/supportAgentRoutes.test.ts` (new) | Targeted unit test for both handlers (happy + error paths) | 3 |
| `server/routes/__tests__/agentsRouteF5.test.ts` (new) | Targeted unit test for the F5 conditional gate | 5 |

### Files NOT modified (despite appearing in spec)

- `server/services/supportAgentInboxService.ts` — not created. Q1
  recommendation delegates to existing `supportInboxService.ts`.
- `scripts/.gate-baselines/no-db-in-routes.txt` — already empty. Q2 no-op.
- `scripts/verify-no-db-in-routes.sh` — out of scope per spec §2 and
  operator instruction.
- `canonicalInboxes` schema — out of scope per spec §2.
- `SupportInboxAgentConfigSchema` — out of scope per spec §2.
- `tasks/todo.md` — **(F2)** not edited in this build. Closure lines
  (Route → DB breach row, Track A F5 row) are recorded as queued text in
  `progress.md`. `finalisation-coordinator` applies the `[status:closed:pr:<num>]`
  edits after the PR number is known, avoiding placeholder commits.

## 6. Contracts

### `supportInboxService.listInboxes` (extended signature)

```typescript
// Before
export async function listInboxes(
  principalCtx: PrincipalContext,
): Promise<InboxWithSyncHealth[]>;

// After
export async function listInboxes(
  principalCtx: PrincipalContext,
  options?: { activeOnly?: boolean },
): Promise<InboxWithSyncHealth[]>;
```

When `options?.activeOnly === true`, the `where` clause is extended with
`eq(canonicalInboxes.isActive, true)`. Default `false` preserves current
behaviour for the existing caller `supportInboxesRoutes.ts`.

### `supportInboxService.getInbox` (no signature change, route uses it)

```typescript
export async function getInbox(
  inboxId: string,
  principalCtx: PrincipalContext,
): Promise<InboxWithSyncHealth>; // throws 404 if not found
```

The PATCH handler in `supportAgentRoutes.ts` calls `getInbox` to load the
existing config for the merge, then calls `updateAgentConfig` with the
merged + validated payload. Two service round-trips per PATCH; the
alternative (a service method that combines load + merge + write) leaks
HTTP semantics into the service. Acceptable cost: ~1ms extra DB roundtrip
on a low-frequency endpoint.

### `supportInboxService.updateAgentConfig` (no signature change)

```typescript
export async function updateAgentConfig(
  inboxId: string,
  config: SupportInboxAgentConfig, // full, validated
  principalCtx: PrincipalContext,
): Promise<CanonicalInbox>;
```

Throws `{ statusCode: 422, message: 'support.inbox.agent_config_invalid' }`
on parse failure, `{ statusCode: 404, message: 'support.inbox.not_found' }`
on missing, `{ statusCode: 403, errorCode: 'support.inbox.scope_mismatch' }`
on sibling-subaccount cross-write. Route doesn't catch — `asyncHandler`
propagates these to the client.

### Route handlers (after refactor)

```typescript
// GET /api/subaccounts/:subaccountId/support/agent/dashboard
// authenticate -> requireOrgPermission('support.inbox.view') -> handler
async (req, res) => {
  const principal = await makePrincipal(req); // resolveSubaccount inside
  const rows = await listInboxes(principal, { activeOnly: true });
  const inboxes = rows.map(r => ({
    inboxId: r.id,
    inboxName: r.name,
    mode: r.agentConfig.mode,
    draftsPending: 0,
    sentToday: 0,
    escalations: 0,
    evalDriftStatus: 'green' as const,
  }));
  res.json({ inboxes });
}

// PATCH /api/subaccounts/:subaccountId/support/inboxes/:inboxId/agent-config
// authenticate -> requireOrgPermission('support.inbox.configure') -> handler
async (req, res) => {
  const principal = await makePrincipal(req);
  const { inboxId } = req.params;
  const patch = req.body as Record<string, unknown>;

  if (typeof patch.promptOverride === 'string') {
    const check = validatePromptOverride(patch.promptOverride);
    if (!check.valid) {
      res.status(422).json({ error: check.reason, errorCode: 'prompt_override_invalid' });
      return;
    }
  }

  const existing = await getInbox(inboxId, principal); // throws 404
  const existingConfig = existing.agentConfig as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...existingConfig, ...patch };
  const NESTED_KEYS = ['collisionWindow', 'draftExpiry', 'optIns'] as const;
  for (const key of NESTED_KEYS) {
    if (patch[key] != null && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      merged[key] = { ...(existingConfig[key] as object), ...(patch[key] as object) };
    }
  }

  let parsedConfig: SupportInboxAgentConfig;
  try {
    parsedConfig = SupportInboxAgentConfigSchema.parse(merged);
  } catch {
    res.status(422).json({ error: 'support.inbox.agent_config_invalid', errorCode: 'agent_config_invalid' });
    return;
  }

  const updated = await updateAgentConfig(inboxId, parsedConfig, principal);
  res.json({ inbox: { id: updated.id, agentConfig: updated.agentConfig } });
}
```

The route-side `SupportInboxAgentConfigSchema.parse` is kept because the
service's `updateAgentConfig` ALSO re-parses (defence-in-depth);
microseconds of wasted CPU on the happy path are acceptable. Note: with
`getInbox` running before the parse, we pay one DB read on
invalid-after-merge input. PATCH is low-frequency and validation failures
are rare; the load order is correct because partial PATCHes are not
parseable until merged with the existing config.

### F5 handler shape

```typescript
// server/routes/agents.ts — GET /api/agents
router.get('/api/agents', authenticate, asyncHandler(async (req, res) => {
  if (req.query.ownerScope === 'user') {
    const rows = await agentService.listOwnedByUser(req.orgId!, req.user!.id);
    res.json({ agents: rows });
    return;
  }
  // F5: default branch requires AGENTS_VIEW
  const canView = await hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_VIEW);
  if (!canView) {
    res.status(403).json({ error: 'You do not have permission to perform this action. Contact your organisation administrator if you believe this is a mistake.' });
    return;
  }
  const canManageAgents = await hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_EDIT);
  const result = canManageAgents
    ? await agentService.listAllAgents(req.orgId!)
    : await agentService.listAgents(req.orgId!);
  res.json(result);
}));
```

The 403 message string matches the canonical `requireOrgPermission` body
so clients see a consistent error shape. The pre-F5 audit comment block
is removed.

## 7. Chunk decomposition

Six chunks. Forward-only dependencies. Each modifies ≤ 2 production files
plus its own test file.

```
Chunk 1 — Service extension (listInboxes activeOnly flag + targeted test)
   └─► Chunk 2 — Route GET handler delegates (no DB calls; schema import still present)
          └─► Chunk 3 — Route PATCH handler delegates (merge stays in route)
                 └─► Chunk 4 — Remove canonicalInboxes import + makePrincipal fix verified
                        └─► Chunk 5 — F5 gate on GET /api/agents
                               └─► Chunk 6 — Doc / handoff updates (no production code)
```

Chunk-0 (caller sweep) is already complete — recorded in progress.md, folded
into §4 above. Not its own chunk.

## 8. Per-chunk detail

### Chunk 1 — `listInboxes` activeOnly flag

**spec_sections:** §1.2, §5 (delegated), §6.8

**Files modified:**
- `server/services/supportInboxService.ts` — extend `listInboxes` signature
  with optional `{ activeOnly?: boolean }` second arg; conditional `where`
  clause `eq(canonicalInboxes.isActive, true)` when flag is true.
- `server/services/__tests__/supportInboxService.activeOnly.test.ts` (new) —
  Vitest unit test asserting:
  - `listInboxes(principal)` returns all inboxes (default preserved).
  - `listInboxes(principal, { activeOnly: true })` returns only active inboxes.
  - Optional flag is type-safe (TS test by leaving `activeOnly` undefined).

**Module shape:**
- Public interface: `listInboxes(principalCtx, options?: { activeOnly?: boolean })`
- Hidden: conditional `where`-clause assembly; the `isActive` join with
  `connectorConfigs`.

**Contract:**
```typescript
export async function listInboxes(
  principalCtx: PrincipalContext,
  options?: { activeOnly?: boolean },
): Promise<InboxWithSyncHealth[]>;
```

**Error handling:** none new. Service surface unchanged for the existing caller.

**Test considerations (for `pr-reviewer` post-implementation):**
- Existing caller `supportInboxesRoutes.ts` still compiles and still returns
  the unfiltered list.
- The new test mocks at the right boundary — prefer an in-memory or test-DB
  driven integration if a harness exists; otherwise unit-test the
  `where`-clause assembly via a `getOrgScopedDb` mock.
- Type test: calling `listInboxes(principal)` without the second arg must
  still typecheck.

**Dependencies:** none — chunk 1 is the base.

**Acceptance criteria:**
- `npm run lint` exits 0.
- `npm run typecheck` exits 0.
- `npx vitest run server/services/__tests__/supportInboxService.activeOnly.test.ts` passes.
- **(T1)** `activeOnly` composes with, and never replaces, the existing principal scoping predicates: the conditional `where` clause is constructed inside the same `and(...)` that already enforces `eq(canonicalInboxes.organisationId, ...)` and, when the principal carries a subaccountId, `eq(canonicalInboxes.subaccountId, ...)`. Setting `activeOnly: true` MUST NOT widen the result set across orgs or subaccounts. Verified by the new test running with a subaccount-scoped principal and asserting that inboxes from sibling subaccounts never appear.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/__tests__/supportInboxService.activeOnly.test.ts`

### Chunk 2 — Migrate GET handler in `supportAgentRoutes.ts`

**spec_sections:** §1.1, §1.3, §4 (GET row), §5 (delegate)

**Files modified:**
- `server/routes/support/supportAgentRoutes.ts` — GET handler only.
  Imports added: `listInboxes` from `../../services/supportInboxService.js`,
  `resolveSubaccount` from `../../lib/resolveSubaccount.js`. The
  `canonicalInboxes` schema import remains for now (PATCH handler still
  uses it until chunk 3 + 4). Inline `db.select(...).from(canonicalInboxes)`
  block replaced with `await listInboxes(principal, { activeOnly: true })`
  + the presentation-layer `.map(...)` for `draftsPending` / `sentToday` /
  `escalations` / `evalDriftStatus` stubs.
- `makePrincipal` function rewritten to the async-`resolveSubaccount`
  pattern matching `supportInboxesRoutes.ts` lines 11-20. This change
  applies to BOTH handlers in the file; PATCH continues to use the
  principal even before its DB work is migrated, so the change is safe here.

**Module shape:**
- Public interface: `GET /api/subaccounts/:subaccountId/support/agent/dashboard`
  unchanged in URL, method, response shape, status codes.
- Hidden: the new `listInboxes` delegation, the `resolveSubaccount` call,
  the presentation-layer mapping.

**Contract:** route response shape preserved:
```typescript
{ inboxes: Array<{
    inboxId: string;
    inboxName: string;
    mode: 'autonomous' | 'assisted' | 'disabled';
    draftsPending: 0;
    sentToday: 0;
    escalations: 0;
    evalDriftStatus: 'green';
  }> }
```

**Error handling:**
- `resolveSubaccount` throws 404 if the subaccount does not belong to the org —
  `asyncHandler` propagates as 404 JSON. Same shape as sibling routes.
- `listInboxes` does not throw on empty results — returns `[]`.

**Test considerations (for `pr-reviewer`):**
- GET behaviour identical for a user whose subaccount has only active inboxes.
- GET no longer returns inactive inboxes (was already filtering by `isActive`
  before this refactor — preserved via `{ activeOnly: true }`).
- The principal's `subaccountId` is now populated (was `null` before). This
  changes observable behaviour IF any prior caller relied on cross-subaccount
  listing — but the route was unreachable at its real mount path from any
  current client URL, so no production caller is affected. Document in
  handoff: "behaviour delta: GET now correctly scopes by subaccount, matching
  the mount path."

**Dependencies:** chunk 1 (uses the new `activeOnly` flag).

**Acceptance criteria:**
- `npm run lint` / `typecheck` pass.
- The route file still imports `canonicalInboxes` (chunk 4 removes it).
- No `db.select` / `db.update` / `db.insert` call remains in the GET handler.
- `supportRouteScoping.test.ts` (existing) still passes.
- **(T3)** Every `makePrincipal` call site in the file is updated to `await` the async principal resolver, including the still-unmigrated PATCH handler. Chunk 2 must not leave any synchronous `makePrincipal` call shape behind — the PATCH handler must typecheck correctly with the new async signature even though its DB work is not yet delegated until chunk 3.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/routes/support/__tests__/supportRouteScoping.test.ts`

### Chunk 3 — Migrate PATCH handler in `supportAgentRoutes.ts`

**spec_sections:** §1.1, §1.3, §4 (PATCH row), §5 (delegate)

**Files modified:**
- `server/routes/support/supportAgentRoutes.ts` — PATCH handler only.
  Inline `db.select(...).from(canonicalInboxes)` block replaced with
  `await getInbox(inboxId, principal)` (throws 404 if not found — matches
  current behaviour). The deep-merge logic stays in the route. The
  `SupportInboxAgentConfigSchema.parse` stays in the route (defence-in-depth;
  service re-parses). The `db.update(...).set(...).returning()` block
  replaced with `await updateAgentConfig(inboxId, parsedConfig, principal)`.
- `server/routes/support/__tests__/supportAgentRoutes.test.ts` (new) —
  targeted Vitest covering:
  - PATCH happy path: full agent-config update merges nested objects correctly.
  - PATCH 404: nonexistent inbox returns 404 with the service's error body.
  - PATCH 422: invalid promptOverride returns 422 with
    `errorCode: 'prompt_override_invalid'`.
  - PATCH 422: malformed agentConfig (e.g. unknown `mode` value) returns 422
    with `errorCode: 'agent_config_invalid'`.
  - PATCH 403: sibling-subaccount inbox returns 403
    (`support.inbox.scope_mismatch`).

**Module shape:**
- Public interface: `PATCH /api/subaccounts/:subaccountId/support/inboxes/:inboxId/agent-config`
  unchanged in URL, method, request shape, response shape, status codes.
- Hidden: `getInbox` load, deep-merge, Zod parse, `updateAgentConfig` write.

**Contract:** request body shape: `Partial<SupportInboxAgentConfig>` (with
nested-object semantics for `collisionWindow`, `draftExpiry`, `optIns`).
Response body: `{ inbox: { id: string; agentConfig: SupportInboxAgentConfig } }`.

**Error handling:**
- 404 (inbox not found): service throws via `getInbox`; `asyncHandler` returns
  `{ statusCode: 404, message: 'support.inbox.not_found' }`.
- 422 (prompt-override invalid): route returns
  `{ error, errorCode: 'prompt_override_invalid' }` — unchanged.
- 422 (agent-config-schema parse fail): route returns
  `{ error: 'support.inbox.agent_config_invalid', errorCode: 'agent_config_invalid' }`
  — unchanged.
- 403 (subaccount scope mismatch): service throws
  `{ statusCode: 403, errorCode: 'support.inbox.scope_mismatch' }`;
  `asyncHandler` propagates. NEW behaviour vs. the old route, which didn't
  check subaccount because the principal was always `null`. Correctness
  improvement; no production caller affected (the old route was unreachable
  via client URLs).

**Test considerations (for `pr-reviewer`):**
- Nested-object merge preserved exactly — a test where the patch is
  `{ collisionWindow: { respectHumanAssignee: false } }` must produce a
  config with the OLD `minMinutesSinceHumanActivity` value plus the NEW
  `respectHumanAssignee: false`.
- The 403 sibling-subaccount path is new behaviour — no current production
  caller hits it; documented in handoff.

**Dependencies:** chunks 1 + 2.

**Acceptance criteria:**
- `npm run lint` / `typecheck` pass.
- No `db.select` / `db.update` call remains in the PATCH handler.
- The route file still imports `canonicalInboxes` (chunk 4 removes it).
- The targeted test file passes.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/routes/support/__tests__/supportAgentRoutes.test.ts`

### Chunk 4 — Remove `canonicalInboxes` import; verify hygiene

**spec_sections:** §1.1 (zero schema imports after build), §6.1, §6.4 (no-op), §6.7

**Files modified:**
- `server/routes/support/supportAgentRoutes.ts` — delete the line
  `import { canonicalInboxes } from '../../db/schema/index.js';`. Also
  delete `eq` and `and` imports from `drizzle-orm` if no longer used
  (chunks 2 + 3 should have removed all `eq(...)` / `and(...)` call sites;
  verify with a static grep before deletion).

**Module shape:**
- Public interface: unchanged.
- Hidden: nothing — this chunk is pure removal of dead imports.

**Contract:** no contract change.

**Error handling:** none.

**Test considerations (for `pr-reviewer`):**
- Static grep `grep -n "canonicalInboxes\|from '\.\./\.\./db" server/routes/support/supportAgentRoutes.ts`
  must return zero matches.
- The file's imports section contains only: `express` Router, `asyncHandler`,
  `authenticate`, `requireOrgPermission`, `resolveSubaccount`, the service
  exports (`listInboxes`, `getInbox`, `updateAgentConfig`),
  `validatePromptOverride`, `SupportInboxAgentConfigSchema` + type,
  `PrincipalContext` type.
- `scripts/.gate-baselines/no-db-in-routes.txt` is NOT modified (already empty;
  Q2 no-op).
- `scripts/verify-no-db-in-routes.sh` is NOT modified.

**Dependencies:** chunks 2 + 3.

**Acceptance criteria:**
- `npm run lint` / `typecheck` pass.
- `npm run build:server` exits 0.
- The route file contains zero imports from `server/db/schema/**`.
- **(T2)** Broader static check: `grep -nE "from '\.\./\.\./db|db\.(select|insert|update|delete)" server/routes/support/supportAgentRoutes.ts` returns zero matches. The only DB-layer touchpoint allowed is the service-call site (`listInboxes` / `getInbox` / `updateAgentConfig`); no `db.<verb>` and no `from '.../db/...'` value imports remain. (Note: `getOrgScopedDb` is NOT imported in the route — that primitive lives inside the service.)

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

### Chunk 5 — F5 conditional gate on `GET /api/agents`

**spec_sections:** §1.5, §4 (GET /api/agents row), §6.9

**Files modified:**
- `server/routes/agents.ts` lines 36-52 — replace the F5-deferred audit
  comment block with a programmatic
  `hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_VIEW)` check INSIDE the
  default branch. The `ownerScope=user` branch keeps its "always allowed"
  guarantee. On AGENTS_VIEW denial, return 403 with the canonical error body.
  The audit comment is removed entirely.
- `server/routes/__tests__/agentsRouteF5.test.ts` (new) — targeted Vitest. The handler short-circuits on `req.query.ownerScope === 'user'` before checking AGENTS_VIEW; the default branch checks AGENTS_VIEW first, then AGENTS_EDIT to pick `listAllAgents` vs `listAgents`. The test must cover all four permission states explicitly — the plan makes no implication assumption between AGENTS_VIEW and AGENTS_EDIT:

  | Permissions held | Query | Expected |
  |---|---|---|
  | none | `?ownerScope=user` | 200 — caller's own agents |
  | none | default | 403 |
  | AGENTS_VIEW only | default | 200 via `listAgents` |
  | AGENTS_EDIT only | default | 403 — fails the AGENTS_VIEW guard (F1) |
  | AGENTS_VIEW + AGENTS_EDIT | default | 200 via `listAllAgents` |
  | AGENTS_VIEW only | `?ownerScope=user` | 200 — short-circuit branch |

  The "AGENTS_EDIT only → 403" row codifies the explicit non-implication: the handler does not assume AGENTS_EDIT entails AGENTS_VIEW. If the permission fixture would normally grant AGENTS_VIEW as a side-effect of AGENTS_EDIT, the test must construct a fixture that grants AGENTS_EDIT in isolation to assert the 403.

**Module shape:**
- Public interface: `GET /api/agents` — URL unchanged, method unchanged,
  response shape unchanged for branch (a). For branch (b), callers without
  AGENTS_VIEW now receive 403 instead of a list. Intended F5 fix.
- Hidden: the conditional `hasOrgPermission` call, the 403 short-circuit.

**Contract:** response shape unchanged per branch. Status code added: 403
for the default branch when AGENTS_VIEW is absent.

**Error handling:** 403 body matches the canonical `requireOrgPermission`
output: `{ error: 'You do not have permission to perform this action. Contact your organisation administrator if you believe this is a mistake.' }`.

**Test considerations (for `pr-reviewer`):**
- The `ownerScope=user` branch must NOT call
  `hasOrgPermission(AGENTS_VIEW)` — preserves the "always allowed"
  guarantee in §6.
- The 403 body string matches the canonical helper output; clients consuming
  this endpoint do not need to learn a new error shape.

**Dependencies:** none — independent of chunks 1-4 (different file). Could
land in parallel; ordered here for forward-only chunk sequencing.

**Acceptance criteria:**
- `npm run lint` / `typecheck` pass.
- The F5 audit comment block (lines 36-40 today) is removed.
- The new test file passes.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/routes/__tests__/agentsRouteF5.test.ts`

### Chunk 6 — Doc / handoff updates

**spec_sections:** §6.11 (todo.md status updates), §8 (handoff)

**Files modified:**
- `tasks/builds/fix-route-db-support-agent/progress.md` — append Phase 2
  close summary including:
  - Spec-deviations applied (Q1 delegate-to-existing-service, Q2 gate-baseline-no-op, Q3 F5 option β).
  - Behaviour-delta note for `supportAgentRoutes.ts` `makePrincipal` fix.
  - Pre-existing client URL bug surfaced (chunk 2 finding) — routed to
    `tasks/todo.md` as a separate ticket (NOT fixed here per CLAUDE.md §6
    "Surface, don't smuggle").
  - **(F2)** Exact closure text queued for `finalisation-coordinator` to apply
    after PR number assignment, recorded inline in progress.md under a
    `## Closure text for finalisation-coordinator` heading:
    - Route → DB layer breach (pre-v1 lockdown critical row): `[status:closed:pr:<PR#>]`
    - Track A F5 row: `[status:closed:pr:<PR#>]`
- `KNOWLEDGE.md` — append IF AND ONLY IF an unexpected pattern surfaces
  during the build. No mandatory append. Examples of expected appends:
  - "Gate regex `import.*db.*from.*['\"].*\/db` does NOT catch schema-table
    imports — the breach must be caught by code review or a tightened regex,
    not by today's gate."
  - "Route handlers using a subaccount-scoped mount must build their
    principal via `resolveSubaccount` even if no per-handler subaccountId
    param is read — the mount path's `:subaccountId` is the source of truth."

**Module shape:** doc-only chunk; no production code.

**Contract:** no code contract changes.

**Error handling:** none.

**Test considerations:** none.

**Dependencies:** chunks 1-5 complete.

**Acceptance criteria:**
- `progress.md` Phase 2 close section reflects what shipped.
- The closure text for the Route → DB breach row and Track A F5 row is recorded inline in `progress.md` (under `## Closure text for finalisation-coordinator`) — **NOT** edited into `tasks/todo.md` in this build (F2: avoids landing a `[status:closed:pr:<num>]` placeholder before the PR number exists; finalisation-coordinator owns the `tasks/todo.md` edit after PR assignment).

**Verification commands:**
- (no code; no commands)

## 9. Risks and mitigations

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Behaviour-delta from `makePrincipal` subaccountId fix breaks an unseen caller | Low | Med | The current route is unreachable at the existing mount from any client URL (confirmed by grep of `client/`). Only callable via direct API. Documented in chunk 2 acceptance + chunk 6 handoff. |
| Service's `updateAgentConfig` re-parses the config after route already parsed — wasted CPU | Low | Low | Defence-in-depth, microseconds. Keep both parses. |
| `getInbox` adds an extra DB round-trip per PATCH vs the old single SELECT+UPDATE | Low | Low | PATCH is low-frequency (admin actions); 1ms additional latency is acceptable. Alternative (combined load+merge+write service method) would leak HTTP semantics into the service layer — worse trade. |
| F5 option β introduces a programmatic permission check inside the handler, divergent from the file's middleware-based pattern | Low | Low | Pattern already exists in the same file: line 47 uses `hasOrgPermission(req, ORG_PERMISSIONS.AGENTS_EDIT)`. β is consistent. |
| `verify-no-db-in-routes.sh` regex does not catch schema-table imports — future regressions in this file could slip through | Med | Low | Out of scope per Q2; raise as a separate `audit-prevention-gates-v2` ticket. Document the gap in `KNOWLEDGE.md` per chunk 6 trigger. |
| Spec §1.2 / §5 literal-reading review may flag the absence of `supportAgentInboxService.ts` | High | Low | Q1 records this as a deliberate spec-deviation; `spec-conformance` reviewer is briefed via the handoff summary. ADR-0024 already endorses "delegate to existing service". |
| PATCH handler's `getInbox` returns the row with `subaccountId` checked, but `updateAgentConfig` re-checks; if these diverge in a future refactor, the route silently relies on the second check | Low | Low | Service contract is `getInbox throws 404; updateAgentConfig throws 404/403`. Both checks are documented in `supportInboxService.ts`. Chunk 3 test covers the 403 path. |
| `npm run build:server` discovers a stale type re-export from removed `canonicalInboxes` import | Low | Low | Verified during chunk 4 by `tsc --noEmit`. No re-exports from this file (only `export default router`). |

## 10. Self-consistency pass

Cross-checks performed before finalising:

- **Goal G1 (zero schema imports in route)** — chunk 4 deletes the import;
  chunk 4 acceptance criteria verifies via static grep.
- **Goal G2 (service exposes the two operations)** — chunk 1 confirms the
  existing service already exposes them; only `activeOnly` is added.
- **Goal G3 (route delegates all DB work)** — chunks 2 + 3 migrate GET and
  PATCH; chunk 4 verifies no `db.select`/`update` remains.
- **Goal G4 (gate baseline updated)** — Q2 documents the no-op; chunk 4
  explicitly states the baseline file is NOT modified.
- **Goal G5 (F5 permission)** — chunk 5 applies option β with test coverage.
- **Goal G6 (no behaviour change)** — F5 chosen option β preserves
  `ownerScope=user` "always allowed". The `makePrincipal` fix in chunks
  2-3 changes principal.subaccountId from `null` to the resolved value, but
  the route is unreachable at its mount from any client URL today — no
  production caller is affected. Documented in handoff.
- **No raw `try/catch` in routes for service errors** — preserved.
  `asyncHandler` propagates service errors. The route's two `try/catch`
  blocks are around `validatePromptOverride` (pure function) and
  `SupportInboxAgentConfigSchema.parse` (pure Zod parse) — both are
  HTTP-edge validation, not service-error handling.
- **`resolveSubaccount` is used** — yes, inside `makePrincipal` per chunk 2.
- **Soft-delete pattern (`deletedAt isNull`)** — N/A; `canonicalInboxes`
  uses `isActive` boolean.
- **Idempotency keys** — N/A; no run-creation path.
- **Three-tier agent model** — N/A; support-inbox subsystem, not agent tier.
- **Test gates CI-only rule** — all "Verification commands" sections list
  only `lint`, `typecheck`, `build:server`, and targeted `npx vitest run`
  for tests authored in THIS chunk. No `verify-*.sh`, no `gates/*`, no
  `npm run test:*` umbrellas.

## 11. Executor notes

- **Test gates and whole-repo verification scripts (`npm run test:gates`,
  `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`,
  `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT
  run during local execution of this plan, in any chunk, in any form.
  Targeted execution of unit tests authored within this plan is allowed;
  running the broader suite is not.**
- Tests authored in this plan use Vitest
  (`import { test, expect } from 'vitest'`). Never `node:test`,
  `node:assert`, or `npx tsx`-runnable harnesses (per
  `docs/testing-conventions.md`).
- Per-chunk verification is the lint/typecheck/build/targeted-vitest subset.
  CI runs the gate suite on PR open.
- After chunk 5 closes, hand off to the branch-level review pass:
  `spec-conformance` (mandatory — spec-driven) → `adversarial-reviewer`
  (mandatory if diff matches §5.1.2 surface; route handler + permission
  middleware likely qualifies) → `pr-reviewer` (mandatory) →
  `reality-checker` (mandatory; provide success criteria + evidence) →
  `dual-reviewer` (mandatory; write `REVIEW_GAP` if Codex unavailable).
  `chatgpt-pr-review` is Phase-3 territory, not part of this plan's
  review pass.

## 12. Plan-gate decisions requested from operator

Three decisions block the start of construction. Each has a recommendation
and an action-if-rejected path. Full detail in §3 above.

1. **Q1 — Delegate to existing `supportInboxService` (recommend yes).**
   Avoids creating a duplicate 200-LOC service file. Records as spec-deviation
   against §1.2 / §5.
2. **Q2 — Treat gate-baseline edit as a no-op (recommend accept).** Baseline
   is already empty; the gate's regex does not catch the offending import
   shape. The fix removes the import anyway, so the gate continues to pass.
   Surface the regex gap in `KNOWLEDGE.md` per chunk 6.
3. **Q3 — F5 conditional gate (option β, recommend yes).** Preserves the
   "always allowed" guarantee for `ownerScope=user` while closing F5 for the
   default branch. Honours spec §6 no-behaviour-change.

Operator approval of all three converts this plan from DRAFT to APPROVED and
construction begins on chunk 1.
