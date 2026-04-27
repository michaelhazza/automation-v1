# ChatGPT Spec Review Session — phase-A-1-2-spec — 2026-04-27T01-50-38Z

## Session Info
- Spec: tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md
- Branch: claude/add-system-monitoring-BgLlY
- PR: #213 — https://github.com/michaelhazza/automation-v1/pull/213
- Started: 2026-04-27T01:50:38Z
- Note: New session opened post the post-merge audit alignment commit (3e9143d0). Prior session (2026-04-26) was finalised at v1; the spec has since been reshaped by the post-merge audit (RLS-bypass posture, B2 admin-bypass guard, system-principal type=system convention). This session reviews the reshaped spec against fresh ChatGPT feedback.

---

## Round 1 — 2026-04-27T01-50-38Z

### ChatGPT Feedback (raw)

```
Here's a focused spec review of phase-A-1-2-spec.md with only the highest-leverage feedback. Overall, this is very close to execution-ready. The architecture is coherent, aligns with your post-hardening patterns, and avoids overreach.

Executive Summary
The spec is structurally sound and consistent with your current architecture (RLS posture, B2 jobs, principal model).
The biggest remaining risks are:
- Ambiguity around system-principal usage boundaries in mixed flows
- Idempotency edge cases across async + sweep interactions
- Heuristic correctness vs noise (false-positive control still underspecified at enforcement level)
No blockers, but a few areas should be tightened to prevent subtle production issues.

1. Principal Context Model — Final Tightening Needed
You fixed the big issue (scope → type), but there's still one ambiguity that will bite later. Mixed execution contexts are still too implicit. You define withSystemPrincipal, withAdminConnectionGuarded, withOrgTx + withPrincipalContext but the decision tree for when each is required is not formally locked. Add a hard rule table (Principal Usage Matrix) and one invariant: A system principal MUST NEVER be relied on to satisfy tenant RLS. All cross-tenant access MUST be explicit via withAdminConnectionGuarded.

2. Idempotency Model — One Missing Edge Case
Cross-job idempotency collision example: Sweep enqueues triage, Synthetic check also enqueues triage, Manual trigger enqueues triage — all for same incident window. You rely on pg-boss singleton keys + downstream idempotent writes but no explicit guarantee that enqueue-level duplication is harmless. Add invariant: All enqueue calls MUST use deterministic job keys; duplicate enqueues for the same logical action MUST collapse at queue layer (singletonKey) OR be harmless due to downstream idempotency. No job may rely solely on downstream DB idempotency to control fan-out. Clarify: triage:<incidentId> is the only allowed key; sweep must not generate alternate key shapes.

3. Baselining — Statistical Validity Gap
Mixed distributions (entity drift). Rolling p50/p95/p99 per (entity_kind, entity_id) but no behaviour when entity changes significantly. Example: agent upgraded, model changed, prompt changed → baseline becomes stale. Add baseline invalidation rule: reset on agent version / skill version / model used / major configuration hash change. Implementation: baseline key includes configHash.

4. Heuristics Layer — Detection vs Action Boundary
Heuristics defined but not formally constrained. Risk: future creep — heuristics start encoding business logic. Add strict contract: A heuristic MAY evaluate signals and produce a score or boolean fire decision; MUST NOT mutate state directly; MUST NOT trigger side effects beyond emitting a candidate or fire record. All side effects (incident creation, triage enqueue, etc.) occur in the orchestration layer only.

5. Investigate-Fix Protocol — Versioning Risk
You correctly made it git-versioned, but incidents store investigate_prompt and protocol evolves; you don't track which protocol version generated the prompt. Add system_incidents.investigate_protocol_version (string, nullable). Set to git SHA or semantic version of docs/investigate-fix-protocol.md at time of generation.

6. Failure Modes — One Blind Spot
Partial success in multi-step jobs. Example: sweep identifies 50 candidates, 30 succeed, 20 fail. Right now state is implied but not defined. Add invariant: Any batch job MUST emit a summary event (success_count, failure_count); never silently drop failed items; ensure failed items are retryable or observable via DLQ.

7. Monitoring the Monitor — Meta Gap
Mention self-checks but no explicit success criteria for the monitoring system itself. Add: System monitor health signals — % of incidents auto-triaged, false positive feedback rate, avg time from incident → diagnosis, sweep coverage rate. These MUST be observable in Phase 3.

8. Minor Cleanups
- Duplications still present — duplicate rows for system principal definition, GA.3, S3. Clean to reduce cognitive load.
- Naming drift — incidentIngest vs incidentIngestor. Lock canonical name.
- Event taxonomy — All new event types MUST be declared in a single enum registry (source-of-truth), not inline.

Final Verdict
Status: Ready to build with minor tightening.
```

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| 1. Principal usage matrix (normative) + invariant: system principal NEVER satisfies tenant RLS | technical | apply (condensed normative form) | auto (apply) | medium | The decision tree exists in §4.3 prose (lines 411-413) and the three-layer fail-closed table (lines 402-407), but a one-glance matrix + one-line invariant promote it from interpretive to normative. The invariant is already implicit in the spec ("the system principal is **not** used to satisfy a tenant RLS policy"), promoting to a hard rule prevents drift. Internal contract clarification — non-user-facing. |
| 2. Cross-job enqueue idempotency invariant | technical | partial-apply (invariant statement) + reject (one-key claim) | auto (mixed) | medium | The invariant ("deterministic enqueue keys MUST collapse at queue layer OR be harmless via downstream idempotency") is genuinely worth promoting from §4.8 implicit pattern to explicit rule. The "manual trigger enqueues triage" example in ChatGPT's premise is a false premise — the spec has no manual triage trigger. The "triage:<incidentId> is the only allowed key / sweep must not generate alternate key shapes" specification is **incorrect**: incident-driven (§9.2) and sweep-driven (§9.3) deliberately use different namespaces (`triage:<incidentId>` vs `sweep:<candidateKind>:<candidateId>:<bucketKey>`); convergence happens at the work-product layer (`(incidentId, agentRunId)` composite-key idempotency in `write_diagnosis`). Collapsing namespaces would prevent the sweep from triaging a candidate already enqueued by incident-driven trigger. Apply the invariant; reject the one-key claim with explicit explanation in the spec. |
| 3. Baseline invalidation on entity drift (agent prompt / model / skill version change) | technical | apply (with reset-trigger phrasing, no configHash-in-key) | auto (apply) | high | Genuine correctness gap. After a model swap or prompt rewrite, the prior 7-day baseline produces false positives until the rolling window catches up. ChatGPT's `configHash`-in-key approach works but adds a column to the unique constraint + breaks the natural-key invariant. Cleaner approach: add `entity_change_marker` column to `system_monitor_baselines`, on refresh tick compare to source-entity field (prompt_hash / model / version), reset row on mismatch. Surfaces as `insufficient_data` during warm-up — same cold-start handling as a brand-new entity (§7.4). New §7.6 + column add to §4.5. Internal correctness. |
| 4. Heuristic boundary contract (detection-only; no DB mutation; no side effects) | technical | apply | auto (apply) | medium | Genuine forward-protection. The §6.2 interface allows write access via `db: Database` on `HeuristicContext`, and there's no explicit invariant preventing a future heuristic author from writing audit rows directly inside `evaluate`. Adding the normative contract + a CI gate in Slice C (grep for write-shaped Drizzle calls in heuristic modules) closes the loophole. Centralising side effects in the orchestrator preserves rate limit + throttle + audit + dedup invariants. Internal architecture defence. |
| 5. Investigate-Fix Protocol versioning — git SHA on incident row | technical | partial-apply (rule clarification, no new column) | auto (mixed) | low | The spec already addresses versioning via `## Protocol\nv1` line in every prompt body (§5.2). Adding a `system_incidents.investigate_protocol_version` column would create a duplicate source of truth (column vs prompt text) and require a backfill story for pre-bump rows. The lighter-touch fix: add a rule in §5.5 stating "when the protocol bumps to v2, the agent's prompt template (§9.7) must update in the same commit; old incidents retain their original `## Protocol\nv1` text indefinitely; consumers MUST branch on the `## Protocol` line if they need version-specific behaviour." Per §4.10.7: prompt body IS the work product; the work-product layer is the source of truth. Apply the rule clarification; reject the new column. |
| 6. Partial-success contract for batch jobs (success_count, failure_count, retryable items) | technical | reject | auto (reject) | n/a | Already covered. §9.3 `SweepResult` has `fired` (succeeded), `errored` (failed), `suppressed`, `insufficient_data`, `capped` fields; `system_monitor_heuristic_fires` audit row is written for every fire, suppression, and insufficient-data case (§4.5); `sweep_completed` event carries `candidates_evaluated`, `fires`, `triages_enqueued`, `sweep_capped_count` summary; pg-boss DLQ + `dlq-not-drained` synthetic check (§8.2) is the catch-all for persistent failure; §4.10.3 (Partial Success × Retry) names the cross-cutting rule. ChatGPT's example (50 candidates, 30 succeed, 20 fail) maps directly onto SweepResult with `fired.length=30`, `errored.length=20`, plus `system_monitor_heuristic_fires` rows for every pair. Adding a generic "summary event" would duplicate the existing `sweep_completed` event. Per the over-specification warning from prior rounds — restating already-covered rules. |
| 7. Monitor-the-monitor — derived health signals (auto-triage rate, FP rate, time-to-diagnosis, sweep coverage) | technical | partial-apply (name derived signals + sources, no new primitives) | auto (apply) | medium | Genuine observability gap. The signals ChatGPT proposes are computable from existing event sources (`agent_diagnosis_added`, `agent_triage_skipped`, `agent_triage_failed`, `prompt_was_useful`, `sweep_completed`) — naming them once as derived metrics + their source events is internal-clarity work consistent with the deferred-Phase-3-dashboard posture. Add §12.5 listing eight signals + sources. NO new metric primitive (no `system_monitor_health_metrics` table, no metrics-service push) — those would be a third source of truth per §4.10.7. The signals ARE the dashboard's spec when Phase 3 builds it. Internal observability. |
| 8a. Duplicate rows — system principal definition / GA.3 / S3 | technical | reject | auto (reject) | n/a | False-positive. The system principal is mentioned in 5 places: glossary §0A line 119 (term), Decisions log Q11 line 75 (decision), GA.3 line 251 (goals criterion), §4.3 lines 370-378 (implementation contract), S3 line 309 (success criterion). Each serves a different reader path. Per Round 4 (2026-04-26) of the prior session: the spec's structure deliberately separates concerns; collapsing would lose dual-entry navigation. ChatGPT's claim is the same false-positive caught and rejected in the prior session's Round 4. |
| 8b. Naming drift — incidentIngest vs incidentIngestor | technical | reject | auto (reject) | n/a | False-positive. Spec uses `incidentIngestor` consistently (lines 2281, 2282, 2373, plus the file inventory) — there is no `incidentIngest` (without trailing -or) anywhere in the current spec. ChatGPT's claim is incorrect. |
| 8c. Event taxonomy — single enum registry, no inline declarations | technical | apply | auto (apply) | low | §12.1's event-type table IS the registry; promoting the rule to "every event type emitted by code in this spec MUST appear in this table; new types extend it in the same commit; no inline string literals" + a CI gate in Slice C (grep for `event_type:\s*['"]` outside the canonical union file) closes the drift surface. Internal observability invariant. |

(Round 1: 9 distinct findings — 4 auto-apply, 2 auto-reject, 3 partial-apply [findings 2, 5, 7]. Findings 8a-8c are tracked as three distinct mini-findings with their own decisions. Zero user-facing. Zero `[missing-doc]` escalations.)

### Applied (auto-applied technical findings)

- [auto] Added Principal Usage Matrix (normative) + invariant ("a system principal MUST NEVER be relied on to satisfy a tenant RLS policy") in §4.3 — finding 1.
- [auto] Added Enqueue idempotency invariant in §4.8 (deterministic keys + collapse-at-queue-layer-OR-harmless-via-downstream-idempotency rule) + explicit explanation that incident-driven and sweep-driven triage use different namespaces by design and converge at the work-product layer — finding 2 (apply portion). Reject portion explained inline in the new paragraph.
- [auto] Added §7.6 Baseline invalidation on entity drift — agent `prompt_hash` / `model` / skill `version` / connector schema marker change triggers baseline reset; new `entity_change_marker` column on `system_monitor_baselines` (per-§4.5 update) — finding 3.
- [auto] Added Heuristic boundary contract (normative) in §6.2 — detection-only invariant, no DB mutation, no side effects, hot path in-process — finding 4. Wired into Slice C as a new CI gate (heuristic-purity gate).
- [auto] Added Protocol version stamping rule in §5.5 — version stamp lives in prompt body per §4.10.7; no new column on `system_incidents`; consumers MUST branch on `## Protocol` line — finding 5 (apply portion). Reject portion explained inline.
- [auto] Added §12.5 Monitor-the-monitor — derived health signals — eight signals named with their source events / DB-row sources; explicit "no new primitive" rationale referencing §4.10.7 — finding 7 (apply portion).
- [auto] Added Event registry invariant in §12.1 — every event type MUST appear in the table; CI gate in Slice C (event-registry gate) greps for inline `event_type:\s*['"]` literals outside the canonical union file — finding 8c.
- [auto] Added Slice C CI gates deliverable bullet (item 8) covering both new gates: heuristic-purity gate + event-registry gate.
- [auto] Updated Spec Status to v1.1 (post-merge audit alignment + Round 5 tightening); recorded total findings (38: 28 applied / 8 rejected / 2 partial-applies / 0 deferred) and the latest review meta.

### Rejected (with rationale logged in the table)

- Finding 6 (partial-success contract) — already covered by §9.3 SweepResult + `sweep_completed` event + DLQ → synthetic check + §4.10.3.
- Finding 8a (duplicate rows for system principal / GA.3 / S3) — false-positive; same dual-entry navigation pattern caught and rejected in prior session's Round 4.
- Finding 8b (incidentIngest vs incidentIngestor) — false-positive; spec uses `incidentIngestor` consistently throughout.
- Finding 2 (one-key-only claim) — incorrect; namespaces are intentional. Explained inline in the new §4.8 invariant.
- Finding 5 (new column for protocol version) — duplicate source of truth per §4.10.7. Lighter-touch rule applied instead.

### Integrity check

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

Cross-references introduced this round:
- §4.10.7 (referenced from §5.5 protocol version stamping rule, §7.6 baseline invalidation cross-cutting rule, §12.5 health-signals "no new primitive" rationale) — present at line 803.
- §7.6 (new sub-section, referenced from §4.5 `entity_change_marker` column note) — present at new location.
- §7.4 (referenced from §7.6 cold-start handling parity) — pre-existing, present.
- §4.5 / §6.2 / §9.3 / §9.7 / §12.1 (referenced across the new edits) — all pre-existing, all present.
- New CI gates wired into Slice C deliverables list (§17.3) — bullet 8 added; gate names referenced from §6.2 + §12.1 invariants.

Post-integrity sanity (4c): re-scanned heading list — §7.6 and §12.5 are properly nested sub-sections; §0–§19 top-level headings unchanged; ToC entries unchanged (sub-sections do not require ToC entries per existing pattern with §7.4 / §7.5 / §12.4). The Spec Status block correctly version-bumped from v1 to v1.1 with the Round 5 (2026-04-27) line and the 38-finding total. No empty sections produced. Pass.

