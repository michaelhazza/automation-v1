# Spec review log — synthetos-foundation-refactor — iteration 1

- Spec: `tasks/builds/synthetos-foundation-refactor/spec.md`
- Spec commit at start: `0be368dcab237accb4de920b49dc77be5f39f729`
- Codex output: `tasks/review-logs/_codex_synthetos_foundation_iter1_2026-05-09T06-58-09Z.txt`
- Codex returned 20 findings.

## Index

- Findings 1–10 (Codex)
- Findings 11–20 (Codex)
- Rubric findings A–H
- Summary

## Findings 1–10

### F1 — Schema Scope Contradiction
Section: 1.4, INV-5, 5.2.9, 6.1, 9.1. Codex says §1.4/INV-5 omit the four `subaccount_agents` governance columns introduced in §5.2.9. Mechanical (inventory drift). **Auto-apply** — update §1.4 schema-impact summary and INV-5 to acknowledge the four `subaccount_agents` columns.

### F2 — Run Trace Dependency Sequenced Too Early
Section: 4.4.14, 8.1. §8.1 puts Run Trace in Phase 1A (independent), §4.4.14 declares it depends on §4.5 (Phase 1B). Mechanical (sequencing bug; the dependency is already declared, the phase assignment just disagrees). **Auto-apply** — move §4.4 to Phase 1B in §8.1.

### F3 — Risk Tier Source-of-Truth Conflict
Section: G2, INV-8, 4.2.4, 4.2.8, 4.2.10. INV-8 says existing `gateLevel` wins unless explicit policy override; `deriveGateLevel(riskTier, policyOverride)` has no input for the existing `gateLevel`. Mechanical (load-bearing claim without backing function signature). **Auto-apply** — add `preservedExistingGateLevel` to `deriveGateLevel` signature; precedence `policyOverride > preservedExistingGateLevel > tierDefault`.

### F4 — Policy Envelope "Single Source of Truth" Overclaims
Section: 4.5.2, 4.5.7. §4.5.2 calls snapshot the single SoT; §4.5.7 says runtime enforcement reads live. Mechanical. **Auto-apply** — reword §4.5.2 + INV-9 to "snapshot is SoT for run-start state (audit/replay); live policy sources win for runtime enforcement (per §4.5.7)".

### F5 — Policy Envelope Immutability Has No Enforcement Mechanism
Section: INV-9, 4.5.6. INV-9 says snapshot is immutable; no DB trigger or service-layer guard named. Mechanical (load-bearing claim without enforcement). **Auto-apply** — add to §4.5.6 the optimistic predicate `UPDATE agent_runs SET policy_envelope_snapshot = $1 WHERE id = $2 AND policy_envelope_snapshot IS NULL` and document in INV-9 (state-based guard).

### F6 — Migration Idempotency Is Claimed But Not Implemented
Section: 6.3. Says migrations are idempotent on re-apply but SQL is plain `ADD COLUMN`. Mechanical. **Auto-apply** — soften §6.3 from "idempotent on re-apply" to "applied once via the Drizzle migration runner; the migrations ledger prevents re-application".

### F7 — Feature Flag Language Conflicts With Project Posture
Section: 4.4.10, 7.3, 8.3, 8.4. Spec adds `RUN_TRACE_API_V1` and `POLICY_ENVELOPE_SNAPSHOT` flags; framing is `feature_flags: only_for_behaviour_modes`. Codex asks to align WITH framing (remove flags) — mechanical realignment, not a directional change. **Auto-apply** — remove both flags; rely on backward-compatible defaults and revert via the standard rollback path.

### F8 — Execution-Safety Contracts Are Missing
Section: 4.1, 4.3, 4.5, 5.2, 5.4 (checklist §10). New writes lack idempotency posture, retry classification, concurrency guards. Mechanical (checklist §10). **Auto-apply** — add a §3.6 "Execution-safety contracts" subsection covering: (a) policy envelope snapshot write (state-based, NULL predicate per F5), (b) controller-style backfill (state-based, idempotent UPDATE), (c) credential broker calls (delegated; semantics inherit from underlying services), (d) credential audit route (read-only, no idempotency concerns), (e) subaccount governance updates (existing path).

### F9 — Terminal Run Trace Guarantee Is Undefined
Section: 4.4.4, 4.4.5 (checklist §10.4). `run_terminated` event listed without exactly-one guarantee, post-terminal prohibition, terminal status values. Mechanical. **Auto-apply** — add to §4.4.4 a "Terminal event" subsection: emitted from `agent_runs` final status (`completed | failed | cancelled | aborted`); exactly one per run; late events are diagnostic and ordered after the terminal event but not prohibited at the trace virtual-view layer (Phase 1 is read-only).

### F10 — Global Sequence Number Contract Is Unsupported
Section: 4.4.4, 4.4.5. `sequenceNumber` required + "global per run", but UNION sets NULL for several tables. Mechanical (type/SQL drift). **Auto-apply** — make `sequenceNumber: number | null`; document cursor ordering as `(timestamp, COALESCE(sequence_number, 0), source_table, id)`.

## Findings 11–20

### F11 — Run Trace Table Count Drifts
Section: G4, 4.4.1, 4.4.2, 4.4.4. Spec alternates between "five decision-ledger tables", "seven current tables", and adds events from `iee_steps` and `agent_runs`. Mechanical (inventory drift). **Auto-apply** — replace "five" with the explicit canonical list everywhere, matching §4.4.1's table inventory plus `iee_steps` and `agent_runs` (9 source tables total).

### F12 — CredentialBroker Method Count Mismatch
Section: 4.3.3, 9.1. Acceptance says "four methods"; API has five. Mechanical. **Auto-apply** — change §9.1 to "five methods".

### F13 — Credential Audit Route Guard Underspecified
Section: 5.4.4, 4.3.3. New `GET /api/subaccounts/:id/credential-audit` route lacks named guards / RLS context. Mechanical (checklist §4 — permissions/RLS for new route). **Auto-apply** — add explicit guard stack: `authenticate`, `resolveSubaccount`, `requirePermission('credentials:audit:read')`, principal-scoped DB context; auditEvents already RLS-protected.

### F14 — Subaccount Governance Precedence Missing
Section: 4.1.6, 5.2.9, 11.2. Run override may request `operator`; subaccount-level `controller_style_allowed` may say `native_only`. No winner. Mechanical (load-bearing claim without enforcement). **Auto-apply** — extend §4.1.6: if `controller_style_allowed = 'native_only'` and a run requests `operator`, route returns HTTP 422 with audit-log entry; otherwise the override applies.

### F15 — Phase Placeholder Language Stale
Section: NG3, 5.2.5, 11.6. Operator Session Identity is Phase 3 in NG3, "Phase 2" in §5.2.5 / §11.6. Mechanical (stale language). **Auto-apply** — change "Phase 2" to "Phase 3" in §5.2.5 and §11.6.

### F16 — Deferred Items Section Missing
Section: NG1-NG10, 5.1.4, 5.2.7, 11.6. Many deferred items but no `## Deferred Items` section per checklist §7. Mechanical. **Auto-apply** — add a `## Deferred Items` top-level section consolidating NG1-NG10 + per-section deferrals (5.1.4 details panel, 5.2.7 tabs, 11.6 placeholder rows).

### F17 — Test Plan Conflicts With Static-Gates-Primary Posture
Section: 7.1, 7.5, 7.6. Spec proposes integration / component / route / performance / E2E smoke tests; framing is `static_gates_primary`, `frontend_tests: none_for_now`, `e2e_tests_of_own_app: none_for_now`, `performance_baselines: defer_until_production`. Codex asks to align WITH framing — mechanical realignment. **Auto-apply** — trim §7 to: pure-function tests for resolvers + the new CI gate (`verify-risk-tier-assigned.sh`); keep at most 1–2 carved-out integration tests for the new run-trace UNION query and policy-envelope resolver (justified per `accepted_primitives` precedent of "small number of carved-out integration tests"); drop component tests, performance baselines, "20% regression" rule, and staging/production smoke runs (smoke-test scenarios stay as the run-correctness assertions but reframed as acceptance criteria not staging tests).

### F18 — Test Inventory Drift
Section: 4.1.10, 4.4.9, 5.2.8, 5.4.4, 7.2. Tests in implementation sections aren't in §7.2. Mechanical. **Auto-apply** — folded into F17 trim; canonical test list lives in §7.2.

### F19 — UI Priority Contradicts Acceptance
Section: 5.5, 9.3. Credentials audit log is "Nice to have" in §5.5 but required in §9.3. Mechanical. **Auto-apply** — set §5.5 to "Should have" to match acceptance.

### F20 — Backfill "Two Jobs" Count Wrong
Section: 6.4. Says "two one-time backfill jobs" but only one is real. Mechanical. **Auto-apply** — change to "One one-time backfill job runs".

## Rubric findings (independent pass)

### R-A — Spec frontmatter convention
Top of spec uses non-canonical `Status: Draft v1.0`, `Date:`, `Branch:`, `Authors:`. Checklist §11 mandates `Status:` (from canonical set), `Spec date:`, `Last updated:`, `Author:`, `Build slug:`. Mechanical. **Auto-apply** — convert to canonical frontmatter; preserve companion-document refs as a separate block.

### R-B — Test-gates-as-CI-only mandate
§7.4 references `scripts/run-all-gates.sh`; §7.6 mandates "smoke tests before merge"; §8.5 says "run smoke tests on production". Specs must NOT mandate local gate runs and should NOT mandate ad-hoc staging/prod test runs (CI is the gate). Mechanical (per spec-reviewer Rules and CLAUDE.md test-gates section). **Auto-apply** — soften to "CI runs the full suite as a pre-merge gate"; new gate `verify-risk-tier-assigned.sh` is registered with CI; smoke-test scenarios remain as acceptance verifications, not staging gates.

### R-C — `claude-code` execution mode → operator derivation
§4.1.6 maps `claude-code` to `operator`. Documented in switch with forward-comment. Not a finding. **Reject**.

### R-D — `auditEvents` RLS for new audit route
Folded into F13.

### R-E — `subaccount_agents` four new columns: explicit RLS-inherited statement
§5.2.9 adds four columns; existing RLS on `subaccount_agents` already covers them, but checklist §4 wants the inheritance stated explicitly. Mechanical. **Auto-apply** — one-liner in §5.2.9 or §6 confirming RLS is inherited.

### R-F — Risk Tier CSV in inventory
§4.2.6 references CSV at `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv`; §4.2.9 lists it. Not a drift. **Reject**.

### R-G — Why-not-reuse `policyEngineService` for envelope resolver
§4.5.5 introduces `policyEnvelopeResolver` distinct from `policyEngineService`. The two have genuinely different responsibilities (snapshot aggregation vs single-action evaluation). The spec implicitly justifies this but doesn't state it explicitly per checklist §1. Not load-bearing — minor. **AUTO-DECIDED — accept** but route to tasks/todo.md as a low-priority "consider adding a one-paragraph rationale" item.

### R-H — Scheduling-fields disclosure
§5.2.3 references existing scheduling fields. Existing surface, not new. Not a finding. **Reject**.

## Summary

- Mechanical accepted: F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12, F13, F14, F15, F16, F17, F18, F19, F20, R-A, R-B, R-E = **23**
- Mechanical rejected: 0
- Directional / ambiguous: 0
- Reclassified → directional: 0
- Autonomous decisions (AUTO-DECIDED): 1 (R-G — minor rationale note)

Reasoning notes: Findings F7 ("remove feature flags") and F17 ("trim test plan") look directional at first glance, but they ask the spec to align WITH the spec-context framing (no rollout flags, no frontend tests, no perf baselines), not to deviate from it. They are mechanical realignment fixes, not posture changes. The auto-apply trims the spec back to the framing.

## Iteration 1 Summary

- Mechanical findings accepted: 23
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 1 (R-G — accept; routed to tasks/todo.md)
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 1
- Spec commit after iteration: (set after commit)
