# Spec Review Log — operator-backend, iteration 2

**Spec:** `docs/superpowers/specs/2026-05-12-operator-backend-spec.md`
**Codex raw output:** `tasks/review-logs/_codex_operator-backend_iter2_2026-05-12T05-42-31Z.txt`
**Repo HEAD at start:** `b4d2ea37`

18 distinct findings from Codex (all cascade ripples from iter 1 changes — the new `attempt_number` column not propagated everywhere, the advisory-lock pattern not propagated to § 7.1, the hard-cap routing change not propagated to § 10.7 forbidden-transitions, etc.).

## Codex findings (Findings 1–9)

### F1 — `operator_runs` uniqueness key inconsistent across § 3.3, § 10.1, § 10.3, § 10.6
- Classification: **mechanical** (cascade from iter 1 F1 — index expanded but other references not updated).
- Disposition: **ACCEPT**. Propagate `(agent_run_id, attempt_number, chain_seq)` through § 10.1 / § 10.3 / § 10.6.

### F2 — `chain_seq_next` should restart per attempt
- Classification: **mechanical** (cascade from F1).
- Disposition: **ACCEPT**. Clarify in § 7.3.

### F3 — § 3.14 item 3 still references adapter as direct writer of `last_progress_at` (cascades with F6 from iter 1)
- Classification: **mechanical** (cascade from iter 1 F6).
- Disposition: **ACCEPT**. Replace the prose in § 3.14 item 3 with the enqueue pattern.

### F4 — § 7.1 step 3 still references `FOR UPDATE` (cascade from iter 1 F8)
- Classification: **mechanical** (cascade — advisory-lock pattern not propagated to § 7.1).
- Disposition: **ACCEPT**. Replace § 7.1 step 3.

### F5 — § 10.7 still allows `delegated → failed` for hard-cap-unresumable (cascade from iter 1 F12)
- Classification: **mechanical** (cascade — § 10.7 not updated when § 3.14 item 3 was clarified).
- Disposition: **ACCEPT**. Remove "OR hard-cap unresumable" from § 10.7 `delegated → failed` and add hard-cap as a `running → failed` path that produces `paused_chain_failure` via the chain-level→task-level routing in § 3.14.

### F6 — § 3.4 `paused_chain_failure` definition incomplete (cascade from F12 iter 1)
- Classification: **mechanical**.
- Disposition: **ACCEPT**. Expand definition.

### F7 — § 7.3 step 2 no-op predicate too narrow vs success predicate (cascade from iter 1 RC)
- Classification: **mechanical**. The success predicate in iter 1 RC widened the allowed input states to all pre-terminal; the no-op precheck (step 2) was not updated.
- Disposition: **ACCEPT**. Widen step 2 to match.

### F8 — Cost-attribution mid-run swap: writing `subscription_mediated` keyed on FINAL `credential_mode` loses pre-swap accounting
- Classification: **mechanical** (load-bearing — § 3.12.C says pre-swap turns counted in `subscription_mediated` for the chain link, but if `operator_runs.credential_mode` is overwritten to `'api_key'` mid-run, the cost writer keyed on that final value would never write the `subscription_mediated` row).
- Disposition: **ACCEPT**. Pin the writer's decision rule: eligibility is based on chain-link START mode OR the existence of a `fallback_engaged` event with `from_mode='operator_session'` — NOT the final `operator_runs.credential_mode`.

### F9 — § 3.12 idempotency posture overgeneralised
- Classification: **mechanical** (per_token rows use `(agent_run_id, request_id)` not the new boundary key).
- Disposition: **ACCEPT**. Clarify.
### F10 — § 4.11 references `checkpoint_payload.settings_snapshot` but settings_snapshot is now a top-level column
- Classification: **mechanical** (cascade from iter 1 F2 — column moved out of checkpoint_payload).
- Disposition: **ACCEPT**.

### F11 — Incident `settings_snapshot` example missing `max_wall_clock_per_task_days`
- Classification: **mechanical** (drift — § 3.16 has six fields; example shows five).
- Disposition: **ACCEPT**.

### F12 — New mutating routes (retry-chain-failure, extend-budget, refresh-credential) lack explicit permission guards
- Classification: **mechanical** (rubric — RLS / route-guard checklist).
- Disposition: **ACCEPT**. Add guards in § 6 with explicit actor rules.

### F13 — `cs.operator_session.suspended_detected` lacks a Contract entry
- Classification: **mechanical** (rubric — every cross-boundary data shape needs a contract).
- Disposition: **ACCEPT**. Add a § 4 contract row.

### F14 — UI prose references existing files not in § 5.3
- Classification: **mechanical** (file-inventory drift). The mockup mapping in § 13.1 references `OpenTaskView.tsx`, `ChatPane`, `ActivityPane`, Files tab — those files exist but the spec's § 5.3 "Modified files" table doesn't list them (because the spec says "render existing layout" / "no new file"). Codex is right that the inventory should still show them as touched files when prose claims they render new state.
- Disposition: **ACCEPT**. Add the existing file paths to § 5.3 (mark them as touched-for-conditional-rendering, not changed-in-structure).

### F15 — Docker template vendor preservation across rename
- Classification: **mechanical** (open question that needs explicit guardrail; without it the build chunk could silently bump the version).
- Disposition: **ACCEPT**. Add the explicit "preserve pinned version during rename; version change requires spec amendment" clause to § 3.5.

### F16 — Conversation-history artefact MIME/Zod left open
- Classification: **ambiguous** → **mechanical** (unnamed primitive — Codex Open Question #3 left this for build chunks but conversation artefacts cross the resume-payload boundary; pinning the shape is the standard contract discipline).
- Disposition: **ACCEPT**. Add the MIME + file name to § 3.14 item 6 and add the file to § 5.1.

### F17 — `is_resumable_now` emission mechanism unspecified
- Classification: **ambiguous** → **mechanical** (load-bearing signal with no named source). The spec already has the "build chunk pins" approach (Open Question #4); but Codex's fix is structurally cleaner — pin the contract upfront with a fallback default.
- Disposition: **ACCEPT**. Add the explicit contract clause to § 3.14 item 3.

### F18 — § 11 deferred item text still references `FOR UPDATE`
- Classification: **mechanical** (cascade from iter 1 F8 — Deferred Items text not updated).
- Disposition: **ACCEPT**.

## Counts and final disposition

- Codex findings: 18
- Rubric findings: 0 (extensive cascade pass produced no new rubric findings beyond what Codex caught)
- Accepted mechanical: 18
- Rejected mechanical: 0
- AUTO-DECIDED directional: 0
- Reclassified → directional: 0

All 18 mechanical fixes to apply this iteration.

## Iteration 2 Summary

- Mechanical findings accepted:  18
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration: (to be recorded after Step 8b)

