# Spec Review Final Report

**Spec:** `tasks/builds/synthetos-foundation-refactor/spec.md`
**Spec commit at start:** `0be368dcab237accb4de920b49dc77be5f39f729`
**Spec commit at finish:** `b6460b8681cd41c86ec44e8e28dfb324b821814c`
**Spec-context commit:** `8b6f8d80e8b58cf9908fb1171fef2398c9d8e19b`
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 20 | 8 (3 unique) | 23 | 0 | 0 | 0 | 1 (R-G, routed to tasks/todo.md) |
| 2 | 13 | 0 | 13 | 0 | 0 | 0 | 0 |
| 3 | 13 | 0 | 13 | 0 | 0 | 0 | 0 |

Totals: **49 mechanical fixes accepted, 0 rejected, 1 AUTO-DECIDED routed to tasks/todo.md.**

---

## Mechanical changes applied (grouped by spec section)

### Frontmatter and metadata
- Converted to canonical checklist §11 frontmatter (Status, Spec date, Last updated, Author, Build slug).

### §1.4 / INV-5 / §6 — Schema scope
- §1.4 schema-impact summary now includes the four `subaccount_agents` governance columns and inheritance of existing RLS.
- INV-5 amended to allow the named partial index (`agent_runs_controller_style_idx`).
- §6.3 "idempotent on re-apply" softened to "applied once via the Drizzle migration runner".
- §6.4 backfill count corrected to "one one-time backfill job".

### §3 — Constraints and Invariants
- New **§3.6 Execution-safety contracts** subsection (per checklist §10): idempotency posture, retry classification, concurrency guard for every new write; terminal-event guarantee; no-silent-partial-success contract; unique-constraint mapping; state-machine closure.
- INV-9 immutability now backed by a state-based `WHERE policy_envelope_snapshot IS NULL` UPDATE predicate.
- INV-16 stable log codes inventory expanded with `foundation.controller_style.rejected` and the four-source `gateLevelSource` enum.

### §4.1 — controllerStyle
- Subaccount-agent precedence: explicit override → 422; derived operator → downgrade to native (with `subaccount_constraint` source).
- Resolver function signature includes `controller_style_allowed`.
- File inventory aligned with §7.2 canonical test list.

### §4.2 — Risk Tier
- `deriveGateLevel` signature pinned to `policy_override > preserved_existing > tier_default` precedence with explicit type union.
- §4.2.6 assignment process clarifies that registry preservation is `preserved_existing`, not `policy_override`.
- New §4.2.8 governance enforcement subsection: `subaccount_constraint` source covers `max_risk_tier` (block) and `require_approval_at_tier` (auto→review upgrade).
- G2 reworded to reflect precedence priority.

### §4.3 — CredentialBrokerService
- Acceptance criteria corrected to "five methods".

### §4.4 — Run Trace API
- Source-table count locked to nine (was inconsistently five / five-plus / seven across sections).
- Glossary table count fixed in §4.6.3.
- `RunTraceEventBase.sequenceNumber` is `number | null`.
- New `sourceId` field added to event base for cursor-tuple stability.
- SQL UNION now projects `source_id` from each table's PK.
- Cursor predicate and ORDER BY use the full `(timestamp, COALESCE(sequence_number, 0), source_table, source_id)` four-tuple.
- `toolSlug` filter semantics specified (per-source predicate table).
- `TERMINAL_RUN_STATUSES` corrected to match `shared/runStatus.ts` exactly (`completed | failed | timeout | cancelled | loop_detected | budget_exceeded | completed_with_uncertainty`).
- Terminal-event guarantee subsection added (exactly-one, late-event handling, Phase 3 enforcement deferral).

### §4.5 — Policy Envelope
- "Single source of truth" reworded to "source of truth for run-start state used for replay/audit; live policy sources win for runtime enforcement".
- Service-layer write guard pinned to optimistic-NULL-predicate UPDATE.
- Terminal-event guarantee and post-terminal handling consolidated into §3.6.

### §5.2 — Agent Configuration
- New `subaccount_agents.controller_style_allowed`, `allowed_environments`, `max_risk_tier`, `require_approval_at_tier` columns governed by enforcement points named in §4.1.6 / §4.2.8.
- Subaccount-governance migration moved to Phase 1A (Codex F2 sequencing fix).
- `.down.sql` migration row added to file inventory and snippet added to §5.2.9.

### §5.4 — Credentials audit log
- Route guard stack pinned: `authenticate`, `resolveSubaccount`, `requirePermission('credentials:audit:read')`, principal-scoped DB context, RLS via existing `auditEvents` manifest entry.
- Permission-registry owner referenced in file inventory.
- Priority changed to "Should have" (matches §9.3 acceptance).

### §6 — Migrations
- Removed `RUN_TRACE_API_V1` and `POLICY_ENVELOPE_SNAPSHOT` feature flags (framing: `feature_flags: only_for_behaviour_modes`).
- §6.4 backfill table reflects single backfill job.

### §7 — Test Strategy
- Trimmed to project framing: pure-function unit tests + two named carved-out integration tests + one new CI gate. Removed all component tests, performance baselines, the 20% regression rule, staging/production smoke runs, and the synthetic 5,000-event performance test.
- §7.2 made the canonical test inventory; per-section test rows aligned.
- §7.5 reframed as "Performance posture" (deferred, alerting thresholds only).
- §7.6 reframed as acceptance verification scenarios (not staging tests).

### §8 — Rollout Plan
- Phase 1A / 1B alignment: Run Trace API moved to 1B (matches §4.4.14 dependency); subaccount-governance migration moved to 1A (so §4.1.6 validation has its backing column).
- §8.2 PR table aligned with phase contents.
- §8.3 feature flags removed; replaced with backward-compat-defaults rollout note.
- §8.5 staging/production smoke-test mandate softened to one-pass post-deploy verification.

### §9 — Acceptance criteria
- "Five methods" credential-broker count.
- Six log codes (added `foundation.controller_style.rejected`).
- Performance baselines acceptance reframed to alerting-thresholds-wired-up.

### §10 — Risk register
- Performance-baseline mitigation row reworded to alerting thresholds (matching §7.5).

### §11 (new) — Deferred Items
- New top-level section consolidates NG1-NG10 and per-section deferrals (5.1.4 details panel, 5.2.7 tabs, 12.6 placeholder rows, 7.1 framing-deferred test categories, 7.5 performance baselines, 0.5 advisory CI gate).

### §12 — Open Decisions
- §12.1 through §12.6 marked RESOLVED with verdicts.
- §12.7 marked RESOLVED.

---

## Rejected findings

None. Every finding was either applied as mechanical (49 of 50) or routed to tasks/todo.md as AUTO-DECIDED (1 of 50).

---

## Directional and ambiguous findings (autonomously decided)

| Iteration | Title | Classification | Decision | Rationale |
|---|---|---|---|---|
| 1 | RUBRIC-G — "why-not-reuse `policyEngineService`" rationale paragraph in §4.5.5 | ambiguous → conservative best-judgment | AUTO-DECIDED — accept | Routed to `tasks/todo.md` under "Deferred spec decisions — synthetos-foundation-refactor". The two services have genuinely different responsibilities (aggregation-at-run-start vs per-action evaluation); the spec implies it but doesn't state the rationale per checklist §1. Low-priority editorial improvement, not load-bearing. |

Two findings that LOOKED directional were correctly classified as mechanical realignment to the framing (and accepted as mechanical):

- Iteration 1 F7 (remove `RUN_TRACE_API_V1` and `POLICY_ENVELOPE_SNAPSHOT` flags): aligns spec with `feature_flags: only_for_behaviour_modes`.
- Iteration 1 F17 (trim test plan): aligns spec with `frontend_tests: none_for_now` / `e2e_tests: none_for_now` / `performance_baselines: defer_until_production`.

In both cases Codex was asking the spec to come INTO the framing, not to deviate from it.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against three rounds of Codex review. The review applied 49 mechanical fixes (no rejections). However:

- The review did not re-verify the framing assumptions at the top of `spec-context.md`. If the product context has shifted since iteration 1 (live users, staging environment, testing posture, rollout model), re-read the spec's headline G1-G8 / NG1-NG10 sections yourself before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement. Specifically: the Phase 1A item set, the dev-day estimates, the choice to ship Risk Tier governance enforcement inside `policyEngineService` rather than a new middleware, and the choice to ship a per-agent Models tab while deferring the subaccount-level Settings tab are all directional calls the human should re-confirm.
- One AUTO-DECIDED item (R-G — "why-not-reuse `policyEngineService`" paragraph) is in `tasks/todo.md` for the operator to action at leisure. It is not a blocker.

**Recommended next step:** re-read sections 0, 1, 2, 3, 4.1.6 (sub-account precedence), 4.2.8 (governance enforcement), 7.1, 8.1, 11, and 12 of the spec to confirm the framing and the resolved verdicts match your current intent. Then proceed to plan breakdown via `architect`.
