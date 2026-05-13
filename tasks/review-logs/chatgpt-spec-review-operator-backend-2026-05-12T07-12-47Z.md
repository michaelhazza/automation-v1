# ChatGPT Spec Review Session — operator-backend — 2026-05-12T07-12-47Z

## Session Info
- Spec: `docs/superpowers/specs/2026-05-12-operator-backend-spec.md`
- Branch: `claude/sandbox-execution-provider-DLfjn`
- PR: #288 — https://github.com/michaelhazza/automation-v1/pull/288
- Mode: manual
- Started: 2026-05-12T07:12:47Z

---

## Round 1 — 2026-05-12T07:12:47Z

### ChatGPT Feedback (raw)

> I'll review this as a spec-readiness pass: conformance to the locked brief, implementation sequencing risks, missing invariants, and places that could cause PR churn later.
>
> Thought for 27s
>
> Yes. This is now a serious build spec, not just a brief expansion. Most of the earlier issues are fixed, especially the task-vs-chain-link model, paused-state finaliser boundaries, fallback stickiness, persistent profile attempts, and the per-subaccount settings model.
>
> I would still make a small round-1 spec patch before handing to implementation. I found 5 items worth fixing.
>
> **Top findings**
>
> **F1, blocker: hard-cap unresumable handling is internally inconsistent**
>
> The spec currently says hard-cap unresumable is an immediate single-event pause and explicitly says it does not require three occurrences.
>
> But the later state-machine section says:
>
> > delegated → paused_chain_failure for hard-cap unresumable, counted in the same dispatch-failure budget as start failures.
>
> Those two statements conflict.
>
> Recommended fix: keep the immediate single-event pause rule. Do not count hard-cap unresumable against the 3-strike dispatch-failure retry budget. Start failures and runtime hard-cap failures are different classes.
>
> Suggested wording:
>
> ```
> Hard-cap unresumable is a runtime failure path, not a dispatch-start failure. It transitions directly to `paused_chain_failure` with `failure_reason='failed_mid_step'`. It increments `operator_chain_failure_count` only for diagnostic visibility, but does not require three consecutive failures and does not consume the chain-link start retry budget.
> ```
>
> **F2, blocker: paused_budget_exceeded is doing too much**
>
> The spec says paused_budget_exceeded covers both:
>
> - per-task budget cap
> - max wall-clock per task
>
> with failure_reason distinguishing them.
>
> That is risky because the UX and recovery action for these are not the same. Budget cap is extendable by adding minutes. Max wall-clock is a governance/runtime limit and may require changing subaccount settings, not simply adding task budget. The brief's settings model treats max wall-clock as its own per-task limit, separate from operator-session budget.
>
> Recommended fix: split the semantics.
>
> Option A, cleaner:
> - `paused_budget_exceeded` = per-task budget cap only.
> - `paused_wall_clock_exceeded` = max wall-clock per task reached.
>
> Option B, minimal:
> > `paused_budget_exceeded` may include `max_wall_clock_exceeded`, but the UI/recovery path MUST branch: budget cap supports additive task-budget extension; max wall-clock requires org-admin settings change or cancellation, not the normal "add minutes" flow.
>
> I'd prefer Option A.
>
> **F3, high: cancellation should explicitly clear queued continuation jobs**
>
> The spec fixed task-level cancellation conceptually, but I would make the queued-job cleanup non-negotiable. The state machine allows {pending | delegated | paused_*} → cancelled, which is good.
>
> But with chain continuation and FIFO queues, cancellation must also invalidate any pending operator-session.chain_link_completed continuation jobs or queued dispatch jobs. Otherwise a cancelled task can resurrect when a queued worker wakes up.
>
> Add this invariant:
>
> ```
> Cancellation is task-scoped. It cancels the active chain link if present, marks the parent `agent_runs` cancelled, tombstones/removes queued chain-continuation jobs, and all dispatcher jobs MUST re-read `agent_runs.status` under lock before dispatch. If status is `cancelled`, the job exits no-op and writes no new `operator_runs` row.
> ```
>
> **F4, medium: fallback stickiness derivation is solid but should be race-protected**
>
> The new derived stickiness rule is good: read latest non-superseded operator_runs, use a link-boundary timestamp, and clear stickiness if a usability-restored or credential-refreshed event occurred after that boundary.
>
> The missing bit is concurrency. If credential restoration and next-chain dispatch happen concurrently, the dispatcher can compute the wrong mode.
>
> Add a DB/transaction rule:
>
> ```
> Fallback stickiness is computed inside the same transaction that creates the next `operator_runs` row. The dispatcher reads the latest chain-link row and clearing events/audit rows under the same org-scoped transaction. The inserted `credential_start_mode` is the durable result of that derivation.
> ```
>
> This fits the spec's new credential_start_mode vs mutable credential_mode split.
>
> **F5, medium: profile restart keeps same agent_run_id, so chain uniqueness must include attempt number**
>
> Fresh-profile restart keeps the same agent_run_id, resets conversation history, bumps attempt_number, and starts chain seq 1 again. Old chain links are retained and marked superseded_by_attempt.
>
> That means any uniqueness/indexing rule on chain sequence must be:
>
> ```
> UNIQUE (agent_run_id, attempt_number, chain_seq)
> ```
>
> Not:
>
> ```
> UNIQUE (agent_run_id, chain_seq)
> ```
>
> The schema section appears to include attempt_number and superseded_by_attempt, which is good, but make this unique constraint explicit in the migration acceptance criteria.
>
> **Smaller polish**
>
> The mockups now look aligned: C1 uses "120 min per chain link" and "Up to 5 running at once," which matches the updated settings model. R7 also correctly removed manual "Extend duration" and says automatic chain-link handoff takes over.
>
> One tiny UI note: R7 still has a .btn-extend CSS class even though the CTA is removed. That is harmless, but I'd grep-clean it if you want the prototype to be tidy.
>
> **Verdict**
>
> Spec is very close, but I would patch F1 and F2 before implementation. They affect state semantics and recovery behaviour. F3–F5 are guardrails that will prevent subtle worker/queue/race bugs later.
>
> After those changes, I'd consider this ready for the feature-coordinator implementation plan.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 hard-cap unresumable conflict between § 3.4 state list and § 10.7 state-machine | technical-escalated (severity=high) | apply | apply (user: as recommended) | high | Internal contradiction between two locked statements — § 3.4 (line 228) already states the correct rule; § 10.7 state-machine line contradicted. Fixed by replacing "counted in the same dispatch-failure budget as start failures" with "immediate single-event pause — NOT counted against the 3-strike start-failure retry budget". |
| F2 split `paused_budget_exceeded` vs add `paused_wall_clock_exceeded` | user-facing (Option A vs Option B is a product-shape decision) | apply Option A | apply Option A (user: as recommended) | high | New task-level state `paused_wall_clock_exceeded` added to closed enum. V1 non-resumable (user-cancel only); admin override path deferred to Phase 3.5. Cascade applied across § 3.4 (closed set + description + resumability classification + state machine), § 3.10 (cancel predicate), § 3.14 (finaliser decision rows), § 4.3 (closed set), § 4.7 (new lifecycle event), § 5.2 (migration 0330 description), § 6 (settings enforcement), § 7.3 (dispatcher predicates + reason-tag mapping), § 10.5 (terminal-event guarantee example), § 10.6 (cancel HTTP mapping), § 10.7 (state-machine bullet), § 11 (new defer line). |
| F3 cancellation queue-tombstone invariant | technical-escalated (severity=high) | apply | apply (user: as recommended) | high | Added consolidating "Cancel-vs-dispatcher race invariant" paragraph at end of § 3.10. Restates the existing protection (queue drain + optimistic predicate excluding 'cancelled') as a single, audit-able rule that future maintainers can reference. |
| F4 fallback-stickiness transaction boundary | technical | apply | auto (apply) | medium | Added "Race-safety: derivation is transactional" sub-paragraph to § 3.7 item 6. Locks derivation inside the same `withOrgTx` as the next `operator_runs` insert; `credential_start_mode` is the durable result and IMMUTABLE per § 3.3. |
| F5 UNIQUE constraint explicit in migration 0327 AC | technical | apply | auto (apply) | medium | Migration 0327 acceptance criteria now explicitly include UNIQUE `(agent_run_id, attempt_number, chain_seq)` per § 3.3, with the rationale (fresh-profile restart keeps same `agent_run_id`, restarts `chain_seq` at 1 for new `attempt_number`). Also clarified migration 0328 owns UNIQUE `(task_id, attempt_number)`. |
| Polish R7 `.btn-extend` grep cleanup | technical (mockup hygiene) | defer | auto (defer) | low | Touches a mockup file (`prototypes/operator-backend/r7-taskheader-operator-controls.html`); agent rule restricts edits to the spec file. Routed to `tasks/todo.md § Spec Review deferred items / operator-backend (2026-05-12)`. |

### Applied (auto-applied technical + user-approved user-facing)

- [user] F1 — fixed § 10.7 state-machine bullet for hard-cap unresumable (now consistent with § 3.4)
- [user] F2 — added new task-level state `paused_wall_clock_exceeded`; propagated across 12 spec sections; added § 11 defer line for Phase 3.5 admin override path
- [user] F3 — added consolidating cancel-vs-dispatcher race invariant to end of § 3.10
- [auto] F4 — added "Race-safety: derivation is transactional" paragraph to § 3.7 item 6
- [auto] F5 — made UNIQUE constraints explicit in migration 0327 + 0328 acceptance criteria

### Deferred to tasks/todo.md

- [auto] Polish R7 `.btn-extend` CSS grep cleanup — added to `tasks/todo.md § Spec Review deferred items / operator-backend (2026-05-12)`

### Integrity check (4a)

- Forward references: no broken references; all new cross-refs (§ 7.3 step 4, § 10.1/10.3/10.6) resolve to existing sections.
- Contradictions: F1 resolves the prior § 3.4 vs § 10.7 contradiction. No new contradictions introduced.
- Missing inputs/outputs: new lifecycle event `operator-session.task_paused_wall_clock_exceeded` declared with payload `{ agent_run_id, max_wall_clock_per_task_days, elapsed_days }`. New defer item declares the future audit event `task.operator.wall_clock_extended` payload.
- Resumability classification (new sub-section in § 3.4) makes the V1 non-resumable status of `paused_wall_clock_exceeded` explicit, preventing future readers from assuming symmetry with `paused_budget_exceeded`.

Integrity check: 0 issues found this round (auto: 0, escalated: 0).

### Top themes

- State-machine consistency (F1, F2, F3 all touch the `agent_runs` task-state machine).
- Race-safety hardening (F3 cancel-vs-dispatch invariant; F4 stickiness-derivation transaction boundary).
- Migration acceptance specificity (F5 explicit UNIQUE constraints).
