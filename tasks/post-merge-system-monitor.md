# Post-merge — System Monitor follow-ups

Deferred items from the ChatGPT PR review of #215 (`claude/add-system-monitoring-BgLlY`).
Routed here (rather than `tasks/todo.md`) per the user's routing override on
2026-04-27 so the system-monitor follow-up stack stays grouped and triageable.

Each item is tagged `[auto]` (technical defer auto-applied by the review agent)
or `[user]` (user approved the defer in the round 1 user-facing approval gate).

---

## Correctness fixes

- [ ] **Rate-limit retry idempotency on triage attempts** (item 7b) — `[auto]` —
      `server/services/systemMonitor/triage/triageHandler.ts:268-274` increments
      `triage_attempt_count + 1` before the LLM tool loop runs. If pg-boss retries
      the message after that point (transient network failure, OOM, redeploy mid-job),
      the count climbs without a real attempt, and the rate-limit gate trips early.
      Fix: idempotency-key the increment on `(incidentId, jobId)` — only increment
      once per pg-boss job id, not once per handler invocation.

## Observability

- [ ] **Synthetic check: write success vs declared success mismatch** (item 6a) —
      `[user]` — System-wide invariant: % of agent runs marked `success` where no
      side effects (no events written, no skill executions, no incident updates)
      were observed. Surfaces silent agent failures where the LLM returned cleanly
      but did nothing. Spec (§9 Phase 2.5 heuristics) lists the day-one synthetic
      set — this is genuinely missing.

- [ ] **Synthetic check: incident silence detection** (item 6b) — `[user]` —
      System-wide invariant: no incidents created in the last X hours despite
      ingest activity (heuristic fires, sweep runs, agent runs). Catches the
      "monitoring system is broken" case where the absence of incidents itself
      is the signal. Threshold + window need spec design.

- [ ] **Correlation-ID propagation enforced as invariant** (item 7c) — `[auto]` —
      `recordIncident` accepts `correlationId`, but no enforcement that downstream
      handlers (heuristic → triage → incident events) thread it through.
      Cross-cutting logging convention. Design level: gate? logger context?
      Required field on the event-write surface? Resolve before locking it in.

## Architectural

- [ ] **Frozen heuristic evaluation context** (item 2) — `[auto]` — Heuristics
      currently read baselines via `BaselineReader` on demand inside the heuristic
      function. ChatGPT's recommendation: pass a frozen evaluation-context object
      pre-materialised by the orchestrator, and forbid any DB reads below that
      layer. Real benefit is replay determinism (same input snapshot → same heuristic
      verdict). Touches all 24 heuristic modules + the heuristic types + a CI gate
      to prevent live reads. Design-level work.

- [ ] **Baseline-update guard during anomaly storms** (item 3b) — `[auto]` —
      Self-corrupting baselines: when system-wide anomaly rate is high, the
      refresh job continues to update baselines, drifting them toward the
      anomalous state. Add a guard: "no baseline update allowed while anomaly
      rate > threshold". Tuning concern post-launch — not a launch blocker, but
      worth nailing before anomalies become baseline.

- [ ] **Resolution-tag taxonomy** (item 4, part 1) — `[user]` — Add a structured
      resolution tag at incident close: `confirmed_bug | false_positive |
      expected_behavior | tuning_required`. Currently `prompt_was_useful` (boolean)
      + free-text feedback exist — richer taxonomy is a workflow change operators
      see, so it's user-facing. Straight TODO once the taxonomy is locked in.

- [ ] **Auto-tuning feedback loop from resolution tags** (item 4, part 2) — `[user]`
      — investigate first — operator-feedback-driven auto-tuning is a footgun
      without a safeguard design. The idea: feed resolution tags back into
      heuristic weighting / threshold adjustment / suppression rules so the
      system learns from operator decisions. The risk: a few bad tags from one
      operator can poison thresholds globally; auto-suppression based on
      `false_positive` votes can silence real signals; no human-in-the-loop
      means a quiet drift toward "useless monitoring agent". Needs a dedicated
      spec covering: signal weighting model, decay function on stale tags,
      consensus thresholds before auto-applying, A/B isolation between manual
      and tuned thresholds, an operator-visible "this rule was auto-tuned"
      indicator, and a rollback path. Do not start work on this loop until the
      spec exists.
