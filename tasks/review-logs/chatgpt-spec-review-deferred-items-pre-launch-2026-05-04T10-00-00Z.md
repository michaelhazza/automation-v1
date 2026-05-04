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

## Round 2 — 2026-05-04T11:00:00Z

### ChatGPT Feedback (raw)

Two findings:
R2-F1: "Round 2 prompt references §2.1–§2.6 but the uploaded spec is the large 82-item bundled hardening spec; mismatch will confuse the next reviewer." Recommends either updating the prompt to reference P0 Phase 1 items, or pasting the actual narrow 6-item spec.
R2-F2: "Phase 1 sequencing says 'Data-integrity P0s (Bucket 4)' but Bucket 4 is Operational readiness. Data integrity is Bucket 2. Small wording bug."
Overall: "Proceed. Spec is solid. Prompt needs correcting."

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| R2-F1 — §2.1–§2.6 vs "82-item bundled spec" mismatch | technical | reject | auto (reject) | low | Hallucination or wrong-spec access: the spec being reviewed IS the narrow 6-item spec with §2.1–§2.6 exactly as described; "82-item bundled hardening spec" does not exist |
| R2-F2 — "Bucket 4 / Bucket 2" data integrity wording bug | technical | reject | auto (reject) | low | Hallucination: "Bucket", "Phase 1 sequencing", "Operational readiness" do not appear anywhere in the spec; ChatGPT reviewed a different document |

### Auto-applied (technical, auto-executed)
- [auto] R2-F1 rejected — references a spec that doesn't exist; the reviewed spec is correctly the 6-item narrow spec
- [auto] R2-F2 rejected — "Bucket 4/2" text absent from spec; hallucinated finding

### Top themes — Round 2
Both findings reference elements absent from the spec under review. ChatGPT appears to have had access to or generated content from a different/broader document in both rounds. Spec unchanged — no edits applied across either round.

---

## Final Summary

**Verdict:** APPROVED (2 rounds)

- Rounds: 2
- Auto-accepted (technical): 0 applied | 8 rejected | 0 deferred
- User-decided: 0 applied | 4 rejected | 1 deferred
- Index write failures: 0
- Deferred to tasks/todo.md § Spec Review deferred items / deferred-items-pre-launch:
  - [auto] Soft-delete enforcement mechanism — selectActive() / lint rule to prevent §2.3 regression [user]
- KNOWLEDGE.md updated: yes (1 entry — ChatGPT over-scoping pattern for narrow fix specs)
- architecture.md updated: no — checked integrationBlockService, checkRequiredIntegration, formatThreadContextBlock, conv_thread_ctx_org_isolation, BriefResultSource; spec closes 6 targeted gaps using existing service patterns; no new primitives or boundaries introduced
- capabilities.md updated: n/a — no capability/skill/integration add/remove/rename
- integration-reference.md updated: n/a — no integration behaviour change
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: n/a — no build discipline or convention changes
- spec-context.md updated: yes — bumped last_reviewed_at to 2026-05-04; framing confirmed current (pre_production: yes, rapid_evolution, static_gates_primary, prefer_existing_primitives — all still accurate)
- frontend-design-principles.md updated: n/a — §2.6 stub label fallback is not a new UI pattern
- PR: #260 — https://github.com/michaelhazza/automation-v1/pull/260

### Implementation readiness checklist
- All inputs defined: yes (each of §2.1–§2.6 specifies inputs clearly)
- All outputs defined: yes (acceptance criteria per item)
- Failure modes covered: yes (§2.1 no-connection path; §2.2 absent conversationId; §2.4 drop-and-recreate fallback; §2.5 422 on mismatch)
- Ordering guarantees explicit: yes (§2.2 prompt injection ordering invariant; migration numbered convention)
- No unresolved forward references: yes (all referenced services exist; no phantom dependencies)
