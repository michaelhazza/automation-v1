# Pre-Test Backend Hardening — Progress

**Build slug:** `pre-test-backend-hardening`
**Branch:** `claude/pre-test-backend-hardening`
**Execution started:** 2026-04-28

---

## Phase 0 — Baseline

### TypeScript baseline (npx tsc --noEmit)

11 pre-existing errors, all in CLIENT files unrelated to this branch's work:

- `client/src/components/ClarificationInbox.tsx` — 10 errors (EventEmitter type issues, all on lines 53–92)
- `client/src/components/skill-analyzer/SkillAnalyzerExecuteStep.tsx` — 1 error (RestoreResult not found, line 55)

**Conclusion:** Zero server-side baseline violations. Our chunk verifications target `server/` only, so these do not interact with any chunk in this build.

### Unit tests

Not run per user instruction (no tests during development phase — tests will be executed at programme end or on demand).

### Migration head

Confirmed: `migrations/0239_system_incidents_last_triage_job_id.sql`. Migration slot `0240` reserved for Chunk 1 as planned.

---

## Pre-execution guardrails (annotations from external review, 2026-04-28)

These are implementation-time guardrails applied to each chunk based on pre-execution review feedback. They do NOT change the spec or plan scope.

### G1 — Chunk 7: Single dispatch wrapper (Critical #1)

Before writing any emit call in `llmRouter.ts`, trace every code path that can reach `providerAdapter.call`. They MUST all converge through the same terminal-tx wrapper. No early-return path may bypass the wrapper. If more than one call site reaches the provider adapter, hoist them into a single dispatch function before wiring emission.

### G2 — Chunk 6: DB-level winner guarantee (Critical #2)

**Pre-execution verification COMPLETE.** The winner branch is enforced by an atomic PostgreSQL UPDATE in `resumeInvokeAutomationStep` (workflowEngineService.ts line 1752–1759): `UPDATE workflowStepRuns SET status = 'running' WHERE id = $1 AND status = 'awaiting_approval'`. Only one concurrent caller can win — if no row returns, the caller is the loser and returns `alreadyResumed: true` without dispatching. This is DB-level atomic; no unique constraint is required beyond the existing PK. The `resolveApprovalDispatchAction` helper and tests are still required per spec.

**Annotation for executor:** Chunk 6's winner mechanism is already correctly implemented. The remaining delta is: (a) extract `resolveApprovalDispatchAction` pure helper, (b) add `dispatch_source: 'approval_resume'` tracing tag, (c) write pure + integration tests. Do NOT refactor the existing `resumeInvokeAutomationStep` beyond what the spec explicitly names.

### G3 — Chunk 5: Non-caching intent (Critical #3)

`resolveRequiredConnections` calls `listMappings(organisationId, subaccountId)` on every dispatch — intentionally non-cached. Add one inline comment at the call site: `// listMappings is called per-dispatch. This is intentionally non-cached — if this becomes hot, introduce caching via a separate spec.`

### G4 — Chunk 4: Process-local throttle (Critical #4)

The `incidentIngestorThrottle` is in-memory/process-local. Cross-instance deduplication is NOT guaranteed. Add to the inline comment at the `ingestInline` call site (the one already required by the spec) a second sentence: `The throttle is process-local; cross-instance deduplication is not guaranteed.`

### G5 — Chunk 1: Migration transaction window (Critical #5)

The `DROP INDEX … CREATE UNIQUE INDEX` pair MUST run inside a single PostgreSQL transaction. Add a comment at the top of `0240_conversations_org_scoped_unique.sql`: `-- Runs in a single transaction. DO NOT split or run outside a transaction — there is a gap between DROP and CREATE where uniqueness protection is absent.`

---

## Chunk execution log

| Chunk | Status | Commit | Notes |
|-------|--------|--------|-------|
| 1 — §1.4 N3 | DONE | a0253a76 | |
| 2 — §1.5 S2 | DONE | b09e2ebc | |
| 3 — §1.6 N1 | DONE | ad03b8b2 | `invalid_format` code added to ValidationError union |
| 4 — §1.7 #5 | DONE | d94bb62e | |
| 5 — §1.2 REQ W1-44 | DONE | 15f7eebc, 8191c954 | Helper extracted to `resolveRequiredConnectionsPure.ts` per `*Pure.ts` convention; determinism test added after quality review |
| 6 — §1.3 Codex iter2 | DONE | 28f7b371, 65465a5a | Core dispatch (resumeInvokeAutomationStep) was pre-existing; delta was pure helper + tracing + tests. `edited × invoke_automation` bug fix: prior code would redispatch on 'edited' discarding operator edits — new helper correctly routes to complete_with_existing_output. Integration tests are stubs; manual-smoke approval (create supervised step, approve, verify webhook) is the gating acceptance check for the double-dispatch invariant. |
| 7 — §1.1 LAEL-P1-1 | DONE | 018317c6, 4131d97f, 7ebac102 | `shouldEmitLaelLifecycle` extracted to `llmRouterLaelPure.ts`. G1 check passed — single providerAdapter.call path found, no hoisting needed. Post-review fixes: B1 payloadInsertStatus on event, B2 finally guarantee, B3 exhaustive test matrix (40 cases). Gap E catch-DELETE added in 7ebac102. Integration tests are stubs (harness gap deferred to tasks/todo.md). |
| 8 — §1.8 S6 | DONE | 69e5b0dc | `__testHooks.delayBetweenClaimAndCommit` seam in reviewService.ts. Race tests in `reviewServiceIdempotency.test.ts` (3 races + 1 hook-presence assertion). |

---

## Programme-end summary (2026-04-28)

All 8 chunks implemented, reviewed (spec-conformance + pr-reviewer), and committed.

### Post-review gap resolution

- **Gap A (async-worker throttle):** Fixed — throttle moved from `ingestInline` to sync branch of `recordIncident` (7ebac102).
- **Gap E (catch-DELETE):** Fixed — defensive DELETE added in payload-insert catch (7ebac102).
- **Gap B (AutomationStepError type):** Deferred to `tasks/todo.md` — pragmatic translation to `type: 'execution'` accepted.
- **Gap C (§1.3 integration test harness):** Deferred — approval-resume integration tests are stubs pending shared fake-webhook harness.
- **Gap D (failure-path payload row):** Deferred as spec ambiguity — implementation skips insert on failure (no response to persist); spec criterion is ambiguous.
- **Gap F (§1.1 LAEL integration test harness):** Deferred — fake-provider harness required.

### Deferred items

All deferred items written to `tasks/todo.md`. None are blocking for merge — they are follow-up hardening tasks.

### KNOWLEDGE.md entries added

- Ledger-canonical / payload-best-effort consistency contract (§1.1 LAEL)
- Post-commit winner-branch rule for dispatch on approval-resume (§1.3)
- `__testHooks` seam promotion rule for deterministic race testing (§1.8)

### Branch state

`claude/pre-test-backend-hardening` — 13 commits ahead of main. Ready for PR creation. `npm run test:gates` gating check to be run at merge time per CLAUDE.md gate-cadence rule.
