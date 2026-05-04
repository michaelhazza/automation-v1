# ChatGPT Spec Review Session — deferred-items-pre-launch — 2026-05-04T10-00-00Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-01-deferred-items-pre-launch-spec.md
- Branch: claude/review-deferred-features-vXp7T
- PR: #260 — https://github.com/michaelhazza/automation-v1/pull/260
- Mode: manual
- Started: 2026-05-04T10:00:00Z

---

## Round 1 — 2026-05-04T10:00:00Z

### ChatGPT Feedback (raw)

Executive summary: High-quality, production-ready hardening spec. Structurally sound, correctly prioritised, aligned with system philosophy (invariants, DB guarantees, RLS discipline). Phase gating and traceability are particularly strong.

4 gaps identified before build: (1) Missing global invariants layer; (2) Idempotency not consistently elevated to first-class contract; (3) Single-writer / ownership rules implicit, not enforced; (4) Operational failure modes under-specified in critical paths.

Critical gaps:
F1 — Missing global invariants section (I1–I6): tenant isolation, idempotency, single-writer, durable-before-notify, DB time canonical, no silent failure.
F2 — Idempotency not consistently enforced: webhooks (Stripe, Slack, GHL), OAuth callback replay, resume flows, retry endpoints.
F3 — Single-writer rule not explicit: ownership rules per domain (workflow_runs, task_events, agent_charges, approvals).
F4 — Retry + failure classification under-specified: no retryable/non-retryable taxonomy, no backoff strategy, no DLQ/dead state, no withBackoff enforcement table.
F5 — Event stream guarantees need tightening: strictly ordered, gap-detectable, replayable, monotonic sequence.
F6 — GUC/RLS propagation risk: any async worker forgetting SET app.organisation_id = cross-tenant leakage; elevate withOrgTx to invariant.
F7 — Soft-delete discipline needs enforcement mechanism: 23 sites fixed manually won't scale; needs selectActive() or lint rule.

Minor improvements:
M1 — Phase 1 risk ordering: move D-P0-5 (durable task events) earlier.
M2 — No inline INSERT rule: extend beyond workflow_runs to all critical tables.
M3 — Explicit timeout + SLA policy: unify max request / webhook / job runtime.
M4 — No hidden async work rule: all async must be queued or explicitly awaited.

Overall verdict: CHANGES_REQUESTED (recommended additions before build; "ready to build with minor tightening").

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — Global invariants section (I1–I6) | technical | reject | user (reject) | critical | Scope expansion — this spec closes 6 targeted fixes; §0.3 hard boundary excludes global policy; invariants belong in architecture.md or a dedicated spec |
| F2 — Idempotency cross-cutting contract | technical | reject | user (reject) | critical | Scope expansion — none of the 6 items introduce new idempotency-sensitive mutation paths; §2.1 checkRequiredIntegration is a read-only check |
| F3 — Single-writer ownership rules | technical | reject | user (reject) | high | Scope expansion — global ownership rules are architecture.md concerns; this spec touches no state-machine mutation ownership |
| F4 — Retry/failure classification table | technical | reject | user (reject) | high | Scope expansion — spec introduces no new retry paths; withBackoff is an existing accepted primitive (spec-context.md); global retry taxonomy is out of scope |
| F5 — Event stream ordering guarantees | technical | reject | auto (reject) | medium | Out of scope — this spec has zero event stream components; agentExecutionEventService already ships this (accepted primitive in spec-context.md) |
| F6 — GUC/RLS propagation invariant | technical | reject | auto (reject) | medium | Items in scope (§2.4 WITH CHECK, §2.5 subaccount guard) are already correctly specified; global withOrgTx invariant is out of scope |
| F7 — Soft-delete enforcement mechanism | technical | defer | user (defer) | medium | Valid long-term — selectActive() / lint rule would prevent §2.3 regression; scope expansion for this spec; routed to tasks/todo.md |
| M1 — Phase ordering D-P0-5 | technical | reject | auto (reject) | low | References non-existent phase labels (D-P0-5); not present in this spec; likely ChatGPT confusion with a broader spec |
| M2 — No inline INSERT rule | technical | reject | auto (reject) | low | References workflow_runs context not present in this spec; not applicable |
| M3 — Timeout/SLA policy | technical | reject | auto (reject) | low | Out of scope — no timeout-sensitive paths introduced by the 6 items |
| M4 — No hidden async work rule | technical | reject | auto (reject) | low | Out of scope — no new async work patterns introduced |

### Auto-applied (technical, auto-executed)
- [auto] F5 rejected — event stream guarantees out of scope
- [auto] F6 rejected — GUC propagation invariant out of scope; in-scope RLS items already correct
- [auto] M1 rejected — references non-existent phase labels
- [auto] M2 rejected — not applicable to this spec's scope
- [auto] M3 rejected — out of scope
- [auto] M4 rejected — out of scope

### User decisions (all as recommended)
- F1, F2, F3, F4 — user (reject) — scope expansion
- F7 — user (defer) — routed to tasks/todo.md § Spec Review deferred items / deferred-items-pre-launch

### Top themes — Round 1
ChatGPT reviewed this as a broad system-hardening spec rather than the narrow 6-item fix spec it is. All critical/high findings were global invariant / cross-cutting policy concerns that violate §0.3's hard scope boundary. Correctly rejected as scope expansion. One valid long-term finding (soft-delete enforcement) deferred for follow-up. Spec unchanged this round — no edits applied.

---
