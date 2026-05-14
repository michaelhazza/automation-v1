# Post-merge — System Monitor follow-ups

Deferred items from the ChatGPT PR review of #215 (`claude/add-system-monitoring-BgLlY`).
Routed here (rather than `tasks/todo.md`) per the user's routing override on
2026-04-27 so the system-monitor follow-up stack stays grouped and triageable.

Each item is tagged `[auto]` (technical defer auto-applied by the review agent)
or `[user]` (user approved the defer in the round 1 user-facing approval gate).

---

## Correctness fixes

- [x] **Rate-limit retry idempotency on triage attempts** (item 7b) — `[auto]` — *Implemented in `system-monitoring-agent-fixes` (G1); see `tasks/builds/system-monitoring-agent-fixes/spec.md` §7.1.*
      `server/services/systemMonitor/triage/triageHandler.ts:268-274` increments
      `triage_attempt_count + 1` before the LLM tool loop runs. If pg-boss retries
      the message after that point (transient network failure, OOM, redeploy mid-job),
      the count climbs without a real attempt, and the rate-limit gate trips early.
      Fix: idempotency-key the increment on `(incidentId, jobId)` — only increment
      once per pg-boss job id, not once per handler invocation.

- [x] **List filter semantics for `triageStatus=failed AND diagnosisStatus=none`** *Implemented in `system-monitoring-agent-fixes` (G5); see spec §10.*
      (round 2, item 3) — `[user]` — The diagnosis filter pill on the incidents
      list (`SystemIncidentsPage.tsx`) currently maps the status enum directly,
      which means a worker-died incident (`triageStatus='running'` left stale,
      then transitioned to `'failed'` with no diagnosis row) ends up in `none`
      under the filter. Operators looking for "auto-triage attempted but failed"
      cannot easily isolate the bucket without reading the column directly.
      Fix: extend filter pill semantics to expose a `failed-no-diagnosis`
      grouping (server-side join on `triageStatus='failed' AND diagnosisStatus
      IN ('none','partial','invalid')`) and surface it as a distinct option
      alongside `none / valid / partial / invalid`. UI string + filter contract
      need spec design — defer until the post-launch operator workflow review.

- [x] **Backend staleness guard for worker-death recovery** (round 2, item 4) — *Implemented in `system-monitoring-agent-fixes` (G2); see spec §7.2.*
      `[user]` — `triageHandler.ts` writes `triageStatus='running'` at the start
      of an attempt. If the worker dies mid-run (OOM, segfault, host shutdown),
      the row stays at `'running'` indefinitely and the UI shows an eternal
      "Triaging…" banner. Backend fix: add a staleness guard — either (a) a
      sweep that flips `'running' → 'failed'` after `attemptStartedAt` exceeds
      a max-attempt-duration (e.g. 10 min), or (b) a heartbeat column updated
      by the handler with a TTL check on read. Option (a) is simpler; option
      (b) generalises to any long-running async work. Resolve which pattern
      is canonical before implementing — likely converges with the
      correlation-ID propagation invariant (item 7c).
      - **Implementation notes** (added round 3, 2026-04-27 — ChatGPT review):
        - The staleness flip MUST emit an incident event (e.g. `triage_timed_out`
          or `triage_stale_recovered`) — a silent column flip leaves operators
          and downstream observability blind. Mirror the existing `triage_failed`
          event shape so consumers don't need a new branch.
        - The flip MUST NOT double-count attempts. Coordinate with the
          rate-limit retry idempotency fix (item 7b above): both touch
          `triage_attempt_count`, and the staleness recovery path is exactly
          the case where a naive increment would double-charge a single attempt
          that the worker never actually completed. Idempotency-key the
          increment on `(incidentId, jobId)` and let the staleness sweep flip
          status without re-incrementing.
        - These two fixes (7b + staleness guard) share the same failure surface
          and should be implemented together to avoid building one on top of
          the other's not-yet-finished assumptions.

## Observability

- [x] **Synthetic check: write success vs declared success mismatch** (item 6a) — *Implemented in `system-monitoring-agent-fixes` (G3); see spec §8.*
      `[user]` — System-wide invariant: % of agent runs marked `success` where no
      side effects (no events written, no skill executions, no incident updates)
      were observed. Surfaces silent agent failures where the LLM returned cleanly
      but did nothing. Spec (§9 Phase 2.5 heuristics) lists the day-one synthetic
      set — this is genuinely missing.

- [x] **Synthetic check: incident silence detection** (item 6b) — `[user]` — *Implemented in `system-monitoring-agent-fixes` (G4); see spec §9.*
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
