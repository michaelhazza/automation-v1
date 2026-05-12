# chatgpt-pr-review — operator-backend — 2026-05-12T21:39:23Z

## Session Info

- **Branch:** `claude/sandbox-execution-provider-DLfjn`
- **PR:** [#288](https://github.com/michaelhazza/automation-v1/pull/288)
- **Build slug:** `operator-backend`
- **Mode:** manual
- **Spec:** [`docs/superpowers/specs/2026-05-12-operator-backend-spec.md`](../../docs/superpowers/specs/2026-05-12-operator-backend-spec.md)
- **Phase 2 handoff:** [`tasks/builds/operator-backend/handoff.md`](../builds/operator-backend/handoff.md)
- **spec_deviations from handoff:** none recorded
- **Started:** 2026-05-12T21:39:23Z

## Round 1 — Setup

- Code-only diff: `.chatgpt-diffs/pr288-round1-code-diff.diff` — 880K, 158 files
- Full diff: `.chatgpt-diffs/pr288-round1-diff.diff` — 4.6M, 185 files (27 files of specs/plans/logs excluded from code-only)
- Awaiting operator paste of ChatGPT response.

## Round 1 — Findings

| ID | Severity | Triage | Recommendation | User Decision |
|----|----------|--------|----------------|---------------|
| F1 | blocker | technical | implement | auto (implement) |
| F2 | blocker | technical | implement | auto (implement) |
| F3 | high | technical | reject (verified doc-residue only — live code at `operatorManagedBackend.ts:467` correctly excludes `'delegated'`) | auto (reject) |
| F4 | medium | technical | implement | auto (implement) |
| F5 | medium | technical | implement | auto (implement) |

### F1 — refresh-credential route emits with blank connectionId + fire-and-forget audit (BLOCKER)

**Evidence:** `server/routes/operatorTasks.ts:376` — `emitUsabilityRestored({ connectionId: '', agentRunId })`; line 378 — `void auditService.log(...)`.

**Root cause:** the route was stubbed to emit the lifecycle event with no connectionId source and to fire the audit log without awaiting durability. Since `task.operator.credential_refreshed` audit events are a stickiness-clearing signal (spec §3.7 item 5), a non-durable audit can leave a chain-link believing fallback should still be sticky.

**Fix:** in the route, resolve the active operator_session integration_connection for the run's subaccount; pass its id as `connectionId`; await `auditService.log`; write the audit row BEFORE emitting the lifecycle event so the durable signal is in place when downstream consumers see the event.

**Files changed:** `server/routes/operatorTasks.ts`.

### F2 — adoptOrStart contradicts the unique sandbox_start_key model (BLOCKER)

**Evidence:** `server/services/sandboxExecutionServicePure.ts:258-279` returned `fresh_start` for terminal rows. Migration 0332 carries a unique partial index `(sandbox_start_key) WHERE sandbox_start_key IS NOT NULL`, so a fresh INSERT after a terminal row with the same key would violate the index.

**Root cause:** the pure decision was written before the unique index landed. The index binds a start_key to one row for the row's full lifecycle, but `decideAdoptOrStart` only treated live statuses as adoptable — terminal rows fell through to `fresh_start`, which tries to INSERT.

**Fix (ChatGPT option 1, preferred):** `decideAdoptOrStart` returns `adopt` whenever any row exists with a matching id (terminal or live); `conflict` whenever any row exists with a mismatched id; `fresh_start` only when no row exists. `runTask`'s Case 3 already handles terminal idempotent re-read.

**Files changed:** `server/services/sandboxExecutionServicePure.ts`, `server/services/sandboxExecutionService.ts` (comment), `server/services/__tests__/sandboxExecutionServiceAdoptOrStart.test.ts` (8 terminal tests now assert `adopt`; 1 mismatched-id terminal test now asserts `conflict`).

### F3 — dispatcher success predicate (HIGH) — REJECTED (verified clean)

**Investigation:**
- `grep -rn "status IN ('pending','delegated'" --include="*.ts" server/` → no matches.
- `server/services/executionBackends/operatorManagedBackend.ts:467` — the live dispatcher predicate is `status IN ('pending','paused_for_chain_continuation','paused_chain_failure','paused_budget_exceeded')`. `'delegated'` is correctly excluded.

ChatGPT's concern was based on a stale snippet in uploaded review materials. The live code is correct. No fix required.

### F4 — progress endpoint doc drift (MEDIUM)

**Evidence:** `architecture.md:3983` listed the progress route as `server/routes/operatorTaskProgress.ts — GET /api/operator-tasks/:agentRunId/progress`. The actual implementation is in `server/routes/operatorSessions.ts:31` at `GET /api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress`, matching the route the spec (§7.3 R2-F1 lock) and the client helper (`client/src/api/operatorBackendApi.ts:39`) both use.

**Fix:** updated architecture.md row to the correct file path and route.

**Files changed:** `architecture.md`.

### F5 — retry route reset of operator_chain_failure_count lacks predicates (MEDIUM)

**Evidence:** `server/routes/operatorTasks.ts:107-110` — `db.update(agentRuns).set({ operatorChainFailureCount: 0 }).where(eq(agentRuns.id, agentRunId))`. No org filter, no status predicate. Raceable: another path could transition the task between the read at line 87 and the reset at line 107.

**Fix:** added `eq(agentRuns.organisationId, orgId)` and `eq(agentRuns.status, 'paused_chain_failure')` to the WHERE clause; capture `.returning({ id })`; treat 0-rows-affected as a `TASK_ALREADY_TERMINAL` conflict.

**Files changed:** `server/routes/operatorTasks.ts`.

### G3 (lint + typecheck) post-fix

- `npm run lint` → 0 errors, 904 warnings (all pre-existing).
- `npm run typecheck` → clean.
- `npx vitest run server/services/__tests__/sandboxExecutionServiceAdoptOrStart.test.ts` → 16/16 passing.

### Round 1 commit + diff regeneration

Commit `3e482410`. Round 2 diff regenerated at `.chatgpt-diffs/pr288-round2-code-diff.diff`.

## Round 2 — Findings

ChatGPT verdict line: "Round 2 is close, but I'd still hold merge."

| ID | Severity | Triage | Recommendation | User Decision |
|----|----------|--------|----------------|---------------|
| F1 | blocker | technical | implement | auto (implement) |
| F2 | blocker | technical | implement | auto (implement) |
| F3 | medium | technical | reject (duplicate of Round 1 F3) | auto (reject — duplicate of R1 F3) |
| F4 | medium | technical | implement | auto (implement) |

Prior-finding status from ChatGPT: F1/F2/F4 Round 1 confirmed fixed; F5 Round 1 fixed for retry-chain-failure but extend-budget was unsafe — that surfaced as Round 2 F1.

### F1 — extend-budget still lacks optimistic predicate + row-count check (BLOCKER)

**Evidence:** `server/routes/operatorTasks.ts:190-198` (Round 1) — `tx.update(agentRuns).set({...}).where(eq(agentRuns.id, agentRunId))`. No `organisationId` filter, no `status='paused_budget_exceeded'` predicate, no row-count check.

**Root cause:** the Round 1 F5 fix landed on retry-chain-failure but extend-budget was missed. Same shape, same race window.

**Fix:** mirror the retry-chain-failure pattern — UPDATE inside the `withOrgGUC` transaction filtered by `id + organisationId + status='paused_budget_exceeded'`; capture `.returning({ id })`; treat 0-rows-affected as `TASK_ALREADY_TERMINAL`; only enqueue the dispatch job after the UPDATE succeeds.

**Files changed:** `server/routes/operatorTasks.ts`.

### F2 — fresh-profile-restart reads earliest chain link, not latest (BLOCKER)

**Evidence:** `server/routes/operatorTasks.ts:300` — `.orderBy(operatorRuns.chainSeq)` (ascending) — returns the earliest chain link in the current attempt. Combined with `latestChainLinkFailureClass: null`, the predicate's failure_reason source was always the wrong chain link's reason — almost always `null` or a transient failure, never the `'OPERATOR_PROFILE_UNRECOVERABLE'` set on the most recent link.

**Root cause:** copy-paste from an earlier query that didn't care about ordering, missed during Phase 2 review.

**Fix:** changed orderBy to `desc(operatorRuns.chainSeq)`. `isNull(supersededByAttempt)` already pins the current attempt; within that, highest chain_seq is the latest link. Added `desc` import.

**V1 failure_class clarification:** the spec's `failure_class='profile_corruption'` branch references a column that does not exist on `operator_runs` in V1. The predicate is wired through `decideFreshProfileRestartAllowed` (which checks both `failureClass` and `failureReason`) for forward compatibility but the route always passes `null` for `failureClass` today. Comment updated to make this explicit so future readers don't re-investigate. Spec §3.15 item 7 already covers this in the deferred-items list.

**Files changed:** `server/routes/operatorTasks.ts`.

### F3 — stale spec/doc `delegated` predicate (MEDIUM) — REJECTED (duplicate of Round 1 F3)

**Investigation:**
- `grep -rn "'pending','delegated'\|'delegated','paused"` — all three matches are the CANCEL UPDATE predicate, which CORRECTLY includes `'delegated'` because cancelling a delegated task is a valid transition (spec §3.10).
- The DISPATCH success predicate at `operatorManagedBackend.ts:467` and spec line 1224 both EXCLUDE `'delegated'`, as required.

The Round 1 F3 finding and the Round 2 F3 finding describe the same concern. Round 1 rejected after verifying live code + spec are correct; Round 2 is a substantive duplicate. Per the chatgpt-pr-review duplicate-detection rule (KNOWLEDGE.md 2026-05-01), auto-apply the prior round's decision (reject) without re-triage.

No code change.

### F4 — fire-and-forget audit writes for state-changing routes (MEDIUM)

**Evidence:** `void auditService.log(...)` in:
- `retry-chain-failure` route (line ~112 Round 1) — state-changing, queues dispatch
- `extend-budget` route — state-changing, queues dispatch
- `fresh-profile-restart` route — state-changing, mutates operator_runs
- `extend-debug-retention` route — state-changing, mutates operator_task_profiles

**Root cause:** the audit log was treated as observability rather than as part of the state-change contract. For state-changing operator actions the audit row IS the operator-visible explanation; if the route returns 202 before the audit is durable, an observer can see the dispatch fire / state change with no recorded cause.

**Fix:** changed all four audit writes from `void auditService.log(...)` to `await auditService.log(...)`. For retry-chain-failure and extend-budget the await sits between the UPDATE and the `boss.send` call so the audit lands before the dispatch job is enqueued. (refresh-credential was already awaited as part of Round 1 F1.)

**Files changed:** `server/routes/operatorTasks.ts`.

### G3 (lint + typecheck) post-fix

- `npm run lint` → 0 errors, 904 warnings (all pre-existing).
- `npm run typecheck` → clean.

### Round 2 commit + diff regeneration

Commit `5c63f181`. Round 3 diff regenerated at `.chatgpt-diffs/pr288-round3-code-diff.diff`.

## Round 3 — Findings

ChatGPT verdict line: "Almost final. The previous blockers look fixed in the latest patch... One remaining pre-finalisation issue."

| ID | Severity | Triage | Recommendation | User Decision |
|----|----------|--------|----------------|---------------|
| F1 | high | technical (architectural — schema/contract change) | implement (operator-approved Option 2: add column now) | operator-approved (Add the column now) |

ChatGPT confirmed Round 2 fixes:
- extend-budget now uses optimistic predicate + row check + awaited audit (Round 2 F1 closed)
- retry-chain-failure uses optimistic predicate + row check + awaited audit (Round 1 F5 closed)
- progress route uses subaccount-scoped URL + dual-GUC (Round 1 F4 closed)
- fresh-profile-restart narrowed to V1's failure_reason='OPERATOR_PROFILE_UNRECOVERABLE' with future-compat note for failure_class (Round 2 F2 closed)

### F1 — assigned-user route rule not wired (HIGH; ARCHITECTURAL escalation)

**Evidence:** `server/routes/operatorTasks.ts:92,180` — `assignedUserId: null` hardcoded into the actor-rule call for retry-chain-failure and extend-budget. The route comment claims "assigned user OR manager+" but the actor-rule helper's assigned-user branch is unreachable.

**Root cause investigation:**
- The spec §6.5b line 1148: *"The route handler reads `agent_runs.assigned_user_id` and `users.role` before authorising."*
- But `agent_runs` schema in V1 has NO `assigned_user_id` column. The closest analogues (`actingAsUserId`, `principalId`) are not the intended source.
- The spec was authored assuming the column existed; Phase 2 build matched the spec aspirationally, leaving the field hardcoded `null` because there was no column to read from.
- Result: a Phase 3.5-shaped gap where the intended actor rule degrades to "manager+ only" in V1 because the data source is missing.

**Triage:** technical (no UX surface). Recommendation: `implement` — but `scope_signal: architectural` (schema/contract change) triggered step-3b escalation. Operator presented with three options:
1. Document V1 reality, defer wiring (no schema change, smallest scope, recommended-default)
2. Add the column now (small migration 0334, modest scope, full wire-up)
3. Remove the dead branch (smallest functional surface, loses forward-compat)

**Operator decision:** Option 2 — add the column now.

**Fix:**
- New migration `migrations/0342_agent_runs_assigned_user_id.sql` (+ `.down.sql`): `ALTER TABLE agent_runs ADD COLUMN assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL` + partial index `agent_runs_assigned_user_id_idx WHERE assigned_user_id IS NOT NULL`.
- `server/db/schema/agentRuns.ts`: added `assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' })`.
- `server/routes/operatorTasks.ts`: `readAgentRunOrThrow` now selects `assignedUserId`; both retry-chain-failure (line 93) and extend-budget (line 180) now pass `run.assignedUserId` to `evaluateRouteActorRule`. Admin-only routes (fresh-profile-restart, refresh-credential, extend-debug-retention) continue to pass `null` because `routeRequiresAdmin: true` short-circuits the assigned-user branch.

**Note:** populating `agent_runs.assigned_user_id` at run-creation time (so the column has data to read) is a separate concern. The operator-task creation path lands in a future build. Until then, the column is null for all rows and the actor rule effectively continues as "manager+ only" — same behaviour as before this fix, but now structurally correct so that adding the populate step in a follow-on PR activates the assigned-user branch with zero further plumbing.

**Files changed:** `migrations/0342_agent_runs_assigned_user_id.sql`, `migrations/0342_agent_runs_assigned_user_id.down.sql`, `server/db/schema/agentRuns.ts`, `server/routes/operatorTasks.ts`.

### G3 (lint + typecheck) post-fix

- `npm run lint` → 0 errors, 904 warnings (all pre-existing).
- `npm run typecheck` → clean.

### Round 3 commit + diff regeneration

Commit `4d557172`. Round 4 diff regenerated at `.chatgpt-diffs/pr288-round4-code-diff.diff`.

## Round 4 — Findings

ChatGPT verdict line: "Not quite final yet... one important route-permission issue remains."

| ID | Severity | Triage | Recommendation | User Decision |
|----|----------|--------|----------------|---------------|
| F1 | blocker | technical | implement | auto (implement) |

ChatGPT confirmed Round 3's assigned-user wiring closed the first half of the prior finding; the actor-rule helper tests cover the matrix; this is the second half — the outer middleware can still block ordinary assigned users before the handler runs.

### F1 — outer middleware blocks assigned users before handler-level actor rule runs (BLOCKER)

**Evidence:** `server/routes/operatorTasks.ts:82,169` — `requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT)` mounted before the handler for retry-chain-failure and extend-budget. AGENTS_EDIT is "Edit AI agents" — a manager-level permission that does not typically grant to rank-and-file users. So an assigned user with the spec-intended right to retry their own paused task is rejected at the middleware before `evaluateRouteActorRule` ever runs.

**Root cause:** the build mounted the closest-existing permission key (AGENTS_EDIT) as a coarse gate; the spec referenced `AGENT_RUN_WRITE` which does not exist in V1. The handler-level actor-rule check is the actually-fine-grained gate, and it's already correct after Round 3, but the coarse gate short-circuits before it.

**Fix:** removed `requireOrgPermission(AGENTS_EDIT)` from both user-or-manager routes (retry-chain-failure, extend-budget). The chain is now:

1. `authenticate` middleware — verifies the actor is logged in to a session.
2. `readAgentRunOrThrow(agentRunId, orgId)` — verifies the run exists, is org-scoped, and resolves `assignedUserId`.
3. `evaluateRouteActorRule({ actorRole, assignedUserId, routeRequiresAdmin: false })` — rejects any actor that is not (a) the assigned user OR (b) manager+. 403 REQUIRES_MANAGER_OR_ASSIGNED_USER otherwise.

The five admin-only routes (fresh-profile-restart, refresh-credential, extend-debug-retention) keep `requireOrgPermission(AGENTS_EDIT)` because they should bounce non-admin actors at the middleware layer. The actor rule on those routes additionally checks `routeRequiresAdmin: true` so only org_admin / system_admin get through.

Route header comment + the inline middleware comments updated to make the V1 reality explicit (AGENT_RUN_WRITE does not exist; handler check stands in).

**Minor cleanup (operator-noted):** sweep for stale `/api/operator-sessions/:operatorRunId/progress` references — `grep -rn "/api/operator-sessions/:operatorRunId" --include="*.ts" --include="*.md" --include="*.tsx" .` (excluding `.chatgpt-diffs`, review logs, spec, plan) → no hits. The implementation is clean; the stale text ChatGPT may have seen was in archived materials only.

**Files changed:** `server/routes/operatorTasks.ts`.

### G3 (lint + typecheck) post-fix

- `npm run lint` → 0 errors, 904 warnings (all pre-existing).
- `npm run typecheck` → clean.

### Round 4 commit + finalisation

Commit pending. Operator instructed: "after this round, merge in main, fix any conflicts and then proceed to finalisation." This is the closing chatgpt-pr-review round.

---

## Final Summary

**Verdict:** APPROVED — operator finalised after Round 4.

**Rounds:** 4. ChatGPT signalled "almost final" after Round 3 and "comfortable finalising after this patch" after Round 4. Operator instructed to close the loop after Round 4 and proceed to finalisation-coordinator Steps 6+.

**Findings closed:**
- Round 1: F1 refresh-credential blank connectionId + fire-and-forget audit (blocker, implemented), F2 adoptOrStart unique-index contradiction (blocker, implemented), F3 dispatcher delegated predicate (high, rejected — verified clean), F4 progress route doc drift (medium, implemented), F5 retry-route reset race (medium, implemented).
- Round 2: F1 extend-budget race (blocker, implemented), F2 fresh-profile-restart wrong-chain-link order (blocker, implemented), F3 stale delegated predicate (medium, rejected — duplicate of R1 F3), F4 fire-and-forget audit writes (medium, implemented).
- Round 3: F1 assigned-user wiring (high, architectural escalation, operator-approved Option 2 — add column).
- Round 4: F1 outer middleware blocks assigned users (blocker, implemented — middleware removed from user-or-manager routes, kept on admin-only routes).

**Total commits driven by chatgpt-pr-review:** 4 (`3e482410`, `5c63f181`, `4d557172`, plus the Round 4 commit landing next).

**Schema change introduced by review:** migration 0334 `agent_runs.assigned_user_id` (operator-approved during Round 3 escalation).

**Doc-sync sweep:** runs as finalisation-coordinator Step 6 after S2 sync — see next entry in this log.

### Doc-sync field verdicts (finalisation-coordinator Step 6, post-S2 sweep)

```
- KNOWLEDGE.md updated: pending Step 7 pattern extraction (Phase 2 added 2 entries already)
- architecture.md updated: yes (Operator Backend Key files: progress poll route corrected to operatorSessions.ts; Migrations row renumbered 0335-0339 + 0340 + 0341 + 0342; permissions row added in Phase 2; capability literals CI gate row added in Phase 2; dual-GUC pattern + key files Phase 2)
- capabilities.md updated: yes (Subscription-Driven Long-Task Execution changelog row added in Phase 2 at line ~1204 — vendor-neutral)
- integration-reference.md updated: n/a — no integration add/remove/rename in this PR; operator_session credential primitive was added in PR #286 (operator-session-identity) and already documented
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: yes (DEVELOPMENT_GUIDELINES.md §9 multi-tenant safety checklist now includes the setOrgAndSubaccountGUC dual-GUC item — per Phase 2 doc-sync; CLAUDE.md n/a — no playbook-level rule changes)
- frontend-design-principles.md updated: no — checked operator UI surfaces (OperatorBadge, OperatorChainLinkIndicator, OperatorAutoExtendBanner, modals) all reuse existing PageShell / Drawer / Modal primitives from PR #270; zero new UI pattern, hard rule, or worked example introduced
- docs/decisions/ updated: yes (ADR-0011 operator-backend-chain-resume-model.md added in Phase 2)
- CONTRIBUTING.md updated: n/a — no lint-suppression policy changes
- references/test-gate-policy.md updated: n/a — no test-gate posture changes; the new CI gates (verify-operator-event-registry.sh, verify-execution-capability-references.sh) follow the existing pattern and are CI-only as required
```

**Doc-sync invariant check:** 9 doc rows recorded against `docs/doc-sync.md`'s 8 registered docs (spec-context.md omitted — spec-review-only). All verdicts substantiated with grep terms / specific reasons. Sweep complete.
