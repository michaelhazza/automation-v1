# Dual Review Log — agents-as-employees

**Files reviewed:** branch `feat/agents-are-employees` uncommitted changes — phases A through C
- `server/services/workspace/workspaceEmailPipeline.ts`
- `server/routes/workspaceMail.ts`
- `server/routes/workspaceCalendar.ts`
- `server/routes/workspaceInboundWebhook.ts`
- `server/routes/workspace.ts`
- `server/adapters/workspace/nativeWorkspaceAdapter.ts`
- `server/adapters/workspace/googleWorkspaceAdapter.ts`
- `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts`
- `server/services/workspace/workspaceOnboardingService.ts`
- `server/index.ts`
- `client/src/pages/AgentMailboxPage.tsx`
- `migrations/0258_workspace_message_actor_id_invariant.sql`

**Iterations run:** 2/3 (terminated early — iteration 2 raised one finding; all rejected → break)
**Timestamp:** 2026-04-29T20:42:05Z
**Codex CLI version:** v0.125.0 (research preview), model gpt-5.5
**Commit at finish:** _filled in after auto-commit step below_

---

## Iteration 1

### Codex findings — 2 (both P2)

**[ACCEPT] `server/services/workspace/workspaceEmailPipeline.ts:247` — dedupe lookup runs in aborted transaction**
  Reason: Real, valid bug. `getOrgScopedDb()` returns the active ALS-bound transaction. The inbound webhook wraps `ingest()` inside `db.transaction(...)`, so the audit-row INSERT, message INSERT, and recovery SELECT all share one PG transaction. When the message INSERT raises `23505` (duplicate dedupe key), Postgres marks the transaction aborted; the subsequent recovery SELECT fails with `current transaction is aborted, commands ignored until end of transaction block` instead of returning `{ deduplicated: true }`. Result: every duplicate webhook delivery 500s and triggers provider retry instead of resolving cleanly. Fix: convert to a preflight dedupe SELECT *before* the audit/message inserts; on a true race-induced 23505 (microsecond window), let it bubble — provider retries, preflight catches it on retry. Also moves the audit row INSERT below the preflight so duplicate deliveries don't write stranded `email.received` audit rows.

**[ACCEPT] `server/routes/workspaceMail.ts:131-141` — body normalisation breaks `SendEmailParams` contract**
  Reason: Real bug. The spec (§12 contract `SendEmailParams`) and plan (line 2437 `body: SendEmailParams`) require `toAddresses: string[]`. The previous route accepted `Omit<SendEmailParams, 'fromIdentityId'>` directly. The current normalisation reads only `body.to`, discarding any `toAddresses`-shaped payload. Agent skill handlers and any caller using the spec contract get an empty recipient list. Fix: restore the `Omit<SendEmailParams, 'fromIdentityId'>` shape on the route, default `policyContext` if missing (the only reason normalisation was introduced), and update the frontend Compose modal to send `toAddresses: string[]` to match the contract.

### Decisions

```
[ACCEPT] server/services/workspace/workspaceEmailPipeline.ts:247 — dedupe lookup in aborted tx
  Reason: Confirmed via Read of orgScopedDb.ts (returns ALS-bound tx) and the inbound webhook
  caller (wraps ingest in db.transaction). Aborted-tx semantics make the recovery SELECT
  unreachable. Restructure to preflight + let race-bubble.

[ACCEPT] server/routes/workspaceMail.ts:131-141 — toAddresses contract regression
  Reason: Confirmed via spec §12 SendEmailParams contract (toAddresses is canonical) and
  plan §B10 (body: SendEmailParams). Only the frontend currently sends `to` — that's the
  bug to fix. Restore route to Omit<SendEmailParams, 'fromIdentityId'> with a policyContext
  default, fix frontend to send toAddresses.
```

---

## Iteration 2

### Codex findings — 1 (P1)

**[REJECT] `server/routes/workspace.ts:248-250` — local lifecycle transition committed before provider call**
  Reason: Codex recommends reversing the order — call provider first, then commit local state. This **contradicts the spec**, **contradicts DEVELOPMENT_GUIDELINES.md §8.10 (race-claim ordering)**, and would create a strictly worse failure mode.

  - **Spec §9.2 explicitly defines the ordering:**
    ```
    POST /api/agents/:agentId/identity/suspend
      ↓ workspaceIdentityService.transition('active' → 'suspended')   ← LOCAL FIRST
      ↓ adapter.suspendIdentity(...)                                   ← THEN PROVIDER
      ↓ audit_events: action='identity.suspended'
      ← 200 { status: 'suspended', seatFreedImmediately: true }
    ```
    Spec lines 825–832, repeated for `resume`, `revoke`, `archive`.

  - **DEVELOPMENT_GUIDELINES.md §8.10:** "Operations with both a state write and an external side effect persist the state-claim first, verify the claim succeeded, and only then trigger the side effect." The current ordering is exactly this rule.

  - **Spec contract `WorkspaceIdentityRow` source-of-truth precedence:** "the DB row is canonical. Adapter mirroring of canonical tables is one-way (adapter writes after external success). If a Google Admin SDK row reports `suspended` but our row says `active`, our row is wrong" (spec line 990). The local row is the canonical source of truth; the provider can drift.

  - **Drift is by design.** The spec defers `workspaceIdentityReconciliationJob` (line 1075) precisely to detect and repair the post-fail drift Codex describes. This is a pre-launch system; reconciliation is a fast-follow.

  - **Reversing the order creates ghost-state.** If adapter call succeeds but the local UPDATE fails (network blip, lock contention), the Google account is suspended but local state shows it as active — operator UI gives no signal to retry, and the provider is in a state our system doesn't know about. Drift can be detected and self-healed by a reconciliation pass; ghost-state cannot.

  - **`seatFreedImmediately: true`** in the spec response (line 832) presumes the local commit happens first.

  Verdict: spec-aligned, guideline-aligned. Rejected as architectural disagreement, not a bug.

### Decisions

```
[REJECT] server/routes/workspace.ts:248-250 — local-then-provider ordering for lifecycle ops
  Reason: Spec §9.2 explicitly mandates this ordering. DEVELOPMENT_GUIDELINES §8.10 (race-
  claim ordering) requires state-first then side-effect. Spec's WorkspaceIdentityRow contract
  treats the local row as source-of-truth with deferred reconciliation. Reversing would
  create ghost-state which is strictly worse than recoverable drift.
```

### Termination

Iteration 2 accepted 0 findings. Per the dual-reviewer loop rule "If zero findings were accepted this iteration → break", terminating after iteration 2.

---

## Changes Made

- `server/services/workspace/workspaceEmailPipeline.ts` — added `and` import; restructured `ingest()` so dedupe lookup is a preflight SELECT BEFORE the audit/message inserts; removed try/catch around the message INSERT (race-induced 23505 now bubbles to the webhook handler so provider retries trigger the preflight on the next attempt). Audit row insert moved below the preflight so duplicate deliveries do not write stranded `email.received` audit rows.
- `server/routes/workspaceMail.ts` — restored `Omit<SendEmailParams, 'fromIdentityId'>` body shape per spec contract; added `policyContext` default of `{ skill: 'mailbox-ui', runId: undefined }` when caller omits it.
- `client/src/pages/AgentMailboxPage.tsx` — Compose modal now sends `toAddresses: string[]` (parsed from comma-separated `composeTo` input) instead of `to: string`, matching the route contract.

---

## Rejected Recommendations

- **Reverse lifecycle ordering (provider-then-local):** rejected — contradicts spec §9.2, contradicts DEVELOPMENT_GUIDELINES.md §8.10, contradicts spec's source-of-truth model for `WorkspaceIdentityRow`. The spec deliberately makes the local DB row canonical and defers reconciliation; reversing the order would create ghost-state which is strictly worse than the recoverable drift the current order produces.

---

**Verdict:** APPROVED (2 iterations, 2 P2 findings accepted and fixed, 1 P1 finding rejected as spec-conflicting)
