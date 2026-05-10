# Pre-Test Hardening — Implementation Plan

**Status:** LOCKED (post-review, 2026-05-10)
**Plan date:** 2026-05-10
**Author:** architect
**Build slug:** `pre-test-hardening`
**Source spec:** [`spec.md`](./spec.md)
**Source brief:** [`brief.md`](./brief.md)
**Migration range reserved:** `0318–0320`
**Class:** Major

---

## Table of contents

- Executor notes
- Model-collapse check
- Architecture notes
- Plan-time builder contracts
  1. W3 connector_configs active-status predicate
  2. RLS-protected-tables registration touchpoint + partial UNIQUE index
  3. T1 route + client call sites + grep contract
  4. T3 `taskService.createTask` caller audit
  5. S1 source-rule snapshot (status×action eligibility + customer-match policy)
  6. `withOrgTx` primitive
  7. Migration sequence (0318 / 0319 / 0320)
- C1 — W1 (HMAC fail-closed) + W2 (recordIncident on 5xx)
- C2 — W3 (cross-tenant attribution + persistent dedup)
- C3 — T1 (support read-path subaccount scoping)
- C4 — T2 (reference-document promote: cross-org scope-ID rejection)
- C5 — T3 (`taskService.createTask` write-path scoping)
- C6 — S1 (preflight checks 4–7) + S2 (agent-run principal cannot set `overrideCollision`)
- C7 — V1 (PATCH /api/connections enum validation + migration 0320)
- C8 — V2 (knowledge override concurrent-write serialisation)
- C9 — O1 (rollup compact SQL fix) + O3 (reseed env guard) + O4 (reseed transaction wrap)
- C10 — O2 runbook + O5 branch-protection record
- Cross-chunk verification (G2 / branch level)
- Self-consistency notes
- Risks & mitigations
- Done — plan ready for builder

---

## Executor notes

- **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
- Per-chunk verification = `npm run lint` + `npx tsc --noEmit -p server/tsconfig.json` + targeted vitest for tests authored in THIS chunk. Nothing more. **Carve-outs:** (a) `npm run build:client` is a G2 / branch-level check, not a per-chunk one; do not run it inside any C-chunk's G1 gate. (b) C10 is docs-only — its G1 gate is `npm run lint` only (no typecheck, no vitest); G2 still runs server typecheck on the integrated branch.
- Sister-branch boundary (spec §0.2): touching `server/middleware/*`, auth routes, rate-limiting primitive, multer config, `server/services/workflowEngineService.ts`, `workflowRunService.ts`, `agentExecutionService.ts`, or `agentRuns` schema rejects the build via the scope-out grep gate at G2. Two T3 caller sites in `workflowEngineService.ts` (lines 2716, 2962) are intentionally left untouched; they ride sister-branch ownership.
- Operator commits explicitly after each chunk lands; no auto-commit from the executing session.
- All four DEC-1 / DEC-2 / DEC-3 / DEC-4 resolutions in spec §0.4 are LOCKED. Do not relitigate.

---

## Model-collapse check

This is a code-hardening sprint: fail-closed HMAC, persistent dedup table, tenant scoping closures, transaction primitives, advisory locks, enum CHECK constraints, and operational guards. None of these decompose into ingest → extract → transform → render. There is no LLM call to collapse — the work is the opposite of model-driven: it closes deterministic correctness gaps in webhook, RLS, and concurrency code. **Collapsed-call alternative rejected:** the entire sprint contains zero LLM invocations and zero classification-shaped steps; a frontier multimodal model has nothing to do here. Recorded for the audit trail.

---

## Architecture notes

### Decisions

The four locked decisions (spec §0.4) are reproduced here for the builder so they don't have to context-switch back to the spec mid-implementation:

- **DEC-1** — Support read scoping shape: subaccount-required path. Every read endpoint moves under `/api/subaccounts/:subaccountId/support/...`.
- **DEC-2** — Webhook attribution shape (W3): per-org URL path token (`/api/webhooks/teamwork/:orgWebhookToken`). HMAC remains the auth boundary; the path token is a coarse-grained discriminator stored on `connector_configs.webhook_token`.
- **DEC-3** — Migration 0240 phased swap: deferred to post-launch; ship runbook only.
- **DEC-4** — `taskService.createTask` signature: caller-supplied `tx` is required at the type level (LOCKED — no runtime-only substitute). Compile-time enforcement is the contract. See C5 plan-time builder contract item 4 for the implementation shape and the sister-branch typecheck-integration plan.

### Patterns applied

- **Single-responsibility, non-introduction.** No new service files in this build. Every change extends an existing file. New library: one (`server/lib/webhookReplayNonceStore.ts`) — the persistent counterpart to `server/lib/webhookDedupe.ts`. Justification for the new lib instead of editing `webhookDedupe.ts`: the existing in-memory store is still useful as a fast-path probe, so we keep it and add the durable store alongside.
- **Adapter-style isolation for the prod-DB guard.** New module `scripts/lib/prod-db-guard.ts` exposes a single `assertDevTargetOrThrow()` callable; `_reseed_drop_create.ts` and `_reseed_restore_users.ts` both use it. This is the only abstraction the build introduces.
- **Composition over inheritance everywhere else.** No inheritance-shaped changes; all changes are additive to existing functions or are signature changes on existing functions.

### What is intentionally NOT abstracted

- The S1 preflight checks (4–7) are added as additional functions in the existing `supportDraftPreflightPure.ts` module rather than into a new "preflight engine". Each check is a pure decision function consumed by `approveDraft`.
- The persistent replay-nonce store is a thin wrapper over a single SQL `INSERT ... ON CONFLICT DO NOTHING`; no new transaction primitive.
- The advisory lock for V2 is a single SQL statement at the top of the existing `withOrgTx` block; no new locking abstraction.

### Patterns NOT used

- No event bus, no new pub/sub channel, no new job framework, queue primitive, or scheduler abstraction. C2 adds one ordinary job module (`webhookReplayNoncePruneJob.ts`) for replay-nonce pruning and registers it with the existing job framework — that is one new job *file*, not a new job *class* in the architectural sense.
- No new feature flags. Spec contains no rollout-gated behaviour; everything flips on at the same instant via the merge.

---

## Plan-time builder contracts

These are the seven builder-contract items resolved at plan time so the builder reads them once and doesn't go rummaging.

### 1. W3 connector_configs active-status predicate (spec §2.3 + §0.7)

**Schema source:** `server/db/schema/connectorConfigs.ts:15`.

```ts
status: text('status').notNull().default('active').$type<'active' | 'error' | 'disconnected'>(),
```

**Locked predicate for the W3 token lookup:** the route handler resolves a connector config by

```ts
WHERE connector_type = 'teamwork'
  AND status = 'active'
  AND webhook_token = $1
```

— exactly three filters in conjunction. Never `webhook_token` alone (cross-provider routing risk per spec §2.3 paragraph 1) and never without `status = 'active'` (revoked / disconnected configs cannot be reactivated by a delivery). The existing `connectorConfigService.findAllActiveByType('teamwork')` at `server/services/connectorConfigService.ts:244` already filters on `status = 'active'`; the new lookup uses the same column with the same value plus the token equality.

**The builder MUST NOT** filter on `disconnectedAt IS NULL`, `installedAt IS NOT NULL`, or any other column as a stand-in for "active". The single source of truth for active/enabled is `status = 'active'`. The schema does not carry an `is_active` boolean or an `enabled_at` timestamp.

### 2. RLS-protected-tables registration touchpoint + partial UNIQUE index expression (spec §2.3 storage block + §0.7)

**Registry path:** `server/config/rlsProtectedTables.ts`. Latest registered migration in the file at plan time is `0312_action_attempts.sql`. Append a new entry for `webhook_replay_nonces`:

```ts
// 0318 — Pre-Test Hardening: persistent webhook replay nonces (W3)
{
  tableName: 'webhook_replay_nonces',
  schemaFile: 'webhookReplayNonces.ts',
  policyMigration: '0318_webhook_replay_nonces.sql',
  rationale: 'Per-org webhook replay nonces (deliveryId from provider) — cross-tenant leak would reveal which webhook events any other org has received; UNIQUE constraint is the dedup invariant.',
},
```

**Partial UNIQUE index expression on `connector_configs.webhook_token` (locked):**

```sql
CREATE UNIQUE INDEX connector_configs_webhook_token_unique
  ON connector_configs (webhook_token)
  WHERE webhook_token IS NOT NULL;
```

The `WHERE webhook_token IS NOT NULL` clause is required so non-Teamwork rows that leave `webhook_token` NULL do not collide on uniqueness (per spec §2.3 storage block). Idempotency: use `CREATE UNIQUE INDEX IF NOT EXISTS`. No `CONCURRENTLY` (we run inside the migration transaction).

### 3. T1 — route + client call sites + grep contract (spec §3.1 + §0.7)

**Server route files (in scope, all under `server/routes/support/`):**

| File | Routes mounted |
|---|---|
| `server/routes/support/index.ts` | mounts the three sub-routers under a single prefix |
| `server/routes/support/supportTicketsRoutes.ts` | `GET /tickets`, `GET /tickets/:id` |
| `server/routes/support/supportDraftsRoutes.ts` | `GET /drafts`, `GET /drafts/:id`, `POST /drafts/:id/approve`, `POST /drafts/:id/reject`, `POST /drafts/:id/edit`, `POST /drafts/:id/manual-resolve` |
| `server/routes/support/supportInboxesRoutes.ts` | `GET /inboxes`, `PATCH /inboxes/:id` |

**Server mount point:** `server/index.ts` line 473 currently reads `app.use('/api/support', supportRouter);`. Builder changes this to `app.use('/api/subaccounts/:subaccountId/support', supportRouter);` AND removes any unscoped mount. Express path parameters propagate down through `Router.use()` only when the inner router is created with `Router({ mergeParams: true })` — builder must verify each of the three sub-router files declares `Router({ mergeParams: true })` so `req.params.subaccountId` is visible inside the leaf handlers.

**Service-layer query helpers to update:**

| Service | Function | Current signature note | Required change |
|---|---|---|---|
| `server/services/supportTicketService.ts:338` | `listOpenTickets` | reads `principal.subaccountId` (currently `null` from routes) | accept and filter on a non-null `subaccountId` from the resolved param |
| `server/services/supportTicketService.ts:257` | `readThreadForHumanUi` | same | same |
| `server/services/supportDraftDispatchService.ts:547` | `listDraftsForReview` | same | same |
| `server/services/supportDraftDispatchService.ts:573` | `getDraftById` | same | same |
| `server/services/supportInboxService.ts:62` | `listInboxes` | same | same |
| `server/services/supportInboxService.ts:140` | `updateAgentConfig` | already uses an inbox id | add a precondition that the inbox's `subaccount_id` matches the resolved subaccount; reject 403 if not |

In each route handler, replace `subaccountId: null` in the `PrincipalContext` literal with `subaccountId: subaccount.id` after `const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);`.

**Client call sites (in scope, all under `client/src/pages/`):**

| File:line | Current call |
|---|---|
| `client/src/pages/integrations/SupportDeskSetupPage.tsx:22` | `api.get<{ inboxes: InboxHealth[] }>('/api/support/inboxes')` |
| `client/src/pages/support/DraftReviewQueue.tsx:30` | `api.get<{ drafts: Draft[] }>('/api/support/drafts')` |
| `client/src/pages/support/DraftReviewQueue.tsx:64` | ``api.post(`/api/support/drafts/${selected.id}/approve`, ...)`` |
| `client/src/pages/support/DraftReviewQueue.tsx:76` | ``api.post(`/api/support/drafts/${selected.id}/reject`, ...)`` |
| `client/src/pages/support/DraftReviewQueue.tsx:88` | ``api.post(`/api/support/drafts/${selected.id}/manual-resolve`, ...)`` |
| `client/src/pages/support/InboxConfigPage.tsx:101` | ``api.patch(`/api/support/inboxes/${inbox.id}`, ...)`` |
| `client/src/pages/support/InboxConfigPage.tsx:263` | `api.get<{ inboxes: Inbox[] }>('/api/support/inboxes')` |
| `client/src/pages/support/TicketDetailPage.tsx:64` | ``api.get<ThreadData>(`/api/support/tickets/${id}`)`` |
| `client/src/pages/support/TicketsListPage.tsx:44` | ``api.get<{ tickets: Ticket[] }>(`/api/support/tickets${params}`)`` |
| `client/src/pages/support/TicketsListPage.tsx:56` | `api.get<{ tickets: Ticket[] }>('/api/support/tickets?statusGroup=quarantined')` |
| `client/src/pages/support/TicketsListPage.tsx:63` | `api.get<{ inboxes: Inbox[] }>('/api/support/inboxes')` |

Each call site rewrites to `/api/subaccounts/${subaccountId}/support/...`. The pages must already have a subaccount in scope; if any does not, the page is migrated to take it from the existing subaccount-routing context (the same context every other subaccount-scoped page consumes).

**Grep contract for the route-inventory check (spec §3.1 acceptance):**

The gate is a *set* of patterns, not a single regex. Builder runs each pattern below and pastes the (expected empty) output into `progress.md`.

```bash
# String-literal callers (single + double quoted) of the legacy unscoped paths.
rg -n "['\"]/api/support/(tickets|drafts|inboxes)" \
  --glob '!docs/**' --glob '!tasks/**' --glob '!*.md' \
  --glob '!server/routes/support/**' \
  -- server/ client/src/ shared/

# Template-literal callers.
rg -n "\`/api/support/(tickets|drafts|inboxes)" \
  --glob '!docs/**' --glob '!tasks/**' --glob '!*.md' \
  --glob '!server/routes/support/**' \
  -- server/ client/src/ shared/

# URL-builder helpers (api wrapper, fetch, axios) that interpolate the support segment.
rg -n "apiUrl\(['\"]/support/(tickets|drafts|inboxes)" \
  --glob '!docs/**' --glob '!tasks/**' --glob '!*.md' \
  -- server/ client/src/ shared/

# Legacy unscoped mount check — the old app.use('/api/support', supportRouter) line
# must NOT remain anywhere in the server entrypoints.
rg -n "app\.use\(['\"]\/api\/support['\"]" -- server/
```

**Scope of the gate (per spec §3.1 acceptance):** `server/`, `client/src/`, `shared/` only. Excluded explicitly: `docs/`, `tasks/`, all `*.md`, and the support route definitions themselves (`server/routes/support/**` — those legitimately use the bare `/tickets`, `/drafts`, `/inboxes` segments inside their `Router` definitions, which become legal under the new mount). Tests that intentionally assert the legacy paths return 404 are also out of scope; if any are written, they must declare the assertion via comment and live under `__tests__/` directories that the gate excludes via `--glob '!**/__tests__/**'` (add this exclusion to all three patterns above when authoring such a test).

**Builder records in `progress.md`:** each command verbatim, the output (expected empty), and the date the gate was run.

### 4. T3 — `taskService.createTask` caller audit (spec §3.3 + §0.7 + §10)

**Implementation file:** `server/services/taskService.ts:130` (function definition); `:160`, `:168`, `:195` are the bare `db` references that need to switch to the supplied `tx`.

**Caller audit — four buckets.** Total direct call sites of `taskService.createTask` discovered at plan time: 17. Bucketed:

- **Implementation site (1):** `server/services/taskService.ts:130` — function definition itself; not a "caller" but listed for completeness.
- **In-scope direct call sites of `taskService.createTask` to migrate (15):** rows 1–13, 14, 17 below. Each migrates to the canonical `(input, tx)` shape per the "Caller pattern" above. Row 13 is special — see notes.
- **Sister-branch call sites preserved by transitional overload (2):** rows 15–16 below. Untouched on this branch; the overload makes them typecheck; sister branch reconciles when it migrates.
- **Deferred call path (1, no wrapper added in this build):** the GHL auto-start job at `server/jobs/ghlAutoStartOnboardingJob.ts` invokes `subaccountOnboardingService.autoStartOwedOnboardingWorkflows`, which transitively reaches the createTask call at row 13. Per spec §10, the GHL path is explicitly deferred; this build adds a `// TODO(post-T3, spec §10): wrap in withOrgTx — explicitly deferred per spec §0.4 + §10` comment at the GHL caller and otherwise leaves it unmodified.

**Bucket 1 — In-scope direct call sites (15 rows):**

| # | File:line | Currently inside `withOrgTx`? | Required action |
|---|---|---|---|
| 1 | `server/routes/tasks.ts:44` | no (route handler) | Wrap as `await withOrgTx({ organisationId: req.orgId!, source: 'route:tasks.create' }, async () => { const tx = getOrgScopedDb('route:tasks.create'); return createTask(input, tx); })`. |
| 2 | `server/routes/portal.ts:654` | no | Wrap, source `route:portal.replay-org` |
| 3 | `server/routes/portal.ts:674` | no | Wrap, source `route:portal.replay-system` |
| 4 | `server/routes/workflowRuns.ts:69` | no | Wrap, source `route:workflowRuns.start` |
| 5 | `server/routes/githubWebhook.ts:168` | no | Wrap, source `route:githubWebhook.issue-opened` |
| 6 | `server/routes/githubWebhook.ts:215` | no | Wrap, source `route:githubWebhook.issue-comment` |
| 7 | `server/services/deliveryService.ts:240` | no | Wrap inside `deliveryService.deliver(...)`, source `service:deliveryService.deliver` |
| 8 | `server/services/scheduledTaskService.ts:647` | no | Wrap, source `service:scheduledTaskService.runDue` |
| 9 | `server/services/skillExecutor.ts:3392` | no | Wrap, source `service:skillExecutor.<handler>` (use the calling skill name in the source label) |
| 10 | `server/services/skillExecutor.ts:3633` | no | Wrap, same shape |
| 11 | `server/services/skillExecutor.ts:4402` | no | Wrap, same shape |
| 12 | `server/services/skillExecutor.ts:5442` | no | Wrap, same shape |
| 13 | `server/services/subaccountOnboardingService.ts:230` | the surrounding function `startOwedOnboardingWorkflow` already uses `getOrgScopedDb` at line 217 — it expects to run inside `withOrgTx` | The createTask call at line 230 is migrated to `createTask(input, tx)` where `tx` comes from `getOrgScopedDb('subaccountOnboardingService.startOwedOnboardingWorkflow')`. The actual `withOrgTx` wrap edit lives one level up, at the function's CALLER `server/routes/subaccountOnboarding.ts:53` (in-scope, this build). The GHL caller at `server/jobs/ghlAutoStartOnboardingJob.ts` is the deferred path — see Bucket 4. |
| 14 | `server/services/systemIncidentService.ts:289` | no | Wrap, source `service:systemIncidentService.openTicket` |
| 15 | `server/services/workflowRunStartSkillService.ts:58` | no | Wrap, source `service:workflowRunStartSkillService.start` |

**Bucket 2 — Sister-branch sites preserved by transitional overload (2 rows):**

| # | File:line | Action |
|---|---|---|
| 16 | `server/services/workflowEngineService.ts:2716` | Do NOT touch. Spec scope-out grep gate enforces non-touch. The 4-arg legacy call shape is preserved on this branch via the transitional overload (see "Implementation shape" above); typecheck stays clean. Sister branch removes the overload when it lands its own `withOrgTx` wrappers. |
| 17 | `server/services/workflowEngineService.ts:2962` | Same. |

**Bucket 3 — Deferred call path (1):**

`server/jobs/ghlAutoStartOnboardingJob.ts` — the GHL auto-start path that transitively reaches row 13's createTask call. NO wrapper added in this build. Builder lands a `// TODO(post-T3, spec §10): wrap in withOrgTx — explicitly deferred per spec §0.4 + §10. Depends on the GHL unauthenticated path landing first.` comment at the call site and otherwise leaves the file unmodified.

**Caller checklist count for `progress.md`:** 15 in-scope direct call sites migrated (Bucket 1) + 1 indirect wrap edit at `server/routes/subaccountOnboarding.ts:53` + 1 TODO comment at `server/jobs/ghlAutoStartOnboardingJob.ts` + 2 untouched sister-branch sites preserved by overload. Builder records each as DONE inline in `progress.md` as it lands.

**Implementation shape (DEC-4 = caller-supplied `tx`, type-level — LOCKED):**

The signature change is described in spec §3.3 as `createTask(input, tx)` and is reinforced by §0.4 DEC-4 ("compile-time enforcement … catches regressions for free"), §0.7 invariant F ("caller-supplied `tx` is required at the type level"), and §3.3 acceptance #1 ("removing the `tx` parameter from any call site is a TypeScript error"). All three lock the type-level shape. A runtime-only / ALS-throw substitute does NOT satisfy DEC-4; the type-level signature is the contract.

**Canonical signature.** `createTask` becomes:

```ts
export async function createTask(
  input: CreateTaskInput,
  tx: OrgScopedTx,
): Promise<Task>
```

Where `CreateTaskInput` collects `{ organisationId, subaccountId, data, userId? }` and `OrgScopedTx` is the existing ALS-aware drizzle-tx type (locate it before introducing — search the repo for the type already used by other `withOrgTx`-consuming services; if no shared type alias exists, introduce one in a stable location like `server/lib/orgScopedDb.ts`).

**Caller pattern.** `withOrgTx`'s actual signature (`server/instrumentation.ts:172`) is `withOrgTx<T>(ctx: OrgTxContext, fn: () => Promise<T>): Promise<T>` — the callback takes NO arguments. The tx is retrieved inside the callback via `getOrgScopedDb(source)`. So every in-scope caller has the shape:

```ts
await withOrgTx({ organisationId, source }, async () => {
  const tx = getOrgScopedDb(source);
  return createTask(input, tx);
});
```

This satisfies DEC-4 because the caller supplies an explicit `tx` to `createTask`. `withOrgTx` establishes the transactional ALS context; `getOrgScopedDb` retrieves the ALS-bound tx at the boundary; `createTask(input, tx)` receives it explicitly so TypeScript enforces the contract at every call site. (Builder must NOT write `async (tx) => …` — that form is incompatible with the actual `withOrgTx` signature.)

**Sister-branch typecheck integration plan (resolves the §0.2 / §3.3 / §9 tension).**

§0.2 forbids touching `server/services/workflowEngineService.ts`; §3.3 mandates the signature change; §9 requires `npx tsc --noEmit` clean. The two callers at `:2716` and `:2962` use the legacy 4-arg shape and cannot be migrated on this branch. Resolution: ship a transitional TypeScript overload on `taskService.createTask` that admits the legacy 4-arg shape, throws at runtime, and is enforced by a grep gate to be unreachable from any in-scope caller.

```ts
// Canonical — required for all in-scope callers.
export function createTask(input: CreateTaskInput, tx: OrgScopedTx): Promise<Task>;

// Transitional — accepts the pre-T3 4-arg shape so the 2 sister-branch callers
// in workflowEngineService.ts (lines 2716, 2962) typecheck on this branch.
// Throws at runtime. Sister branch removes this overload + its callers when it
// lands its own withOrgTx wrappers per §0.2.
/** @deprecated transitional shim for sister-branch reconciliation — do NOT call from new code */
export function createTask(
  organisationId: string,
  subaccountId: string,
  data: CreateTaskData,
  userId?: string,
): Promise<Task>;

export async function createTask(
  arg1: CreateTaskInput | string,
  arg2: OrgScopedTx | string,
  arg3?: CreateTaskData,
  arg4?: string,
): Promise<Task> {
  if (typeof arg1 === 'string') {
    throw new Error(
      'taskService.createTask called via legacy 4-arg shape — caller must migrate to (input, tx) and wrap in withOrgTx (DEC-4 / spec §3.3). Sister-branch transitional path; runtime-unreachable from in-scope callers.',
    );
  }
  // canonical implementation runs against arg2 (the OrgScopedTx)
  …
}
```

**Why this satisfies DEC-4 for in-scope callers.** Every in-scope call site is migrated to the typed `(input, tx)` shape; TypeScript rejects any new call that drops `tx` (the canonical overload requires it). The 4-arg overload is a sister-branch-only escape hatch, runtime-trapped, and grep-gated to remain unreached from in-scope code. Sister branch removes the overload when its callers migrate.

**Grep gate (added to G2 alongside the existing scope-out gate).**

The gate runs TWO patterns to catch both the qualified call (`taskService.createTask(...)`) and any bare call from a destructured/named import (`createTask(...)`).

```bash
# Pattern 1 — qualified call. Any caller of the 4-arg legacy shape MUST be one of the
# two known sister-branch sites.
rg -n "taskService\.createTask\([^{]" \
  --glob '!server/services/taskService.ts' \
  --glob '!server/services/__tests__/**' \
  -- server/ shared/

# Pattern 2 — bare call (named import / destructure / re-export). Same expected set.
# A first-positional arg that does not start with "{" indicates the legacy 4-arg shape.
rg -n "\bcreateTask\([^{]" \
  --glob '!server/services/taskService.ts' \
  --glob '!server/services/__tests__/**' \
  -- server/ shared/
```

**Expected validated output:** the only `taskService.createTask` legacy-shape callers remaining are the two known sister-branch lines:

```
server/services/workflowEngineService.ts:2716: ... taskService.createTask(run.organisationId, …
server/services/workflowEngineService.ts:2962: ... taskService.createTask(…
```

Pattern 2 (the bare-name grep) may return matches from unrelated functions also named `createTask`. Such matches are NOT regressions, but they MUST be documented and excluded by reasoning, not silently ignored: builder pastes both commands and their raw combined output into `progress.md`, then for each non-`taskService` match adds a one-line annotation citing the actual binding (file:line of the import or local definition) confirming the match is not a route to `taskService.createTask`. After exclusions are documented, the only remaining `taskService.createTask` legacy-shape callers must be the two `workflowEngineService.ts` lines above. Anything else is a regression — fix the call site to use the `(input, tx)` shape before merging.

**GHL caller deferral.** The GHL caller at `subaccountOnboardingService` line 230, when invoked via `ghlAutoStartOnboardingJob`, currently runs without a `withOrgTx` wrapper. The chunk LANDS a TODO comment at the GHL caller pointing at spec §10, and otherwise does not touch the GHL path. The non-GHL caller at `server/routes/subaccountOnboarding.ts:53` IS migrated in this chunk.

### 5. S1 source-rule snapshot (spec §4.1 — locked)

The pre-test-hardening spec §4.1 references `tasks/builds/support-ticket-structure/spec.md` §5.1.A (status/action eligibility) and §5.1.B (customer-match policy). The actual source file is `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md` (no file at the referenced path). The plan resolves this discrepancy at plan time so the builder doesn't waste a search.

**§5.1.A — Canonical status state machine table (snapshotted verbatim from `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md` lines 299–313):**

| Value | Visible in agent queues? | Eligible for autonomous reply? | Meaning |
|---|---|---|---|
| `open` | yes | yes | Active, agent attention required, no party currently waiting. |
| `pending_internal` | yes | no (status-change / internal-note only) | Waiting on internal action. |
| `waiting_on_customer` | yes | no by default; opt-in for follow-up | Reply has gone out, awaiting customer response. |
| `resolved` | no by default; opt-in for post-resolution | no by default | Support outcome completed. Customer reply reopens to `open`. |
| `closed` | no | no | Terminal/archive state. Reopening is an explicit operation. |
| `unknown_provider_status` | **no (quarantined)** | **no** | Adapter could not map provider's status. Excluded from all agent queues + actions until mapping is added. |

**Mapping the column 3 ("Eligible for autonomous reply?") values to the §4.1 Check 4 logic (status/action eligibility for `support.propose_reply` / `support.add_internal_note` / `support.set_status`):**

| Status | `support.propose_reply` allowed? | `support.add_internal_note` allowed? | `support.set_status` allowed? |
|---|---|---|---|
| `open` | yes | yes | yes |
| `pending_internal` | **no** (column 3 says "no") | yes | yes |
| `waiting_on_customer` | conditional on `agent_config.optIns.autonomousReplyOnWaitingOnCustomer === true` | yes | yes |
| `resolved` | conditional on `agent_config.optIns.postResolutionFollowUp === true` | yes | yes (but cannot transition to `closed` or `unknown_provider_status` per §11.7) |
| `closed` | **no** | **no** | **no** (reopening is an explicit operator action per §5.1.A "closed → open: only via explicit reopen action, not via inbound message") |
| `unknown_provider_status` | **no** (quarantined) | **no** | **no** |

**§5.1.B — Customer-match policy table (resolved at plan time):**

The pre-test-hardening spec §4.1 calls for a "customer-match policy gate" that "rejects if the inbox's customer-match policy disallows the customer in question (per spec §5.1.B)". **The source spec does not define a §5.1.B customer-match policy table.** What exists in the source spec is:

- **§8.1 #6 (line 939):** "Customer identity resolved when policy requires it (per inbox config flag — currently unused in v1; reserved for the future opt-in `requireCustomerMatch` flag)."
- **§11.6 Customer-identity resolution result (line 1275):** `{ canonicalContactId: string | null; emailMatchCount: 0 | 1 | 'multiple' }`. `canonicalContactId` is set only when `emailMatchCount === 1`. The `multiple` case is logged via `support.ingest.contact_unmatched`. **No auto-create path.**

**Locked behaviour for Check 6 in this build (drawing the smallest possible scope from the source spec):**

The customer-match policy gate is implemented as follows in `supportDraftPreflightPure.ts`:

```
INPUT:  ticket (with canonicalContactId and customerEmail), inbox.agent_config
OUTPUT: { ok: true } | { ok: false, reason: 'customer_match_required' }

RULE:
  If inbox.agent_config does NOT carry `optIns.requireCustomerMatch` (today's v1 — the field is reserved, not present):
    → return { ok: true }   // no-op gate, present for forward-compat
  If inbox.agent_config.optIns.requireCustomerMatch === true:
    If ticket.canonicalContactId IS NULL:
      → return { ok: false, reason: 'customer_match_required' }
    Else:
      → return { ok: true }
  Else:
    → return { ok: true }
```

The gate is a no-op in v1 because `requireCustomerMatch` is not in the `SupportInboxAgentConfig` Zod schema yet. It is implemented as a real check (not a stub) so adding the flag to the Zod schema in a future build instantly switches the gate on without code changes. **The Zod schema does NOT change in this build.**

**Why this is the right call:** the pre-test-hardening spec §4.1 is unambiguous that Check 6 must exist, but the source-of-truth spec only has the reserved flag. Adding behaviour for an unimplemented flag is forward-compatible; adding the Zod schema field is out of scope (it would force a §5.3 / §11.5 amendment to the source spec). The unit test asserts that with no `requireCustomerMatch` flag set, the gate passes; with the flag set + null `canonicalContactId`, the gate rejects. Both assertions are valuable: the second pins the future-on behaviour even though the runtime path can't reach it today.

**Source-rule freeze:** the unit tests in `supportDraftPreflightPure.test.ts` assert one row per status × action combination from the matrix above (Check 4) AND the two-state matrix for Check 6. If a future spec edit invalidates a row, the test will fail. This is the spec contract the build commits to.

### 6. `withOrgTx` primitive (spec §0.7)

**File path:** `server/instrumentation.ts:172`.

**Signature:**

```ts
export async function withOrgTx<T>(
  ctx: OrgTxContext,
  fn: () => Promise<T>,
): Promise<T>
```

`OrgTxContext` is exported from the same file and includes (at minimum) `organisationId` and `source`. Builder reads the file before authoring the wrapper invocations to confirm the exact context shape.

The advisory lock for V2 (`pg_advisory_xact_lock(hashtextextended($1::text, 0))`) MUST be the first SQL statement executed inside the `withOrgTx` block — not before it, not in a separate transaction. The same-transaction requirement is locked in spec §0.7 and §5.2. Builder uses `getOrgScopedDb('knowledgeService.overrideEntry')` inside the `withOrgTx` callback to acquire an ALS-bound client, then issues the `pg_advisory_xact_lock` statement against it, then performs the `MAX(version)` read and the insert.

### 7. Migration sequence (spec §0.7 + §0.3)

**Latest migration in the repo at plan time:** `migrations/0312_action_attempts.sql`.

**This build's migrations:**

- `0318_webhook_replay_nonces.sql` — W3 dedup table + RLS policy.
- `0319_connector_configs_webhook_token.sql` — W3 token column + partial UNIQUE index.
- `0320_connections_status_check.sql` — V1 CHECK constraint with preflight.

Each migration ships with a `.down.sql` companion. Builder verifies no other branch has claimed these numbers before merge by running `ls migrations/0318* migrations/0319* migrations/0320*` and confirming only this branch's files are present at merge time.

**Drizzle schema files updated alongside each migration (per DEVELOPMENT_GUIDELINES §6.4):**

- `0318` → new `server/db/schema/webhookReplayNonces.ts` + register in `server/db/schema/index.ts` + `RLS_PROTECTED_TABLES` entry.
- `0319` → add `webhookToken: uuid('webhook_token')` to `server/db/schema/connectorConfigs.ts`.
- `0320` → no schema-shape change; the column already exists (`connectionStatus: text('connection_status')` with the typed union). The migration is constraint-only.

---

## C1 — W1 (HMAC fail-closed) + W2 (recordIncident on 5xx)

**Goal:** webhook stack fails closed on missing secret in production AND every 5xx path on the Slack and Teamwork webhook routes funnels through `recordIncident` before responding.

**Files to touch:**

- `server/services/webhookService.ts:60–95` — `verifyCallbackToken`. The current open-mode behaviour lives at lines 70–95.
- `server/routes/webhooks/slackWebhook.ts` — every `res.status(500)` path.
- `server/routes/webhooks/teamworkWebhook.ts` — every `res.status(500)` path NOT already wrapped (line 70 already calls `recordIncident`; verify which others remain).
- `server/services/__tests__/webhookService.test.ts` (new) — W1 negative + positive tests.
- `server/routes/webhooks/__tests__/slackWebhook.test.ts` (new) — W2 negative test.
- `server/routes/webhooks/__tests__/teamworkWebhook.test.ts` (new) — W2 negative test.

**Module shape:**

- *Public interface this chunk exposes:* `verifyCallbackToken` keeps its signature; the production-fail-closed behaviour is internal. The two webhook routes keep their HTTP shape — same status codes, same response bodies.
- *What stays hidden behind it:* the NODE_ENV branch, the boot-once warn flag, the `recordIncident` plumbing.

**Approach:**

1. In `webhookService.ts.verifyCallbackToken` and any other secret-gated check in the same module: replace the open-mode return-true with a NODE_ENV branch. In `production`, throw `{ statusCode: 401, message: 'Webhook signature required', errorCode: 'webhook.signature_required' }` when the secret is unset. In `development`, preserve the existing return-true and the one-time `webhook_secret_missing` warn (rename the log key from `webhook.open_mode_active` to `webhook_secret_missing` per spec §2.1).
2. Audit `slackWebhook.ts` and `teamworkWebhook.ts` for every `res.status(500)`. For each, prepend a `recordIncident({ source: 'route', summary, fingerprintOverride, severity: 'medium', stack, errorDetail })` call. Fingerprints: `webhook:slack:handler_failed` and `webhook:teamwork:handler_failed` (literal strings — same convention as the existing `webhook:teamwork:db_lookup_failed` fingerprint at `teamworkWebhook.ts:73`).
3. Write the W1 negative test: stub `env.NODE_ENV = 'production'`, stub `env.WEBHOOK_SECRET` undefined; call `verifyCallbackToken('exec-1', 'token', undefined)`; assert it throws with `errorCode: 'webhook.signature_required'`.
4. Write the W1 positive test: prod env + valid secret + valid HMAC → returns true.
5. Write the W1 dev test: dev env + no secret → returns true; assert logger warn is called once even across multiple invocations (the boot-once flag).
6. Write the W2 tests: spy on `recordIncident`; cause the handler to throw downstream; assert `recordIncident` was called with the right fingerprint before the 500 response.

**Contracts:**

- `verifyCallbackToken(executionId: string, token?: string, engineHmacSecret?: string): boolean` — throws in production with no secret, returns boolean otherwise. Throw shape: `{ statusCode: 401, message: 'Webhook signature required', errorCode: 'webhook.signature_required' }`.

**Error handling:**

- Production + no secret → 401 with `errorCode: 'webhook.signature_required'`.
- Dev + no secret → 200, log line emitted once per process.
- Handler 5xx → `recordIncident` called, then 500 response.

**Tests to author:**

- `server/services/__tests__/webhookService.test.ts`:
  - "rejects in production when WEBHOOK_SECRET is unset" → expect throw with `errorCode: 'webhook.signature_required'`.
  - "accepts in production with valid secret + valid HMAC".
  - "accepts in development with no secret AND emits a warn log exactly once across two calls".
- `server/routes/webhooks/__tests__/slackWebhook.test.ts`:
  - "calls recordIncident with `webhook:slack:handler_failed` before 500 when handler throws".
- `server/routes/webhooks/__tests__/teamworkWebhook.test.ts`:
  - "calls recordIncident with `webhook:teamwork:handler_failed` before 500 when handler throws".

**G1 gate:**

```bash
npx vitest run server/services/__tests__/webhookService.test.ts \
              server/routes/webhooks/__tests__/slackWebhook.test.ts \
              server/routes/webhooks/__tests__/teamworkWebhook.test.ts
npx tsc --noEmit -p server/tsconfig.json
npm run lint
```

**Dependencies:** none — first chunk.

**Spec sections covered:** §2.1 (W1), §2.2 (W2). Test matrix rows: §7 row "1 W1" + "1 W2 (Slack)" + "1 W2 (Teamwork)".

**Risk notes:**

- The existing `webhookOpenModeWarned` flag is module-level mutable state. Tests that exercise the warning path must reset it between cases (use a test helper that re-imports or call a `resetForTest()` export added in the same chunk).
- `recordIncident` is async; the route must `await` it before returning the 500 (otherwise the response races the audit write). Verify each call site uses `await`.
- Logger is resolved at import time (`server/lib/logger.ts` resolves `LOG_LEVEL` to a const) — per DEVELOPMENT_GUIDELINES §7, spy on the logger object directly (`mock.method(logger, 'warn', () => {})`), not on `console.*` or `process.env`.

---

## C2 — W3 (cross-tenant attribution + persistent dedup)

**Goal:** Teamwork webhook URL carries a per-connector token; HMAC validation runs against exactly one connector config; replay protection persists across app instances and survives restarts.

**Files to touch:**

- `migrations/0318_webhook_replay_nonces.sql` (new) + `.down.sql`.
- `migrations/0319_connector_configs_webhook_token.sql` (new) + `.down.sql`.
- `server/db/schema/webhookReplayNonces.ts` (new).
- `server/db/schema/connectorConfigs.ts` — add `webhookToken: uuid('webhook_token')` column.
- `server/db/schema/index.ts` — export the new schema.
- `server/config/rlsProtectedTables.ts` — append `webhook_replay_nonces` entry (see plan-time builder contract item 2).
- `server/lib/webhookReplayNonceStore.ts` (new) — durable wrapper over the new table.
- `server/routes/webhooks/teamworkWebhook.ts:30–80` — rewrite the connector lookup + dedup blocks.
- `server/services/connectorConfigService.ts` — add `findByWebhookToken(token, 'teamwork')` method that filters on `connector_type = 'teamwork' AND status = 'active' AND webhook_token = $1` (per plan-time builder contract item 1).
- `server/jobs/webhookReplayNoncePruneJob.ts` (new) — hourly TTL prune; registered via the existing job framework.
- `server/jobs/index.ts` — register the new prune job.
- `docs/runbooks/teamwork-webhook-token-rotation.md` (new) — operator runbook for URL rotation and token regeneration (per spec §2.3 paragraph 3 "URL rotation is communicated to operators via a runbook entry").
- `server/lib/__tests__/webhookReplayNonceStore.test.ts` (new) — tests for the durable store.
- `server/routes/webhooks/__tests__/teamworkWebhook.W3.test.ts` (new) — W3 integration tests.

**Module shape:**

- *Public interface this chunk exposes:* `webhookReplayNonceStore.recordIfNew(orgId, source, nonce): Promise<{ inserted: boolean }>` — single method consumed by `teamworkWebhook.ts`. Returns `{ inserted: false }` when the row already exists (replay), `{ inserted: true }` on first observation. The Teamwork webhook URL surface changes: `POST /api/webhooks/teamwork/:orgWebhookToken`.
- *What stays hidden behind it:* the SQL `INSERT ... ON CONFLICT DO NOTHING`, the prune-job cadence, the in-memory fast-path probe (we keep `webhookDedupe.ts` as a layer-0 cache to skip a DB roundtrip on hot replays).

**Approach:**

1. Migration `0318`: `CREATE TABLE webhook_replay_nonces (organisation_id uuid NOT NULL, webhook_source text NOT NULL, nonce text NOT NULL, seen_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organisation_id, webhook_source, nonce))`. Add secondary index `(organisation_id, webhook_source, seen_at)` for the prune scan. Add canonical org-isolation RLS policy (FORCE ROW LEVEL SECURITY + CREATE POLICY using `current_setting('app.organisation_id', true)::uuid`). Down migration drops the table.
2. Migration `0319`: `ALTER TABLE connector_configs ADD COLUMN webhook_token uuid NULL`; `CREATE UNIQUE INDEX IF NOT EXISTS connector_configs_webhook_token_unique ON connector_configs (webhook_token) WHERE webhook_token IS NOT NULL`; data step `UPDATE connector_configs SET webhook_token = gen_random_uuid() WHERE connector_type = 'teamwork' AND webhook_token IS NULL`. Down migration drops the index and the column. **Per spec §2.3 `gen_random_uuid()` preflight (locked):** do NOT add `CREATE EXTENSION IF NOT EXISTS pgcrypto`. Rely on the repo convention.
3. New schema file `webhookReplayNonces.ts` with Drizzle table definition matching the migration. Add to `server/db/schema/index.ts`.
4. Add `webhookToken: uuid('webhook_token')` to the existing `connector_configs` Drizzle schema.
5. Add `webhook_replay_nonces` entry to `RLS_PROTECTED_TABLES` (exact entry shape in plan-time builder contract item 2).
6. New library `server/lib/webhookReplayNonceStore.ts`:
   ```ts
   export async function recordIfNew(orgId: string, source: string, nonce: string): Promise<{ inserted: boolean }>
   ```
   Implementation: `INSERT INTO webhook_replay_nonces (organisation_id, webhook_source, nonce) VALUES (...) ON CONFLICT (organisation_id, webhook_source, nonce) DO NOTHING RETURNING 1`. `inserted` = `result.rowCount === 1`. Opens its own `withOrgTx` internally (the org GUC is required for the RLS policy to admit the write); the dedup row commits BEFORE downstream provider-event processing begins. **Failure-semantics statement (locked):** dedup-row insertion commits independently of provider-event processing. If the route crashes between dedup commit and side-effects, the system favours **at-most-once** processing for that delivery — a subsequent retry of the same `deliveryId` will be deduped. This is acceptable per spec §2.3 "Replay correctness invariant" (the row's existence is the precondition; correctness is preserved). If a future caller needs single-transaction semantics across dedup + side-effects, add an optional `tx?: OrgScopedTx` parameter rather than restructuring the route around `recordIfNew`.
7. New service method `connectorConfigService.findByWebhookToken(token, 'teamwork')` per plan-time builder contract item 1. Returns the single matching config or `null`.
8. Rewrite `teamworkWebhook.ts:30–80`. New shape:
   - Read `:orgWebhookToken` from `req.params`.
   - Call `findByWebhookToken(orgWebhookToken, 'teamwork')`. If null → 401 `webhook.token_unknown`.
   - Validate HMAC against the single config's `webhookSecret`. If invalid → 401 `webhook.signature_invalid`.
   - Resolve `deliveryId` from the provider event (locked source per spec §2.3 paragraph 2). **Missing or empty `deliveryId` → 400 `webhook.delivery_id_required` BEFORE any further processing.** Do NOT fall back to a body hash, timestamp, or any derived digest — the locked nonce source is the provider's `deliveryId`; absence is a malformed delivery, not a pun for "unique enough".
   - Call `recordIfNew(config.organisationId, 'teamwork', deliveryId)`. If `inserted === false` → return 200 + emit structured `webhook.teamwork.replay_deduped` log event (per spec §2.3 paragraph 2 + §0.7 invariant). NO side effects.
   - Otherwise process the event normally.
9. Register the route under the new path: `POST /api/webhooks/teamwork/:orgWebhookToken`. Remove the old un-tokened route ENTIRELY (no compatibility shim — pre-launch posture).
10. New prune job `webhookReplayNoncePruneJob.ts`: hourly cron, runs `DELETE FROM webhook_replay_nonces WHERE seen_at < now() - INTERVAL '10 minutes'`. Per-org iteration NOT required (the prune is a single global query because the table is small and the RLS policy is bypassed by the admin connection — mirror the pattern in other prune jobs that use `withAdminConnection`).
11. New runbook `docs/runbooks/teamwork-webhook-token-rotation.md`: covers (a) when to rotate, (b) how to fetch the current token from the operator UI / DB, (c) how to update the Teamwork delivery URL, (d) the consequence of using the old token (404). Linked from `docs/doc-sync.md` if doc-sync gate requires.

**Contracts:**

- `webhookReplayNonceStore.recordIfNew(orgId: string, source: string, nonce: string): Promise<{ inserted: boolean }>`.
- `connectorConfigService.findByWebhookToken(token: string, connectorType: 'teamwork'): Promise<ConnectorConfig | null>`.
- HTTP error codes from the new Teamwork route: `webhook.token_unknown` (401), `webhook.signature_invalid` (401), `webhook.delivery_id_required` (400), `webhook.teamwork.replay_deduped` (200 + log event).
- Migration 0318 RLS policy name: `webhook_replay_nonces_org_isolation` (matches the canonical 0079/0200 naming pattern).

**Error handling:**

- Token unknown / config missing → 401 `webhook.token_unknown`.
- HMAC invalid → 401 `webhook.signature_invalid`.
- Missing or empty `deliveryId` → 400 `webhook.delivery_id_required` (no fallback to body hash / timestamp).
- Replay (nonce already exists) → 200 + structured log event `webhook.teamwork.replay_deduped` (no side effects).
- Distinct delivery → 200, processed normally.
- DB unreachable → 500 + `recordIncident({ fingerprintOverride: 'webhook:teamwork:dedup_db_unreachable' })`.

**Tests to author:**

- `server/lib/__tests__/webhookReplayNonceStore.test.ts`:
  - "first call returns `{ inserted: true }`".
  - "second call with the same (org, source, nonce) returns `{ inserted: false }`".
  - "two distinct nonces under the same (org, source) both insert".
  - "two distinct orgs with the same nonce both insert (no cross-tenant collision)".
- `server/routes/webhooks/__tests__/teamworkWebhook.W3.test.ts`:
  - "POST /api/webhooks/teamwork (no `:orgWebhookToken`) returns 404 AND performs zero side effects — no connector lookup, no nonce insert, no provider-event processing. The legacy un-tokened route is unmounted; no compatibility shim per pre-launch posture.".
  - "valid token + valid HMAC + payload missing `deliveryId` → 400 webhook.delivery_id_required; no nonce row inserted; no downstream processing".
  - "valid token + valid HMAC + payload with empty-string `deliveryId` → 400 webhook.delivery_id_required (same path as missing)".
  - "URL token does not match any active connector_config row → 401 webhook.token_unknown".
  - "URL token belongs to org A but signature is signed with org B's secret → 401 webhook.signature_invalid (this is the cross-tenant attribution test from spec §2.3 acceptance row 1)".
  - "valid token + valid signature + new deliveryId returns 200 and processes the event".
  - "same deliveryId replayed within 10 minutes returns 200 with no side effects and emits replay_deduped".
  - "same deliveryId replayed across two simulated app instances (same store, separate handler invocations) is still deduped (DB-backed proof)".
  - "nonce row still present past the 10-minute mark because prune was paused → duplicate delivery still deduped (the row's existence, not the wall clock, is the precondition per spec §0.7 + §2.3)".
  - "two distinct deliveryIds within the same window both process".

**G1 gate:**

```bash
npx vitest run server/lib/__tests__/webhookReplayNonceStore.test.ts \
              server/routes/webhooks/__tests__/teamworkWebhook.W3.test.ts
npx tsc --noEmit -p server/tsconfig.json
npm run lint
```

**Dependencies:** C1 (so `recordIncident` is consistently used on the failure paths added in this chunk).

**Spec sections covered:** §0.7 invariants A + B + C, §2.3 W3 (all subsections). Test matrix rows: §7 rows W3 ×4.

**Risk notes:**

- The new URL shape (`:orgWebhookToken`) means existing Teamwork webhook subscribers will 404 until the operator rotates their delivery URL. The runbook is the operator-facing artefact; the pre-launch posture (zero or near-zero prod connectors) means cost is negligible.
- `gen_random_uuid()` is invoked unconditionally in the data step — if any environment lacks `pgcrypto` registration, the migration will fail. Per the locked preflight in spec §2.3, this is the repo convention; do not add `CREATE EXTENSION` here.
- The prune job MUST NOT block correctness — the test for "nonce row present past 10 minutes still deduped" pins this. If prune fails, dedup coverage extends; if prune succeeds past the window, a same-deliveryId duplicate is processed as fresh. This is acceptable per spec §2.3 "Replay correctness invariant (locked)".
- The in-memory `webhookDedupeStore` is NOT removed in this chunk. It can serve as a layer-0 fast path (skip the DB roundtrip on hot replays); leave it as-is. Removal is a future cleanup.
- `connectorConfigService.findByWebhookToken` MUST never expose connector configs whose `webhook_token` is NULL — the partial UNIQUE index enforces uniqueness only for non-null tokens, but the lookup query must always include `webhook_token = $1` (never `IS NULL`).

---

## C3 — T1 (support read-path subaccount scoping)

**Goal:** every support read endpoint runs under `/api/subaccounts/:subaccountId/support/...`, every service-layer query carries a non-null subaccount filter, every frontend page calls the new URLs, the legacy unscoped paths are unmounted.

**Files to touch:**

Server:
- `server/index.ts:473` — change the mount.
- `server/routes/support/index.ts` — wrap each sub-router in `Router({ mergeParams: true })` if not already.
- `server/routes/support/supportTicketsRoutes.ts` — declare `Router({ mergeParams: true })`, add `resolveSubaccount` calls, set `principal.subaccountId = subaccount.id`.
- `server/routes/support/supportDraftsRoutes.ts` — same.
- `server/routes/support/supportInboxesRoutes.ts` — same.
- `server/services/supportTicketService.ts:257, 338` — accept and apply subaccount filter.
- `server/services/supportDraftDispatchService.ts:547, 573` — same.
- `server/services/supportInboxService.ts:62, 140` — same; for `updateAgentConfig`, add the inbox-belongs-to-subaccount precondition.

Client (full list in plan-time builder contract item 3):
- `client/src/pages/integrations/SupportDeskSetupPage.tsx`.
- `client/src/pages/support/DraftReviewQueue.tsx`.
- `client/src/pages/support/InboxConfigPage.tsx`.
- `client/src/pages/support/TicketDetailPage.tsx`.
- `client/src/pages/support/TicketsListPage.tsx`.

Tests:
- `server/routes/support/__tests__/supportRouteScoping.test.ts` (new) — integration tests for the subaccount-scoped behaviour.
- `server/services/__tests__/supportTicketService.scoping.test.ts` (new) — service-layer tests asserting two seeded subaccounts cannot read each other's data.

**Module shape:**

- *Public interface this chunk exposes:* the five HTTP endpoints under the new prefix (`GET /api/subaccounts/:subaccountId/support/{tickets,tickets/:id,drafts,drafts/:id,inboxes}`) and the existing service signatures with the change that `subaccountId` in `PrincipalContext` is now non-null at every call site.
- *What stays hidden behind it:* the route mount mechanics, the `mergeParams` plumbing, the per-service subaccount-filter SQL.

**Approach:**

1. Change `server/index.ts:473` from `app.use('/api/support', supportRouter);` to `app.use('/api/subaccounts/:subaccountId/support', supportRouter);`.
2. In `server/routes/support/index.ts`, wrap the router declaration: `const router = Router({ mergeParams: true });`. Ensure each `supportTicketsRoutes`, `supportDraftsRoutes`, `supportInboxesRoutes` sub-router also uses `{ mergeParams: true }`.
3. In each sub-router file, replace the `subaccountId: null` literal in `makePrincipal` (or the inline `PrincipalContext` literal) with `subaccountId: subaccount.id`, where `subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!)` is the first line of each handler.
4. Update each service:
   - `supportTicketService.listOpenTickets`: add `eq(canonicalTickets.subaccountId, principal.subaccountId)` to the WHERE.
   - `supportTicketService.readThreadForHumanUi`: same — and assert the resolved ticket's `subaccountId` matches `principal.subaccountId`; reject 403 otherwise.
   - `supportDraftDispatchService.listDraftsForReview`: same — add the subaccount filter via the parent `canonical_tickets` join (drafts inherit subaccount from their ticket).
   - `supportDraftDispatchService.getDraftById`: same.
   - `supportInboxService.listInboxes`: add `eq(canonicalInboxes.subaccountId, principal.subaccountId)`.
   - `supportInboxService.updateAgentConfig`: load the inbox row first, assert `inbox.subaccountId === principal.subaccountId`, reject 403 `support.inbox.scope_mismatch` otherwise; then update.
5. Update each client call site to interpolate the subaccount id from the existing subaccount-routing context. The client pages are already mounted under a subaccount-scoped route shell (verify by reading the `App.tsx` route table); they read the subaccount from a context provider or a `useParams` hook. Use whichever is established for the codebase — do not introduce a new context.
6. Remove the legacy unscoped mount entirely. There is no compatibility shim per DEC-1 + spec §3.1 "(no compatibility shim per DEC-1)".
7. Run the grep contract from plan-time builder contract item 3. Paste the (expected empty) results into `progress.md`.

**Contracts:**

- All service signatures are unchanged at the type level; `subaccountId` was already a field on `PrincipalContext`. The change is *runtime* — every call site now passes a non-null value.
- HTTP error codes added by this chunk: 404 (legacy path unmounted), 403 (cross-org subaccount via `resolveSubaccount`), 403 `support.inbox.scope_mismatch` (the new updateAgentConfig precondition).

**Error handling:**

- Legacy path → 404 (Express's default not-found, no compatibility shim).
- Cross-org subaccountId in path → 403 from `resolveSubaccount`.
- Cross-subaccount inbox id in `PATCH /api/subaccounts/:subaccountId/support/inboxes/:id` → 403 `support.inbox.scope_mismatch`.

**Tests to author:**

- `server/routes/support/__tests__/supportRouteScoping.test.ts`:
  - "GET /api/support/tickets returns 404 (legacy mount removed)".
  - "GET /api/support/drafts returns 404".
  - "GET /api/support/inboxes returns 404".
  - "GET /api/subaccounts/:subaccountId/support/tickets with another org's subaccountId returns 403".
  - "PATCH /api/subaccounts/:subaccountId/support/inboxes/:id where the inbox belongs to a sibling subaccount returns 403 support.inbox.scope_mismatch".
- `server/services/__tests__/supportTicketService.scoping.test.ts`:
  - "Seed subaccount A with two tickets, subaccount B with two tickets; listOpenTickets called for A returns only A's tickets".
  - "readThreadForHumanUi called for B's ticket from an A principal returns 403".

**G1 gate:**

```bash
npx vitest run server/routes/support/__tests__/supportRouteScoping.test.ts \
              server/services/__tests__/supportTicketService.scoping.test.ts
npx tsc --noEmit -p server/tsconfig.json
npm run lint
```

`npm run build:client` is intentionally NOT in C3's G1 — it runs at G2 against the integrated branch (per executor-notes carve-out). The G2 `build:client` confirms the client pages still typecheck post-URL rewrite.

**Dependencies:** none on prior chunks; can ship after C1 or in parallel.

**Spec sections covered:** §0.7 invariant D, §3.1 T1. Test matrix rows: §7 rows T1 ×3.

**Risk notes:**

- `Router({ mergeParams: true })` is required at every nesting level for `:subaccountId` to surface in the leaf handler. Builder verifies by adding a console.log or test assertion that `req.params.subaccountId` is non-undefined inside one of the handlers.
- Some support pages may not currently have a subaccount in scope (e.g. an org-level dashboard). Verify each of the 11 client call sites is reachable from a route that already carries `:subaccountId`; if not, the page must be moved under the subaccount-routing tree (which is a pre-existing pattern the codebase already enforces for other subaccount-scoped pages).
- The grep gate is the merge-time contract. Builder runs it before requesting review.

---

## C4 — T2 (reference-document promote: cross-org scope-ID rejection)

**Goal:** body-supplied scope IDs (`agentId`, `subaccountId`, `scheduledTaskId`, `taskInstanceId`) on `POST /api/reference-documents/promote` and `POST /api/reference-documents/:id/links` are verified against `req.orgId!` before any insert; mismatches abort the entire operation atomically with a 403 + audit row.

**Files to touch:**

- `server/routes/referenceDocuments.ts:213` (promote — calls `documentPromotionService.promoteFile`).
- `server/routes/referenceDocuments.ts:429` (links — calls `documentDataSourceService.linkDocumentToScope`).
- `server/services/documentPromotionService.ts` — call the new verification helper before the promote logic.
- `server/services/documentDataSourceService.ts` — call the new verification helper before the link logic; this file owns the new `verifyScopeIdsBelongToOrg` helper.
- `server/services/__tests__/referenceDocumentScopeVerification.test.ts` (new).

**Module shape:**

- *Public interface this chunk exposes:* `verifyScopeIdsBelongToOrg(orgId: string, ids: { agentId?: string; subaccountId?: string; scheduledTaskId?: string; taskInstanceId?: string }): Promise<{ ok: true } | { ok: false; failedKind: 'agent' | 'subaccount' | 'scheduledTask' | 'taskInstance'; failedId: string }>`. The two service paths consume this and surface 403 on `{ ok: false }`.
- *What stays hidden behind it:* the four batched verification queries, the audit-row insertion, the early-abort logic.

**Approach:**

1. Add `verifyScopeIdsBelongToOrg` as a private function in `documentDataSourceService.ts` (or a sibling lib). For each non-null scope id, run a SELECT against the corresponding parent table filtered by `id = :id AND organisation_id = :orgId`. Use four batched queries (one per kind) — not joined, because the supplied set may include zero, one, or many of the four kinds.
2. Modify the promote service to call `verifyScopeIdsBelongToOrg` BEFORE any DB write happens. On `{ ok: false }`, throw `{ statusCode: 403, message: 'Cross-org scope ID rejected', errorCode: 'referenceDocument.scope_cross_org' }`.
3. Modify the link service the same way.
4. On the 403 path, write an `auditEvents` row recording (per spec §3.2 atomicity-locked):
   - `organisationId: req.orgId!`
   - `actionType: 'referenceDocument.scope_cross_org_rejected'`
   - `metadata: { scopeKind: failedKind, scopeId: failedId }` — exactly the opaque ID the requester submitted, no joined fields, no name, no row hash, no owning-org id, nothing else.
5. Atomicity (spec §3.2 locked): collect all supplied scope IDs by kind first; run the verifications; only if ALL pass, run the inserts in a single transaction. If any fail, return 403 before the insert phase begins. NO partial rows are written.

**Contracts:**

- 403 error code: `referenceDocument.scope_cross_org`.
- Audit row `actionType: 'referenceDocument.scope_cross_org_rejected'` with metadata exactly `{ scopeKind, scopeId }`.

**Error handling:**

- Any cross-org scope ID → 403 + audit row + zero inserts.
- All scope IDs valid → 201 / normal success path.

**Tests to author:**

- `server/services/__tests__/referenceDocumentScopeVerification.test.ts`:
  - "agentId belonging to org B rejected when org A promotes" → 403 `referenceDocument.scope_cross_org`; assert no insert into `referenceDocumentDataSources`; assert audit row written with `metadata.scopeKind = 'agent'` and `metadata.scopeId = <the submitted id>` and NO other keys leaked.
  - "subaccountId belonging to org B rejected" → same.
  - "scheduledTaskId belonging to org B rejected" → same.
  - "taskInstanceId belonging to org B rejected" → same.
  - "all four supplied with same-org IDs → 201 / success".
  - "two scope IDs supplied where one belongs to org B → 403, ZERO inserts (atomicity test)".
  - "audit row metadata contains ONLY { scopeKind, scopeId } — no name, no human-readable label, no owning-org id" (assert `Object.keys(metadata).sort()` equals `['scopeId', 'scopeKind']`).

**G1 gate:**

```bash
npx vitest run server/services/__tests__/referenceDocumentScopeVerification.test.ts
npx tsc --noEmit -p server/tsconfig.json
npm run lint
```

**Dependencies:** none.

**Spec sections covered:** §3.2 T2. Test matrix rows: §7 rows T2 ×2 (covers per-scope-kind variants in one test file).

**Risk notes:**

- The audit-row content is locked: no joined fields, no human-readable name, no owning-org id. The test must explicitly assert the metadata's exact key set so a later contributor can't add a "helpful" `metadata.targetEntityName` field.
- The four scope kinds map to four different parent tables; each verification query must read the table the kind names. Builder MUST NOT assume `subaccounts.organisation_id`, `agents.organisation_id`, `scheduled_tasks.organisation_id`, `tasks.organisation_id` all exist — verify each schema first (they do, but verify).
- Atomicity is structural: do all four verifications first, then enter the single-transaction insert phase. Do NOT interleave verify-then-insert per kind.

---

## C5 — T3 (`taskService.createTask` write-path scoping)

**Goal:** `taskService.createTask` requires a caller-supplied `OrgScopedTx` at the TypeScript type level (DEC-4 LOCKED); every in-scope caller opens `withOrgTx` and threads the tx through `getOrgScopedDb`; FORCE-RLS rejects any call whose tx lacks the org GUC; 15 in-scope direct call sites migrated (Bucket 1) + 1 indirect wrap edit at `routes/subaccountOnboarding.ts:53` + 1 TODO comment at the GHL job + 2 sister-branch sites preserved via a transitional 4-arg overload that throws at runtime. Bucket counts in plan-time builder contract item 4.

**Files to touch:**

- `server/services/taskService.ts:130–225` — replace the function with the canonical `(input, tx)` overload + the transitional 4-arg overload (full shape in plan-time builder contract item 4 → "Implementation shape"). Switch the three bare `db` references at lines 160, 168, 195 to use the supplied `tx`. Audit helpers `_validateStatus` / `_nextPosition` for bare `db` usage and switch them to accept and use the supplied `tx` too.
- All in-scope caller sites (full list in plan-time builder contract item 4): wrap each `taskService.createTask(...)` per the **Caller pattern** in plan-time builder contract item 4. Concretely: `await withOrgTx({ organisationId, source }, async () => { const tx = getOrgScopedDb(source); return taskService.createTask(input, tx); })` at the appropriate boundary. The `organisationId` value is whatever each caller already has in scope (`req.orgId!` for routes; the various `*.organisationId` properties for services). Builder MUST NOT write `async (tx) => …` — `withOrgTx`'s callback takes no args; the tx is retrieved via `getOrgScopedDb`.
- `server/services/__tests__/taskService.createTask.regression.test.ts` (new) — the strict-contract regression test from spec §3.3 acceptance.
- TODO comment at the GHL caller (`server/jobs/ghlAutoStartOnboardingJob.ts` near line 60 where `subaccountOnboardingService.autoStartOwedOnboardingWorkflows` is invoked): `// TODO(post-T3, spec §10): wrap in withOrgTx — explicitly deferred per spec §0.4 + §10. Depends on the GHL unauthenticated path landing first.`

**Module shape:**

- *Public interface this chunk exposes:* `taskService.createTask(input: CreateTaskInput, tx: OrgScopedTx): Promise<Task>` — canonical, type-level enforced. A second overload `createTask(orgId, subaccountId, data, userId?): Promise<Task>` exists transitionally for the 2 sister-branch callers; it throws at runtime and is `@deprecated`.
- *What stays hidden behind it:* the in-scope caller `withOrgTx` wrapping plumbing, the `taskActivities` insert (now uses the supplied `tx`), the runtime trap on the 4-arg path.

**Approach:**

1. In `taskService.ts`, define both overloads + the implementation per plan-time builder contract item 4 → "Implementation shape". Locate `OrgScopedTx` (or the established equivalent) in the codebase before introducing — search for it, do not invent. If no shared type alias exists, introduce it in `server/lib/orgScopedDb.ts` with a one-line comment naming this build as the introducer.
2. Replace the three bare `db` usages inside `createTask` (the agent-existence select at :160, the `tasks` insert at :168, the `taskActivities` insert at :195) with the supplied `tx`. Audit `_validateStatus` and `_nextPosition` and propagate the `tx` parameter.
3. Audit all in-scope callers (per plan-time builder contract item 4 table). For each, open `withOrgTx({ organisationId, source }, async () => { const tx = getOrgScopedDb(source); … createTask(input, tx) … })` (no `tx` arg in the callback signature). For routes, the wrapper covers the createTask call AND any other inserts the route performs in the same logical operation — never two separate `withOrgTx` blocks for one logical write.
4. For `subaccountOnboardingService.startOwedOnboardingWorkflow` at line 230: the function ALREADY uses `getOrgScopedDb` at line 217 (so it's intended to run inside `withOrgTx`). The non-GHL caller (`server/routes/subaccountOnboarding.ts:53`) must open `withOrgTx` and pass `tx` into the service if the service signature is updated alongside (audit this — if `startOwedOnboardingWorkflow`'s shape changes, the caller threads `tx`; if it stays the same, the caller still wraps with `withOrgTx` so `getOrgScopedDb` finds the ALS context). The GHL caller (`server/jobs/ghlAutoStartOnboardingJob.ts`) is deferred per spec §10 — add the TODO comment, do not modify.
5. Write the regression test (spec §3.3 strict-contract): construct an `OrgScopedTx`-typed value that does NOT have the org GUC set (e.g. a raw drizzle tx outside `withOrgTx`, or a stubbed shape that satisfies the type but not the runtime invariant) and pass it to `createTask`. Expect FORCE-RLS to reject the write — assert the row count for the target org is unchanged after the call.
6. Run the G2 grep gate from plan-time builder contract item 4 → "Grep gate" and paste the output (expected: exactly the two known `workflowEngineService.ts` lines) into `progress.md`.
7. Append the caller-audit checklist to `progress.md` per spec §3.3 acceptance — one row per caller in the table from plan-time builder contract item 4, with each in-scope row marked DONE as it lands.

**Contracts:**

- `taskService.createTask(input, tx)` is the canonical, TypeScript-enforced shape. Removing `tx` from any in-scope call site is a type error (DEC-4 / §3.3 acceptance #1).
- The 4-arg overload is `@deprecated`, throws at runtime, and is grep-gated to be unreachable from any code outside the 2 known sister-branch sites.
- A `tx` whose ALS context lacks the org GUC fails to write under FORCE-RLS (regression test pins this).

**Error handling:**

- 4-arg legacy shape called from any code → throws `Error('taskService.createTask called via legacy 4-arg shape — …')` (runtime-unreachable from in-scope callers; sister-branch escape hatch only).
- `tx` lacking org GUC → no row inserted (FORCE-RLS rejection); row-count assertion in the regression test holds.

**Tests to author:**

- `server/services/__tests__/taskService.createTask.regression.test.ts`:
  - "createTask invoked with a `tx` whose ALS context has no org GUC fails to write under FORCE-RLS AND row count for the target org is unchanged".
  - "createTask invoked inside `withOrgTx` writes successfully and emits the expected `task_created` row".
  - "createTask invoked inside `withOrgTx` with a different organisationId than the GUC fails (FORCE-RLS rejects the cross-tenant write)".
  - "4-arg legacy overload throws synchronously and writes zero rows" (regression-pin so a future contributor can't accidentally re-route it).

**G1 gate:**

```bash
npx vitest run server/services/__tests__/taskService.createTask.regression.test.ts
npx tsc --noEmit -p server/tsconfig.json
npm run lint
```

**G2 gate addition (recorded here so it's not forgotten):** the 4-arg-shape grep from plan-time builder contract item 4. Output recorded in `progress.md`.

**Dependencies:** none on prior chunks. Largest chunk in the build — runs solo per spec §8 recommendation.

**Spec sections covered:** §0.4 DEC-4, §0.7 invariant F, §3.3 T3, §9 acceptance #2 (clean typecheck), §10 (the GHL deferral). Test matrix rows: §7 rows T3 ×2.

**Risk notes:**

- 15 in-scope direct call sites means 15 type-level signature migrations plus 14 `withOrgTx` wrap edits at the route/service boundary (row 13's wrap edit lives at its caller `routes/subaccountOnboarding.ts:53`, so the wrap-edit count is 14, not 15). The test alone cannot prove every caller is wrapped — the builder must do an exhaustive walk per the Bucket-1 table in plan-time builder contract item 4. Mark each entry as DONE in `progress.md` as it's modified.
- The two sister-branch callers (`workflowEngineService.ts:2716` and `:2962`) MUST NOT be touched. The scope-out grep gate at G2 enforces non-touch; the 4-arg overload preserves typecheck; the runtime trap ensures any execution surfaces fast. Sister branch removes the overload + migrates its callers when it lands; the integration branch reconciles the diff.
- The transitional 4-arg overload is a temporary shim. Builder MUST NOT extend it (no quiet "legacy mode" expansion, no compatibility flag, no fallback to the in-memory db). Its only job is to make typecheck pass on this branch while the 2 sister-branch callers remain untouched.
- The regression test must construct a `tx` that satisfies the `OrgScopedTx` type but lacks the org GUC. Builder confirms the existing FORCE-RLS posture rejects such a write before declaring the test green; if FORCE-RLS is somehow off in the test environment, fix the test environment, do not weaken the assertion.
- Spec §3.3 paragraph "Estimated reach: 12–25 caller sites" — confirmed at plan time as 17 direct call sites / 15 in-scope / 2 sister-branch overload-only + 1 deferred GHL TODO path. Recorded here so the builder doesn't re-search.
- The GHL TODO comment is deliberate — do NOT silently wrap the GHL caller. Spec §10 marks this as out of scope; it gets its own decision later.

---

## C6 — S1 (preflight checks 4–7) + S2 (agent-run principal cannot set `overrideCollision`)

**Goal:** `approveDraft` runs all seven preflight checks (the four missing ones added in this chunk); `overrideCollision: true` from an agent-run principal is rejected with 403 before any check fires.

**Files to touch:**

- `server/services/support/supportDraftPreflightPure.ts` (or wherever the existing pure module lives — locate via grep before editing). Add four pure-function checks: `checkTicketStatusEligibility`, `checkCollisionWindow`, `checkCustomerMatchPolicy`, `checkSupersession`.
- `server/services/supportDraftDispatchService.ts approveDraft` — wire the four new checks in order after checks 1–3; add the S2 principal-type guard at function entry.
- `server/services/support/__tests__/supportDraftPreflightPure.test.ts` (new) — per-check tests asserting the snapshotted matrices in plan-time builder contract item 5.
- `server/services/__tests__/supportDraftDispatchService.approveDraft.test.ts` (new) — integration tests for the seven-check sequence + S2.

**Module shape:**

- *Public interface this chunk exposes:* the four new pure check functions (added to the existing pure module), each returning `{ ok: true } | { ok: false; reason: string }`. `approveDraft` keeps its existing signature.
- *What stays hidden behind it:* the per-check decision logic, the snapshotted source-rule matrices, the audit-row writes for the override path.

**Approach (S2 first — it's the gate):**

1. **S2 guard.** At the top of `approveDraft`, immediately after argument unpacking, if `args.overrideCollision === true` AND principal does not have a non-null human `userId`, throw `{ statusCode: 403, errorCode: 'support.draft.override_collision_human_only', message: 'overrideCollision requires a human principal' }`. This precedes ALL other checks and ALL DB reads — including any `auditEvents` write (the S2 failure path produces NO audit row beyond whatever the centralised error-path logger already emits; there is no service-level audit insert on the agent-principal-rejected path). The "ZERO DB writes" assertion in the test enforces this ordering.
2. After the S2 guard passes (i.e. `overrideCollision !== true` OR principal IS human), re-assert `assertScope(principal, 'support.draft.override_collision')` defensively at the service layer (spec §4.1 paragraph 6: "the route-layer `assertScope` is re-asserted defensively at the service layer"). This re-assertion happens AFTER the S2 type-of-principal check so the test for "ZERO DB writes on agent + override" does not depend on `assertScope`'s side-effect behaviour. If `assertScope` fails on the human + override path, that surfaces as the existing scope-failure error path (which may write its own audit row via the central error path — that is fine and outside this build's scope).
3. On the human + override + all-other-checks-pass path, the dedicated `auditEvents` row recording the collision-override decision (per spec §4.1) is written inside `approveDraft` after the seven-check sequence completes successfully.

4. **S1 Check 4 — Ticket-status eligibility.** New pure function `checkTicketStatusEligibility(ticket, action, agentConfig): Result`. Implementation is a switch over `ticket.status × action`. Allowed combinations are exactly the cells marked "yes" or "conditional" in the snapshotted matrix in plan-time builder contract item 5. Conditional cells are gated on the corresponding `agent_config.optIns` flag. Reject reason: `'ticket_status_ineligible'`.

5. **S1 Check 5 — Collision-window.** New pure function `checkCollisionWindow({ ticket, agentConfig, now, overrideCollision, principalKind, assigneeIsHuman }): Result`. Algorithm:
   ```
   if overrideCollision === true AND principalKind === 'human': return ok (skip)
   if respectHumanAssignee AND assigneeIsHuman: return reject
   if (now - ticket.lastHumanActivityAt) < agentConfig.collisionWindow.minMinutesSinceHumanActivity: return reject
   return ok
   ```
   Reject reason: `'human_collision_blocked'`. The `assigneeIsHuman` lookup runs OUTSIDE the pure function (it requires a DB read on `canonical_support_agents`); the pure function takes the resolved boolean as input.

6. **S1 Check 6 — Customer-match policy gate.** New pure function `checkCustomerMatchPolicy({ ticket, agentConfig }): Result` per the locked behaviour in plan-time builder contract item 5. Reject reason: `'customer_match_required'`.

7. **S1 Check 7 — Supersession.** New pure function `checkSupersession({ candidateDraft, hasNewerDraft }): Result`. The `hasNewerDraft` boolean is computed by an OUTSIDE-pure DB query per spec §4.1 paragraph 7 — exact query: `EXISTS (SELECT 1 FROM canonical_ticket_drafts WHERE ticket_id = $1 AND (created_at, id) > ($2, $3) AND organisation_id = current_setting('app.organisation_id', true)::uuid)` where `$2, $3` are the candidate draft's own `created_at` and `id`. Reject reason: `'superseded_by_newer_draft'`.

8. **Wiring.** In `approveDraft`, run checks 1–3 (existing) THEN 4, 5, 6, 7 in that order. The first reject returns the typed reason without entering Phase 2.

9. **`overrideCollision=true` + human path.** Per spec §4.1: when both hold, check 5 is skipped, an `auditEvents` row is written (action `support.draft.collision_override`), and the rest proceed.

**Contracts:**

- New pure functions, signatures locked here:
  - `checkTicketStatusEligibility(ticket, action, agentConfig): { ok: true } | { ok: false; reason: 'ticket_status_ineligible' }`
  - `checkCollisionWindow(input): { ok: true } | { ok: false; reason: 'human_collision_blocked' }`
  - `checkCustomerMatchPolicy(input): { ok: true } | { ok: false; reason: 'customer_match_required' }`
  - `checkSupersession(input): { ok: true } | { ok: false; reason: 'superseded_by_newer_draft' }`
- Error codes (HTTP 403 unless noted):
  - `support.draft.override_collision_human_only` (S2).
  - `support.draft.preflight.ticket_status_ineligible`.
  - `support.draft.preflight.human_collision_blocked`.
  - `support.draft.preflight.customer_match_required`.
  - `support.draft.preflight.superseded_by_newer_draft`.

**Error handling:**

- S2 fires before any DB read; agent principal + override → 403.
- Each S1 check returns its typed reason; first failing check short-circuits.

**Tests to author:**

- `server/services/support/__tests__/supportDraftPreflightPure.test.ts`:
  - **Check 4 — every row in the snapshotted status×action matrix** (plan-time builder contract item 5):
    - "open + propose_reply → ok"
    - "open + add_internal_note → ok"
    - "open + set_status → ok"
    - "pending_internal + propose_reply → reject ticket_status_ineligible"
    - "pending_internal + add_internal_note → ok"
    - "pending_internal + set_status → ok"
    - "waiting_on_customer + propose_reply with optIns.autonomousReplyOnWaitingOnCustomer=false → reject"
    - "waiting_on_customer + propose_reply with optIns.autonomousReplyOnWaitingOnCustomer=true → ok"
    - "resolved + propose_reply with optIns.postResolutionFollowUp=false → reject"
    - "resolved + propose_reply with optIns.postResolutionFollowUp=true → ok"
    - "closed + every action → reject"
    - "unknown_provider_status + every action → reject"
  - **Check 5:**
    - "now - lastHumanActivityAt below threshold → reject human_collision_blocked"
    - "now - lastHumanActivityAt above threshold → ok"
    - "respectHumanAssignee=true AND human assignee → reject"
    - "respectHumanAssignee=false AND human assignee AND lastHumanActivityAt OUTSIDE the collision window → ok (delta wins)"
    - "respectHumanAssignee=false AND human assignee AND lastHumanActivityAt INSIDE the collision window → reject human_collision_blocked (activity check still applies)"
    - "overrideCollision=true AND principalKind='human' → ok (skipped — neither assignee nor activity-window check fires)"
  - **Check 6 (customer-match policy):**
    - "agentConfig has no requireCustomerMatch flag → ok (forward-compat no-op)"
    - "requireCustomerMatch=true AND ticket.canonicalContactId IS NULL → reject customer_match_required"
    - "requireCustomerMatch=true AND ticket.canonicalContactId is set → ok"
    - "requireCustomerMatch=false → ok"
  - **Check 7 (supersession):**
    - "hasNewerDraft=false → ok"
    - "hasNewerDraft=true → reject superseded_by_newer_draft"
- `server/services/__tests__/supportDraftDispatchService.approveDraft.test.ts`:
  - "S2: agent-run principal + overrideCollision=true → 403 support.draft.override_collision_human_only; ZERO DB writes (assert no audit row, no draft transition)".
  - "S2: human principal + overrideCollision=true + every other check passes → success; check 5 skipped; auditEvents row written for collision override".
  - "S1 wiring: check 4 fails first → returns ticket_status_ineligible without checking 5/6/7".
  - "S1 wiring: clean draft passes all seven checks → enters Phase 2 (assert phase 2 invocation)".
  - "Supersession: seed two drafts with the SAME `created_at` (same DB tick) and different ids; assert the larger-id draft wins per the `(created_at, id) > ($2, $3)` tuple comparison".

**G1 gate:**

```bash
npx vitest run server/services/support/__tests__/supportDraftPreflightPure.test.ts \
              server/services/__tests__/supportDraftDispatchService.approveDraft.test.ts
npx tsc --noEmit -p server/tsconfig.json
npm run lint
```

**Dependencies:** none on prior chunks. Can ship after C3 if scheduling permits, but technically parallel.

**Spec sections covered:** §4.1 S1, §4.2 S2. Test matrix rows: §7 rows S1 ×4 + S1 override + S2 ×2.

**Risk notes:**

- The Check 6 implementation is forward-compat-only (per plan-time builder contract item 5); the unit test asserts the future-on path even though no runtime path can reach it. This is the spec contract — do not skip the future-on test row.
- The supersession SQL must use the tuple-comparison shape `(created_at, id) > ($2, $3)` per spec §4.1. A `>` on `created_at` alone admits same-millisecond ambiguity. The integration test pins this.
- Defensive `assertScope` re-assertion at the service layer (spec §4.1 paragraph 6) exists for the case where a future caller bypasses the route guard. Test it explicitly.
- The S2 guard MUST run before any DB read; the test "ZERO DB writes" asserts no `auditEvents` row, no draft state change. If the audit-row write happens before the guard, the test fails — that is the desired catch.

---

## C7 — V1 (PATCH /api/connections enum validation + migration 0320)

**Goal:** route-layer Zod rejects unknown `connectionStatus`; DB-layer CHECK constraint catches any code path that bypasses the route; migration aborts on existing invalid data.

**Files to touch:**

- `server/routes/integrationConnections.ts:123` — wrap `connectionStatus` in a Zod enum.
- `migrations/0320_connections_status_check.sql` (new) + `.down.sql`.
- `server/routes/__tests__/integrationConnectionsValidation.test.ts` (new).

**Module shape:**

- *Public interface this chunk exposes:* the PATCH route's behaviour at the boundary.
- *What stays hidden behind it:* the Zod schema, the migration's preflight + abort logic.

**Approach:**

1. Define a Zod schema for the PATCH body. Add `connectionStatus: z.enum(['active','revoked','error']).optional()`. Reject failures with 400 `connection.status_invalid`. Note: the existing schema/route uses the `'key' in req.body` pattern for explicit `null` writes — verify whether `null` is a legitimate value for `connectionStatus`. The Drizzle schema declares the column as `.notNull()`, so `null` should NOT be accepted; the Zod schema uses `.optional()` (omit-only), not `.nullable()`.
2. Migration `0320_connections_status_check.sql`:
   ```sql
   -- Preflight: abort if any row carries an out-of-enum value.
   DO $$
   DECLARE
     bad_count integer;
     sample text[];
   BEGIN
     SELECT count(*), array_agg(DISTINCT connection_status)
       INTO bad_count, sample
       FROM integration_connections
      WHERE connection_status NOT IN ('active','revoked','error');
     IF bad_count > 0 THEN
       RAISE EXCEPTION '0320 preflight failed: % rows have invalid connection_status. Sample: %. Aborting; clean up before re-running.', bad_count, sample;
     END IF;
   END;
   $$;

   DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'integration_connections_connection_status_check'
     ) THEN
       ALTER TABLE integration_connections
         ADD CONSTRAINT integration_connections_connection_status_check
         CHECK (connection_status IN ('active','revoked','error'));
     END IF;
   END $$;
   ```
   **Idempotency pattern (locked):** the `DO $$ … IF NOT EXISTS … END $$;` block above is the canonical shape because `ALTER TABLE … ADD CONSTRAINT IF NOT EXISTS` is not portable across Postgres versions in this repo's target range. Builder MUST use the `DO $$` form even if running on Postgres 16+; this avoids version-dependent syntax variance and matches the established pattern in this repo (verified at plan time against `migrations/0285_subaccounts_external_id_namespace.sql:30` which uses `END $$;` on a single line, and `migrations/0302_memory_blocks_operator_correction.sql:17` which uses `END$$;`). Either form (`END $$;` with space or `END$$;` without) is accepted by Postgres; pick the spaced form for readability.
3. Down migration drops the constraint.
4. Per spec §5.1 migration preflight (locked): NO silent coercion, NO NULL-out, NO data rewrite — abort visibly.

**Contracts:**

- 400 error code: `connection.status_invalid`.
- Postgres error code 23514 (CHECK violation) on direct DB insert with bad values.
- Migration abort message naming row count and sample distinct values.

**Error handling:**

- PATCH with `'foo'` → 400 `connection.status_invalid`.
- Direct DB insert with `'foo'` → 23514.
- Migration with bad existing data → abort with diagnostic, no constraint added, no data mutated.

**Tests to author:**

- `server/routes/__tests__/integrationConnectionsValidation.test.ts`:
  - "PATCH with connectionStatus='foo' → 400 connection.status_invalid".
  - "PATCH with connectionStatus='revoked' → 200; subsequent GET returns the row with status='revoked'".
  - "PATCH without connectionStatus key → other fields update normally".
- `server/routes/__tests__/integrationConnectionsCheckConstraint.test.ts` (new — DB-level):
  - "after migration 0320, direct DB insert into `integration_connections` with `connection_status='foo'` raises Postgres error 23514" (test runs against the test DB which has 0320 applied; uses raw drizzle insert, NOT the route, to bypass the Zod guard and prove the CHECK fires).

**Migration-execution preflight test (CI-only, recorded in `progress.md`):**

The spec §5.1 acceptance test "seed a row with `'foo'` and run the migration → migration aborts with the preflight diagnostic, no constraint added, no data mutated" requires running the migration against a fixture, which is outside the local testing posture per DEVELOPMENT_GUIDELINES §7 (no jest/playwright/E2E harness; pure-function tests primary). This acceptance row is moved to **CI-only / manual verification** with the following protocol recorded in `progress.md`:

1. Operator (or CI job, when migration-fixture harness is later introduced) seeds `integration_connections (connection_status='foo')` against a clean test DB.
2. Runs `npm run db:migrate` against that DB; captures stderr.
3. Asserts the migration aborts with the preflight diagnostic message (the `RAISE EXCEPTION` text), the `integration_connections_connection_status_check` constraint is NOT present in `pg_constraint`, and the seeded `'foo'` row is unchanged.
4. Pastes the operator log into `progress.md` against this V1 acceptance row.

This is NOT a deferral of correctness — the migration code itself is reviewed at chunk authoring (the `DO $$ … RAISE EXCEPTION … $$` block is a deterministic Postgres construct). It is a deferral of *automated execution proof* until the test posture flips per DEVELOPMENT_GUIDELINES §7 final paragraph.

**G1 gate:**

```bash
npx vitest run server/routes/__tests__/integrationConnectionsValidation.test.ts \
              server/routes/__tests__/integrationConnectionsCheckConstraint.test.ts
npx tsc --noEmit -p server/tsconfig.json
npm run lint
```

**Dependencies:** none.

**Spec sections covered:** §5.1 V1. Test matrix rows: §7 rows V1 ×3 (route validation tests + the 23514 CHECK test; the migration-abort row deferred to CI/manual per the protocol above and recorded in `progress.md`).

**Risk notes:**

- The migration's preflight aborts with a `RAISE EXCEPTION`. If the operator's DB has dirty data, the migration must NOT proceed — the spec is explicit (§5.1 "no silent coercion"). Builder MUST NOT add a `--force` flag or any escape hatch.
- The Zod schema wraps the existing handler; ensure the `'key' in req.body` pattern (from the existing handler) still works for explicit `null` writes on OTHER fields. Adding the Zod schema must not regress the explicit-null behaviour for `displayName`, `label`, `configJson`, etc.

---

## C8 — V2 (knowledge override concurrent-write serialisation)

**Goal:** concurrent `overrideEntry` calls on the same `blockId` serialise via a per-block advisory lock acquired inside the same transaction as the version read + insert; no 5xx leaks the constraint name; concurrent overrides on distinct blocks do not serialise.

**Files to touch:**

- `server/services/knowledgeService.ts:766–811` (`overrideEntry`).
- `server/services/__tests__/knowledgeService.overrideEntry.concurrency.test.ts` (new).

**Module shape:**

- *Public interface this chunk exposes:* `overrideEntry` keeps its existing signature and return-shape.
- *What stays hidden behind it:* the advisory-lock SQL acquired at the top of the same transaction.

**Approach (aligned to spec §5.2 wording — LOCKED):**

Spec §5.2 says: "Builder structures the service as: open `withOrgTx` → `pg_advisory_xact_lock` → read max version → insert → commit." That sequence is the contract. Replace the current `db.transaction(...)` with the spec-mandated shape.

1. Replace the `db.transaction(async (tx) => { ... })` at line 783 with `withOrgTx({ organisationId: opts.organisationId, source: 'knowledgeService.overrideEntry' }, async () => { const tx = getOrgScopedDb('knowledgeService.overrideEntry'); … })`. The `withOrgTx` wrapper sets the org GUC; `getOrgScopedDb` returns the ALS-bound tx for use inside the block.
2. As the FIRST SQL statement inside the new block (before the `MAX(version)` read or any other read), issue:
   ```ts
   await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${opts.blockId}::text, 0))`);
   ```
   The `::text` cast is locked in spec §0.7 + §5.2 (drizzle may pass UUIDs as strings or branded UUIDs; `hashtextextended` requires `text`).
3. **Same-transaction requirement (locked, spec §0.7 + §5.2):** the lock acquisition, the `memoryBlocks` row read, the version read, and the insert MUST all run against the same `tx` inside the same `withOrgTx` block. The `withOrgTx` boundary is the transaction; the lock is automatically released on commit/rollback.
4. **Caller audit + re-entrancy verification (HARD-FAIL gate).** Before writing code, builder reads `server/instrumentation.ts:172` and confirms `withOrgTx`'s behaviour when a caller is already inside an outer `withOrgTx`. Three possible behaviours:
   - **(a) Re-uses the existing transaction** — the inner `withOrgTx` no-ops on the transaction layer and uses the existing tx. Acceptable: lock + reads + insert stay inside one transactional unit. Proceed.
   - **(b) Opens a nested savepoint inside the existing transaction** — also acceptable: the savepoint commits/rolls back as a unit; `pg_advisory_xact_lock` released at the OUTER transaction commit, so still per-block-scoped for the duration. Proceed.
   - **(c) Opens an entirely independent transaction (e.g. on a different connection)** — NOT acceptable. The advisory lock would belong to the inner transaction and release at its commit, leaving the outer transaction unprotected against concurrent writers. The lock + read + insert atomicity becomes ambiguous under nested callers. **If behaviour (c) is observed, builder STOPS and escalates with a plan amendment — do not proceed with C8.**
   Builder records the verified behaviour (a / b / c) in `progress.md` with a one-line citation to the relevant lines in `server/instrumentation.ts`.
5. The org GUC is required for the RLS-protected `memoryBlocks` read at line 791 (already filtered by `eq(memoryBlocks.organisationId, opts.organisationId)`); the `withOrgTx` wrapper guarantees the GUC is set. This closes a pre-existing latent gap (the prior `db.transaction` shape did not set the GUC).

**Contracts:**

- `overrideEntry`'s return shape is unchanged. The 23505 leak path is closed by serialisation, not by catching the error — the lock prevents the race in the first place.

**Error handling:**

- Concurrent overrides on the same block → all succeed in some order; final `MAX(version) = N + initial`.
- Concurrent overrides on distinct blocks → no serialisation, both proceed concurrently.

**Tests to author:**

- `server/services/__tests__/knowledgeService.overrideEntry.concurrency.test.ts`:
  - "Spawn 5 concurrent overrides with distinct bodies on the same blockId; all succeed in some order; final MAX(version) = 5 + initial".
  - "Concurrent overrides do not produce a 500 with constraint name in the body (assert no `memory_block_versions_*_unique` substring in any error response)".
  - "Cross-block concurrency: overrides on distinct blockIds run concurrently (assert by timing — if the lock were per-table or global, the run time would be N×single; with per-block lock, run time is ~single). Tolerance: 2× single-call time as the upper bound; mark as smoke-test if CI runners are slow.".

**G1 gate:**

```bash
npx vitest run server/services/__tests__/knowledgeService.overrideEntry.concurrency.test.ts
npx tsc --noEmit -p server/tsconfig.json
npm run lint
```

**Dependencies:** none.

**Spec sections covered:** §0.7 invariant E, §5.2 V2. Test matrix rows: §7 rows V2 ×2.

**Risk notes:**

- The `::text` cast is non-negotiable — without it, `hashtextextended` may receive a different type representation in different drivers and produce a different lock key. Builder pastes the cast verbatim from spec §5.2.
- The advisory lock is `pg_advisory_xact_lock` (transaction-scoped), NOT `pg_advisory_lock` (session-scoped). The transaction-scoped variant releases on commit/rollback automatically; the session-scoped one would leak.
- The cross-block test relies on timing observation. On slow CI runners the tolerance may need tuning; if so, mark the test as a smoke test rather than removing it.

---

## C9 — O1 (rollup compact SQL fix) + O3 (reseed env guard) + O4 (reseed transaction wrap)

**Goal:** `workingTimeRollupCompactJob` runs to completion; `_reseed_drop_create.ts` and `_reseed_restore_users.ts` are fail-closed against production hosts; `_reseed_restore_users.ts` rolls back cleanly on mid-run throw.

**Files to touch:**

- `server/jobs/workingTimeRollupCompactJob.ts:99` — drop `RETURNING bucket_date` from the inner DELETE (or convert the CTE to a count-only shape).
- `scripts/lib/prod-db-guard.ts` (new) — single shared guard module.
- `scripts/_reseed_drop_create.ts` — wire the guard at `main()`'s first lines.
- `scripts/_reseed_restore_users.ts` — wire the guard + wrap the body in `db.transaction`.
- `server/jobs/__tests__/workingTimeRollupCompactJob.test.ts` (new).
- `scripts/lib/__tests__/prodDbGuard.test.ts` (new).

**Module shape:**

- *Public interface this chunk exposes:* `assertDevTargetOrThrow(databaseUrl: string | undefined, nodeEnv: string | undefined): void` — the single guard callable. The job-fix is internal to one file.
- *What stays hidden behind it:* the hardcoded denylist, the env-var union logic, the transaction-wrapping mechanics.

**Approach:**

**O1 (working-time rollup):**

1. Read `workingTimeRollupCompactJob.ts` lines 80–120 to confirm the exact CTE shape. The spec §6.1 references `RETURNING id`; the actual code (observed at plan time) returns `bucket_date` (line 101: `RETURNING bucket_date`). Either way, the `deleted` CTE feeds nothing downstream — it's a side-effect-only DELETE that the WITH wraps for atomicity.
2. Drop the `RETURNING` clause entirely. The DELETE remains correct because the consuming `INSERT` reads from `monthly_agg`, not from `deleted`.
3. Verify the resulting query still parses against Postgres; the test seeds rows past retention, runs the job, and asserts the row count drops.

**O3 (`_reseed_drop_create.ts` env guard):**

1. New module `scripts/lib/prod-db-guard.ts`:
   ```ts
   const HARDCODED_DENY_FRAGMENTS = ['supabase', 'neon', 'render', 'rds.amazonaws', 'pooler.'];

   export function assertDevTargetOrThrow(
     databaseUrl: string | undefined,
     nodeEnv: string | undefined,
   ): void {
     // Primary guard — fails closed unconditionally
     if (nodeEnv === 'production') {
       throw new Error(
         'REFUSING TO RUN: NODE_ENV=production. This destructive script never runs in production. Set NODE_ENV=development on a dev DB.',
       );
     }

     // Secondary guard — defence-in-depth
     const dbUrl = databaseUrl ?? '';
     const envDeny = (process.env.PROD_DB_HOST_DENYLIST ?? '')
       .split(',')
       .map((s) => s.trim())
       .filter(Boolean);
     const fragments = [...HARDCODED_DENY_FRAGMENTS, ...envDeny];
     for (const fragment of fragments) {
       if (dbUrl.includes(fragment)) {
         throw new Error(
           `REFUSING TO RUN: DATABASE_URL contains denylisted host fragment "${fragment}". This script destroys data; point at an explicit local or self-hosted dev DB.`,
         );
       }
     }
   }
   ```
2. In `_reseed_drop_create.ts`, call `assertDevTargetOrThrow(process.env.DATABASE_URL, process.env.NODE_ENV)` as the first executable line of `main()`, before any DB connection is opened.
3. False-positive policy (locked, spec §6.3): NO `--force`, NO `--allow-hosted`, NO env-var bypass. The hardcoded denylist is the contract.

**O4 (`_reseed_restore_users.ts` transaction wrap):**

1. Same guard call at the top of `main()`.
2. Wrap the entire restore body in `await db.transaction(async (tx) => { ... })`. All inserts inside use `tx` (not module-level `db`).
3. Test the rollback by simulating a mid-restore throw and asserting DB state is unchanged.

**Contracts:**

- `assertDevTargetOrThrow` exits with a thrown Error; the script does not catch (process exits 1).
- Hardcoded denylist: `supabase`, `neon`, `render`, `rds.amazonaws`, `pooler.` — fixed in `scripts/lib/prod-db-guard.ts`.
- `PROD_DB_HOST_DENYLIST` env var augments the hardcoded list (comma-separated).

**Error handling:**

- `NODE_ENV=production` → throw on primary guard, regardless of denylist.
- `DATABASE_URL` matches any fragment → throw on secondary guard.
- All other paths → proceed (existing behaviour preserved).

**Tests to author:**

- `scripts/lib/__tests__/prodDbGuard.test.ts`:
  - "NODE_ENV=production AND no DATABASE_URL → throw on primary guard".
  - "NODE_ENV=production AND DATABASE_URL=postgresql://localhost/x → throw on primary guard (denylist not consulted)".
  - "NODE_ENV=development AND DATABASE_URL contains 'supabase' → throw on secondary guard".
  - "NODE_ENV=development AND DATABASE_URL contains 'neon' → throw".
  - "NODE_ENV=development AND DATABASE_URL contains 'render' → throw".
  - "NODE_ENV=development AND DATABASE_URL contains 'rds.amazonaws' → throw".
  - "NODE_ENV=development AND DATABASE_URL contains 'pooler.' → throw".
  - "NODE_ENV=development AND DATABASE_URL=postgresql://localhost/dev → ok (no throw)".
  - "PROD_DB_HOST_DENYLIST='myhost.example.com' AND DATABASE_URL contains 'myhost.example.com' → throw".
- `server/jobs/__tests__/workingTimeRollupCompactJob.test.ts`:
  - "Seed agent_working_time_rollups with rows past retention; run the compact step; assert rows past retention are deleted; assert no SQL error".

**G1 gate:**

```bash
npx vitest run scripts/lib/__tests__/prodDbGuard.test.ts \
              server/jobs/__tests__/workingTimeRollupCompactJob.test.ts
npx tsc --noEmit -p server/tsconfig.json
npm run lint
```

**Dependencies:** none.

**Spec sections covered:** §6.1 O1, §6.3 O3, §6.4 O4. Test matrix rows: §7 rows O1, O3 ×3, O4 ×2.

**Risk notes:**

- The hardcoded denylist will block staging/dev DBs hosted on those providers. Per spec §6.3 false-positive policy: this is intended; do NOT add a bypass.
- O4's transaction wrap must include EVERY DML, not just the user inserts. Read the script in full before wrapping; leaving any DML outside the transaction defeats the point.
- `prodDbGuard.test.ts` reads `process.env.PROD_DB_HOST_DENYLIST` at call time (not at module-import time) to pick up test-fixture values. Builder verifies the test fixtures clear/restore the env var between cases (use `vi.unstubAllEnvs()` or equivalent).

---

## C10 — O2 runbook + O5 branch-protection record

**Goal:** non-code deliverables landed; `progress.md` has the operator-action records spec §9 requires.

**Files to touch:**

- `docs/runbooks/migration-0240-phased-swap.md` (new) — O2.
- `tasks/builds/pre-test-hardening/progress.md` — append O5 operator-action record (the operator captures the live CI check names + applies branch protection + pastes the `gh api` output).
- `docs/doc-sync.md` — add the new runbook entries (0240 phased swap + Teamwork webhook token rotation from C2) IF the doc-sync gate requires.

**Module shape:**

- *Public interface this chunk exposes:* the runbook content; no code.
- *What stays hidden behind it:* nothing — both items are operator-facing artefacts.

**Approach:**

1. Author `docs/runbooks/migration-0240-phased-swap.md` per spec §6.2: trigger condition (table size or write-latency tail past threshold), the two-step `CREATE UNIQUE INDEX CONCURRENTLY` + drop-old + rename migration, rollback plan, operator command sequence.
2. Per spec §6.5 + §9: the operator captures the current required-check names from a recent ready-to-merge PR; applies branch protection on `main`; pastes the `gh api repos/<owner>/<repo>/branches/main/protection` output into `progress.md`. This step is NOT code — the chunk's "deliverable" is the `progress.md` entry.
3. Sequencing: O5 may be applied at any point in the build but MUST be applied before merge-ready signoff. Applying it too early on an in-progress integration branch unnecessarily restricts the build's own commits; the recommended sequencing per spec §6.5 is "during the merge-ready phase".
4. Update `docs/doc-sync.md` if the doc-sync gate requires — verify by reading `docs/doc-sync.md` first.

**Contracts:**

- Spec §9 acceptance items 6-c (O5 branch-protection screenshot or `gh api` output) and 1 (O2 recorded in `progress.md` against non-code acceptance) are satisfied here.

**Error handling:**

- N/A — no runtime code.

**Tests to author:**

- None. Per DEVELOPMENT_GUIDELINES §7 testing posture (`static_gates_primary` + `runtime_tests: pure_function_only`), runbook content is doc-only; the static-gates layer enforces presence.

**G1 gate:**

```bash
npm run lint    # picks up any markdown/structural issues if configured
```

(No vitest, no typecheck — pure docs.)

**Dependencies:** none. May ship as the last chunk before merge-ready.

**Spec sections covered:** §6.2 O2, §6.5 O5. Test matrix row: §7 row "5 O5 (manual verification)".

**Risk notes:**

- O5 is operator-action; the builder cannot apply branch protection. The chunk's responsibility is to ensure `progress.md` carries the post-application evidence. If the operator has not applied protection by merge-ready, the build is not merge-ready.
- The O2 runbook is the surface that prevents the next operator from rediscovering the trigger condition under pressure (per spec §6.2). Cost of the runbook entry is near-zero; it MUST land in this build per DEC-3.

---

## Cross-chunk verification (G2 / branch level)

Per spec §9, the build is merge-ready when:

1. **Targeted tests authored within this build pass locally.** (Listed per chunk above — runs at G1.)
2. **`npx tsc --noEmit -p server/tsconfig.json`** clean across the integration branch — runs at G1 per chunk and at G2 against the merged branch.
3. **`npm run lint`** clean — same.
4. **`npm run build:client`** succeeds (proves T1's URL-rewrite migration didn't regress the client) — runs at G2.
5. **CI runs the full gate suite** — including:
   - `scripts/verify-rls-protected-tables.sh` (W3 adds `webhook_replay_nonces`; the script exits 0 only if the registry entry + the migration are both present).
   - `scripts/verify-rls-coverage.sh` (every registered table has a matching CREATE POLICY).
   - The scope-out grep gate (no diff in §0.2 forbidden paths: `server/middleware/*`, auth routes, rate-limiting primitive, multer config, `server/services/workflowEngineService.ts`, `workflowRunService.ts`, `agentExecutionService.ts`, `agentRuns` schema).
   - The T1 grep gate (zero callers of legacy unscoped support paths in `server/`, `client/src/`, `shared/`, AND zero remaining `app.use('/api/support', …)` mount lines).
   - The T3 4-arg-shape grep gate (any caller of `taskService.createTask` whose first positional arg is not an object literal MUST be one of the two known sister-branch sites; full pattern in plan-time builder contract item 4 → "Grep gate").
   - All other CI-only gates per `references/test-gate-policy.md`.
6. **`progress.md` documents:**
   - DEC-1 through DEC-4 resolutions (locked in spec §0.4 — `progress.md` only re-states the resolutions and notes any in-build deviations).
   - T3 caller audit checklist with every modified call site listed, matching the four-bucket audit in plan-time builder contract item 4 (15 in-scope direct call sites + 1 indirect wrap edit at `routes/subaccountOnboarding.ts:53` + 1 GHL TODO + 2 sister-branch overload-only sites). Plus the T3 4-arg-shape grep output (expected: exactly the two `workflowEngineService.ts:2716` / `:2962` lines, after any documented false-positive exclusions).
   - O5 branch-protection screenshot or `gh api` output.
   - The T1 grep gate output (expected empty) and the exact commands run.
   - The V1 migration-execution-test operator log per the C7 deferral protocol (one paste against the seeded-bad-row → migration aborts → constraint absent assertion).
   - C8 caller-audit note: the result of confirming `withOrgTx`'s re-entrant behaviour at `server/instrumentation.ts:172` (per C8 approach step 4).
7. **`pr-reviewer` passes.**
8. **`adversarial-reviewer` auto-fires** (webhook + RLS surface) and returns no escalated findings.
9. **`chatgpt-pr-review` round 1** returns no blockers.

The plan does NOT run gates locally. CI runs the full gate suite as a pre-merge gate per `references/test-gate-policy.md`.

---

## Self-consistency notes

- **Goals vs implementation.** Every spec acceptance criterion in §9 is mapped to at least one chunk's "Tests to author" section. Cross-checked: W1, W2 → C1; W3 → C2; T1 → C3; T2 → C4; T3 → C5; S1, S2 → C6; V1 → C7; V2 → C8; O1, O3, O4 → C9; O2, O5 → C10. No orphan acceptance criteria.
- **Locked invariants.** Every §0.7 invariant is covered:
  - Migration range 0318–0320: C2 (0318, 0319), C7 (0320). No additional numbers used.
  - Webhook replay dedup correctness: C2's `webhookReplayNonceStore.recordIfNew` + the regression test for nonce-row-existence-not-wall-clock.
  - Webhook token storage on shared `connector_configs` + partial UNIQUE: C2 plan-time builder contract item 2 names the table and index expression.
  - Support read scoping: C3 grep gate is the contract.
  - Knowledge override race: C8 same-transaction advisory lock per spec.
  - Production reseed guards fail closed: C9's `assertDevTargetOrThrow` primary guard is unconditional.
  - `taskService.createTask` type-level contract: C5 enforces caller-supplied `tx` at the TypeScript signature (DEC-4 LOCKED); regression test additionally verifies a `tx` without org GUC fails to write under FORCE-RLS.
- **Forward-only chunk dependencies.** Only C2 depends on C1 (so `recordIncident` is the established pattern when C2 adds new failure paths). All other chunks are independent. C5 is the largest and runs solo.
- **Sister-branch boundary respected.** C5 explicitly lists 2 callers in `workflowEngineService.ts` as out of scope; the scope-out grep gate enforces non-touch. Typecheck cleanliness on this branch is preserved by the transitional 4-arg overload on `taskService.createTask` (runtime-trapped, grep-gated to be unreachable from in-scope code). Sister branch removes the overload when its callers migrate.
- **No "TBD" / "builder decides" remaining.** Every plan-time builder contract is resolved with a citation to source code or spec text. The C5 Strategy choice is settled: literal Strategy B (caller-supplied `tx` at the type level) is mandated by DEC-4 + §0.7 + §3.3 acceptance #1; the sister-branch typecheck integration plan (overload + grep gate) is in plan-time builder contract item 4.
- **Test gates are CI-only.** No chunk's G1 gate runs `npm run test:gates`, `scripts/verify-*.sh`, or any whole-suite umbrella command. Only `lint`, `typecheck`, targeted vitest, and (where the chunk warrants) `build:client`.
- **S1 source-rule snapshot.** Plan-time builder contract item 5 resolves the spec's reference to `tasks/builds/support-ticket-structure/spec.md` §5.1.B (no such §5.1.B exists in the actual source spec at `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`) by collapsing Check 6 to a forward-compat no-op gate that asserts the future-on path even though no runtime path can reach it today. The Zod schema is NOT touched.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| C5 transitional 4-arg overload becomes a permanent compatibility shim | The overload is `@deprecated`, runtime-traps with a clear error, and is grep-gated (see plan-time builder contract item 4 → "Grep gate") to be unreachable from any code outside the 2 known sister-branch sites. Sister branch is required to remove it when its callers migrate; the integration branch enforces removal at merge. Builder MUST NOT extend the overload's behaviour beyond the runtime trap. |
| Sister-branch (`workflowEngineService.ts`) typecheck breaks on this branch after C5's signature change | Resolved at plan time: the transitional 4-arg overload preserves typecheck on this branch without touching the sister-branch file (§0.2 respected). The 2 known sites at `:2716` and `:2962` remain unchanged on this branch and continue to compile against the legacy overload. Sister branch reconciles when it lands its own `withOrgTx` wrappers and removes the overload. |
| 11 client call sites in C3 may live under different routing contexts | Plan names every site (in plan-time builder contract item 3). Builder verifies each is reachable from a subaccount-scoped route shell at chunk start. Any page that isn't moves under the existing subaccount-routing tree before the URL rewrite. |
| `gen_random_uuid()` unavailable in some target environment for migration 0319 | Locked: spec §2.3 says do NOT add `CREATE EXTENSION` here. If the migration fails in a fresh-DB boot, the fix lives in the schema-bootstrap migration (out of scope for this build). |
| TTL prune job failure extends dedup coverage indefinitely (storage growth) | Acceptable per spec §2.3 "Replay correctness invariant". Storage growth is monitored by the existing infra; correctness is unaffected. |
| Operator forgets to apply O5 branch protection before merge-ready | Spec §9 item 6-c blocks merge-ready signoff without the `gh api` output in `progress.md`. C10 reflects this. |
| `customer-match policy` (Check 6) reads from a flag (`requireCustomerMatch`) that does not exist in the `SupportInboxAgentConfig` Zod schema | Plan-time builder contract item 5 locks the no-op-in-v1 behaviour AND the future-on test row. The Zod schema is NOT changed in this build; adding the flag is a future spec amendment. |
| Two callers of `createTask` in `workflowEngineService.ts` would otherwise need wrapping | Marked out of scope; spec scope-out gate enforces non-touch. Coordinated implicitly via the integration branch when both this build and the sister branch land. |
| Existing in-memory `webhookDedupeStore` could race the new persistent store | Plan keeps the in-memory store as a layer-0 fast-path probe. The persistent store is the correctness boundary; the in-memory layer is best-effort and never overrides a "not duplicate" verdict from the durable store. |
| `Router({ mergeParams: true })` not propagated through every level of nesting in C3 | Tests assert `req.params.subaccountId` is non-undefined inside leaf handlers; the integration test in C3 fails fast if propagation is broken. |

---

## Done — plan LOCKED, ready for builder

This plan is the contract. Every chunk has a goal, files, approach, contracts, error handling, tests, G1 gate, dependencies, spec coverage, and risk notes. Plan-time builder contracts cover the seven items the architect was asked to resolve before code is written. Cross-chunk verification names the G2 gates CI runs. No "TBD" remains.

**Lock history.**
- 2026-05-10 — Plan drafted by architect.
- 2026-05-10 — Plan-vs-spec review round 1: F1–F7 blockers + R1–R5 tightenings applied. C5 Strategy A removed; Strategy B (caller-supplied `tx` at the type level, per DEC-4) mandated; transitional 4-arg overload + grep gate added for sister-branch typecheck integration; C8 aligned to spec §5.2 `withOrgTx → advisory lock → read max → insert` shape; C7 V1 migration tests bucket clarified.
- 2026-05-10 — Plan-vs-spec review round 2: C5 leftover Strategy A wording removed; `withOrgTx` callback shape corrected (callback takes no args; tx via `getOrgScopedDb`); bare-`createTask` grep pattern added; C5 caller audit restructured into four explicit buckets; C2 missing-deliveryId rejection + old-route 404 test added; C7 DO-block idempotency pattern locked; C8 hard-fail gate added for the independent-transaction case.
- 2026-05-10 — Plan-vs-spec review round 3 (final): stale "13-item table" wording updated to four-bucket reference; bare-grep "expected output" softened to allow documented false positives; C2 no-token test extended to assert zero side effects; C6 Approach renumbered (two-step-3 typo fixed); C7 DO block syntax verified against `migrations/0285_…` and `migrations/0302_…`. Plan locked.

**Next step:** operator reviews this lock note, switches to Sonnet for execution, and proceeds chunk-by-chunk per `superpowers:executing-plans`.
