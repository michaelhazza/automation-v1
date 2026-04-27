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

---

## Round 2 — 2026-04-27T02-21-04Z (commit 9858a6af)

### ChatGPT Feedback (raw)

```
Good pass. You closed the biggest structural risks. What's left now is mostly edge-condition hardening and future-proofing, not architectural changes.

Below is Round 2 focused only on things that could still bite you in production.

Executive Summary
Spec is now build-ready and robust
Remaining gaps are:
- Incident lifecycle completeness
- Concurrency edge cases (double-fire + race windows)
- Heuristic tuning safety (false positive containment)
- Sweep coverage guarantees
No structural changes required, just tightening invariants

1. Incident Lifecycle — Missing "Resolution Model"
You've defined ingestion, triage, investigation — but you haven't fully locked what ends an incident.
Current gap: no strict definition of resolved vs ignored vs superseded; whether incidents can re-open.
Why this matters: without this, duplicate incidents over time, noisy dashboards, broken "monitor the monitor" metrics.
Fix — add: ### Incident lifecycle states (normative)
open → triaged → investigating → resolved | ignored | superseded
Definitions: resolved/ignored/superseded.
Invariant: Only one OPEN incident may exist per (entity_kind, entity_id, heuristic_type)
Invariant: Incident re-open — resolved/ignored MUST NOT re-open. New occurrences MUST create a new incident with a new id.

2. Concurrency — Double-Fire Race Window
Two workers detect same anomaly, both pass "no open incident" check, both insert incident.
Risk: duplicate incidents despite idempotent jobs.
Fix — partial unique index on (entity_kind, entity_id, heuristic_type) WHERE status IN ('open', 'triaged', 'investigating') + INSERT ... ON CONFLICT DO NOTHING.

3. Heuristic Safety — False Positive Containment
You defined purity. Good. But you didn't define how aggressive heuristics are allowed to be.
Risk: early heuristics are noisy, system floods incidents, trust collapses quickly.
Fix — add a global guardrail: A heuristic MUST NOT emit incidents if baseline sample size < MIN_SAMPLE_THRESHOLD or confidence score < MIN_CONFIDENCE.
Initial defaults: MIN_SAMPLE_THRESHOLD = 30, MIN_CONFIDENCE = >= 0.7 recommended.
Invariant: Rate limiting — A single heuristic MUST NOT generate more than N incidents per entity per hour (default N=1).

4. Sweep Coverage — Silent Blind Spot Risk
You mention sweeps, but not coverage guarantees. If sweeps silently degrade, some entities never checked, monitoring becomes partial without visibility.
Fix — add: Every active entity MUST be evaluated at least once per SWEEP_WINDOW (e.g. 24h). System MUST track: last_evaluated_at per entity. Violation emits: system_monitor.coverage_gap event.

5. Baseline Drift — Over-Correction Risk
You added invalidation. Good. But baselines can shift too fast if recalculated aggressively — anomalies get "absorbed" into baseline, system stops detecting real issues.
Fix — Baseline updates MUST be smoothed: rolling window minimum size enforced, sudden shifts (>X%) require gradual incorporation (e.g. EMA or capped delta).
Invariant: Baseline MUST NOT change more than MAX_DELTA per update cycle.

6. Investigate-Fix — Determinism Gap
You added versioning in prompt body. Good. Still missing: same incident could generate slightly different prompts over time if context changes.
Risk: inconsistent debugging, hard to reproduce results.
Fix — Invariant: Investigate prompt determinism. Given the same incident_id + underlying logs snapshot + protocol version, the generated investigate_prompt MUST be deterministic. And: snapshot log references (IDs or time window), not live queries.

7. Event Ordering — Subtle but Important
You added registry. Good. Missing: event ordering across async flows is not guaranteed.
Risk: timeline reconstruction breaks, debugging becomes unreliable.
Fix — Invariant: Event ordering. Events MUST include occurred_at (event time) + recorded_at (write time). Consumers MUST NOT assume strict ordering by insertion.

8. Retry Semantics — Clarify One Thing
You reference retries, but not classification.
Add: Retry classification: transient → automatic retry with backoff, permanent → emit terminal failure event no retry, unknown → bounded retry (max N attempts). No infinite retries allowed.

9. One Small Naming Fix (Worth Doing)
Even if rejected earlier, this one is low effort, high clarity:
Lock: incident_ingest (function/process), incident (entity)
Avoid: mixing "ingestor", "ingest", "pipeline"

Final Verdict: Production-safe with these additions.
```

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| 1. Incident lifecycle states `open → triaged → investigating → resolved \| ignored \| superseded` + uniqueness on `(entity_kind, entity_id, heuristic_type)` | technical | reject | auto (reject) | n/a | False premise. The Phase 0 incident state machine ALREADY exists with `open \| investigating \| remediating \| resolved \| suppressed \| escalated` (`server/db/schema/systemIncidents.ts:13`). Phase 0 §5.6 ALREADY enforces a partial unique index on `fingerprint` WHERE status IN active states, with `ON CONFLICT (fingerprint) DO UPDATE SET occurrence_count = occurrence_count + 1` semantics. Phase 0 §4.1 ALREADY commits to "Once resolved, a new occurrence will open a fresh incident row" — the exact "no re-open, new id on recurrence" semantic ChatGPT proposes. ChatGPT's `(entity_kind, entity_id, heuristic_type)` uniqueness would FIGHT the existing fingerprint-based design — the spec deliberately treats fingerprint (not heuristic_type) as the canonical identity per §4.8, and per §9.3 multiple heuristics firing on the same candidate produce ONE incident with multiple fires (clustering), not one per heuristic. Adopting ChatGPT's schema would break Phase 0's clustering. The proposed `triaged` state has no operational meaning — Phase 0's `investigating` covers it. `ignored` maps to existing `suppressed`. `superseded` is the existing "resolved + new row on recurrence" pattern. Round 1's already-covered rejection rationale stands. |
| 2. Cross-job race — partial unique index + INSERT...ON CONFLICT DO NOTHING | technical | reject | auto (reject) | n/a | Already implemented. Phase 0 §5.6 (`phase-0-spec.md:707-720`) shows the exact INSERT...ON CONFLICT...DO UPDATE pattern with the partial unique index on `fingerprint` WHERE status IN active states. Two workers detecting the same anomaly produce the same fingerprint (per §4.8 deterministic identity rule); both INSERTs collide on the partial unique index; ON CONFLICT DO UPDATE bumps `occurrence_count` instead of writing a duplicate. ChatGPT's proposed key `(entity_kind, entity_id, heuristic_type)` is **incorrect** (see finding 1) and would break clustering. The existing fingerprint-based mechanism completes the race-protection picture. The recommended ON CONFLICT DO NOTHING (vs DO UPDATE) is also a regression — Phase 0's DO UPDATE is what enables the `occurrence_count` bump that operators rely on for "this fingerprint is recurring" signal. |
| 3. Heuristic firing constraint — MIN_SAMPLE_THRESHOLD, MIN_CONFIDENCE, per-heuristic per-entity per-hour rate limit | technical | partial-apply (contract + per-entity fire-rate cap as opt-in heuristic field; reject the specific value changes) | auto (mixed) | medium | The two threshold controls already exist and are named in the spec — `BaselineRequirement.minSampleCount` (default 10, §6.2/§7.4), `SYSTEM_MONITOR_MIN_CONFIDENCE` (default 0.5, §9.10) — but the **invariant statement** ("a heuristic MUST NOT emit incident-eligible fires when X / Y / Z") is implicit, not normative. Promoting to a constraint contract in §6.3 makes it a code-review block. The **per-entity fire-rate cap** is a genuine new control — fingerprint-based incident dedup (Phase 0 partial unique index) collapses INCIDENTS, but a heuristic firing 100×/hour on the same entity still produces 100 audit rows and 100 confidence calls — opt-in `firesPerEntityPerHour?` on `Heuristic` is the right surface. Reject the proposed default value bumps (sample 10→30, confidence 0.5→0.7) — those are tuning preferences, not contract additions, and §6.5 PR-based tuning is the correct mechanism per the spec's existing decision tree. Apply: contract paragraph in §6.3 + new optional field on `Heuristic` interface §6.2 + opt-in cap enforcement at orchestrator. |
| 4. Sweep coverage — `last_evaluated_at` per entity + `coverage_gap` event | technical | partial-apply (new `sweep-coverage-degraded` synthetic check + sweep coverage invariant in §12.5; reject per-entity column) | auto (mixed) | medium | The sweep coverage rate is ALREADY named as a derived health signal in §12.5 (Round 1 v1.1), but it's an observability signal, not an active alarm. Promoting it to a synthetic check that fires an incident when coverage drops below threshold makes the rate **operationally surfaced** rather than dashboard-only — operators see a fired incident in the existing queue, no new dashboard required. Reject `last_evaluated_at` per entity — entities not in the sweep window are by definition not anomalous (§9.3 uses 15-min window of activity); adding a per-entity column would be a third source of truth (§4.10.7) for state already encoded by the window definition. The `coverage_gap` event premise is right; the `last_evaluated_at` column is wrong. Apply: new synthetic check `sweep-coverage-degraded` + two new env vars + an invariant paragraph in §12.5. |
| 5. Baseline smoothing — EMA / capped delta / MAX_DELTA per update cycle | technical | reject | auto (reject) | n/a | Already covered by the existing aggregate model. §7.3 describes a 7-day rolling-window aggregate computed via percentiles (p50/p95/p99) — a single anomalous run is 1/N where N is thousands of observations, so single-event noise is already smoothed by construction. EMA / capped-delta is the right pattern for streaming-update models that don't store the underlying observations; the spec's percentile-aggregate model recomputes from raw rows on every refresh tick (§4.8 idempotency mechanism: "Replay-safe deterministic recompute"). The "absorbing anomalies" worry would apply if the baseline updated incrementally per-observation; it does not. ChatGPT's identity-drift concern (entity changed, baseline becomes stale) is already addressed by §7.6 (Round 1 v1.1) — reset on prompt_hash / model / version change. Drift-over-time history is already deferred to Phase 3 (§7.2). Adding EMA / MAX_DELTA on top would fight the existing rolling-window aggregate (percentiles don't have a delta the way EMA does). |
| 6. Investigate prompt determinism — same incident + log snapshot + protocol → same prompt | technical | reject | auto (reject) | n/a | Wrong frame for an LLM-generated prompt. LLM output is non-deterministic by construction (sampling temperature, stochastic decoding); forcing determinism would require either a templated prompt (defeats the purpose of an LLM) or caching the prompt text (which the spec already does via `system_incidents.investigate_prompt`, §4.5). The actual operationalised concern — "stable references in the prompt body so re-reading the prompt is reproducible" — is already addressed in §9.7: "Cite evidence. Every claim in your diagnosis must be backed by a specific read — a row id, a file:line reference, a baseline reading, a heuristic fire id. Never fabricate a file path or a line number." Snapshot log references via stable IDs (run id, fire id, baseline reading) is exactly what §9.7 requires. The audit trail of historical prompts lives in the `system_incident_events` log (§9.8 — "subsequent triages overwrite the prior diagnosis and prompt; the audit trail is the system_incident_events log"). Already covered — no spec change. |
| 7. Event ordering — `occurred_at` + `recorded_at`, no strict insertion order | technical | partial-apply (clarifying rule in §4.10.8 + optional `metadata.occurred_at` per §12.1 carve-out; reject column-on-every-event) | auto (mixed) | low | §4.9.9 already names the ordering rule ("Ordered by `created_at` and surrogate `id` (uuid v7)"), and §4.10.8 already requires server-only timestamps. The genuine gap ChatGPT names: events written via outbox / async write may have a meaningful gap between event time and row write time. The synchronous-write majority (every event in §12.1 currently written inside its source tx — §9.2 outbox tx, §9.8 write_diagnosis) does not need a separate field — `created_at` IS the event time. The async-emitted minority (`agent_diagnosis_added`, `prompt_generated` if deferred) MAY carry `metadata.occurred_at`. Apply: clarifying rule in §4.10.8 + optional-metadata carve-out in §12.1. Reject column-on-every-event — would duplicate `created_at` for the synchronous majority (§4.10.7 second source of truth). |
| 8. Retry classification — transient / permanent / unknown | technical | reject | auto (reject) | n/a | Already covered by §12.4 (retry defaults table) + §4.7 (per-component failure mode tables) + §4.10.4 (Failure Mode × Idempotency). pg-boss does not classify retries — it retries 3x then DLQ, where the `dlq-not-drained` synthetic check (§8.2) is the catch-all. The "permanent failure → emit terminal event, no retry" pattern IS already in the spec via `agent_triage_failed` events with `reason='prompt_validation' / 'agent_run_failed' / 'timeout' / 'self_stuck'` (§9.8 — "After 2 failures: agent_triage_failed event with reason=prompt_validation"; §9.11 — same for self_stuck). The "bounded retry max N" is the existing pg-boss-3 + agent-loop-2 model. Adding a generic transient/permanent classifier on top would duplicate the existing per-failure-type handling without adding clarity. |
| 9. Naming — lock `incident_ingest` (function), `incident` (entity), avoid `ingestor` / `ingest` / `pipeline` | technical | reject | auto (reject) | n/a | Same false-positive as Round 1 finding 8b. The spec consistently uses `incidentIngestor` (the service module name, e.g. lines 2281, 2282, 2373, 2479, file inventory), `incident` (the entity), and `recordIncident` (the public mutation). `incident_ingest` does NOT appear anywhere in the spec. Adopting ChatGPT's proposal would create a new naming variant where none exists. Round 1 rejection rationale stands — the spec is internally consistent; ChatGPT's recommendation introduces drift rather than removing it. |

(Round 2: 9 distinct findings — 6 auto-reject as already-covered or wrong frame, 3 partial-apply [findings 3, 4, 7]. Zero user-facing. Zero `[missing-doc]` escalations. Zero defers.)

### Applied (auto-applied technical findings)

- [auto] Added Heuristic firing constraint contract (normative) in §6.3 — three-row table covering sample threshold (existing `minSampleCount`, default 10), confidence threshold (existing `SYSTEM_MONITOR_MIN_CONFIDENCE`, default 0.5), and new opt-in per-entity fire-rate cap (`firesPerEntityPerHour?`); explanatory paragraphs on why the cap is opt-in and why no global "max N incidents per entity per hour" rule (would conflict with Phase 0 fingerprint-based dedup) — finding 3 (apply portion). Reject portion (specific default-value changes 10→30, 0.5→0.7) explained inline as "starting values, not invariants" with §6.5 PR-based tuning as the correct mechanism.
- [auto] Added optional `firesPerEntityPerHour?: number` field to `Heuristic` interface in §6.2 with inline comment describing orchestrator-side enforcement and `metadata.suppression_id = 'rate_capped'` audit row pattern — finding 3 (apply portion, interface change).
- [auto] Added new synthetic check `sweep-coverage-degraded` to §8.2 day-one set — `high` severity, reads `sweep_completed` event series + active-entity row count, fires when rolling coverage rate drops below threshold for `SYSTEM_MONITOR_COVERAGE_LOOKBACK_TICKS` (default 6). No new data primitive — uses §12.5's existing health signal as the source — finding 4 (apply portion).
- [auto] Added two env vars `SYSTEM_MONITOR_COVERAGE_LOOKBACK_TICKS` (default 6) + `SYSTEM_MONITOR_COVERAGE_THRESHOLD` (default 0.95) to §8.4 (per-section list) and §12.2 (consolidated list) — finding 4 (apply portion).
- [auto] Added Sweep coverage invariant (normative) to §12.5 — promotes the §12.5 sweep coverage rate from observability signal to active health invariant via `sweep-coverage-degraded`; explicitly rejects per-entity `last_evaluated_at` column with §4.10.7 third-source-of-truth rationale — finding 4 (apply portion). Reject portion (per-entity column) explained inline.
- [auto] Added Event-time vs write-time clarification (normative) to §4.10.8 — `created_at` = `recorded_at` (write time); `metadata.occurred_at` MAY be present on async-emitted events when the gap is meaningful (`agent_diagnosis_added`, `prompt_generated`); consumers prefer `metadata.occurred_at` when present and fall back to `created_at`; explicit "no new column on every event row" rationale citing §4.10.7 — finding 7 (apply portion).
- [auto] Added optional `metadata.occurred_at` rule to §12.1 — names the carve-out events (`agent_diagnosis_added`, `prompt_generated`, future async-emitted) and clarifies that the synchronous-write majority does not need it — finding 7 (apply portion).
- [auto] Updated Spec Status to v1.2 (Round 6 ChatGPT pass); recorded total findings (47: 31 applied / 14 rejected / 0 deferred / 5 partial-applies) and the latest review meta.

### Rejected (with rationale logged in the table)

- Finding 1 (incident lifecycle states + entity-heuristic uniqueness) — Phase 0 §5.6 + `systemIncidents.ts:13` already implement the full state machine + fingerprint-based partial unique index; ChatGPT's proposal would break clustering and contradict the canonical identity rule (§4.8).
- Finding 2 (race protection via partial unique index + ON CONFLICT) — Phase 0 §5.6 already implements this on `fingerprint` (correct identity), with DO UPDATE (preserves `occurrence_count` bump signal); ChatGPT's DO NOTHING would be a regression.
- Finding 3 reject portion (default-value bumps) — sample/confidence default changes are tuning, not contract; §6.5 PR-based tuning is the mechanism.
- Finding 4 reject portion (per-entity `last_evaluated_at` column) — third source of truth (§4.10.7) for state already encoded by the sweep window definition.
- Finding 5 (baseline smoothing — EMA / MAX_DELTA) — wrong frame for the percentile-aggregate model; existing 7-day rolling window already smooths; identity-drift covered by §7.6.
- Finding 6 (prompt determinism) — wrong frame for LLM output; the underlying concern (stable references) is already in §9.7.
- Finding 7 reject portion (column-on-every-event) — would duplicate `created_at` for the synchronous-write majority.
- Finding 8 (retry classification) — already covered by §12.4 + §4.7 + §4.10.4 + per-failure-type events (`agent_triage_failed.reason`).
- Finding 9 (naming) — false positive; spec uses `incidentIngestor` consistently, `incident_ingest` does not appear.

### Integrity check

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

Cross-references introduced this round:
- §6.3 firing-constraint contract — references `BaselineReader` (§7.5, present), `requiresBaseline` (§6.2, present), `system_monitor_heuristic_fires` (§4.5, present), `phase-0-spec.md §5.6` (external, present), §4.5 / §4.10.7 / §6.5 / §9.2 / §9.3 / §9.10 (all present).
- §6.2 new `firesPerEntityPerHour?` field — additive, optional, does not break existing heuristics.
- §8.2 new `sweep-coverage-degraded` synthetic check — references `sweep_completed` event (§12.1, present), §12.5 health signal (present), the new env vars (added below).
- §8.4 + §12.2 new env vars `SYSTEM_MONITOR_COVERAGE_LOOKBACK_TICKS` + `SYSTEM_MONITOR_COVERAGE_THRESHOLD` — additive.
- §12.5 sweep coverage invariant — references §8.2 new check (added), §12.1 `sweep_completed` (present), §4.10.7 (present), §9.3 (present).
- §4.10.8 event-time vs write-time rule — references §4.10.7 (present), §4.9.9 (present), §9.2 outbox (present), §9.8 (present).
- §12.1 optional `metadata.occurred_at` rule — references §4.10.8 (present, just extended).

Post-integrity sanity (4c): no integrity-check applied any mechanical fix this round (no broken refs found by the pass), so 4c is a no-op. Re-scanned heading list — no new top-level or sub-headings added; existing structure preserved. ToC unchanged. Spec Status block correctly version-bumped from v1.1 to v1.2 with the Round 6 (2026-04-27) line and the 47-finding total. No empty sections produced. Pass.

---

## Finalisation — 2026-04-27T (session-close)

### NG10 reconciliation (pre-finalisation cleanup)

ChatGPT's Round 2 final verdict flagged: "Make sure NG10 is updated or removed if it still says 'No prompt versioning', because §5.5 now has protocol version stamping in the prompt body."

Verification: `grep -in "prompt versioning"` against the spec found three stale sites — all from v1.0, none updated by Rounds 1 or 2:

1. **§3.2 NG10** (line 301) — "**NG10 No prompt versioning.**"
2. **§5.7-area paragraph** (line 1875) — "**No prompt-text version stamp.**"
3. **§3.2 echo / longer-form non-goals discussion** (line 2972) — "**No prompt versioning at runtime.**"

All three said "no protocol-version stamp" but Round 1 §5.5 added a `## Protocol\nv<n>` line in the prompt body itself — so the stamp DOES exist in-band, what's omitted is a structured column.

**Applied (single mechanical reconciliation pass — auto-applied as technical):**

- [auto] Restated NG10 (§3.2) as "**NG10 No structured protocol-version column on `system_incidents`.**" — preserves the deliberate-omission framing while accurately naming what's omitted (the column, not the stamp itself). References §5.2 / §5.5 as the in-body stamp authority and §4.10.7 as the work-product source-of-truth rule.
- [auto] Restated §5.7-area paragraph as "**No structured version field on the prompt payload.**" — clarifies that the in-body `## Protocol\nv<n>` line IS the version stamp; what's absent is a separate JSON field or column. Per-payload `schema_version` continues to apply to structured JSON only (`agent_diagnosis`, event `metadata`).
- [auto] Restated longer-form non-goals echo as "**No structured protocol-version column on `system_incidents`.**" — same reframe as NG10 with the §4.10.7 work-product rationale.
- [auto] Spec Status block bumped to v1.3 with finalisation-cleanup line; total findings 47 → 48 (32 applied / 14 rejected / 0 deferred / 5 partial-applies).

**Triage classification:** technical — internal correctness clarification, no observable behaviour change, no schema change. Auto-applied per the standard contract (no escalation carveouts triggered).

**Integrity check (post-cleanup):** `grep -in "prompt versioning|No prompt-text version"` returned zero matches across the spec. No broken cross-references introduced. ToC unchanged. Pass.

### Session-close summary

- **Rounds processed:** 2 (Round 1 — v1.0 → v1.1, commit 761bc9ea; Round 2 — v1.1 → v1.2, commit 9858a6af) + finalisation NG10 cleanup (v1.2 → v1.3).
- **Total findings (this session):** 18 distinct ChatGPT findings + 1 finalisation cleanup = 19 decisions.
  - Round 1: 9 findings — 4 full apply, 2 reject, 3 partial-apply (apply portion + reject portion documented inline).
  - Round 2: 9 findings — 0 full apply, 6 reject, 3 partial-apply.
  - Finalisation: 1 cleanup — 1 apply (mechanical reconciliation, three sites in one pass).
- **Auto-accepted (technical):** 19 of 19 decisions auto-applied. Zero user-facing escalations across both rounds.
- **Defers:** 0 across both rounds. Confirmed against `tasks/todo.md` — no spec-review items routed.
- **Final spec version:** v1.3 (Finalised — Execution Ready).
- **PR:** #213 — https://github.com/michaelhazza/automation-v1/pull/213
- **Final commits on branch:** 3e9143d0 (post-merge audit alignment) → 761bc9ea (Round 1) → 9858a6af (Round 2) → finalisation commit (NG10 reconciliation + session-close).
- **Index write failures:** 0 (clean — no JSONL append attempted; index format is per-finding records and the prior session already represented the same spec slug, so finalisation appends a single session-summary entry below).
- **KNOWLEDGE.md:** 3 entries appended — patterns extracted from this session's review dynamics (see KNOWLEDGE.md section dated 2026-04-27).
- **CLAUDE.md / architecture.md:** no `[missing-doc]` triggers across both rounds; no updates required.
- **Hand-off:** spec is implementation-ready. `npm run build` / `npm run typecheck` not applicable to spec-only changes. Next step is `architect` invocation against §15 rollout plan (Slice A → B → C → D).

### Implementation readiness checklist

- [x] All inputs defined — heuristic interface (§6.2 + §6.3), baseline reader (§7.5), principal-usage matrix (§4.3), event registry (§12.1).
- [x] All outputs defined — `SweepResult` (§9.3), `agent_triage_failed.reason` enum (§9.8), `investigate_prompt` markdown body with `## Protocol\nv<n>` stamp (§5.2 / §5.5), event registry rows (§12.1), incident state machine (Phase 0 §5.6 — referenced).
- [x] Failure modes covered — §4.7 per-component failure-mode tables + §4.10.3 partial-success × retry + §4.10.4 failure-mode × idempotency + DLQ catch-all (§8.2).
- [x] Ordering guarantees explicit — §4.9.9 (created_at + uuid v7 surrogate) + §4.10.8 event-time vs write-time clarification (Round 2 v1.2) + §12.1 optional `metadata.occurred_at` carve-out.
- [x] No unresolved forward references — integrity check across both rounds returned zero issues; finalisation grep confirmed.

No checklist failures. Spec is implementation-ready.

