# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md`
**Spec commit at check:** `353418fe`
**Branch:** `claude/pre-test-backend-hardening`
**Base (merge-base with main):** `e0933cb2`
**HEAD:** `69e5b0dc`
**Scope:** programme-level (all 8 spec items §1.1–§1.8)
**Changed-code set:** 22 production files (excluding plan.md / progress.md / current-focus.md)
**Run at:** 2026-04-28T03:19:37Z

---

## Summary

- Requirements extracted:     8 spec items (programme-level scope) + cross-cutting §0.3/§0.4 invariants
- PASS:                       2 spec items fully conformant (§1.4, §1.5, §1.6, §1.8)
- PASS-with-deviation:        2 spec items pass invariants but with documented spec-vs-code adaptations (§1.2 helper/call-site/tests, §1.3 predicate/dispatch/winner-branch, §1.1 success-path)
- DIRECTIONAL_GAP → deferred: 6 gaps routed to `tasks/todo.md`
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0
- MECHANICAL_GAP → fixed:     0

> Per the fail-closed classification rule, all six findings are DIRECTIONAL_GAP. Each requires a design choice the spec did not pre-resolve (type-system extension, transaction boundary trade-off, test harness build-out, failure-path payload semantics, primitive split).

**Verdict:** **NON_CONFORMANT** — 6 directional gaps must be addressed by the main session before `pr-reviewer`. See `tasks/todo.md` under "Deferred from spec-conformance review — pre-test-backend-hardening (2026-04-28)".

The branch's structural / surgical work is sound across all 8 chunks. The gaps are concentrated in two categories:
1. **Test-harness completeness** — two of the three carved-out integration tests (§1.1 LAEL, §1.3 approval-resume) are stubs that pass without exercising the code path.
2. **Spec-vs-existing-system reconciliation** — three places where the spec's literal contract collides with the existing type system or transaction model (§1.1 catch-path DELETE, §1.1 failure-path payload row, §1.2 AutomationStepError shape, §1.7 async-worker exclusion).

None of the gaps invalidate the chunks' core wiring. They are work the human should resolve before merge — most by deciding which side of a spec-vs-code tension to honour.

---

## Requirements extracted (full checklist)

| # | Spec section | Item | Verdict |
|---|---|---|---|
| 1 | §1.4 N3 | Migration 0240 + Drizzle schema for org-scoped conversations_unique_scope | PASS |
| 2 | §1.5 S2 | One-shot PULSE_CURSOR_SECRET fallback warning (module-level flag, logger.warn) | PASS |
| 3 | §1.6 N1 | requireUuid helper + UUID_REGEX + validateBase swap + 3 test cases | PASS |
| 4 | §1.7 #5 (wiring) | checkThrottle in ingestInline + comment + return-shape extension + integration test | PASS |
| 5 | §1.7 #5 (async-worker MUST) | Async-worker path MUST NOT call checkThrottle | DIRECTIONAL_GAP A |
| 6 | §1.2 (helper + call-site) | resolveRequiredConnections pure helper + dispatcher integration + 11 test cases | PASS |
| 7 | §1.2 (error shape) | AutomationStepError shape per spec example (type: 'configuration', status, context.missingKeys) | DIRECTIONAL_GAP B |
| 8 | §1.3 (predicate) | resolveApprovalDispatchAction + exhaustive 9-case pure test (incl. 'edited') | PASS |
| 9 | §1.3 (decideApproval branch) | Step-type branch routes to resumeInvokeAutomationStep on approve+invoke_automation | PASS |
| 10 | §1.3 (atomic winner) | UPDATE WHERE awaiting_approval gates dispatch on the winner branch only | PASS |
| 11 | §1.3 (dispatch_source tag) | Tracing tag dispatch_source: 'approval_resume' on resume path | PASS |
| 12 | §1.3 (integration test) | "Integration test added and green" with call-count assertion | DIRECTIONAL_GAP C (stub) |
| 13 | §1.1 (predicate) | shouldEmitLaelLifecycle + 40-case exhaustive pure test | PASS |
| 14 | §1.1 (success-path emission) | llm.requested before adapter.call + llm.completed in terminal-tx finally + payload row | PASS |
| 15 | §1.1 (pairing-completeness) | Finally block guarantees llm.completed for every emitted llm.requested | PASS |
| 16 | §1.1 (uniqueness invariant) | llm.completed not emitted twice for same (runId, ledgerRowId) — laelCompletedEmitted flag | PASS |
| 17 | §1.1 (pre-dispatch-terminal skip) | budget_blocked / rate_limited / provider_not_configured skip emission AND payload | PASS |
| 18 | §1.1 (failure-path payload row) | "the corresponding agent_run_llm_payloads row" on failure path | DIRECTIONAL_GAP D |
| 19 | §1.1 (catch-path DELETE) | "follow-up DELETE on the contested key MUST run inside the same tx" | DIRECTIONAL_GAP E |
| 20 | §1.1 (integration test) | "one integration test added and green" with happy-path event ordering + payload row | DIRECTIONAL_GAP F (stub) |
| 21 | §1.8 S6 | reviewServiceIdempotency.test.ts with 3 race tests + hook-presence assertion | PASS |
| 22 | §0.3 | No new primitives beyond those named per item | PASS (extracted *Pure.ts files honour project convention; primitive count unchanged) |
| 23 | §0.4 | No edits to pair-spec territory | PASS (zero forbidden files touched) |
| 24 | §0.4 | Migration slot 0240 (not 0241+) | PASS |

---

## Mechanical fixes applied

None. Per fail-closed classification, all 6 findings are DIRECTIONAL.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

All 6 gaps appended to `tasks/todo.md` under heading **"Deferred from spec-conformance review — pre-test-backend-hardening (2026-04-28)"**:

- **Gap A** (§1.7) — async-worker transitively calls checkThrottle via shared ingestInline.
- **Gap B** (§1.2) — AutomationStepError shape divergence (`type: 'configuration'`, `status`, `context.missingKeys` not in existing type).
- **Gap C** (§1.3) — workflowEngineApprovalResumeDispatch.integration.test.ts is a stub.
- **Gap D** (§1.1) — failure-path payload row not inserted.
- **Gap E** (§1.1) — payload-insert catch path lacks contested-key DELETE; spec MUST contradicted by implementation comment lines 1586-1591.
- **Gap F** (§1.1) — llmRouterLaelIntegration.test.ts is a stub.

---

## Spec-vs-code adaptations accepted (PASS, documented)

These are deviations the implementation took that are sanctioned by spec §0.1 ("prefer existing primitives") or by explicit progress.md notes; they are NOT counted as gaps but are flagged here for the human reviewer:

- **§1.1 payload field shape.** Spec example used `callSite`, `ledgerRowId`, `terminalStatus`, `latencyMs`, `costCents`. Impl uses canonical `AgentExecutionEventPayload` discriminated-union fields: `featureTag`, `llmRequestId`, `status`, `durationMs`, `costWithMarginCents`. `shared/types/agentExecutionLog.ts` extended to add `llm.requested`/`llm.completed` discriminants. Sanctioned.
- **§1.3 stepKind → stepType, decision values.** Spec uses `stepKind` and `'approve' | 'reject'`. Codebase uses `stepType` and `'approved' | 'rejected' | 'edited'`. Helper documents this drift and treats `'edited'` as non-redispatch. Captured in commit `65465a5a`.
- **§1.2 requiredConnections shape.** Spec helper signature takes `string[]`. Codebase model is `Array<{ key, required }>`; call site filters by `c.required` and maps to `c.key` before passing to helper. Adaptation is local to the call site; helper signature unchanged.
- **§1.5 firstObservedAt field.** Spec example carried `firstObservedAt: new Date().toISOString()` — impl emits `event` and `message` only. Spec MUST is "log exactly once," not "include this field." Field absence is not a contract violation.
- **§1.8 __testHooks seam in reviewService.ts.** Spec Files section says "DO NOT modify the service" but spec step 4 explicitly authorizes the `__testHooks.delayBetweenClaimAndCommit` seam pattern as the documented escape hatch. Production behaviour unchanged when hook unset (verified at lines 187-189, 368-370).
- **Pure-helper extractions.** `resolveRequiredConnectionsPure.ts`, `resolveApprovalDispatchActionPure.ts`, `llmRouterLaelPure.ts` are all separate files, while spec inventory placed them inline. Project convention is `*Pure.ts` for pure-test discipline. Each chunk still introduces exactly the named primitive count.

---

## Files modified by this run

- `tasks/todo.md` (appended deferred section)
- `tasks/review-logs/spec-conformance-log-pre-test-backend-hardening-2026-04-28T03-19-37Z.md` (this file, NEW)

No production code modified — fail-closed classification routed all gaps to deferred items.

The scratch log at `tasks/review-logs/spec-conformance-scratch-pre-test-backend-hardening-2026-04-28T03-19-37Z.md` has served its purpose and will be cleaned up post-finalisation per the playbook.

---

## Next step

**NON_CONFORMANT.** 6 directional gaps must be addressed by the main session before `pr-reviewer`. See `tasks/todo.md` under "Deferred from spec-conformance review — pre-test-backend-hardening (2026-04-28)".

Recommended ordering for the main session:
1. **Gap A and Gap B** are spec-vs-existing-system reconciliations — the right call is likely a small spec amendment (or a small type extension) rather than reshaping the implementation. Decide first because the answer affects the test surface.
2. **Gap D and Gap E** are observability invariants for §1.1's "ledger canonical, payload best-effort" contract. Both materially affect what failed-call observability looks like — decide before testing-pass starts so the LAEL UI / debug tooling consume the right shape.
3. **Gap C and Gap F** are integration-test build-outs. They depend on a shared fake-webhook / fake-provider harness that does not yet exist in the repo. Build the harness once and use it twice. Without these, the spec-defined call-count assertions for §1.1 and §1.3 are not actually exercised.

After the gaps are addressed (or the spec is amended), re-run `spec-conformance` on the expanded changed-code set to confirm CONFORMANT_AFTER_FIXES, then proceed to `pr-reviewer`.
