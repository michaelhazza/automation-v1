---
status: DRAFT
date: 2026-05-15
author: main-session (claude opus 4.7)
scope_class: Standard
source_branch: main
build_slug: fix-route-db-support-agent
output_location: tasks/builds/fix-route-db-support-agent/spec.md
---

# Wave 1 Env C — Route→DB breach fix + F5 permission

Two small, bounded fixes:

1. Extract `supportAgentInboxService` from `server/routes/support/supportAgentRoutes.ts`. The route currently builds Drizzle `.select().from(canonicalInboxes)` queries and `db.update(canonicalInboxes)` calls inline — bypassing the canonical `route → service → db` cascade. Currently sits in the `verify-no-db-in-routes.sh` gate baseline (Track A2 pre-v1 lockdown finding, **critical** severity).
2. Add `requireOrgPermission(AGENTS_VIEW)` to `GET /api/agents` (Track A finding F5).

## 1. Goals

1. Move all schema imports (`canonicalInboxes`) out of the route file. Route imports zero schema after this build.
2. Create `server/services/supportAgentInboxService.ts` with two named exports:
   - `listSupportAgentInboxes(orgId: string): Promise<...>` — returns the active inboxes for an organisation.
   - `updateSupportAgentInboxAgentConfig(inboxId: string, orgId: string, config: ...): Promise<...>` — patches the agent config.
   Both use `getOrgScopedDb()` for queries — no raw `db` calls.
3. Route file becomes a thin orchestration layer: extract principal, validate input, delegate to service, return JSON.
4. Tighten `scripts/verify-no-db-in-routes.sh` baseline — remove the `supportAgentRoutes.ts` entry. The gate should now refuse any future regression in this file.
5. Add `requireOrgPermission(AGENTS_VIEW)` middleware to the `GET /api/agents` route handler (Track A F5).
6. No behaviour change visible to callers — same response shapes, same status codes, same error semantics.

## 2. Non-Goals

- No changes to the `canonicalInboxes` schema or table structure.
- No changes to the agent-config validation logic (preserve current Zod schema if one exists; pure mechanical extraction).
- No new endpoints, no new query parameters.
- No conversion of other route files that currently sit in the `verify-no-db-in-routes.sh` baseline — each is its own ticket.
- No refactor of the `GET /api/agents` handler itself — only the permission middleware addition.
- The 4 other direct `boss.work` calls in `server/index.ts` are out of scope (they belong to Env B's adjacent SA4 fix or future builds).

## 3. Framing Assumptions

- `server/routes/support/supportAgentRoutes.ts` is 134 LOC with two route handlers: a `GET` (list inboxes) and a `PATCH` (update inbox agent config).
- The schema import `canonicalInboxes` from `../../db/schema/index.js` (line 6) is the offending import. After this build, no schema imports remain.
- `getOrgScopedDb()` is the canonical scoped-read primitive (defined in `server/lib/orgScopedDb.ts`). The new service uses it for both `listSupportAgentInboxes` and `updateSupportAgentInboxAgentConfig`.
- The route currently passes `principal.organisationId` into the query `.where(eq(canonicalInboxes.organisationId, ...))`. The service signature passes `orgId` explicitly; the route extracts it from `req.orgId` (set by middleware per the canonical pattern) and passes it through.
- `GET /api/agents` lives in `server/routes/agents.ts` (architect confirms). The `requireOrgPermission(AGENTS_VIEW)` middleware exists already — this is a one-line addition to the route definition.
- `verify-no-db-in-routes.sh` reads the baseline file `scripts/.gate-baselines/no-db-in-routes.txt` (or similar — architect confirms exact path). Removing the entry is a one-line edit.

## 4. Public-Surface Lock

The route URLs, HTTP methods, request shapes, response shapes, and status codes do not change.

| Route | Before | After |
|---|---|---|
| `GET /api/support/agents/inboxes` | Returns list of active inboxes for principal org | Same |
| `PATCH /api/support/agents/inboxes/:inboxId` | Updates agentConfig on an inbox owned by principal org | Same |
| `GET /api/agents` | No permission gate (Track A F5 finding) | Gated on `requireOrgPermission(AGENTS_VIEW)` |

## 5. Service Contract

New file: `server/services/supportAgentInboxService.ts`

```typescript
// Signature (illustrative — architect confirms exact types during plan phase)
export async function listSupportAgentInboxes(orgId: string): Promise<
  Array<{ id: string; name: string; agentConfig: ... }>
>;

export async function updateSupportAgentInboxAgentConfig(
  inboxId: string,
  orgId: string,
  newConfig: ... // existing Zod-validated shape from route
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_owned' }>;
```

Both functions use `getOrgScopedDb(orgId)` for their DB work. Neither imports schema directly; both use the scoped-db query builder which already references the underlying tables.

## 6. Acceptance Criteria

A build is complete when ALL of the following hold:

1. `server/routes/support/supportAgentRoutes.ts` contains no imports from `server/db/schema/**`.
2. `server/services/supportAgentInboxService.ts` exists with two exported functions (signatures per §5).
3. Both routes in `supportAgentRoutes.ts` delegate to the new service for all DB work; no `db.select` / `db.update` / `db.insert` calls remain in the route file.
4. `scripts/.gate-baselines/no-db-in-routes.txt` no longer contains an entry for `supportAgentRoutes.ts`.
5. `npm run lint` exits 0.
6. `npm run build:server` exits 0.
7. `scripts/verify-no-db-in-routes.sh` exits 0 (this is a critical gate — the whole point of the build).
8. `scripts/verify-with-org-tx-or-scoped-db.sh` exits 0 (new service uses `getOrgScopedDb`, qualifies for the gate's allow-list).
9. `GET /api/agents` has `requireOrgPermission(AGENTS_VIEW)` middleware applied — verified by a targeted grep on the route file.
10. Existing test coverage (if any) for the two support-agent routes still passes; behaviour is unchanged.
11. `tasks/todo.md` items: the critical Route→DB breach line in the pre-v1 lockdown section, and Track A F5, both marked `[status:closed:pr:<num>]` in the merge commit.

## 7. Chunks (high-level)

This is a Standard-class build with a small surface. Architect's plan phase produces the concrete chunks; expected shape:

- **Chunk 0**: plan write + caller sweep (likely just the two route handlers and the gate baseline)
- **Chunk 1**: create `supportAgentInboxService.ts` with the two functions
- **Chunk 2**: migrate the GET handler in `supportAgentRoutes.ts` to call the service
- **Chunk 3**: migrate the PATCH handler in `supportAgentRoutes.ts` to call the service
- **Chunk 4**: remove `canonicalInboxes` import from `supportAgentRoutes.ts`, update gate baseline
- **Chunk 5**: add `requireOrgPermission(AGENTS_VIEW)` to `GET /api/agents` in `server/routes/agents.ts` (F5)
- **Chunk 6**: final review (`spec-conformance` + `pr-reviewer`)

The whole build is likely 1-2 days of agent work. Smaller than Env A and Env B by an order of magnitude.

## 8. Caller Sweep

The architect's caller sweep is much smaller for this build:

- Confirm no other file imports the inline functions from `supportAgentRoutes.ts` (they're not exported — should be a no-op).
- Confirm the new service path `server/services/supportAgentInboxService.ts` is unique (no existing file).
- Confirm the gate-baseline file path for `verify-no-db-in-routes.sh` and that the entry to remove exists.
- Confirm `requireOrgPermission(AGENTS_VIEW)` exists and is used consistently in similar route definitions (so the F5 addition matches existing patterns).
