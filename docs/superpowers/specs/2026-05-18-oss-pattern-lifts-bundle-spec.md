**Status:** reviewing
**Spec date:** 2026-05-18
**Last updated:** 2026-05-18
**Author:** michael
**Build slug:** oss-pattern-lifts-bundle

---

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Agent Runtime, Audit & Governance |
| Capability owner | platform |
| Lifecycle state on launch | Inception |
| Risk surface | server/db/schema, server/routes, RLS migrations, agent runtime |
| Review cadence | quarterly |

---

# Waitpoint Primitive — OSS Pattern-Lifts Bundle

> **Source brief:** `docs/oss-pattern-lifts-bundle-brief.md`
> **Scope:** Significant

## Table of Contents

1. [Goals](#1-goals)
2. [Non-Goals](#2-non-goals)
3. [Framing Assumptions](#3-framing-assumptions)
4. [Data Model](#4-data-model)
5. [Service Interface — waitpointService](#5-service-interface--waitpointservice)
6. [New Jobs](#6-new-jobs)
7. [Call-Site Migrations](#7-call-site-migrations)
8. [Contracts](#8-contracts)
9. [Telemetry](#9-telemetry)
10. [State Machine](#10-state-machine)
11. [Execution Model](#11-execution-model)
12. [Permissions / RLS Checklist](#12-permissions--rls-checklist)
13. [File Inventory](#13-file-inventory)
14. [Chunk Sequencing](#14-chunk-sequencing)
15. [Execution-Safety Contracts](#15-execution-safety-contracts)
16. [Testing Posture](#16-testing-posture)
17. [Deferred Items](#17-deferred-items)
18. [Self-Consistency Pass](#18-self-consistency-pass)
19. [ABCd Lifecycle Estimate](#abcd-lifecycle-estimate)

---

## 1. Goals

- Replace two hand-rolled "pause and resume" implementations with a single generalised `waitpoints` primitive.
- Migrate both existing call sites — OAuth integration-required gate (`agentResumeService.ts`) and workflow approval gate (`dispatch.ts`) — within this build, gated by `WAITPOINT_PRIMITIVE_ENABLED` for rollback safety.
- Give any future long-running pattern a first-class primitive to use without reinventing the pause/resume wheel.
- Emit three structured telemetry events (`waitpoint.created`, `waitpoint.completed`, `waitpoint.expired`) on the existing live execution log.
- Document the primitive in `architecture.md` and add a `KNOWLEDGE.md` entry explaining why Trigger.dev was evaluated and not adopted.

## 2. Non-Goals

- Full Trigger.dev adoption.
- Pre-merge prompt-eval suite (separate Standard build; skip criterion not triggered).
- Composio adoption or connector build.
- Any operator-facing UI for waitpoints in V1 (headless primitive only).
- Retention or archival strategy for completed/expired waitpoints (V2).
- Removing `blockedRunExpiryJob.ts` or `agentResumeService.ts` in V1 — both remain as fallback paths when `WAITPOINT_PRIMITIVE_ENABLED=false`. Cleanup is a follow-up PR after production confirms both sites work.

## 3. Framing Assumptions

- `docs/spec-context.md` framing applies: pre-production, `static_gates_primary` testing posture, `commit_and_revert` rollout model.
- `sendWithTx` (`server/lib/pgBossTxSend.ts`) is the canonical transactional enqueue primitive; `completeWaitpoint` uses it.
- `deriveTokenHash` from `server/services/agentResumeService.ts` (sha256 hex) is reused — no new cryptography library.
- The two existing call sites are the only two implementations of pause/resume; no third hidden pattern exists.
- `bound_run_id` is required for `kind='oauth'` (the agent run is the bind target). For `kind='approval'`, `bound_run_id` is OMITTED — approval waitpoints bind to `actions`/`workflow_step_runs`, not directly to an agent run, and the link is carried via `resumePayload.approvedActionId`. Schema-level nullability allows both shapes and is future-proofing for `kind='external_event'` system-level waits.

## 4. Data Model

### 4.1 `waitpoints` table — migration `<NNNN>_waitpoints_primitive.sql`

> **Migration number is a placeholder.** Per `DEVELOPMENT_GUIDELINES.md §6.2`, migration numbers are claimed at merge time after rebasing onto `main`. `0378` is already used by `0378_vision_inference_calls.sql` on the current `main` — confirm collision-free numbering with `ls migrations/ | sort | tail -10` immediately before merge and rename the file (and update every reference in this spec: §4.1 heading, §12 manifest entry, §13 file inventory) in the same commit.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `text` | `PRIMARY KEY` | sha256(plaintext) — hash only, never plaintext |
| `kind` | `text` | `NOT NULL`, CHECK | `'oauth' \| 'approval' \| 'external_event'` |
| `organisation_id` | `uuid` | `NOT NULL, FK → organisations.id` | RLS boundary |
| `subaccount_id` | `uuid` | nullable | Metadata only — not an RLS predicate |
| `bound_run_id` | `uuid` | nullable, FK → `agent_runs.id` | Required for `kind='oauth'` (validated at service layer); nullable for `kind='approval'` and `kind='external_event'` (approval binds via `resumePayload.workflowStepRunId` instead) |
| `expires_at` | `timestamptz` | `NOT NULL` | Hard expiry — no grace window |
| `status` | `text` | `NOT NULL DEFAULT 'pending'`, CHECK | `'pending' \| 'completed' \| 'expired'` |
| `resume_queue` | `text` | nullable, CHECK | pg-boss queue name for resume dispatch on completion. **Must be non-null for `kind='oauth'`** (the OAuth path enqueues on completion). **Must be NULL for `kind='approval'`** (Path B, §5.2 — approval completion does NOT enqueue any queue; the existing inline `resumeActionCallAfterApproval` drives resume). `kind='external_event'` is unconstrained (V1 has no callers). Enforced by CHECK constraint below. |
| `resume_payload` | `jsonb` | `NOT NULL DEFAULT '{}'` | Sealed payload forwarded to the resume job |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | |
| `completed_at` | `timestamptz` | nullable | Set when `status → 'completed'` |

**Indexes:**
- `waitpoints_org_status_idx` on `(organisation_id, status)` — scoped expiry sweeps and org-scoped lookups
- `waitpoints_bound_run_idx` on `(bound_run_id)` WHERE `bound_run_id IS NOT NULL`

**CHECK constraints:**
- `status IN ('pending', 'completed', 'expired')`
- `kind IN ('oauth', 'approval', 'external_event')`
- `kind <> 'oauth' OR bound_run_id IS NOT NULL` — oauth waitpoints MUST bind to an agent run; direct DB writes cannot create an oauth row without one (defence in depth alongside service-layer validation in §5.1).
- `kind <> 'oauth' OR resume_queue IS NOT NULL` — oauth waitpoints MUST carry a queue name (the OAuth completion path enqueues `agent-run-resume-from-waitpoint`).
- `kind <> 'approval' OR resume_queue IS NULL` — approval waitpoints MUST NOT carry a queue name (Path B does not enqueue on completion; a non-null value would be misleading metadata).

### 4.2 RLS

- `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY` on `waitpoints`.
- Policy: `USING (organisation_id = current_setting('app.organisation_id')::uuid)`.
- RLS enforces the organisation boundary; subaccount filtering is service-layer.
- `expireWaitpoints()` sweep uses `withAdminConnection` AND issues `SET LOCAL ROLE admin_role` inside the connection (crosses org boundaries — same two-part pattern as `blockedRunExpiryJob.runFn`, line 51). Without the role switch, FORCE RLS on `waitpoints` would make the sweep see zero rows.
- `createWaitpoint` and `completeWaitpoint` use `getOrgScopedDb`. `withAdminConnection` is FORBIDDEN for these two methods — they are user/org-scoped and must never run with admin privileges.

---

## 5. Service Interface — `waitpointService`

**File:** `server/services/waitpointService.ts`

### 5.1 `createWaitpoint`

```typescript
createWaitpoint(params: {
  kind: 'oauth' | 'approval' | 'external_event';
  organisationId: string;
  subaccountId?: string;
  boundRunId?: string;
  expiresInSeconds: number;
  resumeQueue: string | null; // non-null required for kind='oauth'; MUST be null for kind='approval' (enforced by DB CHECK in §4.1)
  resumePayload: Record<string, unknown>;
}): Promise<{ id: string; plaintext: string; expiresAt: Date }>
```

- Validates input (service-layer, complementing the DB CHECK constraints in §4.1):
  - if `kind === 'oauth'` and `boundRunId` is undefined → throws `failure('VALIDATION_FAILED', 'boundRunId is required for oauth waitpoints')`.
  - if `kind === 'oauth'` and `resumeQueue` is null → throws `failure('VALIDATION_FAILED', 'resumeQueue is required for oauth waitpoints')`.
  - if `kind === 'approval'` and `resumeQueue` is not null → throws `failure('VALIDATION_FAILED', 'approval waitpoints must not specify resumeQueue (Path B inline resume — see §5.2)')`.
  - `kind='approval'` does NOT require `boundRunId` — approval waitpoints bind via `resumePayload.approvedActionId` (the action row carries the workflow step + agent run linkage). `kind='external_event'` does not require it either. DB-level nullability is permitted for both non-oauth kinds.
  - These validations live in `waitpointServicePure.validateCreateWaitpointParams` so they're unit-testable; the DB CHECK constraints are defence-in-depth.
- Generates 32 random bytes → plaintext token (64-char hex via `crypto.randomBytes(32).toString('hex')`).
- Derives `tokenHash = deriveTokenHash(plaintext)` (sha256 hex, reused from `agentResumeService`).
- Computes `expiresAt = new Date(now + expiresInSeconds * 1000)`.
- Inserts row with `id = tokenHash`, `status = 'pending'`, `expires_at = expiresAt`.
- Returns `{ id: tokenHash, plaintext, expiresAt }`. `id` is the waitpoint row's primary key — safe to persist for any kind (the internal-completion path uses it; see §5.2). `expiresAt` is returned so the caller can persist it alongside the chosen identifier for UI display. **For `kind='oauth'`**: persist `plaintext` (in `agent_messages.meta`) so it round-trips through the OAuth callback. **For `kind='approval'` and `kind='external_event'`**: persist `id` only (in `actions.metadataJson.waitpointId` or analogous tenant-scoped storage) and discard `plaintext` — the consumer is internal and calls `completeWaitpoint({ waitpointId, ... })`. Plaintext returned once; caller must not log it or emit it in telemetry.
- Emits `waitpoint.created` event (always). Routing per §9: live execution log + structured log when `boundRunId` is set (oauth); structured log only otherwise (approval, external_event).
- **Idempotency:** `id` PRIMARY KEY — 23505 on duplicate token is a server error (256-bit entropy; collision not possible in practice).

### 5.2 `completeWaitpoint`

```typescript
completeWaitpoint(params:
  | { plaintext: string; organisationId: string; tx?: TxHandle }       // OAuth path — user presents plaintext token
  | { waitpointId: string; organisationId: string; tx?: TxHandle }     // Approval path — internal call, by id
): Promise<{ status: 'completed' | 'already_completed' }>

// where TxHandle = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }
```

**Deliberate narrowing from the brief.** The brief sketched `completeWaitpoint(token, payload)` with a `payload` argument carrying caller-supplied data into the resume job. The V1 surface drops `payload` — `resumePayload` is sealed at create time (§5.1) and forwarded by the service to `sendWithTx` for the OAuth path; the approval path runs inline and consumes nothing from a completion-time payload. Callers that need to thread data through completion should embed it in `resumePayload` at create time. Re-introducing a completion-time `payload` is a future-build expansion (no current consumer needs it).

**Why two input shapes — and why approval does not store plaintext long-term.** The OAuth flow MUST take plaintext because the resume token leaves the system (lands on a user's OAuth callback URL via the integration card) and comes back as user input — only the user has the plaintext, the server has only the hash. The approval flow is purely internal: the producer (`dispatch.ts`) and the consumer (`reviewService.approveItem`) are both server-side, the consumer already has the action row's `organisation_id`, and there is no user-facing resume URL. Storing plaintext in `actions.metadataJson` for the approval flow would create a long-lived, never-presented secret. Instead, the approval producer persists `waitpointId` (= `tokenHash`, the row's PRIMARY KEY) in `actions.metadataJson.waitpointId`, and the consumer calls `completeWaitpoint({ waitpointId, organisationId, tx })`. Plaintext for `kind='approval'` is generated, returned once for the create-side telemetry path (so the create-side hash matches), and then discarded — never persisted.

- For the `{plaintext}` shape, derives `tokenHash = deriveTokenHash(plaintext)`. For the `{waitpointId}` shape, uses `waitpointId` directly as the lookup key (it equals `tokenHash` by construction — see §4.1 `id` column).
- If `tx` is provided (approval path; called from `reviewService.approveItem`'s existing transaction), uses that transaction handle directly so the waitpoint completion commits atomically with the caller's other writes. If `tx` is omitted (OAuth path; called from `agentResumeService.resumeFromIntegrationConnect`), opens its own `getOrgScopedDb` transaction. `withAdminConnection` is FORBIDDEN in both modes — completion is user/org-scoped and must never run with admin privileges.
- Optimistic UPDATE: `SET status='completed', completed_at=now() WHERE id=<resolved id> AND organisation_id=orgId AND status='pending' AND expires_at > now()` — where `<resolved id>` is `tokenHash` (plaintext path) or `waitpointId` (internal path).
- **0 rows updated:** reads row to distinguish `already_completed` (status='completed' → HTTP 200) from expired/not-found (→ HTTP 410, `errorCode: 'RESUME_TOKEN_EXPIRED'`).
- **1 row updated — per-kind resume behaviour:**
  - `row.kind === 'oauth'`: calls `sendWithTx(tx, resumeQueue, resumePayload, queueOptions)` to enqueue the OAuth resume job atomically in the same transaction. `queueOptions` is built by extracting only the per-job-row subset that `sendWithTx` supports — `{ retryLimit, expireInSeconds, priority, singletonKey }` — from `getJobConfig(resumeQueue)`, then overlaying `singletonKey: (resumePayload as { runId: string }).runId`. Dead-letter routing (`deadLetter: '<queue>__dlq'`) is honoured at processor-creation time by `pgBossRegistrations` — it is not a per-job-row option and is intentionally NOT forwarded here.
  - `row.kind === 'approval'`: NO pg-boss enqueue happens. The existing workflow-engine HITL resume path is inline (synchronous) inside `reviewService.approveItem()` via `resumeActionCallAfterApproval` — the waitpoint primitive does not async-ify it. The waitpoint serves as the durable token + expiry + idempotency layer; the inline resume continues to drive the action transition and engine tick on the synchronous code path. (See §7.3 for the call-site change: approval `completeWaitpoint` runs inside `reviewService.approveItem`'s existing transaction so the waitpoint row's terminal state is committed atomically with the action approval.) Operator-deferred path: a future build may async-ify approval resume by adding a new pg-boss queue + handler — logged as OPLB-SR-IT4-D1 in `tasks/todo.md`.
  - `row.kind === 'external_event'`: NO callers in V1; queue behaviour deferred until a caller lights up.
- Emits `waitpoint.completed` after commit.
- **Idempotency:** state-based — `UPDATE WHERE status='pending'`. Second call → `already_completed`.
- **Retry classification:** guarded — safe to retry.
- **Concurrency guard:** optimistic predicate. Racing second caller gets 0 rows → reads status → `already_completed`. First-commit-wins.

### 5.3 `expireWaitpoints`

```typescript
expireWaitpoints(): Promise<{ expiredCount: number }>
```

- Uses `withAdminConnection` AND issues `SET LOCAL ROLE admin_role` inside the connection (two-part pattern from `blockedRunExpiryJob.runFn`, line 51). Without the role switch, FORCE RLS on `waitpoints` would make the sweep see zero rows.
- Bulk UPDATE: `SET status='expired' WHERE status='pending' AND expires_at < now()`, collecting updated row ids, `kind`s, and `bound_run_id`s.
- **Per expired row — downstream state cleanup. Important — RLS bypass:** under `SET LOCAL ROLE admin_role`, RLS is bypassed, so every downstream SELECT and UPDATE MUST carry an explicit org predicate `AND organisation_id = wp.organisation_id` (where `wp` is the waitpoint row being processed) to preserve the boundary the waitpoint row itself enforced. A bare `WHERE id = $1` lookup would cross orgs under admin role; do not write that.
  - `kind='oauth'` (waitpoint row carries `bound_run_id`): UPDATE `agent_runs SET status='cancelled', run_result_status='failed', blocked_reason=NULL, blocked_expires_at=NULL, integration_resume_token=NULL, completed_at=now(), run_metadata=jsonb_set(run_metadata,'{cancelReason}','"integration_connect_timeout"') WHERE id = $bound_run_id AND organisation_id = $wp.organisation_id AND status = $observed` using `assertValidTransition` (kind='agent_run') and the predicate-checked UPDATE pattern from `blockedRunExpiryJob.runFn`. Emits a `state_transition` structured log with `guarded: true` (matching `blockedRunExpiryJob.runFn` line 113-123). With `WAITPOINT_PRIMITIVE_ENABLED=true` this replaces the work `blockedRunExpiryJob` did before.
  - `kind='approval'` (waitpoint row has `bound_run_id = NULL`; cleanup link is `resumePayload.workflowStepRunId`):
    1. Read `stepRunId = (resumePayload as { workflowStepRunId: string }).workflowStepRunId`.
    2. Replicate the column writes that `failStepRunInternal` (`server/services/workflowEngine/stepLifecycle.ts:44`) does. **Implementation requirement — extract a pure helper.** A new pure export `buildFailStepRunColumnSet(reason: string, currentVersion: number, now: Date): FailStepRunColumns` is added to a refactored `server/services/workflowEngine/stepLifecyclePure.ts` (or `workflowEngine/stepLifecycle/columnSets.ts`) and consumed by BOTH `stepLifecycle.failStepRunInternal` (existing call site) AND `expireWaitpoints` (new call site). The helper returns the column-name → value map and is unit-tested. `failStepRunInternal` is refactored in this build to consume the helper so the two call sites cannot drift. The admin-role SQL `expireWaitpoints` issues then becomes a thin layer that spreads the column set into the UPDATE: `UPDATE workflow_step_runs sr SET <columns from buildFailStepRunColumnSet('approval_timed_out', sr.version, now)> FROM workflow_runs wr WHERE sr.id = $stepRunId AND sr.run_id = wr.id AND wr.organisation_id = $wp.organisation_id AND sr.status = 'awaiting_approval'`. **Acceptance criterion — column parity test.** A pure unit test (`stepLifecyclePure.test.ts`) asserts `buildFailStepRunColumnSet(...)` returns exactly the column-name set `{ status, error, completedAt, version, updatedAt }` (or whatever the current `failStepRunInternal` writes; the test pins to the live shape so any future column added to `failStepRunInternal` either updates the helper or fails the test). This closes the drift class — adding a column to `failStepRunInternal` without updating the helper fails CI. (The `error` text column is the existing place for failure-reason strings; `failed` is the existing terminal status — no formal "approval timed out" status exists in the workflow step run vocabulary.)
    3. After the UPDATE succeeds (rowCount=1), call `sendWithTx(tx, 'workflow-run-tick', { runId: wr.id }, { ...getJobConfig('workflow-run-tick'), singletonKey: wr.id, useSingletonQueue: true })` to give the engine its tick — equivalent to `failStepRunInternal`'s `enqueueTick(sr.runId)` call (which uses the same queue, payload, and singletonKey shape; see `server/services/workflowEngine/constants.ts:20`). The cleanup defers the tick via `sendWithTx` instead of calling `enqueueTick` directly because `enqueueTick` is an in-process helper that assumes the calling context can dispatch via pg-boss; under admin role we just write the row.
    4. The agent_run is NOT cancelled by approval timeout — the workflow engine handles step-failure propagation on its next tick (existing behaviour preserved).
    5. If `workflowStepRunId` is missing from resumePayload (waitpoint authored before this spec lands) or the step run is already terminal / cross-org → drop silently and log `waitpoint.expired_no_step` (analogous to `waitpoint.expired_no_run`).
  - `kind='external_event'`: V1 has no callers; if a row exists, only the waitpoint row is transitioned. No downstream cleanup.
  - `bound_run_id` set but references a deleted run (kind='oauth' only) → logs `waitpoint.expired_no_run` (silent discard); waitpoint row still transitions to `expired`.
- Per-row telemetry: `waitpoint.expired` event emitted when `bound_run_id` references a live run.
- Returns `{ expiredCount }`. Idempotent; repeated runs are safe.
- **Once `WAITPOINT_PRIMITIVE_ENABLED=true`** the waitpoint CREATE path stops writing `agent_runs.blocked_expires_at`. `blockedRunExpiryJob` continues to drain any legacy rows that still have `blocked_expires_at` set (created before the flag flip); once those have all transitioned to terminal states (typically within hours, since blocks expire after 1h), the existing sweep finds zero candidates per cycle and is harmlessly a no-op until removed by the follow-up cleanup PR (§17). Likewise no workflow-step-level expiry job exists today, so this is the first sweep that closes that gap.

---

## 6. New Jobs

### 6.1 `agent-run-resume-from-waitpoint`

**File:** `server/jobs/agentRunResumeFromWaitpointJob.ts`

Handles OAuth kind resume (replaces route-level direct state update after migration).

**Payload:**
```typescript
{ runId: string; organisationId: string; subaccountId: string; }
```

**Handler:** reads `agent_runs` row → verifies resumable state → calls `resumeAgentRun` (`server/services/agentExecutionService/resume.ts`) → hands off to `runAgenticLoop`.

**jobConfig entry:**
```typescript
'agent-run-resume-from-waitpoint': {
  retryLimit: 2,
  expireInSeconds: 300,
  deadLetter: 'agent-run-resume-from-waitpoint__dlq',
}
```

**Idempotency:** `singletonKey: runId` — pg-boss `ON CONFLICT DO NOTHING` prevents duplicate resume jobs for the same run.

### 6.2 `waitpoint-expiry-sweep`

**File:** `server/jobs/waitpointExpirySweepJob.ts`

Scheduled maintenance job calling `waitpointService.expireWaitpoints()`.

- Cadence: every 5 minutes (matching `blockedRunExpiryJob` cadence).
- `singletonKey: 'waitpoint-expiry-sweep'` — prevents overlapping runs.
- Registered at boot alongside other maintenance jobs.

---

## 7. Call-Site Migrations

### 7.1 Feature flag

`WAITPOINT_PRIMITIVE_ENABLED` env var (`'true' | 'false'`), default `'false'`.

- `false`: all existing code paths execute unchanged.
- `true`: both call sites use `waitpointService`; old paths are bypassed but remain until follow-up cleanup PR.
- Removed in the cleanup PR after production confirms both sites work.

### 7.2 OAuth path — `agentExecutionLoop.ts` (create) and `agentResumeService.ts` (complete)

**Create side — `server/services/agentExecutionLoop.ts`** (where `blockedReason: 'integration_required'` is set, around lines 866-906 inside the `if (blockDecision.shouldBlock)` branch):

*Before:* calls `checkRequiredIntegration` (from `integrationBlockService`), which returns `{shouldBlock, plaintext, tokenHash, expiresAt, integrationDedupKey, card, integrationId}`. The loop persists `tokenHash` in `agent_runs.integration_resume_token`, `expiresAt` in `agent_runs.blocked_expires_at`, `integrationDedupKey` in `agent_runs.integration_dedup_key`, and composes the integration card (with `plaintext` as `resumeToken`, `expiresAt` as the card's display expiry) into `agent_messages.meta`.

*After (`WAITPOINT_PRIMITIVE_ENABLED=true`):*

1. Still calls `checkRequiredIntegration` for the metadata it needs — `{integrationId, integrationDedupKey, card}` — and persists `integrationDedupKey` in `agent_runs.integration_dedup_key` (the dedup column is double-block protection metadata, unrelated to the resume token; it stays).
2. Ignores `checkRequiredIntegration`'s `{plaintext, tokenHash, expiresAt}` outputs.
3. Calls `waitpointService.createWaitpoint({ kind: 'oauth', organisationId, subaccountId, boundRunId: runId, expiresInSeconds: 3600, resumeQueue: 'agent-run-resume-from-waitpoint', resumePayload: { runId, organisationId, subaccountId } })` and uses the returned `{plaintext, expiresAt}` to compose the card content (`resumeToken: plaintext`, card's `expiresAt: waitpoint.expiresAt.toISOString()`). The waitpoint's 1h expiry replaces the prior 24h `blockDecision.expiresAt`.
4. Sets `agent_runs.blocked_reason = 'integration_required'` (status discriminator stays — UI reads it to render the blocked surface) and `agent_runs.integration_dedup_key` (as above). Does NOT write `agent_runs.integration_resume_token` or `agent_runs.blocked_expires_at` — those columns become dead with the flag on, awaiting the follow-up cleanup PR (§17).
5. Persists the composed card in `agent_messages.meta` (existing tenant-scoped, RLS-protected persistence site — unchanged from current behaviour).

**Complete side — `server/services/agentResumeService.ts`** (called from route `POST /api/agent-runs/resume-from-integration` in `server/routes/agentRuns.ts` and from OAuth callbacks in `server/routes/oauthIntegrations.ts`):

*Before:* `resumeFromIntegrationConnect` directly updates `agent_runs` and returns synchronously. Run re-execution triggered by the route response path.

*After:* `resumeFromIntegrationConnect` delegates to `waitpointService.completeWaitpoint({ plaintext: resumeToken, organisationId })`. Run re-execution happens asynchronously via the enqueued `agent-run-resume-from-waitpoint` job. The synchronous `enqueueResumeAfterOAuth` path (existing C-P0-2 GHL callback at `oauthIntegrations.ts:443`) is left in place; the OAuth callback chooses based on `WAITPOINT_PRIMITIVE_ENABLED` — when off, current behaviour; when on, the waitpoint path subsumes it.

**Error mapping (unchanged):**
- `already_completed` → HTTP 200 (matches current `already_resumed`)
- Expired/not found → HTTP 410 `errorCode: 'RESUME_TOKEN_EXPIRED'`

### 7.3 Approval path — `dispatch.ts` (create) and `reviewService.ts` (complete)

**Create side — `server/services/workflowEngine/queueLifecycle/dispatch.ts`** (when `result.status === 'pending_approval'`, around line 556):

*Before:* sets `workflowStepRuns.status = 'awaiting_approval'`, emits `Workflow:step:awaiting_approval`.

*After:* additionally calls `waitpointService.createWaitpoint({ kind: 'approval', organisationId, subaccountId, boundRunId: undefined, expiresInSeconds: 86400, resumeQueue: null, resumePayload: { workflowRunId: run.id, workflowStepRunId: sr.id, approvedActionId: result.actionId, organisationId, subaccountId, agentId } })`. **Important — binding contract for approval waitpoints:** `dispatch.ts`'s `run.id` is the `workflow_runs.id` (workflow run id), NOT an `agent_runs.id` — `waitpoints.bound_run_id` FKs to `agent_runs.id` and cannot be set from `run.id`. The action row's `agentRunId` is also not in scope at this call site (`executeActionCall` returns only `{status, actionId}`). The approval waitpoint therefore intentionally OMITS `boundRunId` and carries the durable link to the affected workflow step run via `resumePayload.workflowStepRunId` (`sr.id` is the workflow step run id, in scope at this call site since the same code immediately updates `workflowStepRuns SET status='awaiting_approval' WHERE id = sr.id`). `resumePayload.approvedActionId` carries the action link for the resume consumer; `workflowStepRunId` is what §5.3's cleanup sweep uses to fail the step on timeout. **`resumeQueue` is NULL for `kind='approval'` — the approval flow does NOT enqueue a pg-boss job on completion (Path B, §5.2), so storing a queue name there would be misleading.** The schema column is nullable for this reason (see §4.1). The `waitpoint.created`/`waitpoint.completed`/`waitpoint.expired` events for approval waitpoints emit to **structured log only** (per §9 — approval waitpoints have `bound_run_id = NULL` and therefore have no live-execution-log binding). Telemetry-payload key fields for approval: `actionId`, `stepRunId`, `workflowRunId` (no `runId`). After completion, `reviewService.approveItem` continues the existing inline `resumeActionCallAfterApproval` path (the workflow-engine HITL resume is synchronous — see Path B decision in §5.2). No pg-boss queue is dispatched by the approval `completeWaitpoint` call. **Persistence — stores the returned waitpoint `id` (= `tokenHash`) in `actions.metadataJson.waitpointId`. Plaintext is NOT persisted for approval waitpoints** (see §5.2 "Why two input shapes" — the approval flow is fully internal and stores the id; the plaintext is discarded after create-side telemetry). Still sets `awaiting_approval` status and emits existing events (unchanged).

For `kind: 'approval'` waitpoints, `resumePayload.approvedActionId` AND `resumePayload.workflowStepRunId` are REQUIRED (enforced by the pure validator per §5.1). `workflow-resume` is not dispatched by approval waitpoints in V1 (Path B, §8.4); the payload fields are stored on the waitpoint row purely so the §5.3 expiry sweep can fail the step run on timeout without re-reading the action.

**Complete side — `server/services/reviewService.ts` (`approveItem`)** (inside the existing approval transaction, before `resumeActionCallAfterApproval` runs):

*Important — the spec's earlier draft pointed at `server/routes/reviewItems.ts` and `queueService.enqueueWorkflowResume`. That queue (`workflow-resume`) is the LEGACY `flowRuns` resume path; the current workflow-engine HITL approval resume runs INLINE inside `reviewService.approveItem` via `resumeActionCallAfterApproval`. The waitpoint primitive does not async-ify that inline path in V1.*

*Before:* `reviewService.approveItem` opens a transaction, runs the optimistic-predicate-guarded UPDATE on the review item, transitions the action to `approved`, calls `resumeActionCallAfterApproval` (for workflow-action-call source) or `executionLayerService.executeAction` (default), and finally writes a durable `actionResumeEvents` row. No waitpoint awareness.

*After (`WAITPOINT_PRIMITIVE_ENABLED=true`):* inside `approveItem`'s existing transaction, BEFORE the action-transition write, read `waitpointId` from `actions.metadataJson.waitpointId` (set at create time per §7.3 above — internal id, NOT plaintext, see §5.2) and call `waitpointService.completeWaitpoint({ waitpointId, organisationId, tx })` (the call uses the same `tx` handle for atomicity — see implementation note below). For `kind='approval'`, `completeWaitpoint` UPDATEs the waitpoint row to `completed` and DOES NOT enqueue any pg-boss job (see §5.2). The existing inline path (`resumeActionCallAfterApproval` → engine tick) continues to drive the action transition and workflow-engine resume — unchanged. The waitpoint row's terminal state commits atomically with the action approval; if approval rolls back, so does the waitpoint completion.

**Implementation note — passing tx to completeWaitpoint.** `completeWaitpoint`'s V1 signature opens its own `getOrgScopedDb` transaction. For the approval path, the implementer extends the signature to accept an optional `tx` parameter (same shape `sendWithTx` already takes — `{ execute: (q) => Promise<unknown> }`) so the approval completion runs inside the caller's existing transaction. If `tx` is omitted, `completeWaitpoint` continues to open its own — preserving the OAuth path's behaviour. The OAuth call site does NOT pass `tx` and the existing semantics stand.

**`reviewItems.ts` is no longer modified.** With Path B, the route-level `queueService.enqueueWorkflowResume` call (line 167) is for the legacy `flowRuns` path only and is left untouched. The approval waitpoint integration is service-layer.

---

## 8. Contracts

### 8.1 `createWaitpoint` result

```typescript
{
  id: string;        // sha256(plaintext) — the waitpoint row's PRIMARY KEY. Safe to persist for any kind.
  plaintext: string; // 64-char hex, 32 random bytes. Persist for kind='oauth' only; discard for other kinds.
  expiresAt: Date;   // Hard expiry — caller persists alongside id/plaintext for UI display.
}
```

**Persistence rule by kind.**
- `kind='oauth'`: persist `plaintext` in `agent_messages.meta` (RLS-protected, tenant-scoped). The user receives the plaintext via the integration card and presents it back on the OAuth callback; the server has only the hash.
- `kind='approval'`: persist `id` (= `tokenHash`) in `actions.metadataJson.waitpointId` and DISCARD `plaintext`. The producer (`dispatch.ts`) and consumer (`reviewService.approveItem`) are both internal; the consumer calls `completeWaitpoint({ waitpointId, ... })` directly.
- `kind='external_event'`: same posture as `approval` — persist `id`, discard `plaintext`.

For all kinds, caller MUST NOT log `plaintext`, emit it on the execution log, or include it in any structured event payload. `expiresAt` is not secret. **Rationale for kind-split persistence:** plaintext stored long-term in `actions.metadataJson` would be a never-presented internal secret (the consumer is server-side and already has org context). Persisting `id` instead avoids the long-lived secret without changing observable behaviour.

Producer: `waitpointService.createWaitpoint`
Consumer: execution loop (OAuth kind), `dispatch.ts` (approval kind)

### 8.2 `waitpoints` row shape (public contract)

```typescript
{
  id: string;                // sha256(plaintext) — 64-char hex
  kind: 'oauth' | 'approval' | 'external_event';
  organisationId: string;
  subaccountId: string | null;
  boundRunId: string | null;
  expiresAt: Date;
  status: 'pending' | 'completed' | 'expired';
  resumeQueue: string | null;   // non-null for kind='oauth', null for kind='approval'; see §4.1 CHECK constraints
  resumePayload: Record<string, unknown>;
  createdAt: Date;
  completedAt: Date | null;
}
```

Producer: `waitpointService.createWaitpoint`
Consumer: `completeWaitpoint`, `expireWaitpoints`, telemetry emitters

### 8.3 `agent-run-resume-from-waitpoint` job payload

```typescript
{ runId: string; organisationId: string; subaccountId: string; }
```

Producer: `waitpointService.completeWaitpoint` (via `sendWithTx`)
Consumer: `server/jobs/agentRunResumeFromWaitpointJob.ts`

### 8.4 `workflow-resume` job payload (legacy queue — NOT dispatched by approval waitpoints in V1)

```typescript
{
  workflowRunId: string; approvedActionId?: string;
  organisationId: string; subaccountId: string; agentId: string; agentRunId?: string;
}
```

Producer (today): `queueService.enqueueWorkflowResume` from `server/routes/reviewItems.ts:168`. This is the LEGACY `flowRuns` resume path (handled via `resumeFlow` in `enqueueHelpers.ts:91`). It is NOT used by the workflow-engine HITL approval path.
Consumer: existing `workflow-resume` handler (`resumeFlow`), unchanged.

**Path B clarification.** Under Path B (§5.2), approval `completeWaitpoint` does NOT dispatch any pg-boss queue — approval resume runs inline via `resumeActionCallAfterApproval` inside the caller's transaction. The approval waitpoint row therefore carries `resume_queue = NULL` (enforced by CHECK constraint, §4.1), making the "no queue on this kind" stance explicit at the schema level rather than relying on a misleading-but-ignored stored value. A future build (OPLB-SR-IT4-D1 in `tasks/todo.md`) to async-ify approval resume will (a) introduce a new queue (not `workflow-resume`) and (b) relax the CHECK constraint so approval waitpoints can carry a queue name from that build onward. The legacy `workflow-resume` queue continues to be dispatched by `reviewItems.ts` for `flowRuns` actions — untouched by this spec.

**Waitpoint-layer narrowing for approval kind.** For `kind: 'approval'` waitpoints, `resumePayload.approvedActionId` AND `resumePayload.workflowStepRunId` are REQUIRED. `workflowStepRunId` is carried so the §5.3 expiry sweep can fail the step run on timeout without re-reading the action row.

**Source-of-truth precedence:** the pair (`waitpoints.status`, `waitpoints.expires_at`) is authoritative for whether a pause has been resolved. A row with `status='pending' AND expires_at < now()` is effectively expired even before the 5-minute sweep marks it (`completeWaitpoint`'s predicate already enforces this). `agent_runs.blocked_reason` and `workflow_step_runs.status` reflect downstream effects; they do not supersede the waitpoint authority pair.

---

## 9. Telemetry

**Two emission targets — chosen per row by whether `bound_run_id` is set:**
- **Live execution log + structured log** when `bound_run_id IS NOT NULL` (only `kind='oauth'` in V1) — the run is the bind target and the live execution log surfaces the waitpoint lifecycle to the in-flight run.
- **Structured log ONLY** when `bound_run_id IS NULL` (`kind='approval'` and `kind='external_event'` in V1) — there is no agent run to bind the live execution log to. The structured log carries `actionId`, `stepRunId`, and `workflowRunId` for approval; bare `waitpointId` for `external_event`.

| Event | When | Key fields | Live execution log? |
|---|---|---|---|
| `waitpoint.created` | After `createWaitpoint` insert | `kind`, `waitpointId` (8-char hash prefix), `expiresAt`, `resumeQueue` (nullable per §4.1), plus `runId` (oauth) OR `actionId` + `stepRunId` + `workflowRunId` (approval) | Yes iff `bound_run_id IS NOT NULL` |
| `waitpoint.completed` | After `completeWaitpoint` tx commits | `kind`, `waitpointId` (hash prefix), `completedAt`, plus the same per-kind identifiers as `waitpoint.created` | Yes iff `bound_run_id IS NOT NULL` |
| `waitpoint.expired` | In `expireWaitpoints` sweep | `kind`, `waitpointId` (hash prefix), plus the same per-kind identifiers as `waitpoint.created` | Yes iff `bound_run_id IS NOT NULL` and the run still exists |
| `waitpoint.expired_no_run` | In `expireWaitpoints`, `kind='oauth'` waitpoint whose `bound_run_id` references a deleted run | `kind`, `waitpointId` | Structured log only — the bind target is gone |
| `waitpoint.expired_no_step` | In `expireWaitpoints`, `kind='approval'` waitpoint whose `workflowStepRunId` is missing / already terminal / cross-org | `kind`, `waitpointId`, `stepRunId` (if present) | Structured log only — there was never a bound run |

**V1 explicit statement.** Approval waitpoint events DO NOT emit to the live execution log in V1 (`bound_run_id IS NULL` for `kind='approval'` per §3 framing). They emit to the structured log only. The "all events emit to live execution log" wording in earlier drafts was wrong and contradicted §7.3's `actionId/stepRunId` payload shape — this table is the source of truth.

---

## 10. State Machine

| From | To | Trigger |
|---|---|---|
| `pending` | `completed` | `completeWaitpoint` — valid token, not expired |
| `pending` | `expired` | `expireWaitpoints` sweep — `expires_at < now()` |
| `completed` | — | Terminal |
| `expired` | — | Terminal |

Forbidden: `completed → expired`, `expired → completed`.

Status set is **closed** — new values require a spec amendment + CHECK constraint migration.

---

## 11. Execution Model

| Operation | Model | Notes |
|---|---|---|
| `createWaitpoint` | Inline / synchronous | Returns plaintext + expiresAt to caller immediately |
| `completeWaitpoint` (oauth) | Inline / synchronous | Opens own `getOrgScopedDb` tx; enqueues `agent-run-resume-from-waitpoint` transactionally via `sendWithTx` |
| `completeWaitpoint` (approval) | Inline / synchronous | Runs inside the caller's transaction (`reviewService.approveItem`'s tx); marks waitpoint completed; does NOT enqueue any pg-boss job (existing inline `resumeActionCallAfterApproval` continues to drive resume — Path B, §5.2) |
| `expireWaitpoints` | Queued / async (pg-boss) | `waitpoint-expiry-sweep` job, every 5 min |
| `agent-run-resume-from-waitpoint` | Queued / async (pg-boss) | Triggered by `completeWaitpoint` for oauth kind |
| `workflow-run-tick` | Queued / async (pg-boss) | Triggered by `expireWaitpoints` for expired approval waitpoints (matches `failStepRunInternal`'s tick enqueue; existing engine queue) |

No inline operation has a pg-boss job row. No queued operation is described as synchronous. The legacy `workflow-resume` queue (`flowRuns` path) is NOT in this table — the waitpoint primitive does not dispatch it.

---

## 12. Permissions / RLS Checklist

- [x] RLS policy in `<NNNN>_waitpoints_primitive.sql` (placeholder per §4.1; claim at merge time): `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY; CREATE POLICY waitpoints_org ON waitpoints USING (organisation_id = current_setting('app.organisation_id')::uuid)`.
- [x] Entry in `server/config/rlsProtectedTables.ts`: `{ tableName: 'waitpoints', schemaFile: 'waitpoints.ts', policyMigration: '<NNNN>_waitpoints_primitive.sql', rationale: 'Pause/resume token hashes must not cross org boundaries.' }`. (Placeholder per §4.1 — claim the real migration number at merge time.)
- [x] Route guard (OAuth path): `completeWaitpoint` is invoked from `POST /api/agent-runs/resume-from-integration` in `server/routes/agentRuns.ts` under `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT)` — unchanged from the current route guard.
- [x] Route guard (approval path): `completeWaitpoint` is invoked from `reviewService.approveItem` (called by `POST /api/review-items/:id/approve` in `server/routes/reviewItems.ts`) under `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.REVIEW_APPROVE)` — unchanged from the current route guard; the waitpoint call happens inside the service's existing tx, not at the route layer.
- [x] `expireWaitpoints` uses `withAdminConnection` + `SET LOCAL ROLE admin_role` (maintenance job, crosses org boundaries — same two-part pattern as `blockedRunExpiryJob.runFn`).
- [x] `createWaitpoint` and `completeWaitpoint` MUST use `getOrgScopedDb`. `withAdminConnection` is forbidden for these two methods.
- [x] RLS enforces the organisation boundary; subaccount filtering is service-layer.

---

## 13. File Inventory

### New files — 9

| File | Purpose |
|---|---|
| `server/db/schema/waitpoints.ts` | Drizzle schema for `waitpoints` table |
| `server/services/waitpointService.ts` | `createWaitpoint`, `completeWaitpoint`, `expireWaitpoints` (DB-bound surface) |
| `server/services/waitpointServicePure.ts` | Pure helpers: `generateWaitpointPlaintext()` (wraps `crypto.randomBytes`); `validateCreateWaitpointParams(params)` (throws VALIDATION_FAILED when `kind='oauth'` is missing `boundRunId` OR has null `resumeQueue`; when `kind='approval'` has non-null `resumeQueue`; when `kind='approval'` is missing `resumePayload.approvedActionId` or `resumePayload.workflowStepRunId`); `isCompletableWaitpointRow(row, now)` (predicate on `status === 'pending' AND expires_at > now`). Re-exports `deriveTokenHash` from `server/services/agentResumeService.ts` for consumers (no new sha256 implementation). No DB I/O, no telemetry, no pg-boss calls. |
| `server/services/__tests__/waitpointServicePure.test.ts` | Unit tests for the three pure exports above per the `*Pure.ts` + `*.test.ts` convention |
| `server/services/workflowEngine/stepLifecyclePure.ts` | Extracted pure helper `buildFailStepRunColumnSet(reason, currentVersion, now)` consumed by BOTH `stepLifecycle.failStepRunInternal` AND `waitpointService.expireWaitpoints` (approval-kind cleanup) — closes the column-drift class per §5.3 F5 fix. |
| `server/services/workflowEngine/__tests__/stepLifecyclePure.test.ts` | Column-parity test asserting `buildFailStepRunColumnSet` returns the exact column-name set `failStepRunInternal` writes. |
| `server/jobs/agentRunResumeFromWaitpointJob.ts` | pg-boss handler for `agent-run-resume-from-waitpoint` |
| `server/jobs/waitpointExpirySweepJob.ts` | pg-boss handler for `waitpoint-expiry-sweep` |
| `migrations/<NNNN>_waitpoints_primitive.sql` | Table + indexes + CHECK constraints (incl. `kind <> 'oauth' OR bound_run_id IS NOT NULL`, queue-by-kind constraints — §4.1) + RLS policy. Migration number is a placeholder per §4.1 — claim at merge time. |

### Modified files — 13

| File | Change |
|---|---|
| `server/db/schema/index.ts` | Export `waitpoints` schema |
| `server/config/rlsProtectedTables.ts` | Add `waitpoints` entry |
| `server/config/jobConfig.ts` | Add `agent-run-resume-from-waitpoint` + `waitpoint-expiry-sweep` configs |
| `server/services/agentExecutionLoop.ts` | OAuth CREATE side gated by `WAITPOINT_PRIMITIVE_ENABLED` (around lines 856 / 883 / 902 where `blockedReason: 'integration_required'` is set) |
| `server/services/agentResumeService.ts` | OAuth COMPLETE side: `resumeFromIntegrationConnect` delegates to `waitpointService.completeWaitpoint` when `WAITPOINT_PRIMITIVE_ENABLED=true` |
| `server/services/workflowEngine/stepLifecycle.ts` | `failStepRunInternal` refactored to consume `buildFailStepRunColumnSet` from the new `stepLifecyclePure.ts` — same column writes, source-of-truth shared with `expireWaitpoints` per §5.3 F5 fix. |
| `server/services/workflowEngine/queueLifecycle/dispatch.ts` | Approval CREATE side gated by `WAITPOINT_PRIMITIVE_ENABLED` |
| `server/services/reviewService.ts` | Approval COMPLETE side: `approveItem` calls `waitpointService.completeWaitpoint(plaintext, organisationId, tx)` inside its existing transaction when flag is on. The route-level `queueService.enqueueWorkflowResume` in `reviewItems.ts` is unchanged (that's the legacy `flowRuns` path, not the workflow-engine approval path the waitpoint integrates with). |
| `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts` | Register handlers for `agent-run-resume-from-waitpoint` and `waitpoint-expiry-sweep` (handler-registration convention; replaces the spec's earlier incorrect reference to a non-existent `server/jobs/index.ts`) |
| `server/lib/__tests__/jobPayloadFixtures.ts` | Add fixtures for 2 new job types |
| `docs/env-manifest.json` | Add `WAITPOINT_PRIMITIVE_ENABLED` |
| `architecture.md` | Add waitpoint primitive section |
| `KNOWLEDGE.md` | Add Trigger.dev evaluation entry |

Total: 1 new table, 1 migration, 2 new job types, 9 new files, 13 modified files.

---

## 14. Chunk Sequencing

Single-phase build. 7 chunks. No backward dependencies.

| Chunk | Description | Depends on |
|---|---|---|
| 1 | `waitpoints` schema + migration `0378` + RLS + manifest entry + `WAITPOINT_PRIMITIVE_ENABLED` env var declaration in `server/lib/env.ts` + `docs/env-manifest.json` entry | — |
| 2 | `waitpointService` + `waitpointServicePure` (all 3 service methods including `completeWaitpoint` dual input shape per §5.2 — plaintext vs waitpointId — and the optional `tx?` param) + pure unit tests. Extract `stepLifecyclePure.buildFailStepRunColumnSet` and refactor `stepLifecycle.failStepRunInternal` to consume it (per §5.3 F5 fix). Add `stepLifecyclePure.test.ts` column-parity test. | Chunk 1 |
| 3 | `agent-run-resume-from-waitpoint` job + jobConfig entry + handler registration in `pgBossRegistrations.ts` + payload fixture | Chunk 2 |
| 4 | `waitpoint-expiry-sweep` job + jobConfig entry + handler registration in `pgBossRegistrations.ts` | Chunk 2 |
| 5 | OAuth call-site migration (CREATE in `agentExecutionLoop.ts`, COMPLETE in `agentResumeService.ts`) gated by `WAITPOINT_PRIMITIVE_ENABLED` | Chunks 2, 3 |
| 6 | Approval call-site migration (CREATE in `dispatch.ts`, COMPLETE in `reviewService.approveItem`) gated by `WAITPOINT_PRIMITIVE_ENABLED`. Consumes `completeWaitpoint(params, tx)` (the optional `tx` param is part of the Chunk 2 service surface; this chunk only wires the call site). | Chunk 2 |
| 7 | `architecture.md` + `KNOWLEDGE.md` doc updates (Trigger.dev evaluation + when-to-use guidance + approval Path B design note) | Chunks 5, 6 |

**Dependency verification:** Chunk 1 introduces the env var so Chunks 5 and 6 can read `process.env.WAITPOINT_PRIMITIVE_ENABLED` at call-site-gate time. Chunk 2 → Chunk 1 (schema). Chunks 3–4 → Chunk 2 (service). Chunk 5 → Chunks 2, 3 (service + OAuth resume job type). Chunk 6 → Chunk 2 (service; approval has no new queue — `reviewService.approveItem`'s existing inline path still drives resume). Chunk 7 → Chunks 5, 6 (both call-site migrations complete so docs can describe what shipped). No backward references. No orphaned deferrals. `docs/env-manifest.json` is listed in Chunk 1 only.

---

## 15. Execution-Safety Contracts

### 15.1 Idempotency

| Operation | Posture | Mechanism |
|---|---|---|
| `createWaitpoint` | key-based | `id` PRIMARY KEY — 23505 on duplicate (probabilistically impossible at 256-bit entropy) |
| `completeWaitpoint` | state-based | `UPDATE WHERE id=<resolved id> AND status='pending' AND expires_at > now()` (id resolves from `tokenHash` for plaintext path or `waitpointId` directly for internal path — see §5.2). On 0 rows updated, reads the row: `status='completed'` → returns `{ status: 'already_completed' }` (HTTP 200 idempotent hit); `status='expired'` or row missing → throws `RESUME_TOKEN_EXPIRED` (HTTP 410). |
| `expireWaitpoints` | state-based | `UPDATE WHERE status='pending' AND expires_at < now()`. Repeated runs safe. |
| `agent-run-resume-from-waitpoint` | key-based | `singletonKey: runId` prevents duplicate resume jobs for same run |

### 15.2 Retry Classification

| Operation | Classification |
|---|---|
| `createWaitpoint` | safe |
| `completeWaitpoint` | guarded — optimistic predicate |
| `expireWaitpoints` | safe |
| `agent-run-resume-from-waitpoint` | guarded — `singletonKey` + `retryLimit: 2` |

### 15.3 Concurrency Guard

Two callers race on `completeWaitpoint` with the same token. Both attempt `UPDATE WHERE status='pending'`. DB serialisation ensures exactly one UPDATE succeeds (1 row); the other gets 0 rows, reads `status='completed'`, returns `{ status: 'already_completed' }`. First-commit-wins; no `SELECT FOR UPDATE` needed.

### 15.4 Terminal Events

Two terminal events per waitpoint, mutually exclusive at the row level:
- `waitpoint.completed` — emitted at most once after the `completeWaitpoint` tx commits (best-effort, post-commit; if the process crashes between commit and emission the event is lost but the waitpoint row's `status='completed'` is durable).
- `waitpoint.expired` — emitted at most once per row in the `expireWaitpoints` sweep (same best-effort caveat).

The waitpoint row's terminal state is the source of truth. Telemetry events are observability, not control flow — downstream consumers (UI, dashboards) must read the row state and not rely on event delivery.

Post-terminal prohibition: `UPDATE WHERE status='pending'` predicate prevents any further state writes after terminal state is set.

### 15.5 No-Silent-Partial-Success

`expireWaitpoints` accumulates row count and returns it. Mid-batch DB failure throws — job handler retries. No partial run emits `status: 'success'` with silent failures.

### 15.6 Unique-Constraint-to-HTTP Mapping

| Constraint | Violation | HTTP status |
|---|---|---|
| `waitpoints.id` PRIMARY KEY | Duplicate token (not possible in practice) | 500 — server error |

---

## 16. Testing Posture

Per `docs/spec-context.md`: `static_gates_primary`, `runtime_tests: pure_function_only`.

- `waitpointServicePure.test.ts` targets the three pure exports in `waitpointServicePure.ts`: `generateWaitpointPlaintext()` produces 64-char hex (32 random bytes); `validateCreateWaitpointParams(params)` throws `VALIDATION_FAILED` for `kind='oauth'` missing `boundRunId` OR with null `resumeQueue`; throws for `kind='approval'` with non-null `resumeQueue` (Path B violation); throws for `kind='approval'` missing `resumePayload.approvedActionId` or `resumePayload.workflowStepRunId`; is a no-op for `kind='external_event'`; `isCompletableWaitpointRow(row, now)` returns true iff `status==='pending' && expires_at > now`. `deriveTokenHash` is reused from `agentResumeService.ts` (per §3) — already covered by that service's existing usage and is not re-tested here. The impure `waitpointService.ts` (DB I/O, telemetry, `sendWithTx`) is exercised indirectly through these pure helpers; no separate DB-mocked test file is added in V1.
- `stepLifecyclePure.test.ts` (new this build per §5.3 F5 fix) asserts `buildFailStepRunColumnSet(reason, currentVersion, now)` returns exactly the column-name set written by `failStepRunInternal` — pinned to the live shape so adding a column to `failStepRunInternal` without updating the helper fails CI.
- No API contract tests, no E2E tests, no frontend tests.
- CI static gates:
  - `verify-rls-coverage.sh` enforces the `waitpoints` manifest entry.
  - `verify-rls-contract-compliance.sh` enforces the per-method split: `createWaitpoint` and `completeWaitpoint` use `getOrgScopedDb`; `expireWaitpoints` uses `withAdminConnection` annotated with the existing maintenance-job comment convention `// guard-ignore-next-line: with-org-tx-or-scoped-db reason="cross-tenant sweep"` (matching `blockedRunExpiryJob` and other admin-scoped sweeps).
- **Implementation invariants the gates do NOT enforce but the implementer MUST uphold** (these are convention-level, not static-checkable in V1):
  - Inside `expireWaitpoints`'s `withAdminConnection` block, the FIRST statement is `SET LOCAL ROLE admin_role` (the existing two-part pattern from `blockedRunExpiryJob.runFn` line 51 / `approvalExpiryJob.runFn` line 42).
  - Every downstream `SELECT` and `UPDATE` issued inside the admin-role block carries an explicit `AND organisation_id = wp.organisation_id` (or the equivalent join-through predicate for `workflow_step_runs` via `workflow_runs.organisation_id`) so the boundary the waitpoint row would enforce under RLS is preserved by the SQL even with RLS off.

---

## 17. Deferred Items

- **Pre-merge prompt-eval suite.** Separate Standard build. Trigger: model upgrade or skill change silently regresses a production skill found by a client. Decision doc: `docs/oss-pattern-lifts-bundle-brief.md §3`.
- **Composio evaluation.** Deferred to product-pull on Linear / Asana / Intercom / Zendesk / Shopify. Decision rules: `docs/oss-pattern-lifts-bundle-brief.md §4`.
- **Waitpoint retention and archival.** V2 — no retention policy in V1; rows accumulate. Add sweep when storage becomes a concern.
- **Old code path removal.** Follow-up cleanup PR removes `agent_runs.integration_resume_token`, `agent_runs.blocked_expires_at`, `server/jobs/blockedRunExpiryJob.ts`, and the `WAITPOINT_PRIMITIVE_ENABLED` flag once production confirms both sites work. `agentResumeService.resumeFromIntegrationConnect` is **simplified, not necessarily removed** — §7.2's "After" wiring keeps the route in `agentRuns.ts` delegating to `resumeFromIntegrationConnect`, which under the flag-on path is itself a thin facade that calls `waitpointService.completeWaitpoint`. The cleanup PR collapses that facade to its waitpoint-only body (drops the flag-off branch) but the entry-point function may remain as a stable service-layer name so routes don't need rewiring. Whichever shape (remove vs simplify) lands at cleanup time is implementer's choice based on the call-site count at that moment. `agent_runs.blocked_reason` is KEPT in this cleanup PR — §7.2 still writes it as the UI discriminator for the blocked-state surface; removing it would break the UI. Designing a replacement discriminator (or repurposing `runMetadata`) is out of scope for both this build and the follow-up cleanup; that work is a separate spec.
- **`external_event` kind.** Defined in schema and CHECK constraint. Not wired to any caller in V1. Future patterns use by calling `createWaitpoint({ kind: 'external_event', ... })`.

---

## 18. Self-Consistency Pass

- **Goals ↔ Implementation:** Goals §1 covers primitive + migrations + telemetry + docs. Chunks 1–7 implement each item. ✓
- **Load-bearing claims verified (per-kind under Path B):**
  - "Hard cut-off on expiry" — backed by `WHERE expires_at > now()` in `completeWaitpoint` (§5.2). ✓
  - "Idempotent second call" — backed by `UPDATE WHERE status='pending'` (§15.1). ✓
  - "OAuth completion atomicity" — backed by `sendWithTx` enqueuing `agent-run-resume-from-waitpoint` inside `completeWaitpoint`'s own tx (§5.2 oauth branch). ✓
  - "Approval completion atomicity" — backed by `completeWaitpoint(params, tx)` running inside `reviewService.approveItem`'s existing transaction (§5.2 approval branch, §7.3 complete side, Path B). ✓
  - "Per-kind resume behaviour" — OAuth uses queued resume (`agent-run-resume-from-waitpoint`); approval uses the existing inline `resumeActionCallAfterApproval` path (no new queue) (§5.2, §11). ✓
- **Numeric counts:** 1 new table, 1 migration, 2 new job types, 9 new files, 13 modified files. Reconciled with §13. ✓
- **Execution model consistency:** Inline ops have no pg-boss rows. Queued ops are not described as synchronous. The legacy `workflow-resume` queue is explicitly NOT dispatched by waitpoints (§8.4, §11). ✓
- **Phase sequencing:** dependency graph verified in §14. No backward references — the `completeWaitpoint(tx?)` overload lives in Chunk 2 alongside the rest of the service; Chunk 6 only consumes it. ✓

---

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | S | Equivalent OSS (Trigger.dev) exists but adopting it costs more than this build |
| Build | M | New table + service + 2 job types + 2 call-site migrations; moderate complexity |
| Carry | S | Maintenance sweep + expiry job; no LLM inference; low ongoing cost |
| decommission | M | Removing the primitive requires migrating all future call sites back to hand-rolled patterns |
