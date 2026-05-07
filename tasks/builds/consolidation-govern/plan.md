# Consolidation C — Govern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Govern surface (Knowledge, Spending, Connections) by composing foundation primitives over existing knowledge / spend / integration services, with one additive migration, two new pure aggregators, and four React pages.

**Architecture:** Thirteen forward-only chunks. Backend chunks (C1-C6) extend `memory_blocks` with `auto_update_disabled`, add list / approve / reject / override endpoints to `knowledge.ts`, paged ledger to `agentCharges.ts`, two pure aggregators (`spendInsightsService`, `spendTrendsService`), `CapsResponse` extension, and unified `connections` list + test + usage on `integrationConnections.ts`. Frontend chunks (C7-C12) consume foundation primitives plus three page-scoped vanilla SVG charts. C13 is doc-sync.

**Tech Stack:** TypeScript, Express, Drizzle, React, Tailwind, vanilla SVG (no chart library), Vite

**Spec:** tasks/builds/consolidation-govern/spec.md (approved-for-build 2026-05-07)
**Depends on:** consolidation-foundation (PR #270, merged 2026-05-07)
**Branch:** ui-consolidation-govern

---

## Table of contents

1. Executor notes
2. Model-collapse check
3. Spec coverage map
4. Architecture notes
5. Pre-existing schema reconciliation (read before C1)
6. Stepwise implementation plan
7. Per-chunk detail
   - Task C1 — Migration + auto-extract gate
   - Task C2 — Knowledge list + approve / reject / override
   - Task C3 — Spend Ledger paged list + filterOptions CTE
   - Task C4 — Spend Insights + Trends pure aggregators + endpoints
   - Task C5 — CapsResponse pace extension
   - Task C6 — Unified connections list + usage aggregator + test dispatcher
   - Task C7 — shared/types/govern.ts + API client wrappers
   - Task C8 — KnowledgePage + row + override dialog
   - Task C9 — SpendingPage Ledger tab + insights row
   - Task C10 — SpendingPage Caps tab + 3 SVG charts
   - Task C11 — ConnectionsPage + test button + disconnect dialog
   - Task C12 — Sidebar + router wiring; legacy page delete
   - Task C13 — Doc-sync (architecture.md only)
8. Risks and mitigations
9. Self-consistency check

---

## 1. Executor notes

> **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Per-chunk verification commands are restricted to:

- `npm run lint`
- `npm run typecheck`
- `npm run build:server` (chunks that touch `server/`)
- `npm run build:client` (chunks that touch `client/`)
- `npx tsx <colocated-test-path>` for any pure-function tests authored in the chunk

No other commands are valid Phase-2 verification. CI runs the full gate set on PR open.

This plan is implementation-only for the thirteen chunks in §6-§7. Spec scope (§1-§7 of `tasks/builds/consolidation-govern/spec.md`) is the authoritative contract. If a chunk discovers a contradiction between spec and reality, the builder reports `PLAN_GAP` and the coordinator routes back to architect — the builder does NOT silently widen scope.

**No commits are pushed without explicit user approval.** Each chunk ends with a `git add … && git commit -m …` step, then pause for user review before continuing.

## 2. Model-collapse check

Three model-collapse questions:

1. Does this feature decompose into ingest → extract → transform → render?
2. Is each step doing something a frontier multimodal model could do in a single call?
3. If yes: can the whole pipeline collapse into one model call with a structured-output schema?

**Verdict: not applicable.** Govern is UI consolidation over existing services. Reads, lists, filters, sorts, ETag-concurrent edits, OAuth/MCP test pings. No model in the loop, no pipeline to collapse. Reject collapse: there is nothing to collapse. The closest "model-shaped" surface — auto-extraction of memory entries — is owned by an upstream service this stream does not touch (per spec §1 goal 4 and non-goal 2).

## 3. Spec coverage map

Every requirement in spec §1-§7 traces to a task here. Reconciliations between spec contract and existing reality are §5.

| Spec section | Chunks |
|---|---|
| §1 Goals — workspace + org Knowledge with auto-memory provenance and Edit-and-override | C1, C2, C8 |
| §1 Goals — consolidated Spending (Caps & budgets + Ledger, view-mode aware, top-5 trend charts) | C3, C4, C5, C9, C10 |
| §1 Goals — unified Connections with sort/filter and test action | C6, C11 |
| §1 Goals — extend (not replace) existing services | C2, C3, C4, C5, C6 |
| §2 Non-goals — no Operate/Build pages, no auto-memory pipeline replacement, no new identity primitive, no UI test framework, no new shared frontend primitive | All chunks (defensive scope) |
| §3 Existing primitives audit — every "Extend" verdict | C1 (memory_blocks), C2 (knowledge), C3 (ledger), C4 (insights/trends), C5 (caps), C6 (connections) |
| §4.0 List endpoint invariants (default sort with `id` tiebreaker; max 50; case-insensitive `q`; filterOptions ORDER BY in SQL; same-snapshot CTE) | C2, C3, C6 |
| §4.1 Knowledge entries — list + approve / reject / override + auto_update_disabled gate | C1, C2, C8 |
| §4.2 Ledger list | C3, C9 |
| §4.3 Caps & budgets read | C5, C10 |
| §4.4 Spend insights (org scope) | C4, C9 |
| §4.5 Spend trends (top-5 with synthetic Other rollup, zero-cap unbounded) | C4, C10 |
| §4.6 Connections — unified list | C6, C11 |
| §4.7 View-mode awareness | C8, C9, C10 |
| §4.8 Page-level full-text search | C8, C9, C11 |
| §4.9 Connection test (always 200, monotonic 10s, structured `error.code`) | C6, C11 |
| §4.10 Connection disconnect impact warning (single CTE aggregator) | C6, C11 |
| §4.11 Spending pace + period semantics (CapsResponse extension) | C5, C10 |
| §4.12 Knowledge UX clarifiers (HelpHint tooltips, run-trace iframe, high-confidence badge, override confirm copy) | C8 |
| §4.13 Confirmation dialogs on destructive actions | C8, C11 |
| §4.14 Frontend permission gating (action visibility) | C8, C10, C11 |
| §5 File inventory — every created file | C1-C12 |
| §5 File inventory — every modified file | C2, C3, C5, C6, C12 |
| §6 Permissions / RLS / Execution model — ETag concurrency, body-hash canonicalisation, state-based idempotency, 10s monotonic timeout, cost precision | C1, C2, C3, C4, C5, C6 |
| §7 Phase / chunk plan | C1-C13 |
| §8 Testing posture — pure-function tests for each *Pure.ts | C1, C2, C4, C5, C6 |
| §9 Coordination — sidebar single-row-per-stream, route patterns | C12 |
| §10 Deferred items — explicitly NOT built | All chunks (scope discipline) |

**Spec gaps surfaced during planning** (resolved in this plan; flagged so the operator can amend the spec if desired):

- **Gap 1 — `memory_block_versions.body_hash` column.** Spec §6 says "memory_block_versions carries UNIQUE (memory_block_id, body_hash)" but `server/db/schema/memoryBlockVersions.ts` has no `body_hash` column. Spec §5 says "one new migration" but C1 must extend it. **Resolution:** C1's migration adds BOTH `memory_blocks.auto_update_disabled boolean default false not null` AND `memory_block_versions.body_hash text` (nullable so backfill is non-blocking; new rows always populate it; uniqueness via partial unique index `WHERE body_hash IS NOT NULL`).
- **Gap 2 — Cost precision: spec says "integer microcents" but reality uses ISO 4217 minor units (cents).** `agent_charges.amount_minor: bigint` is cents; `cost_aggregates.totalCostCents: integer` is also cents. **Resolution:** read spec §6 "integer microcents" as "integer minor units" (cents), divide by 100 at the API boundary for `costUsd`, no new migration. C3/C4/C5 all reference cents → dollars (not micro → dollars). If true microcent precision is later required, it's a separate spec amendment + migration.
- **Gap 3 — `KnowledgeEntry` field shape vs reality.** Spec §4.1 names `body`, `confidence: number (0-1)`, `status: 'pending_review' \| 'in_use' \| 'ignored'`; actual `memory_blocks` schema uses `content`, `confidence: 'low' \| 'normal'`, and `status: 'active' \| 'draft' \| 'pending_review' \| 'rejected'`. **Resolution:** C2's mapper translates DB shape → spec contract at the route layer:
  - `body` ← `content` (DB column name).
  - `confidence: number` derived: `'low' → 0.4`, `'normal' → 0.85`. Numeric-score enrichment is deferred upstream.
  - `status` mapping: DB `'active'` → contract `'in_use'`; DB `'draft' \| 'pending_review'` → contract `'pending_review'`; DB `'rejected'` → contract `'ignored'`. Approve writes DB `'active'`; reject writes DB `'rejected'`. The contract surface stays the spec's three-value enum.
  - `kind` does not exist on `memory_blocks`. C2 returns `'observation'` as default until a per-block `kind` field lands. Contract type is unchanged; semantics are best-effort. Documented in C2's mapper test.
- **Gap 4 — Spec lists `agentBeliefService.ts` as the auto-extraction pipeline; reality has multiple writers (`memoryBlockService`, `memoryBlockVersionService`, brief-finalisation paths).** **Resolution:** C1's gate is implemented in `memoryBlockService.upsertBlock()` (or its closest equivalent — confirmed by grepping `INSERT INTO memory_blocks` and `UPDATE memory_blocks SET content`). The single-gate-point invariant is preserved by funnelling auto-extraction writes through one helper that consults `auto_update_disabled` before writing.
- **Gap 5 — `integration_connections.providerType` is a closed union; spec §4.6 mentions `'salesforce' \| 'linear' \| 'notion' \| 'zoom' \| 'mixpanel'` not in the enum.** **Resolution:** spec's enumeration is illustrative; the unified `Connection.provider: string` contract on the wire stays open-ended. C6's mapper passes the DB enum value through as a string. No new providers added.

These five gaps DO NOT change scope (still 13 chunks, still one migration that adds two columns, still no new tables) — they only clarify the mapping between spec contract and existing reality.

## 4. Architecture notes

### Cross-cutting invariants (apply to every chunk)

These invariants are extracted from spec §4.0 / §6 / §4.9 and locked here as a single reference. Every chunk that touches a list endpoint, an enum mapper, an ETag-protected write, a body hash, a top-N ranking, a structured log, or a per-kind connection tester MUST cite the relevant invariant by ID. Builder rejects chunks that drift from these.

**I1 — Pagination is cursor-only seek pagination; SQL `OFFSET` is forbidden for mutable lists.** Cursors are opaque base64url-encoded JSON of `{ primary, id }`. Page predicate is a tuple comparison: ASC sort uses `WHERE (primary, id) > (cursor.primary, cursor.id)`; DESC sort uses `<`. Comparison direction MUST invert with `sortDir`. `LIMIT $limit + 1` detects more-rows-available; the next cursor is built from the last in-page row. Concurrent inserts may cause a row to appear on two adjacent pages, but they MUST NEVER cause a row to be skipped (seek-pagination guarantee). Any pseudocode in this plan that reads `OFFSET cursor-derived` is shorthand for the tuple `WHERE` clause above and MUST be implemented as such; literal SQL `OFFSET` is rejected at code review. Applies to: C2 list, C3 list, C6 list.

**I2 — Unknown DB enum values fail closed.** Every DB→contract enum mapper (`dbStatusToContract`, `authTypeToContract`, `deriveStatus`, future mappers) throws on inputs outside the documented domain rather than returning a default. The thrown error is structured (`{ code: 'UNKNOWN_ENUM_VALUE', enumName, value }`); the route catches, logs (per I7), and returns HTTP 500. Silent collapse to a default contract value is forbidden because a future schema extension would silently break the contract surface. Exception: `chargeTypeToContractType` is a documented placeholder that returns `'other'` for every current value (see plan §3 R3) — when `agent_charges.charge_type` gains values not yet known, that mapper SHOULD also fail closed, not silently widen to `'other'`. Applies to: C2 (knowledge status), C3 (charge type), C6 (auth + status).

**I3 — ETag concurrency returns HTTP 412 Precondition Failed, never merges.** Endpoints that accept `expectedEtag` return 412 with `{ error: 'etag_mismatch', errorCode: 'etag_mismatch', currentEtag }` on mismatch. Server MUST NOT attempt to merge the submitted body against the current row. Clients are expected to re-fetch and retry. HTTP 409 is reserved for state-transition pre-condition violations (`invalid_state_transition` with `currentStatus`). The two error classes have distinct HTTP statuses so clients can route them differently. Applies to: C2 (`POST /api/knowledge/:id/override`).

**I4 — Body-hash canonicalisation order is locked.** `canonicaliseBody(input)`: (a) Unicode NFC; (b) replace `\r\n` and lone `\r` with `\n`; (c) trim leading and trailing whitespace (including newlines); (d) collapse all internal runs of Unicode whitespace (`\s+`, including newlines and tabs) to a single ASCII space; (e) preserve case. The canonical form contains no newlines. Two bodies that differ only in line-ending convention, leading/trailing whitespace, or internal whitespace runs hash identically. The order matters — alternate orderings produce different hashes for visually-identical inputs. Applies to: C2 (`knowledgeOverridePure.canonicaliseBody`).

**I5 — Connection-test 10-second envelope is monotonic-anchored end-to-end.** Both the budget check and `latencyMs` derive from `process.hrtime.bigint()`. The dispatcher races against an `AbortController` whose abort timer is scheduled via `setTimeout`, but elapsed-time accounting on success AND on timeout reads `hrtime` at resolve time. No code path computes elapsed time from `Date.now()` or wall-clock subtraction. Per-kind testers disable internal SDK retries (or bound them within the same envelope). On timeout, `latencyMs` is `~10000` (within `setTimeout` jitter); on hard timeout the response is `{ status: 'failed', error: { code: 'TIMEOUT', message: 'Provider did not respond within 10s.' } }`. Applies to: C6 (`testConnection`).

**I6 — Top-N ranking and synthetic Other rollup are fully deterministic.** Every comparator used to slice "top N" or to build the synthetic Other group ends with `id` (string `localeCompare`) as the ultimate tiebreaker — descending direction matches the primary sort. Without this, two workspaces with identical primary sort value AND identical name would oscillate between Top-N and Other across requests, churning the synthetic Other set. Applies to: C4 (`buildTrends`, `computeInsights.topSpender`, `computeInsights.fastestGrower`, `computeInsights.mostActiveAgent`).

**I7 — Structured logs always carry tenant and correlation context.** Every server-side log entry in this stream includes (where available): `organisationId`, `subaccountId` (or `workspaceId`), `requestId` / `correlationId`, `actorUserId`, plus an action-specific `kind` field. Govern is an admin / governance surface — operational debugging depends on tenant context being present on every line. Pure-function modules log nothing; thin wrapper services and routes use the existing structured logger and supply these fields at the call site. Reuses the existing logger helper (search `serverLogger\|logger.info\|structuredLog` for the helper name; if absent, the chunk uses `console.log(JSON.stringify(...))` with the same shape and notes the helper name to introduce in a follow-up). Applies to: C1, C2, C3, C4, C5, C6 routes + service write paths.

**I8 — `TODO C<n>` markers must not survive a chunk's commit.** Plan-level placeholders embedded in pseudocode (`TODO C2 step 4`, `TODO C6 step 4`, etc.) are deliberate scaffolding to keep the plan readable. Builder MUST replace every such marker with full implementation BEFORE running G1. Per-chunk pre-commit gate: `git diff --cached -G "TODO C[0-9]" --name-only` must return empty. If any line matches, the commit is rejected and the builder finishes the implementation. CI also runs the same grep against the full server tree as a belt-and-braces check.

### Decisions

**D1 — `auto_update_disabled` is a column on `memory_blocks`, never a status value.** Spec §4.1 §6 lock the closed three-value status enum (`pending_review | in_use | ignored`) and treat `auto_update_disabled` as a side-channel boolean. Migration adds the column with `default false not null`, RLS unchanged. Considered and rejected: encoding override as a fourth status (creates dual meaning); a separate `block_overrides` table (over-engineered).

**D2 — Body-hash canonicalisation lives in a single pure helper.** Spec §6 locks the order: NFC → trim → collapse internal whitespace → preserve case, then SHA-256 hex lower-case. C2 ships `server/services/knowledgeOverridePure.ts` with `canonicaliseBody(input)` + `hashBody(canonical)`. The override route calls `canonicaliseBody` → `hashBody` → `INSERT INTO memory_block_versions (..., body_hash) ON CONFLICT (memory_block_id, body_hash) WHERE body_hash IS NOT NULL DO NOTHING RETURNING …`. Idempotency drops out of the unique constraint; no application-level dedup check.

**D3 — Pure aggregators are SQL-anchored but the maths is pure.** `spendInsightsServicePure.ts` and `spendTrendsServicePure.ts` accept already-loaded row sets and compute rankings, deltas, top-5, Other-rollup. The thin wrapper service handles the DB read with a single CTE (snapshot consistency) and passes rows to the pure helper. Considered and rejected: doing the ranking entirely in SQL window functions — works but the delta-vs-zero-previous-month logic is more readable in TypeScript and easier to unit-test.

**D4 — Connection `testConnection()` is a per-kind dispatcher with a shared 10s monotonic envelope.** `connectionTokenService.testConnection({ id, kind })` reads the connection, dispatches to a per-kind tester (`testOAuthGmail`, `testOAuthSlack`, `testWebLogin`, `testMcp`, `testApiKey`), wraps the dispatch in `Promise.race([dispatcher, timeoutPromise(10_000)])` where `timeoutPromise` is anchored to `process.hrtime.bigint()`. Per-kind testers MUST disable internal SDK retries — documented in JSDoc; reviewed in C6. Always returns 200 with `{ status, latencyMs, testedAt, error?, capabilities? }`.

**D5 — Unified connections list is a UNION across `integration_connections` + `mcp_server_configs`.** Existing schema splits OAuth + API key into `integration_connections` and MCP into `mcp_server_configs`. C6's unified `GET /api/connections` issues a single SQL with two `SELECT … UNION ALL SELECT …` arms (both org-scoped) and projects rows into the `Connection` shape. The `authMethod` enum maps from the existing `auth_type` column. Considered and rejected: a new unified table — would require a backfill migration; out of scope per spec §3 ("Extend").

**D6 — One `KnowledgePage` reading `useViewMode()`, not two pages.** Spec §3 audit row hedges between separate `KnowledgePage` + `OrgKnowledgePage` and a single page with view-mode toggle. **Decision:** single `client/src/pages/govern/KnowledgePage.tsx` that switches data source on `viewMode`. Workspace view scopes to active client; org view shows cross-subaccount roll-up. Same pattern as `SpendingPage`. Per foundation §9 single-row-per-stream policy this also keeps the sidebar clean.

**D7 — Charts are page-scoped vanilla SVG, not foundation primitives.** Spec §2 non-goal 5 + §5 file inventory locate `SpendBarChart`, `SpendTrendChart`, `CapUtilisationChart` under `client/src/pages/govern/components/`. Each is a function component that takes a typed data array and renders an inline `<svg>` with hand-rolled scaling. No D3, no Recharts. Considered and rejected: adding a chart library — bundle weight not justified for three single-page charts.

### Patterns applied

- **Single SQL statement / CTE for snapshot consistency** (spec §4.0, §4.10) — list endpoints with `filterOptions` and the connection-usage aggregator.
- **State-based idempotency** for approve/reject (spec §6).
- **Key-based + ETag idempotency** for override (spec §6).
- **Pure-function extraction** (spec §8) — every aggregator pairs a SQL-touching wrapper with a `*Pure.ts` colocated module + `*Pure.test.ts` sibling.
- **Composition over inheritance** — pages compose `<PageShell>` + `<SortableTable>` + `<SearchBox>` + `<Modal>` + `<ConfirmDialog>` directly. No higher-order wrappers.

### Patterns deliberately not applied

- **No new state-management library.** Page state is local; cross-page state lives in foundation `useViewMode`.
- **No new chart library.** Three vanilla SVG components per spec §2.
- **No new permission keys.** Existing `requireOrgPermission` / `requireSubaccountPermission` chains stay.
- **No bulk operations / CSV export / audit-log UI.** Per spec §10, all deferred.

## 5. Pre-existing schema reconciliation (read before C1)

Before any chunk runs, the builder confirms these mappings by grepping the codebase. Mismatches block execution; each is resolved in §3 above.

| Spec contract | Existing reality | Source of truth | Mapping action |
|---|---|---|---|
| `KnowledgeEntry.body` | `memory_blocks.content` (text NOT NULL) | reality | Mapper `body ← content` at C2's route layer. |
| `KnowledgeEntry.confidence: number (0-1)` | `memory_blocks.confidence: 'low' \| 'normal'` | reality | Mapper: `'low' → 0.4`, `'normal' → 0.85`. |
| `KnowledgeEntry.status: 'pending_review' \| 'in_use' \| 'ignored'` | `memory_blocks.status: 'active' \| 'draft' \| 'pending_review' \| 'rejected'` | spec | Mapper: `'active' → 'in_use'`, `'draft' \| 'pending_review' → 'pending_review'`, `'rejected' → 'ignored'`. |
| `KnowledgeEntry.kind: 'belief' \| 'fact' \| 'observation' \| 'preference' \| 'issue'` | not on `memory_blocks` | spec | Default `'observation'`; deferred upstream enrichment. Documented in C2 mapper test. |
| `auto_update_disabled` | column does not exist | spec | C1 migration adds. |
| `memory_block_versions.body_hash` | column does not exist | spec | C1 migration adds + partial unique index. |
| `LedgerRow.costUsd` | `agent_charges.amount_minor: bigint` (cents) | reality | `costUsd = Number(amount_minor) / 100`. NOT microcents. |
| `Connection.authMethod: 'oauth' \| 'api_key' \| 'web_login' \| 'mcp' \| 'cookie'` | `integration_connections.auth_type: 'oauth2' \| 'api_key' \| 'service_account' \| 'github_app' \| 'web_login'` + MCP from `mcp_server_configs` (treated as `'mcp'`) | spec | C6 mapper: `'oauth2' → 'oauth'`, `'api_key' → 'api_key'`, `'service_account' \| 'web_login' → 'web_login'`, `'github_app' → 'oauth'`, MCP rows → `'mcp'`. `'cookie'` reserved. |
| `Connection.status: 'connected' \| 'expired' \| 'failed' \| 'pending'` | `integration_connections.connection_status: 'active' \| 'revoked' \| 'error'` + `oauth_status: 'active' \| 'expired' \| 'error' \| 'disconnected'` | spec | C6 mapper: `'active' → 'connected'`, `'revoked' \| 'disconnected' → 'failed'`, `'expired' → 'expired'`, `'error' → 'failed'`. `'pending'` reserved for in-flight OAuth. |

If the builder finds a sixth mismatch, that's a `PLAN_GAP` event — pause and report.

## 6. Stepwise implementation plan

Thirteen chunks. Backend + types first (C1-C7), frontend pages second (C8-C11), wiring + doc-sync last (C12-C13).

| # | Chunk | Files (created / modified / deleted) | Depends on |
|---|---|---|---|
| C1 | Migration: `auto_update_disabled` + `memory_block_versions.body_hash` + auto-extract gate | 2 created, 2 modified | — |
| C2 | Knowledge route: list + approve / reject / override + ETag + body-hash canonicalisation | 1 created, 2 modified | C1 |
| C3 | Spend Ledger: paged list endpoint + filterOptions CTE | 1 created, 2 modified | — |
| C4 | Spend Insights + Trends pure aggregators + endpoints | 4 created, 1 modified | C3 |
| C5 | Compute Budget service: extend `CapsResponse` with pace fields | 1 modified, 1 modified-test | — |
| C6 | Unified `GET /api/connections` + `/:id/usage` + `/:id/test` dispatcher | 2 created, 2 modified | — |
| C7 | `shared/types/govern.ts` + frontend API client wrappers | 2 created | C1-C6 |
| C8 | `KnowledgePage.tsx` + row + override dialog (workspace + org via view-mode) | 3 created | C7, foundation |
| C9 | `SpendingPage.tsx` Ledger tab + insights row | 2 created | C7, foundation |
| C10 | `SpendingPage.tsx` Caps tab + 3 SVG charts | 3 created, 1 modified | C9 |
| C11 | `ConnectionsPage.tsx` + test button + disconnect dialog | 3 created | C7, foundation |
| C12 | Sidebar + router wiring; legacy page delete | 2 modified, ≥3 deleted | C8, C9, C10, C11 |
| C13 | Doc-sync: `architecture.md` Govern key files | 1 modified | All |

**Dependency graph** (forward-only, acyclic): C2→C1; C4→C3; C7→{C1,C2,C3,C4,C5,C6}; C8→C7; C9→C7; C10→C9; C11→C7; C12→{C8,C9,C10,C11}; C13 closes after all others. C1, C3, C5, C6 are pairwise independent — backend builders can parallelise if desired.

Estimated effort: 6-8 days for one builder; two natural PR boundaries (backend C1-C7, frontend C8-C13).

## 7. Per-chunk detail

### Task C1 — Migration + auto-extract gate

**Spec sections:** §3 (memory_blocks audit row, "Extend"), §4.1 (source-of-truth precedence, auto-extraction skips both UPDATE and version INSERT), §6 (auto_update_disabled column, body-hash key-based idempotency), §8 (pure-function tests for the gate predicate).

**Logical responsibility:** ship the additive migration that makes the override invariant possible, update the Drizzle schema, and gate the auto-extraction pipeline on the new column.

**Files:**
- Create: `migrations/0286_govern_auto_update_disabled.sql`
- Modify: `server/db/schema/memoryBlocks.ts` (add `autoUpdateDisabled` column)
- Modify: `server/db/schema/memoryBlockVersions.ts` (add `bodyHash` column)
- Create: `server/services/memoryBlockGatePure.ts` (pure predicate)
- Create: `server/services/__tests__/memoryBlockGatePure.test.ts`
- Modify: `server/services/memoryBlockService.ts` (call gate before any auto-extraction write)

- [ ] **Step 1: Confirm next migration number**
  Run: `git ls-files migrations | sort | tail -5`
  Expected: latest is `0285_subaccounts_external_id_namespace.sql`. Next is `0286`.
  If a higher number exists (e.g. another in-flight branch landed), bump to next free integer and report.

- [ ] **Step 2: Confirm spec gaps from §5 still apply**
  Run: `grep -n "auto_update_disabled\|body_hash" server/db/schema/memoryBlocks.ts server/db/schema/memoryBlockVersions.ts migrations/`
  Expected: no matches. Both columns are still missing → migration is needed.

- [ ] **Step 3: Write migration `migrations/0286_govern_auto_update_disabled.sql`**
  ```sql
  -- 0286_govern_auto_update_disabled.sql
  -- Consolidation C — Govern (spec.md §4.1, §6)
  --
  -- Adds:
  --   1. memory_blocks.auto_update_disabled — Edit-and-override marker. Auto-extraction
  --      pipeline reads this column and skips BOTH the memory_blocks UPDATE and the
  --      memory_block_versions INSERT when true.
  --   2. memory_block_versions.body_hash — canonicalised SHA-256 of override body.
  --      Powers key-based idempotency via partial unique index. Nullable so legacy
  --      rows are non-blocking; new override rows always populate it.
  --
  -- RLS: column-level additions only; no policy change.

  ALTER TABLE memory_blocks
    ADD COLUMN auto_update_disabled boolean NOT NULL DEFAULT false;

  ALTER TABLE memory_block_versions
    ADD COLUMN body_hash text;

  -- Partial unique index — same canonicalised body cannot be inserted twice
  -- against the same block. Legacy rows with body_hash IS NULL are excluded
  -- so back-fill is non-blocking.
  CREATE UNIQUE INDEX memory_block_versions_block_body_hash_uq
    ON memory_block_versions (memory_block_id, body_hash)
    WHERE body_hash IS NOT NULL;
  ```

- [ ] **Step 4: Write the down-migration `migrations/0286_govern_auto_update_disabled.down.sql`**
  ```sql
  DROP INDEX IF EXISTS memory_block_versions_block_body_hash_uq;
  ALTER TABLE memory_block_versions DROP COLUMN IF EXISTS body_hash;
  ALTER TABLE memory_blocks DROP COLUMN IF EXISTS auto_update_disabled;
  ```

- [ ] **Step 5: Edit `server/db/schema/memoryBlocks.ts` to add the column**
  Insert after `appliesToDomains` (before `createdAt`):
  ```ts
  // Consolidation C — Govern (spec §4.1, §6, migration 0286).
  // True when the block has been Edit-and-overridden by a human reviewer.
  // The auto-extraction pipeline MUST consult this flag and skip BOTH the
  // memory_blocks UPDATE and the memory_block_versions INSERT when true.
  autoUpdateDisabled: boolean('auto_update_disabled').notNull().default(false),
  ```

- [ ] **Step 6: Edit `server/db/schema/memoryBlockVersions.ts` to add `bodyHash`**
  Insert after `notes`:
  ```ts
  // Consolidation C — Govern (spec §6, migration 0286).
  // Canonicalised SHA-256 (hex lower-case) of the override body. Canonicalisation
  // order: Unicode NFC → trim leading/trailing whitespace → collapse internal
  // whitespace runs to single spaces → preserve case. Powers key-based idempotency
  // via the partial unique index memory_block_versions_block_body_hash_uq.
  // Nullable for legacy rows; populated for every new row from C2 onwards.
  bodyHash: text('body_hash'),
  ```
  And register the new index in the table-config block:
  ```ts
  blockBodyHashUniq: uniqueIndex('memory_block_versions_block_body_hash_uq')
    .on(table.memoryBlockId, table.bodyHash)
    .where(sql`${table.bodyHash} IS NOT NULL`),
  ```
  Add `uniqueIndex` and `sql` imports if not already present.

- [ ] **Step 7: Run `npm run db:generate` and verify the diff**
  Expected: drizzle-kit detects the schema change and writes a metadata snapshot. The committed `migrations/0286_*.sql` is the canonical SQL — Drizzle's generated diff is reference only. If drizzle wants to issue a different statement, drop its output and keep the hand-written file.

- [ ] **Step 8: Write the gate predicate at `server/services/memoryBlockGatePure.ts`**
  ```ts
  /**
   * memoryBlockGatePure — pure predicate for the auto-extraction skip rule.
   *
   * Spec: tasks/builds/consolidation-govern/spec.md §4.1 (source-of-truth precedence).
   *
   * INVARIANT: when autoUpdateDisabled is true, the auto-extraction pipeline MUST
   * skip BOTH the memory_blocks UPDATE and the memory_block_versions INSERT.
   * Skipping only one of the two would diverge memory_blocks.body from
   * memory_block_versions audit history — silent reversion via new version rows.
   */

  export interface AutoExtractGateInput {
    autoUpdateDisabled: boolean;
    /** True if the freshly-extracted content equals the live body (no change). */
    contentUnchanged: boolean;
  }

  export interface AutoExtractGateResult {
    skipUpdate: boolean;
    skipVersionInsert: boolean;
    reason: 'override_locked' | 'no_change' | 'allowed';
  }

  /**
   * Returns the skip decision. Override-locked rows always skip both writes.
   * Unchanged content also skips both (existing semantics — preserved).
   */
  export function evaluateAutoExtractGate(
    input: AutoExtractGateInput,
  ): AutoExtractGateResult {
    if (input.autoUpdateDisabled) {
      return { skipUpdate: true, skipVersionInsert: true, reason: 'override_locked' };
    }
    if (input.contentUnchanged) {
      return { skipUpdate: true, skipVersionInsert: true, reason: 'no_change' };
    }
    return { skipUpdate: false, skipVersionInsert: false, reason: 'allowed' };
  }
  ```

- [ ] **Step 9: Write the colocated test**
  File: `server/services/__tests__/memoryBlockGatePure.test.ts`
  ```ts
  // Pure-function tests for the auto-extraction gate (spec §4.1, §8).
  import { evaluateAutoExtractGate } from '../memoryBlockGatePure.js';
  import assert from 'node:assert/strict';

  function it(name: string, fn: () => void): void {
    try { fn(); console.log(`ok — ${name}`); }
    catch (err) { console.error(`FAIL — ${name}`, err); process.exitCode = 1; }
  }

  it('override-locked + content changed → skips BOTH update and version insert', () => {
    const r = evaluateAutoExtractGate({ autoUpdateDisabled: true, contentUnchanged: false });
    assert.equal(r.skipUpdate, true);
    assert.equal(r.skipVersionInsert, true);
    assert.equal(r.reason, 'override_locked');
  });

  it('override-locked + content unchanged → still skips BOTH (override wins over no-change)', () => {
    const r = evaluateAutoExtractGate({ autoUpdateDisabled: true, contentUnchanged: true });
    assert.equal(r.skipUpdate, true);
    assert.equal(r.skipVersionInsert, true);
    assert.equal(r.reason, 'override_locked');
  });

  it('not override-locked + content unchanged → skips both (no-change semantics preserved)', () => {
    const r = evaluateAutoExtractGate({ autoUpdateDisabled: false, contentUnchanged: true });
    assert.equal(r.skipUpdate, true);
    assert.equal(r.skipVersionInsert, true);
    assert.equal(r.reason, 'no_change');
  });

  it('not override-locked + content changed → allows both writes', () => {
    const r = evaluateAutoExtractGate({ autoUpdateDisabled: false, contentUnchanged: false });
    assert.equal(r.skipUpdate, false);
    assert.equal(r.skipVersionInsert, false);
    assert.equal(r.reason, 'allowed');
  });
  ```

- [ ] **Step 10: Wire the gate into `server/services/memoryBlockService.ts` (auto-extraction write paths only)**
  - Identify every code path that performs an auto-extraction `UPDATE memory_blocks SET content = …` or its corresponding version INSERT. Likely a single helper such as `upsertBlock` or `applyAutoExtraction`. Confirm via:
    `grep -n "memoryBlocks).set\|update(memoryBlocks)\|memoryBlockVersions).values" server/services/memoryBlockService.ts server/services/memoryBlockVersionService.ts`
  - At each auto-extraction write site, before the write:
    ```ts
    import { evaluateAutoExtractGate } from './memoryBlockGatePure.js';
    // ... inside the helper:
    const gate = evaluateAutoExtractGate({
      autoUpdateDisabled: existing.autoUpdateDisabled,
      contentUnchanged: existing.content === incomingContent,
    });
    if (gate.skipUpdate && gate.skipVersionInsert) {
      // Override-locked or no-change — log at debug and return early.
      return { skipped: true, reason: gate.reason };
    }
    ```
  - Manual override paths from C2 (`POST /override`) are NOT routed through the gate — they are user-initiated and explicitly write `auto_update_disabled = true` along with the version row.

- [ ] **Step 11: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:server
  npx tsx server/services/__tests__/memoryBlockGatePure.test.ts
  ```
  Expected: lint, typecheck, build:server PASS; test prints four `ok — …` lines and exits 0.

- [ ] **Step 12: Commit**
  ```
  git add migrations/0286_govern_auto_update_disabled.sql migrations/0286_govern_auto_update_disabled.down.sql server/db/schema/memoryBlocks.ts server/db/schema/memoryBlockVersions.ts server/services/memoryBlockGatePure.ts server/services/__tests__/memoryBlockGatePure.test.ts server/services/memoryBlockService.ts
  git commit -m "feat(consolidation-govern): C1 — auto_update_disabled migration + extract gate"
  ```

**Acceptance criteria:**
- `migrations/0286_*.sql` adds both columns plus the partial unique index; down-migration is idempotent.
- Drizzle schema mirrors the SQL (typed columns + indexed `where`).
- `evaluateAutoExtractGate` is pure and the four canonical cases pass.
- Auto-extraction code paths in `memoryBlockService.ts` (and any other auto-extraction writer) consult the gate before writing both the block and the version row.
- `npm run typecheck` is clean.

### Task C2 — Knowledge list + approve / reject / override

**Spec sections:** §4.0 (list endpoint invariants — default sort `created_at DESC, id DESC`, max 50, case-insensitive `q`, `filterOptions` ORDER BY in SQL, same-snapshot CTE), §4.1 (KnowledgeEntry contract + approve/reject/override + auto_update_disabled filter + 409 invalid_state_transition pre-condition), §6 (key-based + ETag idempotency, body-hash canonicalisation, NFC + whitespace + SHA-256 hex lower-case).

**Logical responsibility:** extend the existing `knowledge.ts` route with the spec's list query parameters, add three action endpoints, and ship the canonical body-hash + status-mapper as pure functions.

**Files:**
- Create: `server/services/knowledgeOverridePure.ts` (canonicaliseBody + hashBody + status mapper)
- Create: `server/services/__tests__/knowledgeOverridePure.test.ts`
- Modify: `server/routes/knowledge.ts` (lines ~25-241; add list query params + three action endpoints)
- Modify: `server/services/knowledgeService.ts` (add `listEntries`, `approveEntry`, `rejectEntry`, `overrideEntry`)

- [ ] **Step 1: Confirm route mount path**
  Run: `grep -n "knowledgeRouter\|/api/knowledge" server/index.ts server/routes/knowledge.ts`
  Expected: existing route is mounted at `/api/subaccounts/:subaccountId/knowledge`. The unified list spec §4.1 says `GET /api/knowledge`. To support both view-mode scopes (workspace and org) without a `:subaccountId` URL segment, ADD a new top-level `/api/knowledge` route alongside the existing subaccount-scoped route. The old route stays for bookmarks; both call into the same service.

- [ ] **Step 2: Write `server/services/knowledgeOverridePure.ts`**
  ```ts
  /**
   * knowledgeOverridePure — canonicalisation + hashing + status mapping.
   *
   * Spec: tasks/builds/consolidation-govern/spec.md §4.1 (status mapping),
   *       §6 (body-hash canonicalisation + idempotency).
   */
  import { createHash } from 'node:crypto';

  /**
   * Canonicalise an override body before hashing.
   * Order locked by plan §4 invariant I4 (extends spec §6):
   *   (a) Unicode NFC normalisation
   *   (b) replace CRLF and lone CR with LF (line-ending normalisation)
   *   (c) trim leading and trailing whitespace (including newlines)
   *   (d) collapse internal runs of Unicode whitespace (\s+) to a single ASCII space
   *   (e) preserve case (override text is human-authored and case-sensitive)
   *
   * The canonical form contains no newlines. Two bodies that differ only in
   * line-ending convention or whitespace produce identical hashes.
   */
  export function canonicaliseBody(input: string): string {
    if (typeof input !== 'string') {
      throw new TypeError('canonicaliseBody: input must be string');
    }
    return input
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')   // CRLF + lone CR → LF
      .trim()
      .replace(/\s+/g, ' ');     // any whitespace run (incl. newlines, tabs) → single space
  }

  /**
   * SHA-256 hex (lower-case) of the canonicalised body.
   * Caller MUST pass the output of canonicaliseBody — this function does not re-canonicalise.
   */
  export function hashBody(canonical: string): string {
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Status mapping — DB enum ↔ contract enum.
  // DB:       'active' | 'draft' | 'pending_review' | 'rejected'
  // Contract: 'pending_review' | 'in_use' | 'ignored'
  // ---------------------------------------------------------------------------

  export type DbStatus = 'active' | 'draft' | 'pending_review' | 'rejected';
  export type ContractStatus = 'pending_review' | 'in_use' | 'ignored';

  /**
   * INVARIANT I2 — fail closed on unknown enum value.
   * A future schema extension (e.g. adding `archived`) MUST surface as an error,
   * not silently widen to a default contract value.
   */
  export class UnknownEnumValueError extends Error {
    constructor(public readonly enumName: string, public readonly value: string) {
      super(`Unknown ${enumName} value: ${value}`);
      this.name = 'UnknownEnumValueError';
    }
  }

  export function dbStatusToContract(s: DbStatus): ContractStatus {
    switch (s) {
      case 'active':         return 'in_use';
      case 'draft':
      case 'pending_review': return 'pending_review';
      case 'rejected':       return 'ignored';
      default: {
        const _exhaustive: never = s;
        throw new UnknownEnumValueError('memory_blocks.status', _exhaustive as string);
      }
    }
  }

  /**
   * Confidence mapping: DB column is binary 'low' | 'normal'; contract is 0-1 number.
   * 'low' → 0.4, 'normal' → 0.85. Documented gap (spec §5 of plan).
   */
  export function dbConfidenceToContract(c: 'low' | 'normal' | null | undefined): number {
    if (c === 'low') return 0.4;
    return 0.85;
  }

  /**
   * Pre-condition check for the override action.
   * Spec §4.1: override only allowed on 'in_use' (DB 'active') rows.
   */
  export function isOverrideAllowed(dbStatus: DbStatus): boolean {
    return dbStatus === 'active';
  }
  ```

- [ ] **Step 3: Write the colocated test `server/services/__tests__/knowledgeOverridePure.test.ts`**
  ```ts
  import {
    canonicaliseBody, hashBody,
    dbStatusToContract, dbConfidenceToContract,
    isOverrideAllowed,
    type DbStatus,
  } from '../knowledgeOverridePure.js';
  import assert from 'node:assert/strict';

  function it(name: string, fn: () => void): void {
    try { fn(); console.log(`ok — ${name}`); }
    catch (err) { console.error(`FAIL — ${name}`, err); process.exitCode = 1; }
  }

  // canonicaliseBody
  it('NFC normalises decomposed forms', () => {
    // "café" can be decomposed (e + combining acute) or composed (é).
    const decomposed = 'café';
    const composed = 'café';
    assert.equal(canonicaliseBody(decomposed), canonicaliseBody(composed));
  });
  it('trims leading and trailing whitespace', () => {
    assert.equal(canonicaliseBody('  hello  '), 'hello');
  });
  it('collapses internal whitespace runs to single space', () => {
    assert.equal(canonicaliseBody('hello   world\t\nfoo'), 'hello world foo');
  });
  it('preserves case', () => {
    assert.equal(canonicaliseBody('Hello World'), 'Hello World');
  });
  it('is idempotent', () => {
    const once = canonicaliseBody('  Hello   World  ');
    assert.equal(canonicaliseBody(once), once);
  });
  // INVARIANT I4 — line-ending convention does not affect hash identity.
  it('normalises CRLF and lone CR to LF before whitespace collapse', () => {
    assert.equal(canonicaliseBody('a\r\nb'), canonicaliseBody('a\nb'));
    assert.equal(canonicaliseBody('a\rb'),   canonicaliseBody('a\nb'));
    assert.equal(canonicaliseBody('a\r\nb'), 'a b');
  });
  it('treats trailing whitespace and trailing newline equivalently', () => {
    assert.equal(canonicaliseBody('hello   '), canonicaliseBody('hello\n\n'));
  });

  // hashBody
  it('hashBody is deterministic and lower-case hex', () => {
    const a = hashBody(canonicaliseBody('hello'));
    const b = hashBody(canonicaliseBody('hello'));
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
  it('hashBody differs for different canonical inputs', () => {
    assert.notEqual(hashBody('hello'), hashBody('world'));
  });
  it('visually identical NFC inputs hash identically', () => {
    const decomposed = 'café';
    const composed = 'café';
    assert.equal(
      hashBody(canonicaliseBody(decomposed)),
      hashBody(canonicaliseBody(composed)),
    );
  });

  // status mapping
  it('dbStatusToContract maps all four DB values', () => {
    assert.equal(dbStatusToContract('active'), 'in_use');
    assert.equal(dbStatusToContract('draft'), 'pending_review');
    assert.equal(dbStatusToContract('pending_review'), 'pending_review');
    assert.equal(dbStatusToContract('rejected'), 'ignored');
  });
  // INVARIANT I2 — fail closed on unknown enum value.
  it('dbStatusToContract throws UnknownEnumValueError on unknown DB value', () => {
    assert.throws(
      () => dbStatusToContract('archived' as unknown as DbStatus),
      (err: Error) => err.name === 'UnknownEnumValueError' && err.message.includes('archived'),
    );
  });

  // confidence mapping
  it('dbConfidenceToContract: low → 0.4, normal → 0.85, null → 0.85', () => {
    assert.equal(dbConfidenceToContract('low'), 0.4);
    assert.equal(dbConfidenceToContract('normal'), 0.85);
    assert.equal(dbConfidenceToContract(null), 0.85);
    assert.equal(dbConfidenceToContract(undefined), 0.85);
  });

  // override pre-condition
  it('isOverrideAllowed is true only on DB active', () => {
    assert.equal(isOverrideAllowed('active'), true);
    assert.equal(isOverrideAllowed('draft'), false);
    assert.equal(isOverrideAllowed('pending_review'), false);
    assert.equal(isOverrideAllowed('rejected'), false);
  });
  ```

- [ ] **Step 4: Add `listEntries` + `approveEntry` + `rejectEntry` + `overrideEntry` to `server/services/knowledgeService.ts`**
  Place the new exports below the existing helpers; they call into the `memory_blocks` table directly.

  ```ts
  // ── Govern (spec §4.1, §4.0, §6) ───────────────────────────────────────────

  import { eq, and, isNull, sql, desc, asc, inArray } from 'drizzle-orm';
  import { memoryBlocks, memoryBlockVersions } from '../db/schema/index.js';
  import { db } from '../db/index.js';
  import {
    canonicaliseBody, hashBody,
    dbStatusToContract, dbConfidenceToContract,
    isOverrideAllowed,
    type DbStatus, type ContractStatus,
  } from './knowledgeOverridePure.js';

  export interface ListEntriesQuery {
    organisationId: string;
    scope: 'workspace' | 'org';
    subaccountId?: string;
    status?: ContractStatus[];
    autoUpdateDisabled?: boolean;
    kind?: string[];                          // not yet projected onto memory_blocks; stored for future use
    agent?: string[];
    q?: string;
    cursor?: string | null;
    limit: number;                            // already clamped to 50 by the route
    sortKey: 'createdAt' | 'updatedAt' | 'confidence' | 'sourceAgent' | 'kind' | 'status';
    sortDir: 'asc' | 'desc';
  }

  export interface KnowledgeEntryRow {
    id: string;
    kind: 'belief' | 'fact' | 'observation' | 'preference' | 'issue';
    body: string;
    confidence: number;
    status: ContractStatus;
    source: { runId: string; agentName: string; extractedAt: string };
    subaccount: { id: string; name: string } | null;
    autoUpdateDisabled: boolean;
    lastEditedBy: { kind: 'auto' | 'manual'; userId: string | null; at: string } | null;
    /** ETag — opaque to the client; used by /override concurrency check. */
    etag: string;
  }

  export interface ListEntriesResult {
    rows: KnowledgeEntryRow[];
    cursor: string | null;
    filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
  }

  /**
   * List knowledge entries.
   *
   * INVARIANTS (spec §4.0):
   * - Default ORDER BY ends with id (tiebreaker direction follows primary sort).
   * - limit clamped ≤ 50.
   * - q = case-insensitive partial substring against body, source.agentName, source.runId.
   * - filterOptions counts come from the same base-query CTE as rows.
   * - filterOptions sorted by `count DESC, value ASC` IN SQL (not JS).
   */
  export async function listEntries(query: ListEntriesQuery): Promise<ListEntriesResult> {
    const limit = Math.min(query.limit, 50);
    // Build the base CTE — apply org scoping + RLS-friendly filters first, then
    // derive both the row page and the filterOptions counts from the same snapshot.
    // Implementation note: a single SQL with `WITH base AS (...)`, then
    //   SELECT … FROM base ORDER BY <sortKey>, id LIMIT $limit OFFSET cursor-derived
    //   UNION the filterOption rollups via lateral aggregations.
    // The builder writes the SQL with drizzle's `db.execute(sql\`…\`)` for the CTE
    // arm and a typed parameteriser for the cursor.
    // See spec §4.0 for the contract; the SQL is mechanical from there.
    // ...
    throw new Error('TODO C2 step 4 — see plan');
  }

  export async function approveEntry(opts: {
    organisationId: string;
    blockId: string;
    actorUserId: string | null;
  }): Promise<{ alreadyApplied: boolean }> {
    // State-based idempotency:
    //   UPDATE memory_blocks
    //   SET status = 'active', updated_at = now()
    //   WHERE id = $1 AND organisation_id = $2 AND status IN ('draft', 'pending_review')
    //   RETURNING id;
    // Zero rows → row already in 'active' or 'rejected' → return { alreadyApplied: true }.
    throw new Error('TODO C2 step 4');
  }

  export async function rejectEntry(opts: {
    organisationId: string;
    blockId: string;
    actorUserId: string | null;
  }): Promise<{ alreadyApplied: boolean }> {
    // State-based:
    //   UPDATE memory_blocks
    //   SET status = 'rejected', updated_at = now()
    //   WHERE id = $1 AND organisation_id = $2 AND status <> 'rejected'
    //   RETURNING id;
    throw new Error('TODO C2 step 4');
  }

  export async function overrideEntry(opts: {
    organisationId: string;
    blockId: string;
    body: string;
    expectedEtag: string;
    actorUserId: string | null;
  }): Promise<
    | { ok: true; status: 'in_use'; etag: string; created: boolean }
    | { ok: false; reason: 'state'; currentStatus: ContractStatus }
    | { ok: false; reason: 'etag_mismatch'; currentEtag: string }
    | { ok: false; reason: 'not_found' }
  > {
    const canonical = canonicaliseBody(opts.body);
    const bodyHash = hashBody(canonical);
    return db.transaction(async (tx) => {
      // Lock + read
      const [row] = await tx
        .select({
          id: memoryBlocks.id,
          status: memoryBlocks.status,
          updatedAt: memoryBlocks.updatedAt,
          autoUpdateDisabled: memoryBlocks.autoUpdateDisabled,
          content: memoryBlocks.content,
        })
        .from(memoryBlocks)
        .where(and(
          eq(memoryBlocks.id, opts.blockId),
          eq(memoryBlocks.organisationId, opts.organisationId),
          isNull(memoryBlocks.deletedAt),
        ));
      if (!row) return { ok: false, reason: 'not_found' as const };

      if (!isOverrideAllowed(row.status as DbStatus)) {
        return {
          ok: false, reason: 'state' as const,
          currentStatus: dbStatusToContract(row.status as DbStatus),
        };
      }

      // ETag check
      const currentEtag = row.updatedAt.toISOString();
      if (currentEtag !== opts.expectedEtag) {
        return { ok: false, reason: 'etag_mismatch' as const, currentEtag };
      }

      // Insert version row keyed by (block_id, body_hash). Idempotent via
      // partial unique index.
      const inserted = await tx
        .insert(memoryBlockVersions)
        .values({
          memoryBlockId: opts.blockId,
          content: canonical,
          version: sql`(
            COALESCE((SELECT MAX(version) FROM memory_block_versions WHERE memory_block_id = ${opts.blockId}), 0) + 1
          )`,
          createdByUserId: opts.actorUserId,
          changeSource: 'manual_edit',
          bodyHash,
        })
        .onConflictDoNothing({ target: [memoryBlockVersions.memoryBlockId, memoryBlockVersions.bodyHash] })
        .returning({ id: memoryBlockVersions.id });

      const created = inserted.length > 0;

      // Always set auto_update_disabled = true; only update content + updatedAt
      // when a new version row was actually inserted.
      const [updated] = created
        ? await tx
            .update(memoryBlocks)
            .set({
              content: canonical,
              autoUpdateDisabled: true,
              updatedAt: new Date(),
              lastEditedByAgentId: null,
            })
            .where(eq(memoryBlocks.id, opts.blockId))
            .returning({ updatedAt: memoryBlocks.updatedAt })
        : await tx
            .update(memoryBlocks)
            .set({ autoUpdateDisabled: true, updatedAt: new Date() })
            .where(eq(memoryBlocks.id, opts.blockId))
            .returning({ updatedAt: memoryBlocks.updatedAt });

      return {
        ok: true as const, status: 'in_use' as const,
        etag: updated.updatedAt.toISOString(), created,
      };
    });
  }
  ```

  Note: builder fills in `listEntries` and `approveEntry`/`rejectEntry` mechanically per the SQL contract above. The `TODO C2 step 4 — see plan` markers must NOT remain at commit time — they exist only as placeholders for the route call shape and must be replaced with full implementations before C2's commit step.

- [ ] **Step 5: Add the unified `GET /api/knowledge` route to `server/routes/knowledge.ts`**
  Mount above the existing subaccount-scoped routes. Wire the `q` parameter, sort, cursor, and limit per spec §4.0; clamp `limit` to 50; return `{ rows, cursor, filterOptions }`.
  ```ts
  import { listEntries, approveEntry, rejectEntry, overrideEntry } from '../services/knowledgeService.js';

  const knowledgeListQuery = z.object({
    scope: z.enum(['workspace', 'org']).optional().default('workspace'),
    status: z.array(z.enum(['pending_review', 'in_use', 'ignored'])).optional(),
    autoUpdateDisabled: z.coerce.boolean().optional(),
    kind: z.array(z.enum(['belief', 'fact', 'observation', 'preference', 'issue'])).optional(),
    agent: z.array(z.string()).optional(),
    q: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(25),
    sortKey: z.enum(['createdAt', 'updatedAt', 'confidence', 'sourceAgent', 'kind', 'status']).optional().default('createdAt'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
  });

  router.get(
    '/api/knowledge',
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
    asyncHandler(async (req, res) => {
      const q = knowledgeListQuery.parse(req.query);
      // For workspace scope, require an active subaccount in the request context.
      const result = await listEntries({
        organisationId: req.orgId!,
        scope: q.scope,
        subaccountId: q.scope === 'workspace' ? (req.activeSubaccountId ?? undefined) : undefined,
        status: q.status,
        autoUpdateDisabled: q.autoUpdateDisabled,
        kind: q.kind,
        agent: q.agent,
        q: q.q,
        cursor: q.cursor ?? null,
        limit: q.limit,
        sortKey: q.sortKey,
        sortDir: q.sortDir,
      });
      res.json(result);
    }),
  );
  ```

  Note: `req.activeSubaccountId` is the existing helper (search `req.activeSubaccountId\|getActiveSubaccount`). If the helper is unavailable on this code path, fall back to a header `X-Subaccount-Id` and `resolveSubaccount(headerValue, req.orgId!)`. Document the choice in the route comment.

- [ ] **Step 6: Add three action endpoints**
  ```ts
  router.post(
    '/api/knowledge/:id/approve',
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
    asyncHandler(async (req, res) => {
      const result = await approveEntry({
        organisationId: req.orgId!, blockId: req.params.id, actorUserId: req.user?.id ?? null,
      });
      res.json(result);
    }),
  );

  router.post(
    '/api/knowledge/:id/reject',
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
    asyncHandler(async (req, res) => {
      const result = await rejectEntry({
        organisationId: req.orgId!, blockId: req.params.id, actorUserId: req.user?.id ?? null,
      });
      res.json(result);
    }),
  );

  const overrideBody = z.object({
    body: z.string().min(1).max(MEMORY_BLOCK_CONTENT_MAX),
    expectedEtag: z.string().min(1),
  });

  router.post(
    '/api/knowledge/:id/override',
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
    validateBody(overrideBody, 'warn'),
    asyncHandler(async (req, res) => {
      const { body, expectedEtag } = req.body as z.infer<typeof overrideBody>;
      const result = await overrideEntry({
        organisationId: req.orgId!, blockId: req.params.id,
        body, expectedEtag, actorUserId: req.user?.id ?? null,
      });
      if (result.ok) {
        res.json({ status: result.status, etag: result.etag, created: result.created });
        return;
      }
      switch (result.reason) {
        case 'state':
          res.status(409).json({
            error: 'invalid_state_transition',
            errorCode: 'invalid_state_transition',
            currentStatus: result.currentStatus,
          });
          return;
        case 'etag_mismatch':
          // INVARIANT I3 — ETag mismatch is HTTP 412 Precondition Failed (NOT 409).
          // 409 is reserved for state-transition pre-condition violations
          // (invalid_state_transition above). Server does NOT merge; client re-fetches.
          res.status(412).json({
            error: 'etag_mismatch',
            errorCode: 'etag_mismatch',
            currentEtag: result.currentEtag,
          });
          return;
        case 'not_found':
          res.status(404).json({ error: 'Knowledge entry not found' });
          return;
      }
    }),
  );
  ```

- [ ] **Step 7: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:server
  npx tsx server/services/__tests__/knowledgeOverridePure.test.ts
  ```
  Expected: lint, typecheck, build:server PASS; test prints all `ok — …` lines and exits 0.

- [ ] **Step 7b: Invariant I8 TODO grep gate**
  ```
  git diff --cached -G "TODO C[0-9]" --name-only
  ```
  Expected: empty output. Any matching file means a `TODO C2 step …` placeholder was left in the staged code; finish the implementation before committing.

- [ ] **Step 8: Commit**
  ```
  git add server/services/knowledgeOverridePure.ts server/services/__tests__/knowledgeOverridePure.test.ts server/services/knowledgeService.ts server/routes/knowledge.ts
  git commit -m "feat(consolidation-govern): C2 — knowledge list + approve/reject/override + body-hash idempotency"
  ```

**Acceptance criteria:**
- `canonicaliseBody` and `hashBody` are pure and deterministic; tests prove NFC normalisation collapses decomposed/composed equivalents to the same hash.
- `listEntries` returns `{ rows, cursor, filterOptions }`; default sort is `created_at DESC, id DESC`; `limit` is clamped to 50; `q` is case-insensitive partial substring; `filterOptions` is sorted by `count DESC, value ASC` in SQL.
- `approveEntry` / `rejectEntry` are state-based idempotent (zero affected rows → `alreadyApplied: true`).
- `overrideEntry` returns 409 `invalid_state_transition` (with `currentStatus`) when row is not `'in_use'`, 412 `etag_mismatch` (with `currentEtag`) when ETag mismatches, and 200 `{ status: 'in_use', etag, created }` on success. Same canonical body submitted twice → `created: false`, no new version row. (Per invariant I3 — 412 is the standard for ETag concurrency; 409 is reserved for state-transition violations.)
- `npm run typecheck` is clean; build:server passes.

### Task C3 — Spend Ledger paged list + filterOptions CTE

**Spec sections:** §4.0 (default `timestamp DESC, id DESC` sort, max 50, case-insensitive `q`, single-snapshot CTE for filterOptions, `ORDER BY count DESC, value ASC` IN SQL), §4.2 (LedgerQuery + LedgerRow contract), §6 (cost precision — see plan §3 Gap 2: cents not microcents; divide by 100 at the API boundary), §8 (pure-function tests).

**Logical responsibility:** add a paged ledger-list endpoint that surfaces `agent_charges` rows with multi-select filters (workspace / agent / type) + sort. Existing `/api/agent-charges` route is partially overlapping — extend it to support the spec's contract OR add a sibling `GET /api/spend/ledger`. Decision below.

**Files:**
- Create: `server/services/spendLedgerServicePure.ts` (cursor encode/decode, status mapping, costUsd projection)
- Create: `server/services/__tests__/spendLedgerServicePure.test.ts`
- Create: `server/services/spendLedgerService.ts` (single CTE — rows + filterOptions snapshot)
- Modify: `server/routes/agentCharges.ts` (add `GET /api/spend/ledger`; existing `/api/agent-charges` left untouched for backward compatibility)
- Modify: `server/index.ts` (no new mount — `/api/spend/ledger` is added in `agentCharges.ts` and the existing router is already mounted)

- [ ] **Step 1: Confirm route mount**
  Run: `grep -n "agentChargesRouter\|/api/agent-charges\|/api/spend" server/index.ts server/routes/agentCharges.ts`
  Expected: existing `/api/agent-charges` routes mounted via `agentChargesRouter`. The new endpoint sits in the same file (it's the same domain). `/api/spend/ledger`, `/api/spend/insights`, `/api/spend/trends`, `/api/spend/caps` all live in this router.

- [ ] **Step 2: Confirm cost-precision invariant**
  Run: `grep -n "amount_minor\|costCents\|microcents\|costUsd" server/db/schema/agentCharges.ts server/db/schema/costAggregates.ts`
  Expected: `agent_charges.amount_minor: bigint` (cents), `cost_aggregates.totalCostCents: integer` (cents). The mapper divides by 100 (NOT 1_000_000). Per plan §3 Gap 2.

- [ ] **Step 3: Write `server/services/spendLedgerServicePure.ts`**
  ```ts
  /**
   * spendLedgerServicePure — pure helpers for the Ledger list endpoint.
   *
   * Spec: tasks/builds/consolidation-govern/spec.md §4.0, §4.2, §6.
   *
   * INVARIANTS:
   * - Cursor encodes (primarySortValue, id) in the effective sort order so pagination
   *   is stable across rows with identical sort values, across concurrent writes,
   *   and across ASC/DESC overrides (spec §4.0).
   * - costUsd projection: amount_minor (bigint, cents) / 100. NOT microcents.
   *   See plan §3 Gap 2 — spec §6 says "integer microcents" but reality uses ISO 4217
   *   minor units (cents). The integer-precision invariant is preserved; only the
   *   denominator changes.
   */

  export type LedgerSortKey = 'timestamp' | 'workspace' | 'agent' | 'type' | 'tokens' | 'cost';
  export type SortDir = 'asc' | 'desc';

  export interface CursorPayload {
    /** Stringified primary sort value. Date as ISO string, number as decimal. */
    primary: string;
    id: string;
  }

  export function encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  export function decodeCursor(input: string): CursorPayload | null {
    try {
      const json = Buffer.from(input, 'base64url').toString('utf8');
      const parsed = JSON.parse(json) as unknown;
      if (
        typeof parsed === 'object' && parsed !== null &&
        'primary' in parsed && 'id' in parsed &&
        typeof (parsed as CursorPayload).primary === 'string' &&
        typeof (parsed as CursorPayload).id === 'string'
      ) {
        return parsed as CursorPayload;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Project amount_minor (cents) → dollars for the API contract.
   * Integer-precision aware: the bigint is divided by 100 then converted to number.
   * For values up to ~9 quadrillion cents this is safe in float64; values larger
   * than Number.MAX_SAFE_INTEGER are not realistic for a single row.
   */
  export function amountMinorToCostUsd(amountMinor: bigint | number): number {
    const n = typeof amountMinor === 'bigint' ? Number(amountMinor) : amountMinor;
    return n / 100;
  }

  /**
   * Sum a list of integer-cent amounts and return USD with two-decimal precision.
   * Sums in integer cents to avoid float drift across the aggregator.
   */
  export function sumCostUsd(amountsMinor: ReadonlyArray<bigint | number>): number {
    let sum = 0n;
    for (const a of amountsMinor) {
      sum += typeof a === 'bigint' ? a : BigInt(Math.round(a));
    }
    return Number(sum) / 100;
  }

  /**
   * Map agent_charges.charge_type → contract LedgerRow.type.
   * Existing values: 'purchase' | 'subscription' | 'top_up' | 'invoice_payment' | 'refund'.
   * Contract values: 'llm' | 'embedding' | 'tool_call' | 'storage' | 'other'.
   *
   * Note: agent_charges is the agentic-commerce ledger and does not currently track
   * llm/embedding/tool_call splits. The Govern Ledger spec contract anticipates an
   * LLM-cost ledger; this mapper is a placeholder that returns 'other' for all
   * known agentic-commerce rows. If the build needs the LLM dimension in the same
   * view, the route UNIONs `agent_charges` with `llm_requests` (or its successor)
   * — call out as PLAN_GAP if reality requires it; do not silently invent the data.
   *
   * INVARIANT I2 — fail closed on UNKNOWN charge types. Future schema additions
   * (e.g. `chargeback`, `tax`) MUST surface as a thrown error, not silently widen
   * to 'other'. Callers can catch and choose to log + fall back to 'other' at the
   * route boundary if that is the desired UX, but this pure mapper does not decide.
   */
  export type DbChargeType =
    'purchase' | 'subscription' | 'top_up' | 'invoice_payment' | 'refund';

  export function chargeTypeToContractType(
    db: DbChargeType,
  ): 'llm' | 'embedding' | 'tool_call' | 'storage' | 'other' {
    switch (db) {
      case 'purchase':
      case 'subscription':
      case 'top_up':
      case 'invoice_payment':
      case 'refund':
        return 'other';
      default: {
        const _exhaustive: never = db;
        throw new Error(`UnknownEnumValue: agent_charges.charge_type=${_exhaustive as string}`);
      }
    }
  }
  ```

- [ ] **Step 4: Write the colocated test `server/services/__tests__/spendLedgerServicePure.test.ts`**
  ```ts
  import {
    encodeCursor, decodeCursor,
    amountMinorToCostUsd, sumCostUsd,
    chargeTypeToContractType,
  } from '../spendLedgerServicePure.js';
  import assert from 'node:assert/strict';

  function it(name: string, fn: () => void): void {
    try { fn(); console.log(`ok — ${name}`); }
    catch (err) { console.error(`FAIL — ${name}`, err); process.exitCode = 1; }
  }

  it('encodeCursor/decodeCursor round-trips', () => {
    const payload = { primary: '2026-05-07T12:00:00.000Z', id: 'abc-123' };
    assert.deepEqual(decodeCursor(encodeCursor(payload)), payload);
  });
  it('decodeCursor returns null on garbage', () => {
    assert.equal(decodeCursor('not-base64'), null);
    assert.equal(decodeCursor(''), null);
  });
  it('amountMinorToCostUsd: 12345 cents → 123.45', () => {
    assert.equal(amountMinorToCostUsd(12345), 123.45);
    assert.equal(amountMinorToCostUsd(12345n), 123.45);
  });
  it('sumCostUsd sums integer cents without float drift', () => {
    // 0.10 + 0.20 in dollars is 0.30000000000000004 due to float;
    // summed in integer cents (10 + 20) it is exactly 0.30.
    assert.equal(sumCostUsd([10n, 20n]), 0.3);
    assert.equal(sumCostUsd([10, 20, 30]), 0.6);
  });
  it('chargeTypeToContractType returns other for all current values', () => {
    assert.equal(chargeTypeToContractType('purchase'), 'other');
    assert.equal(chargeTypeToContractType('subscription'), 'other');
    assert.equal(chargeTypeToContractType('top_up'), 'other');
    assert.equal(chargeTypeToContractType('invoice_payment'), 'other');
    assert.equal(chargeTypeToContractType('refund'), 'other');
  });
  // INVARIANT I2 — fail closed when DB introduces a value the mapper has not
  // been updated for. Prevents silent contract drift.
  it('chargeTypeToContractType throws on unknown DB charge type', () => {
    assert.throws(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => chargeTypeToContractType('chargeback' as any),
      /UnknownEnumValue/,
    );
  });
  ```

- [ ] **Step 5: Write `server/services/spendLedgerService.ts` with a single-CTE list+filterOptions read**
  ```ts
  import { db } from '../db/index.js';
  import { sql } from 'drizzle-orm';
  import {
    encodeCursor, decodeCursor,
    amountMinorToCostUsd,
    chargeTypeToContractType,
  } from './spendLedgerServicePure.js';

  export interface LedgerListInput {
    organisationId: string;
    scope: 'workspace' | 'org';
    subaccountId?: string;
    workspace?: string[];
    agent?: string[];
    type?: Array<'llm' | 'embedding' | 'tool_call' | 'storage' | 'other'>;
    from?: Date;
    to?: Date;
    q?: string;
    cursor: string | null;
    limit: number;
    sortKey: 'timestamp' | 'workspace' | 'agent' | 'type' | 'tokens' | 'cost';
    sortDir: 'asc' | 'desc';
  }

  export interface LedgerRowOut {
    id: string;
    timestamp: string;
    workspace: { id: string; name: string };
    agent: { id: string; name: string };
    type: 'llm' | 'embedding' | 'tool_call' | 'storage' | 'other';
    provider: string;
    model: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    costUsd: number;
  }

  export interface LedgerListResult {
    rows: LedgerRowOut[];
    cursor: string | null;
    filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
  }

  /**
   * Single-snapshot CTE: WITH base AS (SELECT ... FROM agent_charges
   *   LEFT JOIN subaccounts ... LEFT JOIN agents ... WHERE org-scoped + structured filters),
   *   page AS (SELECT * FROM base WHERE (primary, id) <op> (cursor.primary, cursor.id) ORDER BY <sortKey>, id <sortDir> LIMIT $limit + 1) — see invariant I1, seek pagination only,
   *   ws_options AS (SELECT subaccount_id AS value, MAX(name) AS label, COUNT(*) AS count
   *                  FROM base GROUP BY subaccount_id ORDER BY count DESC, label ASC),
   *   agent_options AS (...similar...),
   *   type_options AS (SELECT 'other' AS value, 'Other' AS label, COUNT(*) AS count FROM base ...).
   *
   * Returns rows from `page` and filterOptions from the *_options CTEs in one
   * round trip. Counts are computed from the same `base` snapshot — counts and
   * rows cannot diverge under concurrent writes (spec §4.0).
   *
   * `q` filters via `ILIKE '%<q>%'` against agent.name and subaccount.name composed with AND.
   * filterOptions ORDER BY happens IN SQL (not JS) per spec §4.0.
   */
  export async function listLedger(input: LedgerListInput): Promise<LedgerListResult> {
    const limit = Math.min(input.limit, 50);
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;

    // Construct the SQL with drizzle's tagged template. The CTE structure below is
    // mandatory — do not split into multiple round trips. See spec §4.0.
    const result = await db.execute(sql`
      WITH base AS (
        SELECT
          ac.id, ac.created_at AS timestamp, ac.subaccount_id, sa.name AS subaccount_name,
          ac.agent_id, a.label AS agent_name,
          ac.charge_type, ac.merchant_descriptor AS provider, ac.amount_minor
        FROM agent_charges ac
        LEFT JOIN subaccounts sa ON sa.id = ac.subaccount_id
        LEFT JOIN agents a ON a.id = ac.agent_id
        WHERE ac.organisation_id = ${input.organisationId}
          ${input.scope === 'workspace' && input.subaccountId
            ? sql`AND ac.subaccount_id = ${input.subaccountId}`
            : sql``}
          ${input.workspace?.length
            ? sql`AND ac.subaccount_id = ANY(${input.workspace})`
            : sql``}
          ${input.agent?.length
            ? sql`AND ac.agent_id = ANY(${input.agent})`
            : sql``}
          ${input.from
            ? sql`AND ac.created_at >= ${input.from.toISOString()}`
            : sql``}
          ${input.to
            ? sql`AND ac.created_at <= ${input.to.toISOString()}`
            : sql``}
          ${input.q
            ? sql`AND (a.label ILIKE ${'%' + input.q + '%'} OR sa.name ILIKE ${'%' + input.q + '%'})`
            : sql``}
      ),
      ordered AS (
        -- INVARIANT I1 — seek pagination via tuple comparison, NEVER SQL OFFSET.
        -- For ASC sort the tuple comparator is strict-greater-than; for DESC it is
        -- strict-less-than. The cursor's primary column is cast to the sort column's
        -- type at the parameter site (timestamptz here; numeric for cost/tokens).
        SELECT * FROM base
        ${cursor
          ? sql`WHERE (${sql.raw(primarySortCol(input.sortKey))}, id) ${sql.raw(input.sortDir === 'asc' ? '>' : '<')} (${castCursorPrimary(input.sortKey, cursor.primary)}, ${cursor.id})`
          : sql``}
        ORDER BY
          ${sql.raw(orderClause(input.sortKey, input.sortDir))},
          id ${sql.raw(input.sortDir === 'asc' ? 'ASC' : 'DESC')}
        LIMIT ${limit + 1}
      ),
      ws_options AS (
        SELECT subaccount_id::text AS value, MAX(subaccount_name) AS label, COUNT(*)::int AS count
        FROM base WHERE subaccount_id IS NOT NULL
        GROUP BY subaccount_id
        ORDER BY count DESC, label ASC
      ),
      agent_options AS (
        SELECT agent_id::text AS value, MAX(agent_name) AS label, COUNT(*)::int AS count
        FROM base WHERE agent_id IS NOT NULL
        GROUP BY agent_id
        ORDER BY count DESC, label ASC
      )
      SELECT
        (SELECT json_agg(row_to_json(ordered.*)) FROM ordered) AS rows,
        (SELECT json_agg(row_to_json(ws_options.*)) FROM ws_options) AS workspace_options,
        (SELECT json_agg(row_to_json(agent_options.*)) FROM agent_options) AS agent_options
    `);

    // Project rows into LedgerRowOut (camelCase, costUsd) and emit cursor of last row when limit+1 hit.
    // Implementation detail left to the builder — straightforward mapping.
    return /* projected */ {} as LedgerListResult;
  }

  function orderClause(key: LedgerListInput['sortKey'], dir: LedgerListInput['sortDir']): string {
    return `${primarySortCol(key)} ${dir === 'asc' ? 'ASC' : 'DESC'}`;
  }

  function primarySortCol(key: LedgerListInput['sortKey']): string {
    return ({
      timestamp: 'timestamp',
      workspace: 'subaccount_name',
      agent: 'agent_name',
      type: 'charge_type',
      tokens: 'amount_minor', // tokens not yet projected; sort by amount as proxy
      cost: 'amount_minor',
    } satisfies Record<LedgerListInput['sortKey'], string>)[key];
  }

  /**
   * Cast the cursor's stringified primary value to the column's SQL type so the
   * tuple comparator type-checks. `timestamp` → `timestamptz`; numeric columns
   * → `bigint`; text columns → no cast.
   */
  function castCursorPrimary(key: LedgerListInput['sortKey'], raw: string) {
    switch (key) {
      case 'timestamp': return sql`${raw}::timestamptz`;
      case 'tokens':
      case 'cost':     return sql`${raw}::bigint`;
      case 'workspace':
      case 'agent':
      case 'type':     return sql`${raw}::text`;
    }
  }
  ```

  Note: builder fills the row-projection step using `amountMinorToCostUsd` and `chargeTypeToContractType`. The `LIMIT $limit + 1` pattern detects "more rows available"; emit the next cursor from the last in-page row. `tokensIn`/`tokensOut`/`model` are nullable in the contract — set to `null` for `agent_charges` rows since the schema does not track them.

- [ ] **Step 6: Add `GET /api/spend/ledger` to `server/routes/agentCharges.ts`**
  Mount at the bottom of the existing router so it does not shadow the `/aggregates` route. Wire query params + 50-clamp + view-mode scoping.
  ```ts
  import { listLedger } from '../services/spendLedgerService.js';
  import { z } from 'zod';

  const ledgerQuery = z.object({
    scope: z.enum(['workspace', 'org']).optional().default('workspace'),
    workspace: z.union([z.string(), z.array(z.string())]).optional(),
    agent: z.union([z.string(), z.array(z.string())]).optional(),
    type: z.union([
      z.enum(['llm', 'embedding', 'tool_call', 'storage', 'other']),
      z.array(z.enum(['llm', 'embedding', 'tool_call', 'storage', 'other'])),
    ]).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    q: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(25),
    sortKey: z.enum(['timestamp', 'workspace', 'agent', 'type', 'tokens', 'cost']).optional().default('timestamp'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
  });

  router.get(
    '/api/spend/ledger',
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
    asyncHandler(async (req, res) => {
      const q = ledgerQuery.parse(req.query);
      const result = await listLedger({
        organisationId: req.orgId!,
        scope: q.scope,
        subaccountId: q.scope === 'workspace' ? (req.activeSubaccountId ?? undefined) : undefined,
        workspace: arrayify(q.workspace),
        agent: arrayify(q.agent),
        type: arrayify(q.type),
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        q: q.q,
        cursor: q.cursor ?? null,
        limit: q.limit,
        sortKey: q.sortKey,
        sortDir: q.sortDir,
      });
      res.json(result);
    }),
  );

  function arrayify<T>(v: T | T[] | undefined): T[] | undefined {
    if (v === undefined) return undefined;
    return Array.isArray(v) ? v : [v];
  }
  ```

- [ ] **Step 7: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:server
  npx tsx server/services/__tests__/spendLedgerServicePure.test.ts
  ```
  Expected: PASS.

- [ ] **Step 8: Commit**
  ```
  git add server/services/spendLedgerServicePure.ts server/services/__tests__/spendLedgerServicePure.test.ts server/services/spendLedgerService.ts server/routes/agentCharges.ts
  git commit -m "feat(consolidation-govern): C3 — spend ledger paged list with single-CTE filterOptions"
  ```

**Acceptance criteria:**
- `GET /api/spend/ledger` returns `{ rows, cursor, filterOptions }` per spec contract.
- Default sort `created_at DESC, id DESC`; tiebreaker direction follows `sortDir`.
- `limit` clamped to 50.
- `q` is case-insensitive partial substring against `agent.name + workspace.name`.
- Single SQL statement (CTE) returns rows AND filterOptions from the same snapshot.
- `filterOptions` ordered by `count DESC, value ASC` IN SQL.
- `costUsd` derived by integer-cents / 100 (per plan §3 Gap 2).
- Pure-function tests pass.

### Task C4 — Spend Insights + Trends pure aggregators + endpoints

**Spec sections:** §4.4 (SpendInsights — UTC-anchored MTD, deltaPct vs previous full calendar month, runs30d rolling 30 calendar days, previous-month-zero → null), §4.5 (SpendTrends — top-4 by current MTD plus synthetic `__other__` at index 4 when actual_workspace_count > 5; zero/null cap → unbounded; `capUsage6mo[i] = null` and NOT counted as blown), §6 (cost precision — cents not microcents per Gap 2), §8 (pure-function tests for ranking + delta + Other-rollup + cap classification).

**Logical responsibility:** ship two new pure aggregators and their HTTP endpoints. Both org-scope only.

**Files:**
- Create: `server/services/spendInsightsServicePure.ts`
- Create: `server/services/__tests__/spendInsightsServicePure.test.ts`
- Create: `server/services/spendInsightsService.ts` (thin wrapper — single-CTE DB read, calls pure)
- Create: `server/services/spendTrendsServicePure.ts`
- Create: `server/services/__tests__/spendTrendsServicePure.test.ts`
- Create: `server/services/spendTrendsService.ts` (thin wrapper)
- Modify: `server/routes/agentCharges.ts` (add `GET /api/spend/insights` + `GET /api/spend/trends`)

(Strictly speaking that's six new files — collapsing the pure + wrapper pair counts as one logical unit per service. The chunk creates 4 plus 2 modifies the route file = 5 changes.)

- [ ] **Step 1: Confirm time-window helpers**
  Run: `grep -rn "startOfMonth\|firstDayOfMonth\|monthStart" server/lib`
  If a date-fns or in-house helper is already present, reuse it. Otherwise the pure module ships its own UTC-only `startOfMonth(date: Date)` helper with full unit tests.

- [ ] **Step 2: Write `server/services/spendInsightsServicePure.ts`**
  ```ts
  /**
   * spendInsightsServicePure — pure rankings + deltas for the org-scope insights tiles.
   *
   * Spec: §4.4. UTC throughout. Cost precision: cents → USD via /100 (plan §3 Gap 2).
   *
   * Inputs are pre-filtered/aggregated by the wrapper; this module is pure maths.
   */

  export interface WorkspaceMonthlySpend {
    workspaceId: string;
    workspaceName: string;
    /** Current calendar-month MTD spend in integer cents. */
    mtdCents: number;
    /** Previous full calendar month spend in integer cents. Null when no prior data. */
    prevMonthCents: number | null;
  }

  export interface AgentRunCount {
    agentId: string;
    agentName: string;
    workspaceId: string;
    workspaceName: string;
    /** Rolling 30 calendar days ending now. */
    runs30d: number;
  }

  export interface SpendInsightsOutput {
    topSpender: {
      workspace: { id: string; name: string };
      mtdUsd: number;
      pctOfOrgTotal: number;
      /** null when prevMonthCents was 0 or null. */
      deltaPct: number | null;
    } | null;
    fastestGrower: {
      workspace: { id: string; name: string };
      /** null when prevMonthCents was 0 or null. */
      deltaPct: number | null;
    } | null;
    mostActiveAgent: {
      agent: { id: string; name: string };
      runs30d: number;
      workspace: { id: string; name: string };
    } | null;
  }

  /**
   * Compute deltaPct for a single workspace.
   * Returns null when prev is 0 or null (avoids divide-by-zero AND meaningless infinite growth).
   * Negative values allowed (decline). Spec §4.4.
   */
  export function computeDeltaPct(currentCents: number, prevCents: number | null): number | null {
    if (prevCents === null || prevCents === 0) return null;
    return ((currentCents - prevCents) / prevCents) * 100;
  }

  /** Centralised cents → USD with 4 decimal precision (caller may round at render time). */
  export function centsToUsd(cents: number): number {
    return Math.round(cents) / 100;
  }

  export function computeInsights(
    spends: ReadonlyArray<WorkspaceMonthlySpend>,
    runs: ReadonlyArray<AgentRunCount>,
  ): SpendInsightsOutput {
    if (spends.length === 0 && runs.length === 0) {
      return { topSpender: null, fastestGrower: null, mostActiveAgent: null };
    }

    const orgTotalMtdCents = spends.reduce((acc, w) => acc + w.mtdCents, 0);

    // INVARIANT I6 — every comparator ends with id as the ultimate tiebreaker.
    // Without this, two workspaces with identical primary AND identical name
    // would oscillate between Top-N positions across requests.
    // topSpender: max mtdCents; tie-break by descending workspace name, then by id (asc, lexicographic).
    const topSpenderRow = [...spends].sort((a, b) =>
      b.mtdCents - a.mtdCents
      || b.workspaceName.localeCompare(a.workspaceName)
      || a.workspaceId.localeCompare(b.workspaceId),
    )[0] ?? null;

    // fastestGrower: max deltaPct (skipping null deltas).
    const grower = spends
      .map((w) => ({ w, delta: computeDeltaPct(w.mtdCents, w.prevMonthCents) }))
      .filter((x): x is { w: WorkspaceMonthlySpend; delta: number } => x.delta !== null)
      .sort((a, b) =>
        b.delta - a.delta
        || b.w.workspaceName.localeCompare(a.w.workspaceName)
        || a.w.workspaceId.localeCompare(b.w.workspaceId),
      )[0];

    const mostActive = [...runs].sort((a, b) =>
      b.runs30d - a.runs30d
      || b.agentName.localeCompare(a.agentName)
      || a.agentId.localeCompare(b.agentId),
    )[0] ?? null;

    return {
      topSpender: topSpenderRow
        ? {
            workspace: { id: topSpenderRow.workspaceId, name: topSpenderRow.workspaceName },
            mtdUsd: centsToUsd(topSpenderRow.mtdCents),
            pctOfOrgTotal: orgTotalMtdCents === 0 ? 0 : (topSpenderRow.mtdCents / orgTotalMtdCents) * 100,
            deltaPct: computeDeltaPct(topSpenderRow.mtdCents, topSpenderRow.prevMonthCents),
          }
        : null,
      fastestGrower: grower
        ? {
            workspace: { id: grower.w.workspaceId, name: grower.w.workspaceName },
            deltaPct: grower.delta,
          }
        : null,
      mostActiveAgent: mostActive
        ? {
            agent: { id: mostActive.agentId, name: mostActive.agentName },
            runs30d: mostActive.runs30d,
            workspace: { id: mostActive.workspaceId, name: mostActive.workspaceName },
          }
        : null,
    };
  }
  ```

- [ ] **Step 3: Write `server/services/__tests__/spendInsightsServicePure.test.ts`**
  ```ts
  import {
    computeDeltaPct, computeInsights, centsToUsd,
  } from '../spendInsightsServicePure.js';
  import assert from 'node:assert/strict';

  function it(name: string, fn: () => void): void {
    try { fn(); console.log(`ok — ${name}`); }
    catch (err) { console.error(`FAIL — ${name}`, err); process.exitCode = 1; }
  }

  it('deltaPct: prev 0 → null (no infinite growth)', () => {
    assert.equal(computeDeltaPct(100, 0), null);
  });
  it('deltaPct: prev null → null', () => {
    assert.equal(computeDeltaPct(100, null), null);
  });
  it('deltaPct: prev 100, current 150 → +50', () => {
    assert.equal(computeDeltaPct(150, 100), 50);
  });
  it('deltaPct: prev 100, current 50 → -50 (negative allowed)', () => {
    assert.equal(computeDeltaPct(50, 100), -50);
  });
  it('topSpender returns null deltaPct when previous month was zero', () => {
    const out = computeInsights(
      [{ workspaceId: 'a', workspaceName: 'A', mtdCents: 5000, prevMonthCents: 0 }],
      [],
    );
    assert.equal(out.topSpender?.deltaPct, null);
  });
  it('topSpender pctOfOrgTotal = mtd/sum*100', () => {
    const out = computeInsights(
      [
        { workspaceId: 'a', workspaceName: 'A', mtdCents: 6000, prevMonthCents: null },
        { workspaceId: 'b', workspaceName: 'B', mtdCents: 4000, prevMonthCents: null },
      ],
      [],
    );
    assert.equal(out.topSpender?.pctOfOrgTotal, 60);
  });
  it('fastestGrower picks max deltaPct, skipping null deltas', () => {
    const out = computeInsights(
      [
        { workspaceId: 'a', workspaceName: 'A', mtdCents: 200, prevMonthCents: 100 }, // +100%
        { workspaceId: 'b', workspaceName: 'B', mtdCents: 300, prevMonthCents: 0 },   // null
        { workspaceId: 'c', workspaceName: 'C', mtdCents: 150, prevMonthCents: 100 }, // +50%
      ],
      [],
    );
    assert.equal(out.fastestGrower?.workspace.id, 'a');
  });
  it('fastestGrower can be null when no workspace has comparable prevMonth', () => {
    const out = computeInsights(
      [{ workspaceId: 'a', workspaceName: 'A', mtdCents: 200, prevMonthCents: 0 }],
      [],
    );
    assert.equal(out.fastestGrower, null);
  });
  it('mostActiveAgent ranks by runs30d', () => {
    const out = computeInsights([], [
      { agentId: 'a', agentName: 'A', workspaceId: 'w', workspaceName: 'W', runs30d: 5 },
      { agentId: 'b', agentName: 'B', workspaceId: 'w', workspaceName: 'W', runs30d: 12 },
    ]);
    assert.equal(out.mostActiveAgent?.agent.id, 'b');
    assert.equal(out.mostActiveAgent?.runs30d, 12);
  });
  it('empty inputs → all-null output', () => {
    const out = computeInsights([], []);
    assert.deepEqual(out, { topSpender: null, fastestGrower: null, mostActiveAgent: null });
  });
  it('centsToUsd: 12345 → 123.45', () => {
    assert.equal(centsToUsd(12345), 123.45);
  });
  ```

- [ ] **Step 4: Write `server/services/spendInsightsService.ts` (thin DB wrapper)**
  Reads from `agent_charges` (filtered to settled / executed states) and `agent_runs` (or its successor). Single CTE returns three pre-aggregated arrays:
  ```ts
  import { db } from '../db/index.js';
  import { sql } from 'drizzle-orm';
  import { computeInsights, type SpendInsightsOutput } from './spendInsightsServicePure.js';

  export async function getSpendInsights(opts: { organisationId: string }): Promise<SpendInsightsOutput> {
    // UTC anchors:
    //   monthStart  = date_trunc('month', now() AT TIME ZONE 'UTC')
    //   prevStart   = monthStart - INTERVAL '1 month'
    //   prevEnd     = monthStart - INTERVAL '1 microsecond' (last microsecond of previous month)
    //   runsCutoff  = now() - INTERVAL '30 days'
    const result = await db.execute(sql`
      WITH ws_mtd AS (
        SELECT subaccount_id AS ws_id,
               (SELECT name FROM subaccounts WHERE id = subaccount_id) AS ws_name,
               SUM(amount_minor)::bigint AS mtd_cents
        FROM agent_charges
        WHERE organisation_id = ${opts.organisationId}
          AND status IN ('executed', 'succeeded', 'settled')
          AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
        GROUP BY subaccount_id
      ),
      ws_prev AS (
        SELECT subaccount_id AS ws_id,
               SUM(amount_minor)::bigint AS prev_cents
        FROM agent_charges
        WHERE organisation_id = ${opts.organisationId}
          AND status IN ('executed', 'succeeded', 'settled')
          AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') - INTERVAL '1 month'
          AND created_at <  date_trunc('month', now() AT TIME ZONE 'UTC')
        GROUP BY subaccount_id
      ),
      runs AS (
        SELECT a.id AS agent_id, a.label AS agent_name,
               a.subaccount_id AS ws_id,
               (SELECT name FROM subaccounts WHERE id = a.subaccount_id) AS ws_name,
               COUNT(ar.id)::int AS runs30d
        FROM agent_runs ar JOIN agents a ON a.id = ar.agent_id
        WHERE ar.organisation_id = ${opts.organisationId}
          AND ar.created_at >= now() - INTERVAL '30 days'
        GROUP BY a.id, a.label, a.subaccount_id
      )
      SELECT
        (SELECT json_agg(json_build_object(
          'workspaceId', ws_mtd.ws_id::text, 'workspaceName', ws_mtd.ws_name,
          'mtdCents', ws_mtd.mtd_cents,
          'prevMonthCents', (SELECT prev_cents FROM ws_prev WHERE ws_prev.ws_id = ws_mtd.ws_id)
        )) FROM ws_mtd) AS spends,
        (SELECT json_agg(json_build_object(
          'agentId', runs.agent_id::text, 'agentName', runs.agent_name,
          'workspaceId', runs.ws_id::text, 'workspaceName', runs.ws_name,
          'runs30d', runs.runs30d
        )) FROM runs) AS runs;
    `);

    const row = result.rows[0] as { spends: unknown[] | null; runs: unknown[] | null };
    const spends = (row.spends ?? []).map((r) => {
      const x = r as { workspaceId: string; workspaceName: string; mtdCents: string | number; prevMonthCents: string | number | null };
      return {
        workspaceId: x.workspaceId,
        workspaceName: x.workspaceName,
        mtdCents: Number(x.mtdCents),
        prevMonthCents: x.prevMonthCents === null ? null : Number(x.prevMonthCents),
      };
    });
    const runs = (row.runs ?? []) as Parameters<typeof computeInsights>[1];
    return computeInsights(spends, runs);
  }
  ```

  Note: `agent_runs` table reference is illustrative. Builder confirms with `grep -n "agentRuns\|agent_runs" server/db/schema/`. Adjust to the actual table (likely `agentRuns` mapping to `agent_runs`). If `agent_runs.organisation_id` doesn't exist, scope via `JOIN subaccounts sa ON sa.id = a.subaccount_id WHERE sa.organisation_id = $1`.

- [ ] **Step 5: Write `server/services/spendTrendsServicePure.ts`**
  ```ts
  /**
   * spendTrendsServicePure — top-4 ranking + synthetic Other rollup + cap classification.
   *
   * Spec: §4.5.
   *
   * INVARIANTS:
   * - Top-4 by current MTD spend; tie-break by descending alphabetical workspace name.
   * - actual_workspace_count <= 5: array length is the actual count; no Other entry.
   * - actual_workspace_count >  5: top-4 + synthetic Other at index 4. id='__other__', name='Other'.
   *   spend6mo[i] = sum of non-top-4 workspaces' spend6mo[i].
   *   capUsage6mo[i]: cap-zero/null workspaces contribute 0 to summed cap (their spend
   *   still contributes to summed spend). Aggregate capUsage = (sumSpend / sumCap) * 100,
   *   except when sumCap is 0 → null at that index. capBlownAt = first index where
   *   aggregate capUsage > 100, else null. null months are NOT counted as blown.
   * - For individual (non-Other) workspaces: cap > 0 → capUsage = (spend/cap)*100;
   *   cap == 0 || cap == null → capUsage[i] = null AND not blown.
   */

  export interface WorkspaceTrendInput {
    workspaceId: string;
    workspaceName: string;
    /** Length 6, oldest → current month, integer cents. */
    spend6moCents: number[];
    /** Length 6. cents/month or null where unbounded. */
    cap6moCents: Array<number | null>;
    /** Current MTD spend cents — used for ranking. */
    currentMtdCents: number;
  }

  export interface WorkspaceTrendOutput {
    id: string;
    name: string;
    spend6mo: number[];
    capUsage6mo: Array<number | null>;
    capBlownAt: number | null;
  }

  export interface TrendsOutput {
    workspaces: WorkspaceTrendOutput[];
    monthLabels: string[];
  }

  /** Centralised cents → USD with 2 decimal precision. */
  export function centsToUsdRounded(cents: number): number {
    return Math.round(cents) / 100;
  }

  /**
   * Classify a single month's cap utilisation for an individual workspace.
   * Returns null when cap is 0 or null (unbounded).
   */
  export function classifyCapUsage(spendCents: number, capCents: number | null): number | null {
    if (capCents === null || capCents === 0) return null;
    return (spendCents / capCents) * 100;
  }

  /** First index where capUsage > 100, treating null as "not blown". Spec §4.5. */
  export function firstBlownIndex(capUsage: ReadonlyArray<number | null>): number | null {
    for (let i = 0; i < capUsage.length; i++) {
      const v = capUsage[i];
      if (v !== null && v > 100) return i;
    }
    return null;
  }

  /**
   * Project per-workspace usage and capBlownAt for the contract.
   */
  export function projectIndividual(w: WorkspaceTrendInput): WorkspaceTrendOutput {
    const capUsage6mo = w.spend6moCents.map((s, i) => classifyCapUsage(s, w.cap6moCents[i]));
    return {
      id: w.workspaceId,
      name: w.workspaceName,
      spend6mo: w.spend6moCents.map(centsToUsdRounded),
      capUsage6mo,
      capBlownAt: firstBlownIndex(capUsage6mo),
    };
  }

  /**
   * Build the synthetic Other rollup from non-top-4 workspaces.
   * Cap-zero/null contributors add 0 to summed cap; their spend still contributes.
   * When summedCap[i] is 0, capUsage6mo[i] is null at that index.
   */
  export function projectOther(rest: ReadonlyArray<WorkspaceTrendInput>): WorkspaceTrendOutput {
    const len = 6;
    const summedSpend: number[] = Array(len).fill(0);
    const summedCap: number[] = Array(len).fill(0);
    for (const w of rest) {
      for (let i = 0; i < len; i++) {
        summedSpend[i] += w.spend6moCents[i];
        const c = w.cap6moCents[i];
        summedCap[i] += c === null ? 0 : c;
      }
    }
    const capUsage6mo = summedSpend.map((s, i) => summedCap[i] === 0 ? null : (s / summedCap[i]) * 100);
    return {
      id: '__other__',
      name: 'Other',
      spend6mo: summedSpend.map(centsToUsdRounded),
      capUsage6mo,
      capBlownAt: firstBlownIndex(capUsage6mo),
    };
  }

  /**
   * Top-4 + Other rollup orchestration.
   */
  export function buildTrends(
    workspaces: ReadonlyArray<WorkspaceTrendInput>,
    monthLabels: string[],
  ): TrendsOutput {
    // INVARIANT I6 — fully deterministic ordering. Final tiebreaker is workspaceId
    // (lexicographic asc) so the synthetic Other set is stable across requests.
    const sorted = [...workspaces].sort((a, b) =>
      b.currentMtdCents - a.currentMtdCents
      || b.workspaceName.localeCompare(a.workspaceName)   // descending alphabetical (spec §4.5)
      || a.workspaceId.localeCompare(b.workspaceId),      // final tiebreaker: id asc
    );

    if (workspaces.length <= 5) {
      return { workspaces: sorted.map(projectIndividual), monthLabels };
    }
    const top4 = sorted.slice(0, 4).map(projectIndividual);
    const rest = sorted.slice(4);
    return { workspaces: [...top4, projectOther(rest)], monthLabels };
  }
  ```

- [ ] **Step 6: Write `server/services/__tests__/spendTrendsServicePure.test.ts`**
  ```ts
  import {
    classifyCapUsage, firstBlownIndex,
    projectIndividual, projectOther, buildTrends,
  } from '../spendTrendsServicePure.js';
  import assert from 'node:assert/strict';

  function it(name: string, fn: () => void): void {
    try { fn(); console.log(`ok — ${name}`); }
    catch (err) { console.error(`FAIL — ${name}`, err); process.exitCode = 1; }
  }

  // classifyCapUsage
  it('classifyCapUsage: spend 50, cap 100 → 50%', () => {
    assert.equal(classifyCapUsage(50, 100), 50);
  });
  it('classifyCapUsage: spend 150, cap 100 → 150 (over cap)', () => {
    assert.equal(classifyCapUsage(150, 100), 150);
  });
  it('classifyCapUsage: cap 0 → null (unbounded)', () => {
    assert.equal(classifyCapUsage(50, 0), null);
  });
  it('classifyCapUsage: cap null → null (unbounded)', () => {
    assert.equal(classifyCapUsage(50, null), null);
  });

  // firstBlownIndex
  it('firstBlownIndex returns first > 100', () => {
    assert.equal(firstBlownIndex([50, 80, 110, 90]), 2);
  });
  it('firstBlownIndex skips nulls (null is not blown)', () => {
    assert.equal(firstBlownIndex([null, null, 110]), 2);
    assert.equal(firstBlownIndex([null, null, null]), null);
  });
  it('firstBlownIndex returns null when nothing blown', () => {
    assert.equal(firstBlownIndex([50, 80, 90]), null);
  });

  // projectOther — synthetic rollup with zero-cap = unbounded contributor
  it('projectOther: zero-cap workspace contributes 0 to summed cap but spend still counts', () => {
    const rest = [
      {
        workspaceId: 'a', workspaceName: 'A',
        spend6moCents: [100, 100, 100, 100, 100, 100],
        cap6moCents: [200, 200, 200, 200, 200, 200],
        currentMtdCents: 100,
      },
      {
        workspaceId: 'b', workspaceName: 'B',
        spend6moCents: [50, 50, 50, 50, 50, 50],
        cap6moCents: [0, 0, 0, 0, 0, 0],   // unbounded
        currentMtdCents: 50,
      },
    ];
    const out = projectOther(rest);
    // Summed spend per month: 150 cents, summed cap: 200 (b contributes 0). 150/200*100 = 75.
    assert.equal(out.capUsage6mo[0], 75);
    // Spend in dollars: 150 cents / 100 = 1.5
    assert.equal(out.spend6mo[0], 1.5);
    assert.equal(out.id, '__other__');
    assert.equal(out.name, 'Other');
  });
  it('projectOther: when summedCap[i] is 0 (all contributors unbounded), capUsage[i] = null', () => {
    const rest = [
      {
        workspaceId: 'a', workspaceName: 'A',
        spend6moCents: [100, 100, 100, 100, 100, 100],
        cap6moCents: [0, 0, 0, 0, 0, 0],
        currentMtdCents: 100,
      },
    ];
    const out = projectOther(rest);
    assert.equal(out.capUsage6mo[0], null);
    assert.equal(out.capBlownAt, null);
  });

  // buildTrends — top-5 ranking
  it('buildTrends: actual <= 5 workspaces → array length is actual count, no Other', () => {
    const ws = [1, 2, 3, 4, 5].map((i) => ({
      workspaceId: `w${i}`, workspaceName: `W${i}`,
      spend6moCents: [0, 0, 0, 0, 0, i * 100],
      cap6moCents: [200, 200, 200, 200, 200, 200],
      currentMtdCents: i * 100,
    }));
    const out = buildTrends(ws, ['Jan','Feb','Mar','Apr','May','Jun']);
    assert.equal(out.workspaces.length, 5);
    assert.equal(out.workspaces.every((w) => w.id !== '__other__'), true);
  });
  it('buildTrends: actual > 5 → top-4 ranked plus synthetic Other at index 4', () => {
    const ws = Array.from({ length: 7 }, (_, i) => ({
      workspaceId: `w${i}`, workspaceName: `W${i}`,
      spend6moCents: [0, 0, 0, 0, 0, (i + 1) * 100],
      cap6moCents: [200, 200, 200, 200, 200, 200],
      currentMtdCents: (i + 1) * 100,
    }));
    const out = buildTrends(ws, ['Jan','Feb','Mar','Apr','May','Jun']);
    assert.equal(out.workspaces.length, 5);
    assert.equal(out.workspaces[4].id, '__other__');
    // Top 4 by currentMtd: w6, w5, w4, w3 (700, 600, 500, 400).
    assert.deepEqual(out.workspaces.slice(0, 4).map((w) => w.id), ['w6', 'w5', 'w4', 'w3']);
  });
  it('buildTrends: ties broken by descending alphabetical workspace name', () => {
    const ws = [
      { workspaceId: 'a', workspaceName: 'Alpha', spend6moCents: [0,0,0,0,0,500], cap6moCents: [null,null,null,null,null,null], currentMtdCents: 500 },
      { workspaceId: 'b', workspaceName: 'Bravo', spend6moCents: [0,0,0,0,0,500], cap6moCents: [null,null,null,null,null,null], currentMtdCents: 500 },
    ];
    const out = buildTrends(ws, ['Jan','Feb','Mar','Apr','May','Jun']);
    // Bravo wins the tie (descending alphabetical).
    assert.equal(out.workspaces[0].id, 'b');
  });
  // INVARIANT I6 — when both spend AND name tie, id (asc) breaks the tie so
  // the synthetic Other set is stable across requests.
  it('buildTrends: id tiebreaker fires when spend AND name both tie', () => {
    const ws = [
      { workspaceId: 'id-z', workspaceName: 'Same', spend6moCents: [0,0,0,0,0,500], cap6moCents: [null,null,null,null,null,null], currentMtdCents: 500 },
      { workspaceId: 'id-a', workspaceName: 'Same', spend6moCents: [0,0,0,0,0,500], cap6moCents: [null,null,null,null,null,null], currentMtdCents: 500 },
    ];
    const out = buildTrends(ws, ['Jan','Feb','Mar','Apr','May','Jun']);
    // id-a wins (lexicographic ascending).
    assert.equal(out.workspaces[0].id, 'id-a');
  });
  ```

- [ ] **Step 7: Write `server/services/spendTrendsService.ts` (thin DB wrapper)**
  Reads 6 months of monthly spend per workspace + per-workspace caps from `compute_budgets` (or its successor). Single CTE for snapshot consistency. Builder writes the SQL straight from spec §4.5; the projection calls `buildTrends`. UTC anchors per insights service.

- [ ] **Step 8: Add `GET /api/spend/insights` and `GET /api/spend/trends` to `server/routes/agentCharges.ts`**
  Org-scope only; require `org_admin` (existing helper). Both reads are synchronous, cacheable at the route layer (no caching added in this chunk — add only if observed slow).
  ```ts
  import { getSpendInsights } from '../services/spendInsightsService.js';
  import { getSpendTrends } from '../services/spendTrendsService.js';

  router.get(
    '/api/spend/insights',
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
    asyncHandler(async (req, res) => {
      const result = await getSpendInsights({ organisationId: req.orgId! });
      res.json(result);
    }),
  );

  router.get(
    '/api/spend/trends',
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
    asyncHandler(async (req, res) => {
      const result = await getSpendTrends({ organisationId: req.orgId! });
      res.json(result);
    }),
  );
  ```

- [ ] **Step 9: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:server
  npx tsx server/services/__tests__/spendInsightsServicePure.test.ts
  npx tsx server/services/__tests__/spendTrendsServicePure.test.ts
  ```
  Expected: PASS.

- [ ] **Step 10: Commit**
  ```
  git add server/services/spendInsightsServicePure.ts server/services/__tests__/spendInsightsServicePure.test.ts server/services/spendInsightsService.ts server/services/spendTrendsServicePure.ts server/services/__tests__/spendTrendsServicePure.test.ts server/services/spendTrendsService.ts server/routes/agentCharges.ts
  git commit -m "feat(consolidation-govern): C4 — spend insights + trends pure aggregators + endpoints"
  ```

**Acceptance criteria:**
- `computeInsights`: `topSpender returns null deltaPct when previous month was zero`. `fastestGrower` skips workspaces with null delta. `mostActiveAgent` ranks by `runs30d`.
- `buildTrends`: `actual_workspace_count <= 5 → no Other entry, length is actual count`. `actual_workspace_count > 5 → top-4 + synthetic Other at index 4`. Tie-break is descending alphabetical workspace name.
- `classifyCapUsage`: `cap 0 || cap null → null` ("no cap configured / unbounded"); months with null cap NOT counted as blown by `capBlownAt`.
- `projectOther`: zero-cap contributors add 0 to summed cap, their spend still adds to summed spend; when summedCap is 0 across all rolled-up months, capUsage[i] is null at that index.
- All UTC time anchors documented in service-level JSDoc; no `Date.now()` use of local timezone.
- Both endpoints return 200 on empty data (`null` insights / `[]` workspaces). No 5xx for missing data.

### Task C5 — CapsResponse pace extension

**Spec sections:** §4.3 (CapsResponse base contract), §4.11 (period semantics — `periodResetAt`, `paceWindow`, `paceProjectedEndOfPeriodUsd`, default 7-day window), §6 (cost precision: cents → USD), §8 (pure-function tests for the pace projector).

**Logical responsibility:** extend the existing `computeBudgetService.ts` to include the spec §4.11 fields without disrupting existing callers. Pace projector is pure, separate from the read.

**Files:**
- Modify: `server/services/computeBudgetServicePure.ts` (add `projectPaceCents` + `computePeriodResetAt`)
- Modify: `server/services/__tests__/computeBudgetServicePure.test.ts` (or create if missing — `find server/services/__tests__/computeBudgetServicePure.test.ts`)
- Modify: `server/services/computeBudgetService.ts` (extend `getCaps` or its equivalent to include the new fields)
- Modify: `server/routes/agentCharges.ts` (or wherever `/api/spend/caps` is mounted; if not yet mounted, add it here)

- [ ] **Step 1: Confirm where `/api/spend/caps` is currently mounted**
  Run: `grep -rn "api/spend/caps\|getCaps\|getSpendCaps" server/routes server/services`
  Expected: not yet mounted (this is a new endpoint per spec §3 audit row "Reuse"; the read may exist as `getCaps` in `computeBudgetService` but isn't HTTP-exposed). If absent, mount in `server/routes/agentCharges.ts` at `GET /api/spend/caps` (org and workspace scope).

- [ ] **Step 2: Confirm pure-test file path**
  Run: `ls server/services/__tests__/computeBudgetServicePure.test.ts` (or equivalent). Reuse if it exists; create otherwise.

- [ ] **Step 3: Add the pure helpers to `server/services/computeBudgetServicePure.ts`**
  ```ts
  // ── Govern (spec §4.11) ────────────────────────────────────────────────────

  /**
   * Project end-of-period spend by extrapolating the last N days at the current run rate.
   * Spec §4.11. Default window 7 days.
   *
   * INVARIANT: integer-cents in, integer-cents out. No float intermediates inside the
   * extrapolation; convert to USD at the API boundary only.
   *
   * If daysElapsedInWindow <= 0 → returns currentMtdCents (cannot project from zero data).
   * If daysRemaining <= 0      → returns currentMtdCents (period ends today).
   */
  export function projectPaceCents(
    currentMtdCents: number,
    spendInWindowCents: number,
    daysElapsedInWindow: number,
    daysRemaining: number,
  ): number {
    if (daysElapsedInWindow <= 0 || daysRemaining <= 0) return currentMtdCents;
    const dailyRate = spendInWindowCents / daysElapsedInWindow;
    return Math.round(currentMtdCents + dailyRate * daysRemaining);
  }

  /**
   * Compute the period reset timestamp (UTC).
   * Calendar-month period: first instant of next calendar month.
   */
  export function computePeriodResetAt(now: Date): Date {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    return new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
  }

  /**
   * Compute days remaining in the current calendar month from `now` (UTC).
   * Returns 0 on the last day at-or-after periodResetAt - tiny epsilon (defensive).
   */
  export function daysRemainingInPeriod(now: Date): number {
    const reset = computePeriodResetAt(now);
    const ms = reset.getTime() - now.getTime();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  /** Classify pace against a cap into one of three states. Spec §4.11. */
  export function classifyPace(projectedCents: number, capCents: number): 'on_track' | 'warning' | 'over' {
    if (capCents <= 0) return 'on_track';     // unbounded; render as on track
    const pct = (projectedCents / capCents) * 100;
    if (pct > 100) return 'over';
    if (pct > 80) return 'warning';
    return 'on_track';
  }
  ```

- [ ] **Step 4: Add tests in `server/services/__tests__/computeBudgetServicePure.test.ts`**
  Append (or create the file with the imports below):
  ```ts
  import {
    projectPaceCents, computePeriodResetAt, daysRemainingInPeriod, classifyPace,
  } from '../computeBudgetServicePure.js';
  import assert from 'node:assert/strict';

  function it(name: string, fn: () => void): void {
    try { fn(); console.log(`ok — ${name}`); }
    catch (err) { console.error(`FAIL — ${name}`, err); process.exitCode = 1; }
  }

  it('projectPaceCents: 7-day window 2100¢ over 7 days, 18 days remaining → 7800¢', () => {
    // currentMtd 1200, daily 300 (2100/7), * 18 days remaining = 5400, total 6600.
    assert.equal(projectPaceCents(1200, 2100, 7, 18), 6600);
  });
  it('projectPaceCents: daysElapsedInWindow 0 → returns currentMtd (no extrapolation)', () => {
    assert.equal(projectPaceCents(1200, 0, 0, 18), 1200);
  });
  it('projectPaceCents: daysRemaining 0 → returns currentMtd', () => {
    assert.equal(projectPaceCents(1200, 2100, 7, 0), 1200);
  });
  it('computePeriodResetAt: jumps to next UTC month start', () => {
    const reset = computePeriodResetAt(new Date(Date.UTC(2026, 4, 7))); // 2026-05-07
    assert.equal(reset.toISOString(), '2026-06-01T00:00:00.000Z');
  });
  it('computePeriodResetAt: handles December → January roll', () => {
    const reset = computePeriodResetAt(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)));
    assert.equal(reset.toISOString(), '2027-01-01T00:00:00.000Z');
  });
  it('daysRemainingInPeriod returns positive number across the month', () => {
    const d = daysRemainingInPeriod(new Date(Date.UTC(2026, 4, 7)));
    assert.equal(d > 0 && d <= 31, true);
  });
  it('classifyPace: < 80% → on_track', () => {
    assert.equal(classifyPace(70, 100), 'on_track');
  });
  it('classifyPace: 80-100% → warning', () => {
    assert.equal(classifyPace(85, 100), 'warning');
    assert.equal(classifyPace(100, 100), 'warning');
  });
  it('classifyPace: > 100% → over', () => {
    assert.equal(classifyPace(120, 100), 'over');
  });
  it('classifyPace: cap 0 → on_track (unbounded)', () => {
    assert.equal(classifyPace(120, 0), 'on_track');
  });
  ```

- [ ] **Step 5: Extend the read in `server/services/computeBudgetService.ts`**
  Locate the existing caps-read function (search `function getCaps\|getCapsResponse\|orgComputeBudgets`). Add these fields to its return shape:

  ```ts
  // Existing CapsResponse shape now includes:
  //   periodResetAt: string;            // ISO
  //   paceWindow: '7d' | '14d' | '30d'; // default '7d'
  //   paceProjectedEndOfPeriodUsd: number;

  import {
    projectPaceCents, computePeriodResetAt, daysRemainingInPeriod, classifyPace,
  } from './computeBudgetServicePure.js';

  // Inside getCaps (or its equivalent):
  const now = new Date();
  const resetAt = computePeriodResetAt(now);
  const daysRemaining = daysRemainingInPeriod(now);

  // Window read: sum of agent_charges.amount_minor over the last N days, scoped per org.
  // Default window = 7 days. Read once at the org level; per-workspace projections reuse
  // the same daily rate per workspace.
  const windowDays = 7;
  // ... DB read returns spendInWindowCentsByWorkspace ...

  // For each workspace:
  //   const projected = projectPaceCents(usedMtdCents, spendInWindowCents, windowDays, daysRemaining);
  //   const status = classifyPace(projected, monthlyCapCents ?? 0);
  //   pacePct = monthlyCapCents > 0 ? Math.min(200, projected / monthlyCapCents * 100) : 0;

  // Org-level field assembly:
  return {
    scope: ...,
    orgCap: {
      monthlyUsd: orgCapCents / 100,
      usedMtdUsd: orgUsedCents / 100,
      daysRemaining,
      pace: classifyPace(orgProjectedCents, orgCapCents),
    },
    workspaces: [...],
    periodResetAt: resetAt.toISOString(),
    paceWindow: '7d',
    paceProjectedEndOfPeriodUsd: orgProjectedCents / 100,
  };
  ```

- [ ] **Step 6: Mount `GET /api/spend/caps` in `server/routes/agentCharges.ts`**
  ```ts
  import { getCapsResponse } from '../services/computeBudgetService.js';
  import { z } from 'zod';

  const capsQuery = z.object({
    scope: z.enum(['workspace', 'org']).optional().default('workspace'),
  });

  router.get(
    '/api/spend/caps',
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.SPEND_APPROVER),
    asyncHandler(async (req, res) => {
      const q = capsQuery.parse(req.query);
      const result = await getCapsResponse({
        organisationId: req.orgId!,
        scope: q.scope,
        subaccountId: q.scope === 'workspace' ? (req.activeSubaccountId ?? undefined) : undefined,
      });
      res.json(result);
    }),
  );
  ```

- [ ] **Step 7: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:server
  npx tsx server/services/__tests__/computeBudgetServicePure.test.ts
  ```
  Expected: PASS.

- [ ] **Step 8: Commit**
  ```
  git add server/services/computeBudgetServicePure.ts server/services/__tests__/computeBudgetServicePure.test.ts server/services/computeBudgetService.ts server/routes/agentCharges.ts
  git commit -m "feat(consolidation-govern): C5 — caps response pace + period semantics"
  ```

**Acceptance criteria:**
- `projectPaceCents` is purely integer-cent and matches the spec §4.11 extrapolation rule. Edge cases (`daysElapsedInWindow <= 0`, `daysRemaining <= 0`) return `currentMtdCents` without throwing.
- `computePeriodResetAt` returns first instant of next UTC calendar month; December roll handled.
- `classifyPace` thresholds: `<= 80%` → on_track, `> 80% && <= 100%` → warning, `> 100%` → over, cap 0 → on_track.
- `CapsResponse` returns `periodResetAt: string`, `paceWindow: '7d' | '14d' | '30d'`, `paceProjectedEndOfPeriodUsd: number` alongside existing fields.
- Pure-function tests pass.

### Task C6 — Unified connections list + usage aggregator + test dispatcher

**Spec sections:** §4.0 (list invariants — `created_at DESC, id DESC`, max 50, case-insensitive `q` against `name + provider`, single-snapshot CTE for `filterOptions`, ORDER BY in SQL), §4.6 (Connection contract; UNION across kinds), §4.9 (test dispatcher — always 200, monotonic 10s, structured error.code, capabilities for OAuth, SDK retries disabled), §4.10 (usage aggregator — single CTE under READ COMMITTED).

**Logical responsibility:** ship the unified list + per-id usage aggregator + per-id test dispatcher with the timeout envelope.

**Files:**
- Create: `server/services/connectionsListPure.ts` (status / authMethod mappers, cursor)
- Create: `server/services/__tests__/connectionsListPure.test.ts`
- Create: `server/services/connectionsService.ts` (UNION list, usage aggregator)
- Modify: `server/services/connectionTokenService.ts` (add `testConnection` dispatcher with monotonic timeout)
- Modify: `server/routes/integrationConnections.ts` (add `GET /api/connections`, `GET /:id/usage`, `POST /:id/test`)
- Modify: `server/index.ts` (no new mount; existing router covers — confirm)

- [ ] **Step 1: Confirm UNION sources**
  Run: `grep -rn "mcp_server_configs\|mcpServerConfigs\|integration_connections" server/db/schema/`
  Expected: `integration_connections` and `mcp_server_configs` exist. Confirm `mcp_server_configs` has `id, organisation_id, subaccount_id, name, created_at, last_*` columns; if not, document deviation.

- [ ] **Step 2: Write `server/services/connectionsListPure.ts`**
  ```ts
  /**
   * connectionsListPure — pure mappers for the unified connections list.
   *
   * Spec: §4.6 (contract), §4.0 (cursor encode/decode).
   *
   * INVARIANT: maps DB enums to the contract enum. See plan §3 Gap 5 — provider
   * is open-ended string on the wire even though the DB column is a closed union.
   */

  export type DbAuthType = 'oauth2' | 'api_key' | 'service_account' | 'github_app' | 'web_login';
  export type ContractAuthMethod = 'oauth' | 'api_key' | 'web_login' | 'mcp' | 'cookie';

  /** INVARIANT I2 — fail closed on unknown values. */
  export class UnknownEnumValueError extends Error {
    constructor(public readonly enumName: string, public readonly value: string) {
      super(`Unknown ${enumName} value: ${value}`);
      this.name = 'UnknownEnumValueError';
    }
  }

  export function authTypeToContract(t: DbAuthType): ContractAuthMethod {
    switch (t) {
      case 'oauth2':          return 'oauth';
      case 'github_app':      return 'oauth';
      case 'api_key':         return 'api_key';
      case 'service_account': return 'web_login';
      case 'web_login':       return 'web_login';
      default: {
        const _exhaustive: never = t;
        throw new UnknownEnumValueError('integration_connections.auth_type', _exhaustive as string);
      }
    }
  }

  export type DbConnectionStatus = 'active' | 'revoked' | 'error';
  export type DbOauthStatus = 'active' | 'expired' | 'error' | 'disconnected';
  export type ContractStatus = 'connected' | 'expired' | 'failed' | 'pending';

  /**
   * Effective status: oauth_status takes precedence when present (it's more specific
   * for the expired/disconnected sub-states), falling back to connection_status.
   * INVARIANT I2 — unknown values throw rather than silently mapping.
   */
  export function deriveStatus(
    connectionStatus: DbConnectionStatus,
    oauthStatus: DbOauthStatus | null,
  ): ContractStatus {
    if (oauthStatus) {
      switch (oauthStatus) {
        case 'active':       return 'connected';
        case 'expired':      return 'expired';
        case 'disconnected': return 'failed';
        case 'error':        return 'failed';
        default: {
          const _exhaustive: never = oauthStatus;
          throw new UnknownEnumValueError('integration_connections.oauth_status', _exhaustive as string);
        }
      }
    }
    switch (connectionStatus) {
      case 'active':  return 'connected';
      case 'revoked': return 'failed';
      case 'error':   return 'failed';
      default: {
        const _exhaustive: never = connectionStatus;
        throw new UnknownEnumValueError('integration_connections.connection_status', _exhaustive as string);
      }
    }
  }

  // Cursor (mirrors spendLedgerServicePure.encodeCursor pattern)
  export interface ConnCursorPayload { primary: string; id: string; }
  export function encodeConnCursor(payload: ConnCursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }
  export function decodeConnCursor(input: string): ConnCursorPayload | null {
    try {
      const parsed = JSON.parse(Buffer.from(input, 'base64url').toString('utf8')) as unknown;
      if (
        typeof parsed === 'object' && parsed !== null &&
        'primary' in parsed && 'id' in parsed
      ) return parsed as ConnCursorPayload;
      return null;
    } catch { return null; }
  }
  ```

- [ ] **Step 3: Write `server/services/__tests__/connectionsListPure.test.ts`**
  Include all enum mappings, the OAuth-status-takes-precedence rule, and cursor round-trip:
  ```ts
  import {
    authTypeToContract, deriveStatus,
    encodeConnCursor, decodeConnCursor,
  } from '../connectionsListPure.js';
  import assert from 'node:assert/strict';

  function it(name: string, fn: () => void): void {
    try { fn(); console.log(`ok — ${name}`); }
    catch (err) { console.error(`FAIL — ${name}`, err); process.exitCode = 1; }
  }

  it('authTypeToContract: oauth2 → oauth', () => assert.equal(authTypeToContract('oauth2'), 'oauth'));
  it('authTypeToContract: github_app → oauth', () => assert.equal(authTypeToContract('github_app'), 'oauth'));
  it('authTypeToContract: api_key → api_key', () => assert.equal(authTypeToContract('api_key'), 'api_key'));
  it('authTypeToContract: service_account → web_login', () => assert.equal(authTypeToContract('service_account'), 'web_login'));
  it('authTypeToContract: web_login → web_login', () => assert.equal(authTypeToContract('web_login'), 'web_login'));

  it('deriveStatus: oauth_status expired wins over connection_status active', () => {
    assert.equal(deriveStatus('active', 'expired'), 'expired');
  });
  it('deriveStatus: oauth_status disconnected → failed', () => {
    assert.equal(deriveStatus('active', 'disconnected'), 'failed');
  });
  it('deriveStatus: oauth_status null falls back to connection_status', () => {
    assert.equal(deriveStatus('active', null), 'connected');
    assert.equal(deriveStatus('revoked', null), 'failed');
    assert.equal(deriveStatus('error', null), 'failed');
  });

  it('encodeConnCursor / decodeConnCursor round-trip', () => {
    const p = { primary: '2026-05-07T00:00:00.000Z', id: 'abc' };
    assert.deepEqual(decodeConnCursor(encodeConnCursor(p)), p);
  });
  it('decodeConnCursor returns null on garbage', () => {
    assert.equal(decodeConnCursor('garbage'), null);
  });

  // INVARIANT I2 — fail closed on unknown enum values for both auth_type and statuses.
  it('authTypeToContract throws on unknown DB value', () => {
    assert.throws(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => authTypeToContract('basic_auth' as any),
      (err: Error) => err.name === 'UnknownEnumValueError' && err.message.includes('basic_auth'),
    );
  });
  it('deriveStatus throws on unknown oauth_status', () => {
    assert.throws(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => deriveStatus('active', 'paused' as any),
      (err: Error) => err.name === 'UnknownEnumValueError',
    );
  });
  it('deriveStatus throws on unknown connection_status', () => {
    assert.throws(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => deriveStatus('archived' as any, null),
      (err: Error) => err.name === 'UnknownEnumValueError',
    );
  });
  ```

- [ ] **Step 4: Write `server/services/connectionsService.ts`**
  ```ts
  import { db } from '../db/index.js';
  import { sql } from 'drizzle-orm';
  import {
    authTypeToContract, deriveStatus,
    encodeConnCursor, decodeConnCursor,
  } from './connectionsListPure.js';

  export interface ConnectionListInput {
    organisationId: string;
    scope: 'workspace' | 'org';
    subaccountId?: string;
    provider?: string[];
    authMethod?: Array<'oauth' | 'api_key' | 'web_login' | 'mcp' | 'cookie'>;
    status?: Array<'connected' | 'expired' | 'failed' | 'pending'>;
    q?: string;
    cursor: string | null;
    limit: number;
    sortKey: 'name' | 'provider' | 'authMethod' | 'status' | 'lastSync' | 'owner';
    sortDir: 'asc' | 'desc';
  }

  /**
   * Single-statement UNION across integration_connections + mcp_server_configs,
   * org-scoped, then sliced by sort/cursor/limit. filterOptions computed from the
   * same UNIONed CTE.
   *
   * INVARIANT: ORDER BY in SQL for filterOption rollups (spec §4.0). The CTE
   * issues a single round trip — counts and rows are snapshot-consistent.
   */
  export async function listConnections(input: ConnectionListInput) {
    const limit = Math.min(input.limit, 50);
    const cursor = input.cursor ? decodeConnCursor(input.cursor) : null;
    // Pseudocode SQL for the builder — fill the SELECT projections per the contract.
    // The two arms project to identical columns:
    //   id, name, provider, auth_type_db, connection_status, oauth_status,
    //   subaccount_id, owner_kind, last_sync_at, created_at
    //
    // WITH base AS (
    //   SELECT id, label AS name, provider_type AS provider, auth_type AS auth_type_db,
    //          connection_status, oauth_status,
    //          subaccount_id, last_successful_sync_at AS last_sync_at,
    //          CASE WHEN subaccount_id IS NULL THEN 'org' ELSE 'workspace' END AS owner_kind,
    //          created_at, 'integration' AS source
    //   FROM integration_connections
    //   WHERE organisation_id = $1
    //     <scope filter>
    //   UNION ALL
    //   SELECT id, name AS name, 'mcp' AS provider, 'mcp' AS auth_type_db,
    //          'active' AS connection_status, NULL AS oauth_status,
    //          subaccount_id, NULL::timestamptz AS last_sync_at,
    //          CASE WHEN subaccount_id IS NULL THEN 'org' ELSE 'workspace' END AS owner_kind,
    //          created_at, 'mcp' AS source
    //   FROM mcp_server_configs
    //   WHERE organisation_id = $1
    //     <scope filter>
    // ),
    // ordered AS (
    //   -- INVARIANT I1: seek pagination via tuple WHERE, NEVER SQL OFFSET.
    //   SELECT * FROM base
    //   <q filter: ILIKE '%q%' on name OR provider>
    //   <provider/authMethod/status filters>
    //   <cursor predicate: WHERE (<primary>, id) > (cursor.primary, cursor.id) for ASC; < for DESC>
    //   ORDER BY <sortKey>, id <sortDir>
    //   LIMIT $limit + 1
    // ),
    // provider_options AS (
    //   SELECT provider AS value, provider AS label, COUNT(*)::int AS count
    //   FROM base GROUP BY provider ORDER BY count DESC, label ASC
    // ),
    // auth_options AS (... GROUP BY auth_type_db ORDER BY count DESC, value ASC),
    // status_options AS (... derived status ... ORDER BY count DESC, value ASC)
    // SELECT json_agg(...) ...
    //
    throw new Error('TODO C6 step 4');
  }

  /**
   * Single-CTE usage aggregator.
   * Spec §4.10: agents + recurring_tasks + workflows in one SQL statement so counts
   * are snapshot-consistent under default READ COMMITTED.
   */
  export async function getConnectionUsage(opts: {
    organisationId: string; connectionId: string;
  }) {
    const result = await db.execute(sql`
      WITH agent_uses AS (
        SELECT a.id::text AS id, a.label AS name, ads.last_used_at
        FROM agents a JOIN agent_data_sources ads ON ads.agent_id = a.id
        WHERE ads.connection_id = ${opts.connectionId}
          AND a.organisation_id = ${opts.organisationId}
      ),
      task_uses AS (
        SELECT st.id::text AS id, st.name, st.next_fire_at
        FROM scheduled_tasks st
        WHERE st.connection_id = ${opts.connectionId}
          AND st.organisation_id = ${opts.organisationId}
      ),
      workflow_uses AS (
        SELECT w.id::text AS id, w.name
        FROM workflows w
        WHERE w.connection_id = ${opts.connectionId}
          AND w.organisation_id = ${opts.organisationId}
      )
      SELECT
        (SELECT json_agg(row_to_json(agent_uses.*)) FROM agent_uses) AS agents,
        (SELECT json_agg(row_to_json(task_uses.*)) FROM task_uses) AS recurring_tasks,
        (SELECT json_agg(row_to_json(workflow_uses.*)) FROM workflow_uses) AS workflows;
    `);
    const row = result.rows[0] as Record<string, unknown>;
    return {
      agents: (row.agents as Array<{ id: string; name: string; last_used_at: string | null }> ?? [])
        .map((a) => ({ id: a.id, name: a.name, lastUsedAt: a.last_used_at })),
      recurringTasks: (row.recurring_tasks as Array<{ id: string; name: string; next_fire_at: string | null }> ?? [])
        .map((t) => ({ id: t.id, name: t.name, nextFireAt: t.next_fire_at })),
      workflows: (row.workflows as Array<{ id: string; name: string }> ?? [])
        .map((w) => ({ id: w.id, name: w.name })),
    };
  }
  ```

  Note: builder confirms `agent_data_sources.connection_id`, `scheduled_tasks.connection_id`, and `workflows.connection_id` columns exist; if any don't, the column name needs to be confirmed and the SQL adjusted. Document any rename in C6's commit message. If a workflow → connection link doesn't exist yet, return `workflows: []` and note the deferred linkage in plan §10 (deferred items).

- [ ] **Step 5: Add `testConnection` to `server/services/connectionTokenService.ts`**
  ```ts
  // ── Govern (spec §4.9) ─────────────────────────────────────────────────────

  export interface ConnectionTestResponse {
    status: 'ok' | 'failed';
    latencyMs: number;
    testedAt: string;
    error?: { code: 'TIMEOUT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'PROVIDER_ERROR'; message: string };
    capabilities?: string[];
  }

  /**
   * Test a connection. Always returns 200; failures surface as { status: 'failed', error: { code, message } }.
   *
   * INVARIANTS (spec §4.9, plan §4 invariant I5):
   * - 10s budget is monotonic-anchored end-to-end. `process.hrtime.bigint()` is the
   *   ONLY source of elapsed time on both the success and timeout paths. `Date.now()`
   *   and wall-clock subtraction are not used for elapsed-time calculations.
   * - The dispatcher races against an AbortController whose abort timer is scheduled
   *   via setTimeout. setTimeout drift is acceptable because the reported `latencyMs`
   *   is read from `hrtime` at resolve time, not from the timeout configuration.
   * - Per-kind testers receive the AbortSignal and pass it to `fetch`/SDK call sites
   *   so cancellation propagates. Per-kind testers MUST disable internal SDK retries
   *   (or bound them within the same envelope).
   * - error.message NEVER includes secrets, tokens, or full URLs.
   */
  export async function testConnection(opts: {
    organisationId: string; connectionId: string;
  }): Promise<ConnectionTestResponse> {
    const startNs = process.hrtime.bigint();
    const TIMEOUT_MS = 10_000;
    const elapsedMs = (): number => Number((process.hrtime.bigint() - startNs) / 1_000_000n);

    const ac = new AbortController();
    const timeoutHandle = setTimeout(() => ac.abort(), TIMEOUT_MS);

    try {
      // 1. Read the connection row + kind (passes ac.signal so DB driver can cancel).
      // 2. Dispatch by kind:
      //    - oauth (gmail/slack/github/...)  → testOauthPing(connection, ac.signal)
      //    - api_key (hubspot/stripe/...)    → testApiKeyPing(connection, ac.signal)
      //    - web_login                       → testWebLoginPing(connection, ac.signal)
      //    - mcp                             → testMcpInitialize(connection, ac.signal)
      //
      //    Each per-kind helper:
      //    - Uses the bare provider HTTP API (no SDK retry layer) OR the SDK with retries disabled.
      //    - Passes ac.signal to fetch / SDK so abort cancels in-flight network IO.
      //    - On 401/403: throw AppError with code 'AUTH_FAILED'.
      //    - On DNS/TLS/connect failure: throw AppError with code 'NETWORK_ERROR'.
      //    - On AbortError when ac.signal aborted: throw AppError with code 'TIMEOUT'.
      //    - On 4xx (non-auth) or 5xx: throw AppError with code 'PROVIDER_ERROR'.
      //    - For OAuth: also returns scope list as `capabilities`.
      const result = await dispatchTestByKind(opts.organisationId, opts.connectionId, ac.signal);
      return {
        status: 'ok',
        latencyMs: elapsedMs(),
        testedAt: new Date().toISOString(),
        capabilities: result.capabilities,
      };
    } catch (err: unknown) {
      // If the AbortController fired, surface as TIMEOUT regardless of which
      // sub-error the abort surfaced as in the dispatcher (DOMException/AbortError,
      // FetchError, undici AbortError, etc.).
      const aborted = ac.signal.aborted;
      const rawCode = (err as { code?: string }).code;
      const code = aborted
        ? 'TIMEOUT' as const
        : (['AUTH_FAILED', 'NETWORK_ERROR', 'PROVIDER_ERROR'].includes(rawCode ?? '')
            ? (rawCode as 'AUTH_FAILED' | 'NETWORK_ERROR' | 'PROVIDER_ERROR')
            : 'PROVIDER_ERROR' as const);
      const message = aborted
        ? 'Provider did not respond within 10s.'
        : sanitiseErrorMessage((err as Error).message);
      return {
        status: 'failed',
        latencyMs: elapsedMs(),
        testedAt: new Date().toISOString(),
        error: { code, message },
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  // dispatchTestByKind + per-kind helpers + sanitiseErrorMessage live in this file
  // or a sibling `connectionTesters.ts` module if the per-kind helpers grow large.
  ```

  Note: builder writes the per-kind helpers (`testOauthPing`, `testApiKeyPing`, `testWebLoginPing`, `testMcpInitialize`) using the existing token decryption helper + `fetch` (no SDK retry). Each returns `{ capabilities?: string[] }` on success or throws an `AppError` with one of the four codes. Sanitise: scrub bearer tokens, cookies, and full URLs from any raw error message. Use `message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')` and `message.replace(/https?:\/\/[^\s]+/g, '[url]')` as a baseline; document the regex set in JSDoc.

- [ ] **Step 6: Add the three new endpoints to `server/routes/integrationConnections.ts`**
  Mount alongside existing routes; the unified list is org-level (no `:subaccountId` segment).
  ```ts
  import { listConnections, getConnectionUsage } from '../services/connectionsService.js';
  import { testConnection } from '../services/connectionTokenService.js';
  import { z } from 'zod';

  const connListQuery = z.object({
    scope: z.enum(['workspace', 'org']).optional().default('org'),
    provider: z.union([z.string(), z.array(z.string())]).optional(),
    authMethod: z.union([
      z.enum(['oauth', 'api_key', 'web_login', 'mcp', 'cookie']),
      z.array(z.enum(['oauth', 'api_key', 'web_login', 'mcp', 'cookie'])),
    ]).optional(),
    status: z.union([
      z.enum(['connected', 'expired', 'failed', 'pending']),
      z.array(z.enum(['connected', 'expired', 'failed', 'pending'])),
    ]).optional(),
    q: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(25),
    sortKey: z.enum(['name', 'provider', 'authMethod', 'status', 'lastSync', 'owner']).optional().default('name'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
  });

  router.get(
    '/api/connections',
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW), // confirm appropriate connections-read perm
    asyncHandler(async (req, res) => {
      const q = connListQuery.parse(req.query);
      const result = await listConnections({
        organisationId: req.orgId!,
        scope: q.scope,
        subaccountId: q.scope === 'workspace' ? (req.activeSubaccountId ?? undefined) : undefined,
        provider: arrayify(q.provider),
        authMethod: arrayify(q.authMethod),
        status: arrayify(q.status),
        q: q.q,
        cursor: q.cursor ?? null,
        limit: q.limit,
        sortKey: q.sortKey,
        sortDir: q.sortDir,
      });
      res.json(result);
    }),
  );

  router.get(
    '/api/connections/:id/usage',
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
    asyncHandler(async (req, res) => {
      const result = await getConnectionUsage({ organisationId: req.orgId!, connectionId: req.params.id });
      res.json(result);
    }),
  );

  router.post(
    '/api/connections/:id/test',
    authenticate,
    requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
    asyncHandler(async (req, res) => {
      // Rate-limit: max 6 tests per connection per minute (spec §4.9).
      // Use existing rate-limit helper if present; otherwise a small in-memory bucket
      // is acceptable for Phase-2 ship. Document choice in commit message.
      const result = await testConnection({ organisationId: req.orgId!, connectionId: req.params.id });
      res.status(200).json(result);
    }),
  );

  function arrayify<T>(v: T | T[] | undefined): T[] | undefined {
    if (v === undefined) return undefined;
    return Array.isArray(v) ? v : [v];
  }
  ```

- [ ] **Step 7: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:server
  npx tsx server/services/__tests__/connectionsListPure.test.ts
  ```
  Expected: PASS.

- [ ] **Step 7b: Invariant I8 TODO grep gate**
  ```
  git diff --cached -G "TODO C[0-9]" --name-only
  ```
  Expected: empty output. Any matching file means a `TODO C6 step …` placeholder was left in the staged code; finish the implementation before committing.

- [ ] **Step 8: Commit**
  ```
  git add server/services/connectionsListPure.ts server/services/__tests__/connectionsListPure.test.ts server/services/connectionsService.ts server/services/connectionTokenService.ts server/routes/integrationConnections.ts
  git commit -m "feat(consolidation-govern): C6 — unified connections list + usage CTE + monotonic test dispatcher"
  ```

**Acceptance criteria:**
- `GET /api/connections` returns `{ rows, cursor, filterOptions }`; rows are UNIONed across `integration_connections` and `mcp_server_configs`; status mapped per `deriveStatus` (oauth_status precedence); authMethod mapped per `authTypeToContract`; default sort `name ASC, id ASC`; `q` is case-insensitive partial against `name + provider`; max 50.
- `filterOptions` for `provider`, `authMethod`, `status` come from the same UNIONed snapshot, ordered `count DESC, value ASC` IN SQL.
- `GET /api/connections/:id/usage` returns `{ agents, recurringTasks, workflows }` from a single CTE.
- `POST /api/connections/:id/test` always returns 200; on success returns `{ status: 'ok', latencyMs, testedAt, capabilities? }`; on failure returns `{ status: 'failed', latencyMs, testedAt, error: { code, message } }` where `code ∈ {'TIMEOUT', 'AUTH_FAILED', 'NETWORK_ERROR', 'PROVIDER_ERROR'}`. Per invariant I5: 10-second budget is monotonic-anchored end-to-end via `process.hrtime.bigint()`; AbortController propagates cancellation to per-kind testers; per-kind testers disable internal SDK retries.
- `error.message` never contains secrets, tokens, or full URLs (sanitiser regex enforced).
- Pure-function tests pass.

### Task C7 — shared/types/govern.ts + API client wrappers

**Spec sections:** §4.1 (KnowledgeEntry), §4.2 (LedgerRow + LedgerQuery), §4.3+§4.11 (CapsResponse extended), §4.4 (SpendInsights), §4.5 (SpendTrends), §4.6 (Connection + ConnectionsQuery), §4.9 (ConnectionTestResponse), §4.10 (ConnectionUsage).

**Logical responsibility:** ship the canonical TypeScript types this stream's frontend imports. Place under `shared/` so server and client both reference one source of truth.

**Files:**
- Create: `shared/types/govern.ts`
- Create: `client/src/api/governApi.ts` (thin fetch wrappers per endpoint)

- [ ] **Step 1: Write `shared/types/govern.ts` verbatim from spec §4**
  ```ts
  /**
   * Govern stream contracts (Knowledge, Spending, Connections).
   *
   * Spec: tasks/builds/consolidation-govern/spec.md §4.
   *
   * INVARIANTS (paraphrased; spec is authoritative):
   * - Knowledge status enum is closed at three values; auto_update_disabled is a
   *   side-channel boolean, not a fourth status (§4.1).
   * - costUsd is dollars (decimal); aggregators accumulate in integer cents and
   *   divide by 100 at the API boundary (§6 + plan §3 Gap 2).
   * - Connection test ALWAYS returns 200; error.code is the closed enum (§4.9).
   * - SpendTrends.workspaces[i].capUsage6mo[j] is null for "no cap configured /
   *   unbounded" months; null months are NOT counted as blown by capBlownAt (§4.5).
   */

  // ── Knowledge ──────────────────────────────────────────────────────────────

  export interface KnowledgeListQuery {
    scope?: 'workspace' | 'org';
    status?: ('pending_review' | 'in_use' | 'ignored')[];
    autoUpdateDisabled?: boolean;
    kind?: ('belief' | 'fact' | 'observation' | 'preference' | 'issue')[];
    agent?: string[];
    q?: string;
    cursor?: string; limit?: number;
    sortKey?: 'createdAt' | 'updatedAt' | 'confidence' | 'sourceAgent' | 'kind' | 'status';
    sortDir?: 'asc' | 'desc';
  }

  export interface KnowledgeEntry {
    id: string;
    kind: 'belief' | 'fact' | 'observation' | 'preference' | 'issue';
    body: string;
    confidence: number; // 0-1
    status: 'pending_review' | 'in_use' | 'ignored';
    source: { runId: string; agentName: string; extractedAt: string };
    subaccount: { id: string; name: string } | null;
    autoUpdateDisabled: boolean;
    lastEditedBy: { kind: 'auto' | 'manual'; userId: string | null; at: string } | null;
    /** Opaque ETag — caller passes this back to /override for concurrency check. */
    etag: string;
  }

  export interface KnowledgeListResponse {
    rows: KnowledgeEntry[];
    cursor: string | null;
    filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
  }

  // ── Spend Ledger ───────────────────────────────────────────────────────────

  export interface LedgerQuery {
    scope?: 'workspace' | 'org';
    workspace?: string[];
    agent?: string[];
    type?: ('llm' | 'embedding' | 'tool_call' | 'storage' | 'other')[];
    from?: string;
    to?: string;
    cursor?: string; limit?: number;
    sortKey?: 'timestamp' | 'workspace' | 'agent' | 'type' | 'tokens' | 'cost';
    sortDir?: 'asc' | 'desc';
  }

  export interface LedgerRow {
    id: string;
    timestamp: string;
    workspace: { id: string; name: string };
    agent: { id: string; name: string };
    type: 'llm' | 'embedding' | 'tool_call' | 'storage' | 'other';
    provider: string;
    model: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    costUsd: number; // dollars; cents in storage / aggregator
  }

  export interface LedgerResponse {
    rows: LedgerRow[];
    cursor: string | null;
    filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
  }

  // ── Spend Caps ─────────────────────────────────────────────────────────────

  export interface CapsResponse {
    scope: 'workspace' | 'org';
    orgCap: {
      monthlyUsd: number;
      usedMtdUsd: number;
      daysRemaining: number;
      pace: 'on_track' | 'warning' | 'over';
    };
    workspaces: Array<{
      id: string; name: string;
      dailyCapUsd: number | null;
      monthlyCapUsd: number | null;
      usedMtdUsd: number;
      pacePct: number;          // 0-200 (>100 = over)
      status: 'on_track' | 'warning' | 'over';
    }>;
    // §4.11 extension
    periodResetAt: string;       // ISO
    paceWindow: '7d' | '14d' | '30d';
    paceProjectedEndOfPeriodUsd: number;
  }

  // ── Spend Insights (org scope) ─────────────────────────────────────────────

  export interface SpendInsights {
    topSpender: {
      workspace: { id: string; name: string };
      mtdUsd: number;
      pctOfOrgTotal: number;
      deltaPct: number | null; // null when previous month was zero or absent
    } | null;
    fastestGrower: {
      workspace: { id: string; name: string };
      deltaPct: number | null;
    } | null;
    mostActiveAgent: {
      agent: { id: string; name: string };
      runs30d: number;
      workspace: { id: string; name: string };
    } | null;
  }

  // ── Spend Trends (org scope) ───────────────────────────────────────────────

  export interface SpendTrends {
    workspaces: Array<{
      id: string; name: string;
      spend6mo: number[];                 // length 6, oldest → current month, USD
      capUsage6mo: (number | null)[];     // length 6, % values; >100 = over cap; null = no cap
      capBlownAt: number | null;          // first index over cap, or null
    }>;
    monthLabels: string[];                // length 6
  }

  // ── Connections ────────────────────────────────────────────────────────────

  export interface ConnectionsQuery {
    scope?: 'workspace' | 'org';
    provider?: string[];
    authMethod?: ('oauth' | 'api_key' | 'web_login' | 'mcp' | 'cookie')[];
    status?: ('connected' | 'expired' | 'failed' | 'pending')[];
    cursor?: string; limit?: number;
    sortKey?: 'name' | 'provider' | 'authMethod' | 'status' | 'lastSync' | 'owner';
    sortDir?: 'asc' | 'desc';
  }

  export interface Connection {
    id: string;
    name: string;
    provider: string;
    authMethod: 'oauth' | 'api_key' | 'web_login' | 'mcp' | 'cookie';
    status: 'connected' | 'expired' | 'failed' | 'pending';
    lastSyncAt: string | null;
    owner: { kind: 'workspace' | 'org'; id: string; name: string };
    createdAt: string;
  }

  export interface ConnectionsResponse {
    rows: Connection[];
    cursor: string | null;
    filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
  }

  export interface ConnectionUsage {
    agents: Array<{ id: string; name: string; lastUsedAt: string | null }>;
    recurringTasks: Array<{ id: string; name: string; nextFireAt: string | null }>;
    workflows: Array<{ id: string; name: string }>;
  }

  export interface ConnectionTestResponse {
    status: 'ok' | 'failed';
    latencyMs: number;
    testedAt: string;
    error?: { code: 'TIMEOUT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'PROVIDER_ERROR'; message: string };
    capabilities?: string[];
  }
  ```

- [ ] **Step 2: Write `client/src/api/governApi.ts`**
  Thin fetch wrappers that read the contracts from `shared/types/govern.ts` and return typed promises. Use the existing `apiFetch` helper if one exists (search `client/src/api/`); otherwise export per-endpoint helpers using `fetch` + `credentials: 'include'`.
  ```ts
  import type {
    KnowledgeListQuery, KnowledgeListResponse, KnowledgeEntry,
    LedgerQuery, LedgerResponse,
    CapsResponse, SpendInsights, SpendTrends,
    ConnectionsQuery, ConnectionsResponse,
    ConnectionUsage, ConnectionTestResponse,
  } from '@shared/types/govern';

  function qs(params: Record<string, unknown>): string {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) for (const item of v) u.append(k, String(item));
      else u.set(k, String(v));
    }
    const s = u.toString();
    return s ? `?${s}` : '';
  }

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  /**
   * POST. Returns parsed JSON for status < 500 OR for 409 / 412 (which carry
   * structured `error` payloads — see invariant I3). Throws only on 5xx and
   * other unexpected statuses. Callers branch on the parsed body shape.
   */
  async function post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status >= 500) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────
  export const listKnowledge = (q: KnowledgeListQuery) =>
    get<KnowledgeListResponse>(`/api/knowledge${qs(q as Record<string, unknown>)}`);
  export const approveKnowledge = (id: string) =>
    post<{ alreadyApplied: boolean }>(`/api/knowledge/${encodeURIComponent(id)}/approve`);
  export const rejectKnowledge = (id: string) =>
    post<{ alreadyApplied: boolean }>(`/api/knowledge/${encodeURIComponent(id)}/reject`);
  export const overrideKnowledge = (id: string, body: string, expectedEtag: string) =>
    post<
      | { status: 'in_use'; etag: string; created: boolean }
      | { error: 'invalid_state_transition'; currentStatus: KnowledgeEntry['status'] }
      | { error: 'etag_mismatch'; currentEtag: string }
    >(`/api/knowledge/${encodeURIComponent(id)}/override`, { body, expectedEtag });

  // ── Spending ───────────────────────────────────────────────────────────────
  export const listLedger = (q: LedgerQuery) =>
    get<LedgerResponse>(`/api/spend/ledger${qs(q as Record<string, unknown>)}`);
  export const getCaps = (scope: 'workspace' | 'org') =>
    get<CapsResponse>(`/api/spend/caps?scope=${scope}`);
  export const getSpendInsights = () =>
    get<SpendInsights>(`/api/spend/insights?scope=org`);
  export const getSpendTrends = () =>
    get<SpendTrends>(`/api/spend/trends?scope=org`);

  // ── Connections ────────────────────────────────────────────────────────────
  export const listConnections = (q: ConnectionsQuery) =>
    get<ConnectionsResponse>(`/api/connections${qs(q as Record<string, unknown>)}`);
  export const getConnectionUsage = (id: string) =>
    get<ConnectionUsage>(`/api/connections/${encodeURIComponent(id)}/usage`);
  export const testConnection = (id: string) =>
    post<ConnectionTestResponse>(`/api/connections/${encodeURIComponent(id)}/test`);
  ```

  Note: `@shared/types/govern` import alias requires the existing `tsconfig` + Vite alias for `@shared`. Confirm with `grep -n "@shared\|paths" tsconfig*.json vite.config*`. If the alias is `~/shared` or `shared/` instead, adjust.

- [ ] **Step 3: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:client
  npm run build:server
  ```
  Expected: PASS. (No new tests in C7 — types and fetch wrappers are exercised by C8-C11 builds.)

- [ ] **Step 4: Commit**
  ```
  git add shared/types/govern.ts client/src/api/governApi.ts
  git commit -m "feat(consolidation-govern): C7 — shared types + frontend API client wrappers"
  ```

**Acceptance criteria:**
- `shared/types/govern.ts` exports every contract from spec §4 with field shapes verbatim.
- `KnowledgeEntry.autoUpdateDisabled` is camelCase boolean (frontend); DB column stays `auto_update_disabled` (snake_case) — see C2 mapper.
- `client/src/api/governApi.ts` exports one wrapper per endpoint with typed return.
- Both `npm run build:client` and `npm run build:server` import the shared types without error.

### Task C8 — KnowledgePage + row + override dialog

**Spec sections:** §1 goal 1 (Knowledge), §3 frontend audit rows (`<SortableTable>`, `<Modal>`, `<ViewModeSwitcher>`, `<WorkspaceBadge>`, `<PageShell>`, `<SearchBox>`, `<EmptyState>`, `<ErrorState>`, `<ConfirmDialog>`, `<HelpHint>`), §4.7 (workspace vs org view-mode), §4.8 (full-text search; `q` searches body + agentName + runId), §4.12 (UX clarifiers — confidence scale tooltip, kind chip tooltips, run-id link to `/run-trace/<id>?embedded=1` in `<Modal size="iframe">`, pending-review high-confidence badge, override copy), §4.13 (reject + override confirmation copy), §4.14 (permission gating).

**Logical responsibility:** ship the single-page Knowledge surface that switches on view-mode and surfaces approve / reject / override actions per row.

**Files:**
- Create: `client/src/pages/govern/KnowledgePage.tsx`
- Create: `client/src/pages/govern/components/KnowledgeRow.tsx`
- Create: `client/src/pages/govern/components/KnowledgeOverrideDialog.tsx`

- [ ] **Step 1: Scaffold `KnowledgePage.tsx`**
  ```tsx
  import { useEffect, useState, useMemo } from 'react';
  import { PageShell } from '../../components/PageShell';
  import { SearchBox } from '../../components/SearchBox';
  import { EmptyState } from '../../components/EmptyState';
  import { ErrorState } from '../../components/ErrorState';
  import { SortableTable, type ColumnDef } from '../../components/SortableTable';
  import ViewModeSwitcher from '../../components/ViewModeSwitcher';
  import { useViewMode } from '../../hooks/useViewMode';
  import { listKnowledge, approveKnowledge, rejectKnowledge } from '../../api/governApi';
  import type { KnowledgeEntry } from '@shared/types/govern';
  import { KnowledgeRow } from './components/KnowledgeRow';
  import { KnowledgeOverrideDialog } from './components/KnowledgeOverrideDialog';
  import ConfirmDialog from '../../components/ConfirmDialog';
  import { HelpHint } from '../../components/ui/HelpHint';

  export default function KnowledgePage() {
    const { viewMode, availableModes, setViewMode } = useViewMode();
    const [q, setQ] = useState('');
    const [rows, setRows] = useState<KnowledgeEntry[] | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [overrideTarget, setOverrideTarget] = useState<KnowledgeEntry | null>(null);
    const [rejectTarget, setRejectTarget] = useState<KnowledgeEntry | null>(null);

    useEffect(() => {
      setRows(null); setError(null);
      listKnowledge({ scope: viewMode === 'org' ? 'org' : 'workspace', q })
        .then((r) => setRows(r.rows))
        .catch((e: Error) => setError(e));
    }, [viewMode, q]);

    const columns: ColumnDef<KnowledgeEntry>[] = useMemo(() => [
      {
        key: 'body', label: 'Entry', sortable: false, filterable: false,
        render: (r) => <KnowledgeRow row={r} onOverride={setOverrideTarget} />,
      },
      // …include columns for status, kind, confidence, agent, sourceRunId, subaccount (org view)…
      { key: 'status', label: 'Status', sortable: true, filterable: true, getValue: (r) => r.status },
      {
        key: 'confidence',
        label: (
          <span className="inline-flex items-center gap-1">
            Confidence
            <HelpHint content="Auto-extracted entries get a 0-1 confidence score from the extracting agent. Below 0.5: weak signal. 0.5-0.8: moderate. Above 0.8: strong." />
          </span>
        ) as unknown as string, // SortableTable label is string in current contract; pass JSX-as-any if necessary or wrap label in component prop
        sortable: true, filterable: false,
        getValue: (r) => r.confidence,
        render: (r) => r.confidence.toFixed(2),
      },
      // … kind column with HelpHint per spec §4.12 …
      // … if viewMode === 'org', add Subaccount column with <WorkspaceBadge /> …
    ], [viewMode]);

    if (error) return (
      <PageShell header={<h1>Knowledge</h1>}>
        <ErrorState error={error} retry={() => setQ((x) => x)} />
      </PageShell>
    );

    return (
      <PageShell
        header={
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Knowledge</h1>
            <div className="flex items-center gap-3">
              <ViewModeSwitcher value={viewMode} onChange={setViewMode} availableModes={availableModes} />
              <SearchBox value={q} onChange={setQ} placeholder="Search entries, agent, run id..." />
            </div>
          </div>
        }
      >
        {rows === null ? (
          <div className="text-sm text-slate-500 py-8">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No entries match your filters"
            primaryAction={{ label: 'Clear filters', onClick: () => setQ('') }}
          />
        ) : (
          <SortableTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            persistKey={`knowledge-${viewMode}`}
            initialSort={{ key: 'createdAt', dir: 'desc' }}
          />
        )}
        {overrideTarget && (
          <KnowledgeOverrideDialog
            entry={overrideTarget}
            onClose={() => setOverrideTarget(null)}
            onSaved={() => { setOverrideTarget(null); setQ((x) => x); }}
          />
        )}
        {rejectTarget && (
          <ConfirmDialog
            title="Reject knowledge entry?"
            message={`Reject "${rejectTarget.body.slice(0, 80)}"? It will be moved to ignored.`}
            confirmLabel="Reject"
            onCancel={() => setRejectTarget(null)}
            onConfirm={async () => {
              await rejectKnowledge(rejectTarget.id);
              setRejectTarget(null);
              setQ((x) => x); // refetch
            }}
          />
        )}
      </PageShell>
    );
  }
  ```

  Note: SortableTable's current `ColumnDef.label: string` — the JSX-label workaround above is acceptable only if the type accepts ReactNode. If the label prop is strictly `string`, render the HelpHint inside the column header by extending the `render` of an additional sentinel column or by wrapping. Spec §4.12 mandates the tooltip; the builder picks the cleanest reading of the foundation API and documents the choice.

- [ ] **Step 2: Scaffold `KnowledgeRow.tsx`**
  Renders the body cell: a left-aligned text excerpt, a small chip cluster (`status`, `kind`, `confidence`), provenance (`agentName · run<runId>` where `runId` is a clickable link that opens a `<Modal size="iframe" title="Run trace">` showing `/run-trace/${runId}?embedded=1`), and the per-row action menu.
  - When `entry.status === 'pending_review' && entry.confidence > 0.8`: render a small "high confidence" badge per spec §4.12.
  - When `entry.autoUpdateDisabled === true`: render a small lock icon next to the body.
  - Action menu (per spec §4.14): show Approve only when status is `'pending_review'`. Show Reject when status is not `'ignored'`. Show "Edit and override" only when status is `'in_use'`.
  - Approve / reject actions call `approveKnowledge(id)` / open `setRejectTarget` confirm dialog. Override opens `setOverrideTarget`.
  - All write-action buttons hidden when user lacks `knowledge:write` (use existing helper from `client/src/lib/auth.ts`).

- [ ] **Step 3: Scaffold `KnowledgeOverrideDialog.tsx`**
  ```tsx
  import { useState } from 'react';
  import Modal from '../../../components/Modal';
  import type { KnowledgeEntry } from '@shared/types/govern';
  import { overrideKnowledge } from '../../../api/governApi';

  export function KnowledgeOverrideDialog({
    entry, onClose, onSaved,
  }: {
    entry: KnowledgeEntry; onClose: () => void; onSaved: () => void;
  }) {
    const [body, setBody] = useState(entry.body);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function handleSave() {
      setBusy(true); setError(null);
      try {
        const r = await overrideKnowledge(entry.id, body, entry.etag);
        if ('error' in r) {
          if (r.error === 'invalid_state_transition') {
            setError(`Cannot override an entry currently in ${r.currentStatus}.`);
          } else if (r.error === 'etag_mismatch') {
            setError('Entry was updated by someone else. Reload and try again.');
          }
        } else {
          onSaved();
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }

    return (
      <Modal
        title="Edit and override"
        size="md"
        onClose={onClose}
        footer={
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm bg-slate-100 rounded">Cancel</button>
            <button type="button" disabled={busy} onClick={handleSave}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded disabled:opacity-50">
              {busy ? 'Saving…' : 'Save override'}
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 mb-3">
          Future automatic memory updates will skip this entry. The current value stays unchanged
          until you save.
        </p>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          className="w-full text-sm border rounded p-2 font-mono"
        />
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </Modal>
    );
  }
  ```

- [ ] **Step 4: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:client
  ```
  Expected: PASS. (No frontend tests per spec §8 / `frontend_tests: none_for_now`.)

- [ ] **Step 5: Commit**
  ```
  git add client/src/pages/govern/KnowledgePage.tsx client/src/pages/govern/components/KnowledgeRow.tsx client/src/pages/govern/components/KnowledgeOverrideDialog.tsx
  git commit -m "feat(consolidation-govern): C8 — KnowledgePage + row + override dialog"
  ```

**Acceptance criteria:**
- Single `KnowledgePage` reads `useViewMode()` and switches data scope on `viewMode`.
- `<SearchBox>` debounce wired through `q` query parameter (foundation default 200ms).
- Confidence column carries a `<HelpHint>` per spec §4.12.
- Pending-review entries with `confidence > 0.8` show a "high confidence" badge.
- `runId` opens `/run-trace/<runId>?embedded=1` in a foundation `<Modal size="iframe">`.
- Reject opens a `<ConfirmDialog>` with the spec §4.13 copy.
- Override opens `<KnowledgeOverrideDialog>` which sends `expectedEtag` and surfaces 409 paths to the user.
- Approve / reject / override action buttons hidden when user lacks `knowledge:write` permission per spec §4.14.

### Task C9 — SpendingPage Ledger tab + insights row

**Spec sections:** §4.2 (Ledger contract), §4.4 (Insights — org scope only), §4.7 (view-mode awareness — workspace view drops Workspace column + insights tiles; org view shows everything), §4.8 (search box wired to `q`), §4.14 (insights tiles hidden in workspace view AND for non-org-admin users in org view).

**Logical responsibility:** ship `SpendingPage.tsx` with the Ledger tab as the default. Caps tab scaffold added but bodied out in C10.

**Files:**
- Create: `client/src/pages/govern/SpendingPage.tsx`
- Create: `client/src/pages/govern/components/SpendInsightsRow.tsx`

- [ ] **Step 1: Scaffold `SpendingPage.tsx` with two tabs**
  ```tsx
  import { useState } from 'react';
  import { PageShell } from '../../components/PageShell';
  import ViewModeSwitcher from '../../components/ViewModeSwitcher';
  import { useViewMode } from '../../hooks/useViewMode';
  import { LedgerTab } from './SpendingPage.LedgerTab';
  import { CapsTab } from './SpendingPage.CapsTab';

  type TabKey = 'caps' | 'ledger';

  export default function SpendingPage() {
    const { viewMode, availableModes, setViewMode } = useViewMode();
    const [tab, setTab] = useState<TabKey>('caps');
    return (
      <PageShell
        header={
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold">Spending</h1>
              <nav className="flex gap-1 ml-3" role="tablist">
                <TabButton active={tab === 'caps'} onClick={() => setTab('caps')}>Caps & budgets</TabButton>
                <TabButton active={tab === 'ledger'} onClick={() => setTab('ledger')}>Ledger</TabButton>
              </nav>
            </div>
            <ViewModeSwitcher value={viewMode} onChange={setViewMode} availableModes={availableModes} />
          </div>
        }
      >
        {tab === 'caps' ? <CapsTab viewMode={viewMode} /> : <LedgerTab viewMode={viewMode} />}
      </PageShell>
    );
  }

  function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
      <button
        type="button" role="tab" aria-selected={active}
        onClick={onClick}
        className={`px-3 py-1.5 text-sm rounded ${active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
      >
        {children}
      </button>
    );
  }
  ```

- [ ] **Step 2: Create `SpendingPage.LedgerTab.tsx` (sibling file in same folder)**
  ```tsx
  import { useEffect, useState, useMemo } from 'react';
  import { SearchBox } from '../../components/SearchBox';
  import { EmptyState } from '../../components/EmptyState';
  import { ErrorState } from '../../components/ErrorState';
  import { SortableTable, type ColumnDef } from '../../components/SortableTable';
  import WorkspaceBadge from '../../components/WorkspaceBadge';
  import { listLedger, getSpendInsights } from '../../api/governApi';
  import type { LedgerRow, SpendInsights } from '@shared/types/govern';
  import { SpendInsightsRow } from './components/SpendInsightsRow';

  export function LedgerTab({ viewMode }: { viewMode: 'workspace' | 'org' | 'system' }) {
    const [q, setQ] = useState('');
    const [rows, setRows] = useState<LedgerRow[] | null>(null);
    const [insights, setInsights] = useState<SpendInsights | null>(null);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
      setRows(null); setError(null);
      listLedger({ scope: viewMode === 'org' ? 'org' : 'workspace', q })
        .then((r) => setRows(r.rows))
        .catch(setError);
    }, [viewMode, q]);

    useEffect(() => {
      if (viewMode !== 'org') { setInsights(null); return; }
      getSpendInsights().then(setInsights).catch(() => setInsights(null));
    }, [viewMode]);

    const columns: ColumnDef<LedgerRow>[] = useMemo(() => {
      const cols: ColumnDef<LedgerRow>[] = [
        { key: 'timestamp', label: 'When', sortable: true, getValue: (r) => r.timestamp,
          render: (r) => new Date(r.timestamp).toLocaleString() },
        { key: 'agent', label: 'Agent', sortable: true, filterable: true, getValue: (r) => r.agent.name },
        { key: 'type', label: 'Type', sortable: true, filterable: true, getValue: (r) => r.type },
        { key: 'tokens', label: 'Tokens', sortable: true, align: 'right',
          getValue: (r) => (r.tokensIn ?? 0) + (r.tokensOut ?? 0),
          render: (r) => `${r.tokensIn ?? '—'} / ${r.tokensOut ?? '—'}` },
        { key: 'cost', label: 'Cost', sortable: true, align: 'right',
          getValue: (r) => r.costUsd,
          render: (r) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r.costUsd) },
      ];
      if (viewMode === 'org') {
        cols.splice(1, 0, {
          key: 'workspace', label: 'Workspace', sortable: true, filterable: true,
          getValue: (r) => r.workspace.name,
          render: (r) => <WorkspaceBadge clientId={r.workspace.id} clientName={r.workspace.name} variant="pill" clickable={false} />,
        });
      }
      return cols;
    }, [viewMode]);

    if (error) return <ErrorState error={error} retry={() => setQ((x) => x)} />;

    return (
      <div className="space-y-4">
        {viewMode === 'org' && insights && <SpendInsightsRow insights={insights} />}
        <div className="flex justify-end">
          <SearchBox value={q} onChange={setQ} placeholder="Search agent or workspace..." />
        </div>
        {rows === null ? (
          <div className="text-sm text-slate-500 py-8">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No charges match your filters"
            primaryAction={{ label: 'Clear filters', onClick: () => setQ('') }}
          />
        ) : (
          <SortableTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            persistKey={`spending-ledger-${viewMode}`}
            initialSort={{ key: 'timestamp', dir: 'desc' }}
          />
        )}
      </div>
    );
  }
  ```

- [ ] **Step 3: Create `SpendingPage.CapsTab.tsx` placeholder (filled in C10)**
  ```tsx
  export function CapsTab({ viewMode }: { viewMode: 'workspace' | 'org' | 'system' }) {
    return (
      <div className="text-sm text-slate-500 py-8">
        Caps & budgets — wired in C10.
      </div>
    );
  }
  ```

- [ ] **Step 4: Create `SpendInsightsRow.tsx`**
  ```tsx
  import type { SpendInsights } from '@shared/types/govern';

  export function SpendInsightsRow({ insights }: { insights: SpendInsights }) {
    const fmtUsd = (n: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
    const fmtPct = (n: number | null) =>
      n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

    return (
      <div className="grid grid-cols-3 gap-3">
        <div className="spend-insight-card border rounded p-3">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Top spender</div>
          {insights.topSpender ? (
            <>
              <div className="text-base font-semibold">{insights.topSpender.workspace.name}</div>
              <div className="text-sm text-slate-600">
                {fmtUsd(insights.topSpender.mtdUsd)} ({insights.topSpender.pctOfOrgTotal.toFixed(1)}% of org)
              </div>
              <div className="text-xs text-slate-500">{fmtPct(insights.topSpender.deltaPct)} vs last month</div>
            </>
          ) : <div className="text-sm text-slate-500">—</div>}
        </div>
        <div className="spend-insight-card border rounded p-3">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Fastest grower</div>
          {insights.fastestGrower ? (
            <>
              <div className="text-base font-semibold">{insights.fastestGrower.workspace.name}</div>
              <div className="text-sm text-slate-600">{fmtPct(insights.fastestGrower.deltaPct)} vs last month</div>
            </>
          ) : <div className="text-sm text-slate-500">—</div>}
        </div>
        <div className="spend-insight-card border rounded p-3">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Most active agent</div>
          {insights.mostActiveAgent ? (
            <>
              <div className="text-base font-semibold">{insights.mostActiveAgent.agent.name}</div>
              <div className="text-sm text-slate-600">{insights.mostActiveAgent.runs30d} runs · 30 days</div>
              <div className="text-xs text-slate-500">{insights.mostActiveAgent.workspace.name}</div>
            </>
          ) : <div className="text-sm text-slate-500">—</div>}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 5: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:client
  ```

- [ ] **Step 6: Commit**
  ```
  git add client/src/pages/govern/SpendingPage.tsx client/src/pages/govern/SpendingPage.LedgerTab.tsx client/src/pages/govern/SpendingPage.CapsTab.tsx client/src/pages/govern/components/SpendInsightsRow.tsx
  git commit -m "feat(consolidation-govern): C9 — SpendingPage Ledger tab + insights row"
  ```

**Acceptance criteria:**
- `SpendingPage` defaults to Caps tab, switches to Ledger on tab click.
- Ledger workspace view drops the Workspace column + filter; org view shows it with `<WorkspaceBadge>`.
- Org view also renders the three insight tiles via `<SpendInsightsRow>` ABOVE the search box.
- Cost rendered with `Intl.NumberFormat` USD, 2 decimals on Ledger rows.
- Workspace user sees only their workspace's rows; non-org-admin in org view does NOT see insights tiles (gate via `usePermission('spend:org_admin')` or equivalent — confirm helper name).

### Task C10 — SpendingPage Caps tab + 3 SVG charts

**Spec sections:** §1 goal 2 (split top row + per-workspace bar chart + two trend line charts, capped at top 5), §4.3 (CapsResponse), §4.5 (SpendTrends), §4.7 (workspace view: hide trend charts; org view: show all), §4.11 (pace tooltip + period reset + days remaining + status chip), §4.14 (per-workspace caps + trend charts hidden in workspace view AND for non-org-admin in org view).

**Logical responsibility:** body out the Caps & budgets tab with the live caps data + three vanilla SVG charts.

**Files:**
- Create: `client/src/pages/govern/components/SpendBarChart.tsx`
- Create: `client/src/pages/govern/components/SpendTrendChart.tsx`
- Create: `client/src/pages/govern/components/CapUtilisationChart.tsx`
- Modify: `client/src/pages/govern/SpendingPage.CapsTab.tsx`

- [ ] **Step 1: Build the bar chart `SpendBarChart.tsx`**
  ```tsx
  /**
   * SpendBarChart — vanilla SVG horizontal bar chart, top 5 workspaces by current MTD spend.
   *
   * Page-scoped (spec §2 non-goal 5). No chart library.
   */

  interface BarRow { id: string; name: string; usd: number; }

  export function SpendBarChart({ rows }: { rows: BarRow[] }) {
    const max = rows.length > 0 ? Math.max(...rows.map((r) => r.usd)) : 1;
    const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
    return (
      <svg viewBox="0 0 320 180" className="w-full h-auto" role="img" aria-label="Top spenders bar chart">
        {rows.slice(0, 5).map((r, i) => {
          const w = (r.usd / max) * 200; // 100..300 px wide bar
          const y = 10 + i * 32;
          return (
            <g key={r.id}>
              <text x={4} y={y + 14} fontSize="11" fill="#475569">{r.name}</text>
              <rect x={110} y={y + 4} width={w} height={16} fill="#6366f1" rx={2} />
              <text x={110 + w + 4} y={y + 16} fontSize="11" fill="#1e293b">{fmt(r.usd)}</text>
            </g>
          );
        })}
        {rows.length === 0 && <text x={160} y={90} textAnchor="middle" fontSize="11" fill="#94a3b8">No data</text>}
      </svg>
    );
  }
  ```

- [ ] **Step 2: Build the line chart `SpendTrendChart.tsx`**
  ```tsx
  /**
   * SpendTrendChart — 6-month spend per workspace, multiple line series.
   * Lines colour-coded; legend on the right.
   * Page-scoped vanilla SVG.
   */
  import type { SpendTrends } from '@shared/types/govern';

  const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9'];

  export function SpendTrendChart({ trends }: { trends: SpendTrends }) {
    const allValues = trends.workspaces.flatMap((w) => w.spend6mo);
    const max = allValues.length > 0 ? Math.max(...allValues, 1) : 1;
    const W = 480, H = 180, pad = 28;
    const xStep = (W - 2 * pad) / 5;

    function pathFor(values: number[]): string {
      return values.map((v, i) => {
        const x = pad + i * xStep;
        const y = H - pad - (v / max) * (H - 2 * pad);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join(' ');
    }

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="6-month spend trend">
        {/* axes */}
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#cbd5e1" />
        <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#cbd5e1" />
        {/* month labels */}
        {trends.monthLabels.map((m, i) => (
          <text key={i} x={pad + i * xStep} y={H - 8} fontSize="10" fill="#64748b" textAnchor="middle">{m}</text>
        ))}
        {/* lines */}
        {trends.workspaces.map((w, i) => (
          <path key={w.id} d={pathFor(w.spend6mo)} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} />
        ))}
      </svg>
    );
  }
  ```

- [ ] **Step 3: Build the cap-utilisation chart `CapUtilisationChart.tsx`**
  ```tsx
  /**
   * CapUtilisationChart — 6-month cap utilisation per workspace; over-cap segments dashed red.
   * null months (no cap configured) render as a gap.
   * Page-scoped vanilla SVG.
   */
  import type { SpendTrends } from '@shared/types/govern';

  const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9'];
  const OVER_COLOR = '#dc2626';

  export function CapUtilisationChart({ trends }: { trends: SpendTrends }) {
    const W = 480, H = 180, pad = 28;
    const xStep = (W - 2 * pad) / 5;
    const yMax = 200; // y axis 0..200% (cap at 200 per spec)

    function yFor(pct: number): number {
      return H - pad - (Math.min(pct, yMax) / yMax) * (H - 2 * pad);
    }

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Cap utilisation trend">
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#cbd5e1" />
        <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#cbd5e1" />
        {/* 100% reference line */}
        <line x1={pad} y1={yFor(100)} x2={W - pad} y2={yFor(100)} stroke="#fbbf24" strokeDasharray="4 3" />
        {trends.monthLabels.map((m, i) => (
          <text key={i} x={pad + i * xStep} y={H - 8} fontSize="10" fill="#64748b" textAnchor="middle">{m}</text>
        ))}
        {trends.workspaces.map((w, i) => {
          // Walk segments. null breaks the line; over-cap segment uses dashed red.
          const segments: Array<{ d: string; color: string; dash: string | undefined }> = [];
          let current: { points: Array<[number, number]>; over: boolean } | null = null;
          for (let j = 0; j < w.capUsage6mo.length; j++) {
            const v = w.capUsage6mo[j];
            if (v === null) {
              if (current) {
                segments.push({
                  d: current.points.map((p, k) => `${k === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '),
                  color: current.over ? OVER_COLOR : PALETTE[i % PALETTE.length],
                  dash: current.over ? '5 3' : undefined,
                });
              }
              current = null;
              continue;
            }
            const x = pad + j * xStep;
            const y = yFor(v);
            const over = v > 100;
            if (current === null || current.over !== over) {
              if (current) {
                // bridge a single point so segments meet at the boundary
                current.points.push([x, y]);
                segments.push({
                  d: current.points.map((p, k) => `${k === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '),
                  color: current.over ? OVER_COLOR : PALETTE[i % PALETTE.length],
                  dash: current.over ? '5 3' : undefined,
                });
              }
              current = { points: [[x, y]], over };
            } else {
              current.points.push([x, y]);
            }
          }
          if (current) {
            segments.push({
              d: current.points.map((p, k) => `${k === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '),
              color: current.over ? OVER_COLOR : PALETTE[i % PALETTE.length],
              dash: current.over ? '5 3' : undefined,
            });
          }
          return (
            <g key={w.id}>
              {segments.map((s, k) => (
                <path key={k} d={s.d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} />
              ))}
            </g>
          );
        })}
      </svg>
    );
  }
  ```

- [ ] **Step 4: Body out `SpendingPage.CapsTab.tsx`**
  ```tsx
  import { useEffect, useState } from 'react';
  import { ErrorState } from '../../components/ErrorState';
  import { HelpHint } from '../../components/ui/HelpHint';
  import { getCaps, getSpendTrends } from '../../api/governApi';
  import type { CapsResponse, SpendTrends } from '@shared/types/govern';
  import { SpendBarChart } from './components/SpendBarChart';
  import { SpendTrendChart } from './components/SpendTrendChart';
  import { CapUtilisationChart } from './components/CapUtilisationChart';

  export function CapsTab({ viewMode }: { viewMode: 'workspace' | 'org' | 'system' }) {
    const [caps, setCaps] = useState<CapsResponse | null>(null);
    const [trends, setTrends] = useState<SpendTrends | null>(null);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
      setCaps(null); setError(null);
      getCaps(viewMode === 'org' ? 'org' : 'workspace').then(setCaps).catch(setError);
    }, [viewMode]);

    useEffect(() => {
      if (viewMode !== 'org') { setTrends(null); return; }
      getSpendTrends().then(setTrends).catch(() => setTrends(null));
    }, [viewMode]);

    if (error) return <ErrorState error={error} retry={() => setCaps(null)} />;
    if (!caps) return <div className="text-sm text-slate-500 py-8">Loading…</div>;

    const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
    const fmt4 = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(n);

    const orgPacePct = caps.orgCap.monthlyUsd > 0
      ? (caps.orgCap.usedMtdUsd / caps.orgCap.monthlyUsd) * 100
      : 0;
    const orgStatusColor = ({
      on_track: 'bg-emerald-100 text-emerald-700',
      warning: 'bg-amber-100 text-amber-700',
      over: 'bg-red-100 text-red-700',
    } as const)[caps.orgCap.pace];

    return (
      <div className="space-y-5">
        {/* Top row */}
        <div className={`grid ${viewMode === 'org' ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
          <div className="border rounded p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Org monthly cap</h2>
              <span className={`text-xs font-medium px-2 py-0.5 rounded ${orgStatusColor}`}>{caps.orgCap.pace.replace('_', ' ')}</span>
            </div>
            <div className="text-2xl font-semibold mt-2">{fmt(caps.orgCap.usedMtdUsd)} / {fmt(caps.orgCap.monthlyUsd)}</div>
            <div className="h-2 bg-slate-100 rounded mt-2">
              <div className="h-full bg-indigo-600 rounded" style={{ width: `${Math.min(100, orgPacePct)}%` }} />
            </div>
            <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
              {caps.orgCap.daysRemaining} days remaining · Resets {new Date(caps.periodResetAt).toLocaleDateString('en-GB')}
              <HelpHint content={`Pace based on the last ${caps.paceWindow} of spend extrapolated to the period end.`} />
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Projected: {fmt4(caps.paceProjectedEndOfPeriodUsd)}
            </div>
          </div>
          {viewMode === 'org' && (
            <div className="border rounded p-4">
              <h2 className="text-sm font-semibold text-slate-700 mb-2">Top spenders this month</h2>
              <SpendBarChart rows={caps.workspaces.slice(0, 5).map((w) => ({ id: w.id, name: w.name, usd: w.usedMtdUsd }))} />
            </div>
          )}
        </div>

        {/* Trend charts (org only, hidden for non-org-admin per spec §4.14) */}
        {viewMode === 'org' && trends && (
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded p-4">
              <h2 className="text-sm font-semibold text-slate-700 mb-2">6-month spend trend</h2>
              <SpendTrendChart trends={trends} />
            </div>
            <div className="border rounded p-4">
              <h2 className="text-sm font-semibold text-slate-700 mb-2">Cap utilisation trend</h2>
              <CapUtilisationChart trends={trends} />
            </div>
          </div>
        )}

        {/* Per-workspace caps table (org only) */}
        {viewMode === 'org' && caps.workspaces.length > 0 && (
          <PerWorkspaceCapsTable caps={caps} />
        )}
      </div>
    );
  }

  function PerWorkspaceCapsTable({ caps }: { caps: CapsResponse }) {
    // Use foundation <SortableTable>. Builder fills mechanically — workspace name (with WorkspaceBadge),
    // monthlyCapUsd, usedMtdUsd, pacePct (clamped 0..200), status pill.
    return null;
  }
  ```

- [ ] **Step 5: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:client
  ```

- [ ] **Step 6: Commit**
  ```
  git add client/src/pages/govern/components/SpendBarChart.tsx client/src/pages/govern/components/SpendTrendChart.tsx client/src/pages/govern/components/CapUtilisationChart.tsx client/src/pages/govern/SpendingPage.CapsTab.tsx
  git commit -m "feat(consolidation-govern): C10 — Caps tab + 3 vanilla SVG charts"
  ```

**Acceptance criteria:**
- Workspace view shows the org monthly cap card only (no second column, no trend charts, no per-workspace table).
- Org view shows the split top row (org cap left, top-5 bar chart right), then the two trend charts side-by-side, then the per-workspace caps table.
- Pace badge colour-coded by `caps.orgCap.pace` (`on_track` green, `warning` amber, `over` red).
- HelpHint tooltip on the pace bar reads `Pace based on the last <paceWindow> of spend extrapolated to the period end.`
- `Resets <date>` rendered next to the bar.
- `<N> days remaining` rendered below the bar.
- `paceProjectedEndOfPeriodUsd` rendered with 4-decimal precision.
- Cap-utilisation chart segments where `capUsage > 100` render as dashed red; null months render as a gap (no line).
- All charts are vanilla SVG. No chart library imported.
- Trend charts + per-workspace table hidden for non-org-admin users in org view (gate via existing helper).

### Task C11 — ConnectionsPage + test button + disconnect dialog

**Spec sections:** §1 goal 3 (15-row reference set; sortable + filterable), §3 audit row, §4.6 (Connection contract), §4.7 (org-scoped by default; workspace view shows owned-by-active-workspace), §4.8 (search `q` against `name + provider`), §4.9 (test button), §4.10 (disconnect impact warning + type-to-confirm when impact > 0), §4.13 (disconnect confirm copy), §4.14 (connect / disconnect / refresh hidden for non-org-admin on org-owned).

**Logical responsibility:** ship the unified Connections page with per-row test + disconnect + refresh.

**Files:**
- Create: `client/src/pages/govern/ConnectionsPage.tsx`
- Create: `client/src/pages/govern/components/ConnectionTestButton.tsx`
- Create: `client/src/pages/govern/components/DisconnectConfirmDialog.tsx`

- [ ] **Step 1: Scaffold `ConnectionsPage.tsx`**
  ```tsx
  import { useEffect, useState, useMemo } from 'react';
  import { PageShell } from '../../components/PageShell';
  import { SearchBox } from '../../components/SearchBox';
  import { EmptyState } from '../../components/EmptyState';
  import { ErrorState } from '../../components/ErrorState';
  import { SortableTable, type ColumnDef } from '../../components/SortableTable';
  import WorkspaceBadge from '../../components/WorkspaceBadge';
  import ViewModeSwitcher from '../../components/ViewModeSwitcher';
  import { useViewMode } from '../../hooks/useViewMode';
  import { listConnections } from '../../api/governApi';
  import type { Connection } from '@shared/types/govern';
  import { ConnectionTestButton } from './components/ConnectionTestButton';
  import { DisconnectConfirmDialog } from './components/DisconnectConfirmDialog';

  export default function ConnectionsPage() {
    const { viewMode, availableModes, setViewMode } = useViewMode();
    const [q, setQ] = useState('');
    const [rows, setRows] = useState<Connection[] | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [disconnectTarget, setDisconnectTarget] = useState<Connection | null>(null);

    useEffect(() => {
      setRows(null); setError(null);
      listConnections({ scope: viewMode === 'workspace' ? 'workspace' : 'org', q })
        .then((r) => setRows(r.rows))
        .catch(setError);
    }, [viewMode, q]);

    const columns: ColumnDef<Connection>[] = useMemo(() => [
      { key: 'name', label: 'Name', sortable: true, getValue: (r) => r.name },
      { key: 'provider', label: 'Provider', sortable: true, filterable: true, getValue: (r) => r.provider },
      { key: 'authMethod', label: 'Auth', sortable: true, filterable: true, getValue: (r) => r.authMethod },
      {
        key: 'status', label: 'Status', sortable: true, filterable: true,
        getValue: (r) => r.status,
        render: (r) => <StatusPill status={r.status} />,
      },
      {
        key: 'lastSync', label: 'Last sync', sortable: true,
        getValue: (r) => r.lastSyncAt ?? '',
        render: (r) => r.lastSyncAt ? new Date(r.lastSyncAt).toLocaleString() : '—',
      },
      {
        key: 'owner', label: 'Owner', sortable: true,
        getValue: (r) => r.owner.name,
        render: (r) =>
          r.owner.kind === 'workspace'
            ? <WorkspaceBadge clientId={r.owner.id} clientName={r.owner.name} variant="pill" clickable={false} />
            : <span className="text-xs text-slate-500">Org</span>,
      },
      {
        key: 'actions', label: '', sortable: false,
        render: (r) => (
          <div className="flex gap-2 justify-end">
            <ConnectionTestButton connectionId={r.id} />
            <button
              type="button"
              onClick={() => setDisconnectTarget(r)}
              className="text-xs text-red-600 hover:text-red-800"
            >
              Disconnect
            </button>
          </div>
        ),
      },
    ], []);

    if (error) return (
      <PageShell header={<h1>Connections</h1>}><ErrorState error={error} retry={() => setQ((x) => x)} /></PageShell>
    );

    return (
      <PageShell
        header={
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Connections</h1>
            <div className="flex items-center gap-3">
              <ViewModeSwitcher value={viewMode} onChange={setViewMode} availableModes={availableModes} />
              <SearchBox value={q} onChange={setQ} placeholder="Search name or provider..." />
            </div>
          </div>
        }
      >
        {rows === null ? (
          <div className="text-sm text-slate-500 py-8">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No connections"
            primaryAction={{ label: 'Clear filters', onClick: () => setQ('') }}
          />
        ) : (
          <SortableTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            persistKey={`connections-${viewMode}`}
            initialSort={{ key: 'name', dir: 'asc' }}
          />
        )}
        {disconnectTarget && (
          <DisconnectConfirmDialog
            connection={disconnectTarget}
            onClose={() => setDisconnectTarget(null)}
            onDisconnected={() => { setDisconnectTarget(null); setQ((x) => x); }}
          />
        )}
      </PageShell>
    );
  }

  function StatusPill({ status }: { status: Connection['status'] }) {
    const cls = {
      connected: 'bg-emerald-100 text-emerald-700',
      expired: 'bg-amber-100 text-amber-700',
      failed: 'bg-red-100 text-red-700',
      pending: 'bg-slate-100 text-slate-600',
    }[status];
    return <span className={`connection-status-pill px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>;
  }
  ```

- [ ] **Step 2: Build `ConnectionTestButton.tsx`**
  ```tsx
  import { useState } from 'react';
  import { testConnection } from '../../../api/governApi';
  import type { ConnectionTestResponse } from '@shared/types/govern';

  export function ConnectionTestButton({ connectionId }: { connectionId: string }) {
    const [busy, setBusy] = useState(false);
    const [last, setLast] = useState<ConnectionTestResponse | null>(null);

    async function handleTest() {
      setBusy(true);
      try {
        const r = await testConnection(connectionId);
        setLast(r);
      } finally {
        setBusy(false);
      }
    }

    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button" disabled={busy} onClick={handleTest}
          className="text-xs px-2 py-1 border rounded text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
        >
          {busy ? 'Testing…' : 'Test'}
        </button>
        {last && (
          <span
            className={`text-xs ${last.status === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}
            title={last.status === 'ok'
              ? `${last.latencyMs}ms — ${last.capabilities?.join(', ') ?? 'no capabilities reported'}`
              : `${last.error?.code}: ${last.error?.message}`}
          >
            {last.status === 'ok' ? `OK · ${last.latencyMs}ms` : `Failed · ${last.error?.code}`}
          </span>
        )}
      </span>
    );
  }
  ```

- [ ] **Step 3: Build `DisconnectConfirmDialog.tsx`**
  ```tsx
  import { useEffect, useState } from 'react';
  import Modal from '../../../components/Modal';
  import type { Connection, ConnectionUsage } from '@shared/types/govern';
  import { getConnectionUsage } from '../../../api/governApi';

  export function DisconnectConfirmDialog({
    connection, onClose, onDisconnected,
  }: {
    connection: Connection; onClose: () => void; onDisconnected: () => void;
  }) {
    const [usage, setUsage] = useState<ConnectionUsage | null>(null);
    const [confirmText, setConfirmText] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      getConnectionUsage(connection.id).then(setUsage).catch(() => setUsage({ agents: [], recurringTasks: [], workflows: [] }));
    }, [connection.id]);

    const impactCount = (usage?.agents.length ?? 0) + (usage?.recurringTasks.length ?? 0) + (usage?.workflows.length ?? 0);
    const requiresType = impactCount > 0;
    const canConfirm = !requiresType || confirmText.toLowerCase() === 'disconnect';

    async function handleDisconnect() {
      setBusy(true);
      try {
        // Existing per-kind disconnect endpoint. Confirm path with grep on commit;
        // for OAuth it's POST /api/connections/:id/disconnect (per spec §4.6 routing).
        await fetch(`/api/connections/${encodeURIComponent(connection.id)}/disconnect`, {
          method: 'POST', credentials: 'include',
        });
        onDisconnected();
      } finally {
        setBusy(false);
      }
    }

    return (
      <Modal
        title={`Disconnect ${connection.provider}?`}
        size="sm"
        onClose={onClose}
        footer={
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm bg-slate-100 rounded">Cancel</button>
            <button
              type="button" disabled={busy || !canConfirm} onClick={handleDisconnect}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded disabled:opacity-50"
            >
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        }
      >
        {usage === null ? (
          <p className="text-sm text-slate-500">Checking impact…</p>
        ) : (
          <>
            <p className="text-sm text-slate-700 mb-3">
              {usage.agents.length} agents, {usage.recurringTasks.length} recurring tasks,
              and {usage.workflows.length} workflows use this connection. They will fail until reconnected.
            </p>
            {requiresType && (
              <label className="text-xs text-slate-600 block">
                Type <code className="font-mono">disconnect</code> to confirm:
                <input
                  type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                  className="block w-full mt-1 text-sm border rounded p-1.5 font-mono"
                  autoFocus
                />
              </label>
            )}
          </>
        )}
      </Modal>
    );
  }
  ```

- [ ] **Step 4: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:client
  ```

- [ ] **Step 5: Commit**
  ```
  git add client/src/pages/govern/ConnectionsPage.tsx client/src/pages/govern/components/ConnectionTestButton.tsx client/src/pages/govern/components/DisconnectConfirmDialog.tsx
  git commit -m "feat(consolidation-govern): C11 — ConnectionsPage + test button + disconnect dialog"
  ```

**Acceptance criteria:**
- Page lists 15-row sample reference set (or whatever the org has) with provider / authMethod / status filters.
- `<SearchBox>` searches `name + provider`.
- Status pill colour-coded: connected (emerald), expired (amber), failed (red), pending (slate).
- Test button calls `POST /api/connections/:id/test`; renders OK + latency on success, failed + error code on failure.
- Disconnect button opens dialog that pre-fetches `/usage`; renders "<N> agents, <M> tasks, <K> workflows use this".
- When impact > 0, type-to-confirm "disconnect" required before the disconnect button enables.
- Connect / disconnect / refresh hidden for non-org-admin users on org-owned connections (per spec §4.14).

### Task C12 — Sidebar + router wiring; legacy page delete

**Spec sections:** §5 file inventory (`client/src/App.tsx` + `client/src/config/sidebar.ts` modified; legacy pages replaced), §9 (single-row-per-stream policy: Knowledge under Build / Spending under Setup / Connections under External — confirm with current sidebar group taxonomy below).

**Logical responsibility:** route `/knowledge`, `/spending`, `/connections` to the new pages, retire the legacy navigation rows, and (selectively) remove the obsolete page files.

**Files:**
- Modify: `client/src/App.tsx` (add three routes; redirect legacy paths)
- Modify: `client/src/config/sidebar.ts` (add three sidebar rows; remove duplicates per single-row-per-stream)
- Delete: `client/src/pages/WorkspaceMemoryPage.tsx` (replaced)
- Delete: `client/src/pages/SpendingBudgetsListPage.tsx` and `client/src/pages/SpendingBudgetDetailPage.tsx` (replaced)
- Delete: `client/src/pages/IntegrationsAndCredentialsPage.tsx` IF safe (verify no other route still uses it; current `App.tsx` references it from `/admin/mcp-servers`, `/admin/subaccounts/:id/connections`, and `/portal/:id/connections` — keep until those legacy routes also retire). For C12, keep `IntegrationsAndCredentialsPage.tsx` and only redirect `/connections` to the new page.

**Important — sidebar group naming reality vs spec.** Spec §9 names groups "Build", "Setup", "External". Existing sidebar (`client/src/config/sidebar.ts`) uses groups: `top | work | projects | agents | company | clientpulse | organisation | platform | footer`. There is NO "Build", "Setup", or "External" group today. **Resolution:** map spec-named groups onto existing groups:
- "Build" → `work` (Knowledge sits among Tasks / Automations / Workflows / Scheduled / Calendar / Sites / Triggers / Action Log)
- "Setup" → `organisation` (Spending sits among Companies / Configuration Assistant / Agents / Calendar / Automations / Skills / Team / Health / Manage / Spending Budgets / Spend Ledger)
- "External" → `organisation` as well, OR treat Connections as a sibling under `work` per workspace view. Single-row-per-stream means ONE row per page in a single group; the spec's three-stream split happens by group, not by row. Builder picks: Connections under `organisation` (it's an org-level concept by default per spec §4.7).

If introducing "Build", "Setup", "External" as new groups is desired, that's a coordinated change with Specs A and B — out of scope for this stream. Document the mapping decision in C12's commit message.

- [ ] **Step 1: Add the three new routes to `client/src/App.tsx`**
  Locate the section near line 408-412 where `/admin/subaccounts/:subaccountId/memory` and `/admin/subaccounts/:subaccountId/knowledge` are mounted. Add new routes alongside the existing ones (do NOT delete the legacy routes; they redirect):

  ```tsx
  // ── Govern (consolidation-govern, spec §1) ───────────────────────────────
  const KnowledgePage = lazy(() => import('./pages/govern/KnowledgePage'));
  const SpendingPage = lazy(() => import('./pages/govern/SpendingPage'));
  const ConnectionsPage = lazy(() => import('./pages/govern/ConnectionsPage'));

  // …in the Routes block (inside the same Route element as existing routes):
  <Route path="/knowledge" element={<KnowledgePage />} />
  <Route path="/spending" element={<SpendingPage />} />
  <Route path="/connections" element={<ConnectionsPage />} />

  // Redirect legacy paths to the new pages so bookmarks survive.
  <Route path="/admin/subaccounts/:subaccountId/memory" element={<Navigate to="/knowledge" replace />} />
  <Route path="/admin/subaccounts/:subaccountId/knowledge" element={<Navigate to="/knowledge" replace />} />
  <Route path="/admin/spending-budgets" element={<Navigate to="/spending" replace />} />
  <Route path="/admin/spending-budgets/:budgetId" element={<Navigate to="/spending" replace />} />
  <Route path="/admin/subaccounts/:subaccountId/spend-ledger" element={<Navigate to="/spending" replace />} />
  ```

  Note: leave `/admin/subaccounts/:subaccountId/connections` alone — that's the existing per-subaccount integration management page, kept for now per "files NOT modified" decision above. The Connections row in the sidebar points at the new `/connections`.

  Also: any redirect `<Navigate>` MUST use `replace`. If view-mode is org and the user was navigating from the sidebar's "Knowledge" link, the new page reads `useViewMode()` and shows the appropriate scope. If the URL legacy redirect lands on an unsupported view-mode (e.g. workspace bookmark with no active client), the page's empty/error state handles it — no special handling required here.

- [ ] **Step 2: Update `client/src/config/sidebar.ts`**
  Add three new rows. Place per the mapping above:
  ```ts
  // Knowledge — under `work` group (workspace view, near Tasks / Automations).
  // Insert in the `work` block after Action Log (current line ~196 region).
  if (hasOrgContext && activeClientId && viewMode === 'workspace') {
    if (hasOrgPerm('org.agents.view') /* or appropriate knowledge:read permission key */) {
      items.push({
        group: 'work',
        kind: 'link',
        key: 'knowledge',
        label: 'Knowledge',
        to: staticRoute('/knowledge'),
        iconKey: 'skills', // pick most appropriate iconKey from existing Icons map
      });
    }
  }

  // Spending — under `organisation` group, near existing Spending Budgets / Spend Ledger rows.
  // REPLACES both the existing 'spending-budgets' and 'spend-ledger' rows (single-row-per-stream).
  if (hasOrgContext && hasAnyOrgPerm) {
    if (hasOrgPerm('org.spend.admin') || hasOrgPerm('spend_approver')) {
      items.push({
        group: 'organisation',
        kind: 'link',
        key: 'spending',
        label: 'Spending',
        to: staticRoute('/spending'),
        iconKey: 'usage',
      });
    }
  }

  // Connections — under `organisation` group.
  if (hasOrgContext && hasAnyOrgPerm) {
    items.push({
      group: 'organisation',
      kind: 'link',
      key: 'connections',
      label: 'Connections',
      to: staticRoute('/connections'),
      iconKey: 'settings', // confirm appropriate icon
    });
  }
  ```

  REMOVE the existing rows:
  - `key: 'spending-budgets'` (currently at lines ~450-459) — superseded by `key: 'spending'`.
  - `key: 'spend-ledger'` (currently at lines ~460-469) — superseded by `key: 'spending'`.

  DO NOT touch: `key: 'admin-skills'`, `key: 'admin-mcp-servers'` — those remain page-specific.

- [ ] **Step 3: Verify route patterns are added to `APP_ROUTE_PATTERNS`**
  Open `client/src/config/routes.ts` and confirm `/knowledge`, `/spending`, `/connections` are in `APP_ROUTE_PATTERNS`. If they aren't, add them. Without this, `staticRoute('/knowledge')` will be a TypeScript error.

- [ ] **Step 4: Delete legacy page files (only after redirects confirmed working)**
  ```
  git rm client/src/pages/WorkspaceMemoryPage.tsx
  git rm client/src/pages/SpendingBudgetsListPage.tsx
  git rm client/src/pages/SpendingBudgetDetailPage.tsx
  ```

  **Caveat — re-import sweep before commit.** The legacy pages may be imported elsewhere (other pages, tests, mock exports). Run:
  ```
  npm run typecheck
  ```
  If typecheck reports references to the deleted files, restore them OR fix the importer. Common patterns: dashboard widgets that link to spending-budgets, breadcrumbs, route-config lists. If a non-trivial sweep is needed beyond the obvious imports, defer the deletion and only keep the redirect — the deletion can land in a follow-up PR. Document the choice in the commit.

- [ ] **Step 5: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  npm run build:client
  ```

- [ ] **Step 6: Commit**
  ```
  git add client/src/App.tsx client/src/config/sidebar.ts client/src/config/routes.ts
  git rm client/src/pages/WorkspaceMemoryPage.tsx client/src/pages/SpendingBudgetsListPage.tsx client/src/pages/SpendingBudgetDetailPage.tsx
  git commit -m "feat(consolidation-govern): C12 — sidebar + router wiring; retire legacy pages"
  ```

**Acceptance criteria:**
- `/knowledge`, `/spending`, `/connections` resolve to the new pages.
- Legacy paths (`/admin/subaccounts/:id/memory`, `/admin/subaccounts/:id/knowledge`, `/admin/spending-budgets`, `/admin/subaccounts/:id/spend-ledger`) redirect to the new pages.
- Sidebar shows exactly one row per stream: Knowledge in `work` (workspace view), Spending in `organisation`, Connections in `organisation`.
- Old `spending-budgets` and `spend-ledger` rows removed.
- All static `<Link>` and `<NavItem>` `to=` props use `staticRoute(...)` — no raw template-literal route strings introduced.
- `npm run typecheck` is clean (deleted-file imports either restored or fixed).

### Task C13 — Doc-sync (architecture.md only)

**Spec sections:** §7 (chunk plan row C13).

**Logical responsibility:** update the documentation surface that materially changes once Govern ships.

**Files:**
- Modify: `architecture.md` — extend the "Key files per domain" table (or equivalent index) with a Govern section.

**Files NOT touched (intentionally):**
- `KNOWLEDGE.md` — entries land here only if a non-obvious gotcha is encountered during build (per `docs/doc-sync.md`). The chunk does NOT pre-fill entries.
- `DEVELOPMENT_GUIDELINES.md` — no new invariant locked by C1-C12 that isn't already in spec §6.
- `docs/capabilities.md` — Govern is product-visible, but the entry update is an editorial change deferred to the doc-sync agent.
- `docs/spec-context.md` — no testing-posture change.
- `tasks/builds/consolidation-govern/handoff.md` — Phase 2 section is appended by the coordinator at handoff time, not by this chunk.

- [ ] **Step 1: Locate "Key files per domain" in `architecture.md`**
  Run: `grep -n "Key files per domain" architecture.md`

- [ ] **Step 2: Append a Govern subsection**
  Insert a new sub-table under the existing index. Suggested format (mirror existing style):

  ```md
  #### Govern (consolidation-govern, 2026-05)

  | Concern | Files |
  |---|---|
  | Knowledge list + override | `server/routes/knowledge.ts`, `server/services/knowledgeService.ts`, `server/services/knowledgeOverridePure.ts`, `client/src/pages/govern/KnowledgePage.tsx`, `client/src/pages/govern/components/KnowledgeRow.tsx`, `client/src/pages/govern/components/KnowledgeOverrideDialog.tsx` |
  | Auto-extraction gate | `server/services/memoryBlockGatePure.ts`, `server/services/memoryBlockService.ts` (call site) |
  | Spend ledger | `server/routes/agentCharges.ts` (`GET /api/spend/ledger`), `server/services/spendLedgerService.ts`, `server/services/spendLedgerServicePure.ts`, `client/src/pages/govern/SpendingPage.LedgerTab.tsx` |
  | Spend insights / trends | `server/services/spendInsightsService.ts`, `server/services/spendInsightsServicePure.ts`, `server/services/spendTrendsService.ts`, `server/services/spendTrendsServicePure.ts`, `client/src/pages/govern/components/SpendInsightsRow.tsx`, `client/src/pages/govern/components/SpendBarChart.tsx`, `client/src/pages/govern/components/SpendTrendChart.tsx`, `client/src/pages/govern/components/CapUtilisationChart.tsx` |
  | Caps + pace | `server/services/computeBudgetService.ts` (extended), `server/services/computeBudgetServicePure.ts` (pace projector), `client/src/pages/govern/SpendingPage.CapsTab.tsx` |
  | Connections list / usage / test | `server/routes/integrationConnections.ts` (`GET /api/connections`, `GET /:id/usage`, `POST /:id/test`), `server/services/connectionsService.ts`, `server/services/connectionsListPure.ts`, `server/services/connectionTokenService.ts` (testConnection dispatcher), `client/src/pages/govern/ConnectionsPage.tsx`, `client/src/pages/govern/components/ConnectionTestButton.tsx`, `client/src/pages/govern/components/DisconnectConfirmDialog.tsx` |
  | Shared contracts | `shared/types/govern.ts`, `client/src/api/governApi.ts` |
  | Schema additions | `server/db/schema/memoryBlocks.ts` (`auto_update_disabled`), `server/db/schema/memoryBlockVersions.ts` (`body_hash`), migration `migrations/0286_govern_auto_update_disabled.sql` |
  ```

- [ ] **Step 3: Verify no stale references**
  Run: `grep -n "WorkspaceMemoryPage\|SpendingBudgetsListPage\|SpendingBudgetDetailPage" architecture.md docs/`
  If matches exist, update or remove them inline so deleted file references don't lie about reality. Per CLAUDE.md §11 "Docs Stay In Sync With Code".

- [ ] **Step 4: Run G1 gate**
  ```
  npm run lint
  npm run typecheck
  ```
  (No `build:client` / `build:server` needed — markdown-only change.)

- [ ] **Step 5: Commit**
  ```
  git add architecture.md
  git commit -m "docs(consolidation-govern): C13 — architecture.md key files for Govern stream"
  ```

**Acceptance criteria:**
- `architecture.md` "Key files per domain" lists every file shipped in C1-C12, grouped by concern.
- No stale references to deleted legacy pages remain in `architecture.md` or `docs/`.
- `KNOWLEDGE.md` is touched only if a non-obvious gotcha was hit during the build.

## 8. Risks and mitigations

### R1 — Schema-vs-spec gap on `KnowledgeEntry.kind`

**Risk:** Spec contract names a closed `kind` enum (`belief | fact | observation | preference | issue`). `memory_blocks` does not have a `kind` column. The C2 mapper returns `'observation'` as default, which is honest about the gap but loses the distinction in the UI.

**Mitigation:** documented in plan §3 Gap 3 and §5. C2's mapper test asserts the default. Adding a real `kind` column is a separate spec amendment + migration; spec §10 implicitly captures this as the upstream extractor enrichment that's deferred.

**Residual risk:** UI filter on `kind` returns the same value for every row. UX impact is the kind filter shows only "observation" until enriched. Acceptable for Phase-2 ship; flag in Phase-3 acceptance.

### R2 — Cost precision divergence

**Risk:** Spec §6 says "integer microcents"; reality is integer cents. If a future enhancement introduces an actual microcent column, all aggregator divisions need updating in lockstep.

**Mitigation:** all cents → USD divisions live in three pure helpers: `amountMinorToCostUsd`, `centsToUsd` (insights), `centsToUsdRounded` (trends). One change point per service; pure-function tests would catch a wrong denominator.

**Residual risk:** none for this build. A future microcent migration must update the three helpers together.

### R3 — `agent_charges` does not split LLM/embedding/tool_call

**Risk:** Spec §4.2 contract names `type: 'llm' | 'embedding' | 'tool_call' | 'storage' | 'other'`. `agent_charges` only categorises by `charge_type: 'purchase' | 'subscription' | 'top_up' | 'invoice_payment' | 'refund'`. Mapping returns `'other'` for all rows — the type dimension is empty in practice.

**Mitigation:** `chargeTypeToContractType` returns `'other'`; mapper documented. If the team needs the LLM split, the route would UNION `agent_charges` with `llm_requests` (or its successor) — calls out the gap as a deferred enrichment. The Ledger UI's `type` filter still works mechanically; it just shows one value.

**Residual risk:** the Insights tile "Most active agent" is the more useful spend dimension; the type filter is degraded. Acceptable for Phase-2 ship.

### R4 — Connection test rate-limiter not yet built

**Risk:** Spec §4.9 mandates max 6 tests per connection per minute. If the existing rate-limit infrastructure (`server/services/securityAuditService` etc.) doesn't expose a per-connection bucket, C6 needs to add one. A naive `setInterval` bucket per process won't survive deploy + restarts and won't share state across replicas.

**Mitigation:** check `grep -rn "RateLimit\|rate_limit_buckets\|rate-limit" server/services server/middleware`. There is a `rate_limit_buckets` migration (0253). Reuse the existing bucket helper if present; otherwise an in-process bucket is acceptable for Phase-2 ship with a note that a Postgres-backed bucket is the follow-up.

**Residual risk:** small; test endpoint is read-only and providers themselves rate-limit aggressive callers.

### R5 — Connection-usage SQL columns may not exist

**Risk:** C6's usage CTE references `agent_data_sources.connection_id`, `scheduled_tasks.connection_id`, `workflows.connection_id`. If the actual schema names these `integration_connection_id` or stores the link in JSON config, the SQL fails at runtime.

**Mitigation:** C6 step 4 mandates a grep before commit. The chunk's commit message must record the actual column names used. If a column name doesn't exist (e.g. workflow → connection link is JSON-only or absent), return `[]` for that array and document the missing linkage in the deferred-items section of the spec.

**Residual risk:** disconnect impact warning is partially blind for the missing dimension. UX: `<DisconnectConfirmDialog>` still surfaces accurate counts for the dimensions that ARE linked. Acceptable for Phase-2 ship.

### R6 — Sidebar group taxonomy mismatch with spec

**Risk:** Spec §9 names groups "Build", "Setup", "External". Existing `sidebar.ts` uses `work | organisation | clientpulse | platform | footer`. There is no canonical mapping in the foundation handoff.

**Mitigation:** C12 step 2 maps spec-named groups onto existing groups (Knowledge → `work`, Spending + Connections → `organisation`). The decision is documented in the chunk's commit message. If Specs A or B introduce "Build", "Setup", "External" groups in their merges, C12's row keys are stable enough that a follow-up rename is mechanical.

**Residual risk:** none — visual outcome matches spec §9 single-row-per-stream; group naming is a label-only difference.

### R7 — `useViewMode` 'system' on Govern pages

**Risk:** `useViewMode` returns `'system' | 'org' | 'workspace'`. Govern pages handle workspace + org but spec §4.7 says system view is "not used in this stream". If a system-admin user lands on the page in system view, the data fetch may behave unexpectedly.

**Mitigation:** every Govern page treats `viewMode === 'system'` as 'org' (more permissive of the two). The data scope falls back to org-wide; UI remains consistent. C8/C9/C11 page code uses `viewMode === 'workspace' ? 'workspace' : 'org'`.

**Residual risk:** none — the system-view segment is gated to system admins only; org-scope data is what they would expect.

### R8 — Migration ordering with concurrent branches

**Risk:** Another in-flight branch may also be claiming `migrations/0286_*.sql`. If it lands first, C1 needs to bump to `0287` and update Drizzle metadata.

**Mitigation:** C1 step 1 confirms next available number before writing. Builder bumps if needed and reports.

**Residual risk:** minor merge friction; resolution is mechanical.

### R9 — Body-hash collision space

**Risk:** SHA-256 collisions are practically impossible (2^128 work factor) — no real risk. However, the partial unique index on `(memory_block_id, body_hash) WHERE body_hash IS NOT NULL` allows multiple rows where `body_hash IS NULL`, so a future "auto-extraction also writes a hash" change must populate `body_hash` for all writes to keep the index meaningful.

**Mitigation:** documented in C1 / C2. A follow-up migration could backfill hashes for legacy rows then drop the partial-WHERE clause; out of scope for this build.

**Residual risk:** none.

## 9. Self-consistency check

- **Goals (§1) match implementation (§4-§7)?** Yes. Knowledge → C1+C2+C8; Spending → C3+C4+C5+C9+C10; Connections → C6+C11; types → C7; wiring → C12; doc-sync → C13.
- **Every spec "must"/"guarantees" claim has a backing mechanism?**
  - Override sets `auto_update_disabled = true` atomically with the version insert: C2 step 4 (transactional `db.transaction`).
  - Auto-extraction skips BOTH UPDATE and version INSERT when `auto_update_disabled = true`: C1 step 8 + step 10.
  - List endpoints have stable seek-pagination with `id` tiebreaker direction matching primary sort (invariant I1): C2 step 4 (mapper note), C3 step 3 + step 5 (tuple `WHERE` predicate), C6 step 4. The ORDER BY always concludes with `id <sortDir>`. SQL `OFFSET` is forbidden for mutable lists.
  - `filterOptions` ORDER BY happens IN SQL (`ORDER BY count DESC, value/label ASC`) — C3 step 5, C6 step 4.
  - Connection test never bubbles 5xx: C6 step 5 always resolves with `{ status: 'ok' | 'failed' }`.
  - Connection test 10s monotonic (invariant I5): C6 step 5 uses `process.hrtime.bigint()` for both budget check and `latencyMs`; AbortController propagates cancellation to per-kind testers; abort path is normalised to `{ code: 'TIMEOUT' }` regardless of which sub-error surfaced from the dispatcher.
  - ETag mismatch returns HTTP 412 (invariant I3): C2 step 6 — distinguishes ETag concurrency (412) from state-transition violations (409). Server never merges; clients re-fetch.
  - Body-hash canonicalisation handles line-ending convention (invariant I4): C2 step 2 — order is NFC → CRLF/CR → LF → trim → collapse internal whitespace; canonical form has no newlines; tests assert.
  - Top-5 ranking with synthetic Other rollup at index 4 when actual_workspace_count > 5: C4 step 5 (`buildTrends`); fully deterministic via id-tiebreaker (invariant I6).
  - Insights time windows UTC-anchored: C4 step 4 SQL uses `now() AT TIME ZONE 'UTC'`.
  - Connection-usage aggregator single CTE under READ COMMITTED: C6 step 4 (`getConnectionUsage` single `db.execute(sql\`WITH ... SELECT ...\`)`).
  - Status enum closed at three values; auto_update_disabled is side-channel: C2 step 2 mapper.
  - Spend amounts integer cents in storage and aggregation; no floats: C3, C4, C5 pure modules sum `BigInt`/integer cents and divide at the boundary.
  - Override pre-condition `status='in_use'` else 409: C2 step 4 (`isOverrideAllowed` + `currentStatus` in 409 body).
  - DB→contract enum mappers fail closed on unknown values (invariant I2): C2 (`dbStatusToContract`), C3 (`chargeTypeToContractType`), C6 (`authTypeToContract`, `deriveStatus`); each has a colocated test asserting the throw.
  - Structured logs carry tenant + correlation context (invariant I7): wrapper services and routes attach `organisationId`, `subaccountId`, `requestId`, `actorUserId` at log call sites.
  - Zero-cap workspaces in trends are unbounded: C4 step 5 (`classifyCapUsage(s, 0) → null`); test asserts.
- **File inventory complete?** Yes — every component, page, service, and pure module named in spec §5 appears in plan §6 + §7 with explicit file paths.
- **Phase dependency graph clean?** Yes — C2→C1, C4→C3, C7→C1-C6, C8→C7, C9→C7, C10→C9, C11→C7, C12→C8+C9+C10+C11, C13 last. No cycles.
- **Deferred items section in spec exists and is honoured?** Spec §10. Plan honours: no bulk ops (C8, C11), no version-history modal (C8 ships only "current value + override flow"), no audit-log UI, no CSV export, no keyboard shortcuts, no spend forecasting beyond linear pace (C5 ships linear), no scope-diff UI (C11 surfaces capabilities returned by test but not a diff view).
- **Testing posture matches framing?** Spec §8 = `static_gates_primary | runtime_tests: pure_function_only | frontend_tests: none_for_now`. Plan ships pure-function tests in C1, C2, C3, C4 (insights+trends), C5, C6. No frontend tests authored. Static gates run via lint + typecheck + build:client/server per chunk.
- **Permissions/RLS/execution-model statements explicit?** Spec §6 → plan §4 architecture decisions + each chunk's permission middleware (`requireOrgPermission`).
- **Type consistency between contract and DB?** §3 Spec coverage map + §5 schema reconciliation table. `KnowledgeEntry.autoUpdateDisabled` is camelCase boolean (frontend); DB column is snake_case `auto_update_disabled` — mapper at the route layer.
- **No placeholder text remaining in chunks?** Two `TODO C2 step 4` markers and one `TODO C6 step 4` exist as deliberate placeholders for SQL-projection stubs. C2 Step 7b and C6 Step 7b add an explicit grep gate (`git diff --cached -G "TODO C[0-9]" --name-only` must be empty) per invariant I8 — commits are rejected if any marker survives.
- **Cross-cutting invariants (§4) cited in chunks where they apply?** I1 (seek pagination): C2, C3, C6. I2 (fail-closed enums): C2, C3, C6. I3 (412 for ETag): C2. I4 (canonicalisation): C2. I5 (monotonic timeout): C6. I6 (deterministic top-N): C4. I7 (logs): all server chunks. I8 (TODO grep): C2 + C6 explicit Step 7b; other chunks inherit via CI.
- **Spec gaps documented?** Yes — five gaps in §3 (resolved in §5).
