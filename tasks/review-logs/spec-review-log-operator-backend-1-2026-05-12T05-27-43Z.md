# Spec Review Log — operator-backend, iteration 1

**Spec:** `docs/superpowers/specs/2026-05-12-operator-backend-spec.md`
**Codex raw output:** `tasks/review-logs/_codex_operator-backend_iter1_2026-05-12T05-27-43Z.txt`
**Repo HEAD at start:** `7f01ff2e4e9b936118a2b78d0312b129a99fcfe7`

24 distinct findings from Codex. Plus rubric findings from Claude pass. Classifications and dispositions below.

## Codex findings — classification (Findings 1–12)

### F1 — `(agent_run_id, chain_seq)` UNIQUE blocks chain_seq=1 reuse on fresh-profile restart (§ 3.15.7 / § 3.3)
- Classification: **mechanical** (contradiction with § 3.15 item 7 attempt-bump semantics).
- Disposition: **ACCEPT**. Change index to `(agent_run_id, attempt_number, chain_seq) UNIQUE`.

### F2 — `settings_snapshot` referenced but no column (§ 3.16, § 4.11)
- Classification: **mechanical** (load-bearing claim without backing column).
- Disposition: **ACCEPT**. Add `settings_snapshot jsonb NOT NULL` to `operator_runs` schema and migration 0327.

### F3 — `operator_chain_failure_count` referenced but no column (§ 7.3 item 5)
- Classification: **mechanical** (load-bearing — counter named but not declared).
- Disposition: **ACCEPT**. Add `operator_chain_failure_count integer NOT NULL DEFAULT 0` to `agent_runs` via migration 0330.

### F4 — Cancel flag referenced but no column (§ 3.10 item 2)
- Classification: **mechanical**.
- Disposition: **ACCEPT**. Add `cancel_requested_at timestamptz NULL` to `operator_runs`.

### F5 — Apparent conflict on chain-link terminal-status writer (§ 7.2 vs § 7.6)
- Classification: **mechanical** (clarification of writer ownership).
- Disposition: **ACCEPT**. Clarify § 7.6 that the finaliser commits cost rows + `event_emitted_at` atomically; the adapter writes terminal `status` earlier per § 7.2. The two are sequential, not conflicting.

### F6 — `step_count` double-writer race (§ 3.9 vs § 7.4)
- Classification: **mechanical** (contradiction — two writers).
- Disposition: **ACCEPT**. Specify queued handler is sole writer; adapter only enqueues. Use `greatest(step_count, step_index)` for monotonic update; idempotency key `(operator_run_id, step_index)`.

### F7 — Progress event missing from § 10.1 idempotency table
- Classification: **mechanical** (rubric — every externally-triggered write needs an idempotency posture).
- Disposition: **ACCEPT**. Add row.

### F8 — Concurrency-cap `SELECT count(*) FOR UPDATE` doesn't lock absent rows (§ 3.17.5, § 10.3)
- Classification: **mechanical** (load-bearing concurrency-guard claim with insufficient mechanism).
- Disposition: **ACCEPT**. Use `pg_advisory_xact_lock(hashtext('operator_slots:' || subaccount_id))` pattern.

### F9 — Cost-ledger UNIQUE constraint missing `boundary` column (§ 4.10, § 5.2, § 5.3)
- Classification: **mechanical** (file-inventory drift — idempotency key references column that's not declared in migration 0331).
- Disposition: **ACCEPT**. Extend migration 0331: add `boundary text` column and partial UNIQUE `(operator_run_id, source_type, boundary) WHERE operator_run_id IS NOT NULL AND boundary IS NOT NULL`.

### F10 — Cost-ledger example fields not specified as columns (§ 4.10)
- Classification: **mechanical** (load-bearing claim — example fields not declared, would force implementer to guess).
- Disposition: **ACCEPT**. Add explicit clause: extension fields live in `llm_requests.metadata jsonb`; only `operator_run_id` and `boundary` are new typed columns.

### F11 — Column-name drift `sandbox_started_at` vs `started_at` (§ 3.17.4)
- Classification: **mechanical** (drift).
- Disposition: **ACCEPT**.

### F12 — Hard-cap unresumable contradictory routing (§ 3.14 items 3,4,7 / § 10.7)
- Classification: **mechanical** (contradiction — multiple possible routings).
- Disposition: **ACCEPT**. Pin rule: hard-cap unresumable → chain link `'failed'` + `failed_mid_step=true`; task `paused_chain_failure` (counted in dispatch-failure budget). § 3.14 item 7 wording clarified to exclude hard-cap from the "runtime failure terminates task" branch.

## Codex findings — classification (Findings 13–24)

### F13 — Budget-cap auto-pause missing finaliser-decision branch (§ 3.14.4)
- Classification: **mechanical** (load-bearing — § 3.17 spec'd but § 3.14 decision table omits branch).
- Disposition: **ACCEPT**. Add branch: "`completed` with checkpoint AND consumed budget ≥ pinned cap → `paused_budget_exceeded`; do not enqueue next chain link."

### F14 — Fallback stickiness has no storage column (§ 3.7.6)
- Classification: **mechanical** (load-bearing — "sticky for the logical task" with no SoT).
- Disposition: **ACCEPT** (with derivation, not new column). Pin rule: stickiness is derived from the latest non-superseded `operator_runs.credential_mode` for the task; if `'api_key'` AND no `operator-session.usability_restored` event has fired since that row, stickiness applies. Add precedence row in § 4.11.

### F15 — `'long_running'` import surface (§ 3.2, § 4.1)
- Classification: **ambiguous** → **directional** (per Step 5: introduces a new pattern — `EXECUTION_CAPABILITIES` const object — that isn't in the codebase today).
- Disposition: **AUTO-DECIDED — accept minimum change**. The minimum change is to clarify the gate's allow-list: capability literals are permitted inside adapter object declarations (the type-checker enforces correctness via the union). The gate enforces the "no naked literal in non-adapter consumers" rule. No new runtime const introduced. Add note to § 3.2 / § 4.1.
- Route to `tasks/todo.md`.

### F16 — GC job + FORCE RLS interaction unclear (§ 6.2, § 7.5)
- Classification: **mechanical** (load-bearing — `withAdminConnection` named but role-bypass mechanism unstated; architecture.md uses `withAdminConnection + SET LOCAL ROLE admin_role` per accepted_primitives).
- Disposition: **ACCEPT**. Pin `withAdminConnection + SET LOCAL ROLE admin_role` per architecture.md § 1758 / § 3422.

### F17 — `operatorConversationHistoryPure.ts` missing from § 5.1 and chunk plan (§ 3.14.6)
- Classification: **mechanical** (file-inventory drift).
- Disposition: **ACCEPT**.

### F18 — `cs.operator_session.suspended_detected` notifier has no concrete file (§ 3.13)
- Classification: **mechanical** (unnamed new primitive).
- Disposition: **ACCEPT**. Add concrete file + function signature. Use the existing inbox/notification primitive — no new service layer.

### F19 — Debug-retention-extend route missing from § 5.1 (§ 6.2)
- Classification: **mechanical** (file-inventory drift).
- Disposition: **ACCEPT**.

### F20 — Fresh-profile-restart from terminal `failed` forbidden by state machine (§ 10.3, § 10.7, § 3.15.7)
- Classification: **mechanical** (state-machine contradiction).
- Disposition: **ACCEPT**. Remove `'failed'` from restart predicate; restart only allowed from the three `paused_*` states.

### F21 — `max_wall_clock_per_task_days` not enforced (§ 3.16, § 3.17)
- Classification: **mechanical** (load-bearing cap with no enforcement).
- Disposition: **ACCEPT**. Add enforcement clause; reuse `paused_budget_exceeded` state with `failure_reason='max_wall_clock_exceeded'` (avoids new state machine value).

### F22 — Artefact-harvest event missing from § 4.7 closed set (§ 3.11, § 4.7)
- Classification: **mechanical** (load-bearing — event required but not in closed set).
- Disposition: **ACCEPT**. Add `operator-session.artefact_harvested` to § 4.7.

### F23 — "Adapter does not branch on auth type" misleading (§ 3.1, § 3.7)
- Classification: **mechanical** (load-bearing statement contradicted by § 3.7 / § 3.12).
- Disposition: **ACCEPT**. Reword to: "does not inspect provider-specific shapes; does branch on the broker-returned redacted `mode`."

### F24 — No wake-up mechanism for FIFO-queued chain continuations (§ 3.17.5, § 7.3)
- Classification: **mechanical** (load-bearing — "dispatched when a slot frees" with no mechanism).
- Disposition: **ACCEPT**. Add release-and-enqueue-next hook in finaliser path.
## Rubric findings (Claude pass)

### RA — § 4.11 needs precedence row for credential-mode stickiness derivation
- After F14 lands, add `Credential-mode stickiness` row to § 4.11 (precedence: latest non-superseded `operator_runs.credential_mode`).
- Classification: mechanical.
- Disposition: **ACCEPT**.

### RB — § 4.7 namespace discipline conflicts with § 4.9 audit events
- § 4.7 says `operator.*` is reserved for "incidents / audit / system-monitoring" but § 4.9 audit events use the existing `task.operator.*` and `subaccount.operator_settings.*` namespaces (which is correct — they ride existing audit conventions). The "operator.*" reservation should be tightened to "incident / system-monitoring only"; audit events use existing audit namespaces.
- Classification: mechanical (contradiction).
- Disposition: **ACCEPT**.

### RC — § 7.3 item 4 missing optimistic predicate on `agent_runs.status` write
- "On success: writes `agent_runs.status='delegated'`" without specifying the predicate. Should match § 10.1 (`UPDATE WHERE status IN ('paused_for_chain_continuation','delegated','pending')`).
- Classification: mechanical (load-bearing — predicate not named).
- Disposition: **ACCEPT**.

## Counts and final disposition

- Codex findings: 24
- Rubric findings: 3 (RA, RB, RC)
- Accepted mechanical: 26
- Rejected mechanical: 0
- AUTO-DECIDED directional: 1 (F15)
- Reclassified → directional: 1 (F15 from ambiguous)

All 26 mechanical fixes to apply this iteration. F15 routes to `tasks/todo.md`.

## Iteration 1 Summary

- Mechanical findings accepted:  26
- Mechanical findings rejected:  0
- Directional findings:          0 (pure)
- Ambiguous findings:            1 (F15 — reclassified to directional)
- Reclassified → directional:    1
- Autonomous decisions (directional/ambiguous): 1
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             1 (F15 — see tasks/todo.md § operator-backend deferred items)
- Spec line count after iteration: 1698 (was 1644; +54 lines, no removals)
- Spec commit after iteration: `b4d2ea37`


