# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-12-operator-backend-spec.md`
**Spec commit at start:** untracked (working tree, never committed before review)
**Spec commit at finish:** `2a56278e`
**Spec-context commit:** `62497257`
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap
**Verdict:** NEEDS_REVISION (iteration cap hit at 5 of 5; Codex was still surfacing 15 cascade-ripple findings per round; 1 AUTO-DECIDED item routed to tasks/todo.md for deferred review)

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted mechanical | Rejected mechanical | Directional auto-decided | Spec commit |
|---|---|---|---|---|---|---|
| 1 | 24 | 3 | 26 | 0 | 1 (F15 → tasks/todo.md) | b4d2ea37 |
| 2 | 18 | 0 | 18 | 0 | 0 | 90a5c18f |
| 3 | 15 | 0 | 15 | 0 | 0 | a56892be |
| 4 | 15 | 0 | 15 | 0 | 0 | 0f28a36c |
| 5 | 15 | 0 | 15 | 0 | 0 | 2a56278e |
| **Total** | **87** | **3** | **89** | **0** | **1** | — |

## Mechanical changes applied (grouped)

See `tasks/review-logs/spec-review-log-operator-backend-{1..5}-*.md` for the per-finding decision trail. Summary below.

### Schema / state-machine
- `operator_runs` gained: `settings_snapshot jsonb NOT NULL`, `cancel_requested_at`, `cancel_requested_by_user_id`, `credential_start_mode` (immutable, distinct from mutable `credential_mode`).
- `operator_task_profiles` gained `gc_started_at` for stale-`gc_in_progress` reclaim.
- `agent_runs` gained `operator_chain_failure_count` with explicit increment/reset rules and predicate-widening across iterations.
- UNIQUE index on `operator_runs` changed to `(agent_run_id, attempt_number, chain_seq)` to permit fresh-profile-restart chain_seq=1.
- Migration 0330 renamed `extend_agent_runs.sql` (covers status enum + new column).
- Migration 0331 renamed `extend_llm_requests_operator.sql` (adds `boundary` column + partial UNIQUE).
- Hard-cap-unresumable routing pinned (immediate `paused_chain_failure`; counter is diagnostic-only).
- `paused_budget_exceeded` covers both budget-cap and max-wall-clock; `failure_reason` discriminates.
- § 10.7 forbidden transitions: separate predicates for `cancelled` (broad pre-terminal set) vs `completed|failed` (requires `delegated`).

### Idempotency / concurrency / load-bearing claims
- Finaliser idempotency keyed on `event_emitted_at IS NULL`, not terminal status (resolves the re-run-after-cost-writer-rollback case).
- Concurrent-finalises guard pinned: `pg_advisory_xact_lock` + `UPDATE … event_emitted_at = now() WHERE event_emitted_at IS NULL` stamp.
- Concurrency-cap accounting pinned to `pg_advisory_xact_lock(hashtext('operator_slots:' || subaccount_id))` everywhere (replaces unsafe `SELECT count(*) FOR UPDATE`).
- Dispatch-crash recovery: `sandbox_start_key = operator_run_id` + `adoptOrStart` (additive extension to Spec B primitive, documented in § 2 / § 5.3).
- Dispatch-next handler precondition includes `NOT EXISTS operator_runs WHERE status IN ('pending','running')` to prevent N+1 dispatch race.
- Progress handler is sole writer for `last_progress_at`/`step_count`; NULL-safe `greatest(coalesce(..., '-infinity'::timestamptz), ...)`; `status='running'` post-terminal guard.
- Task-terminal-event guard via pg-boss singleton key `operator-session-task-terminal:${agent_run_id}` (no new table introduced).
- Incident emission idempotency key pinned (`operator.chain_link_start_failed:${agent_run_id}:${attempt_number}:${chain_seq}:${retry_attempt}`).
- CS notification idempotency key uses persisted broker transition timestamp (stable across retries).
- Cancellation sequence: signal `cancel_requested_at` first; terminal `status` only after acknowledgement (prevents post-terminal runtime events).
- GC stale-`gc_in_progress` reclaim rule (30-minute timeout).

### Cost / accounting
- `subscription_mediated` eligibility derived from immutable `credential_start_mode` (not the mutable `credential_mode`).
- Sandbox-compute cost cache writer pinned (`operatorCostWriter` in the same transaction as the ledger row).
- `per_token` idempotency stays on `(agent_run_id, request_id)`; `operator_run_id` is attribution-only.

### File inventory + chunk plan
- 16+ files added to § 5.1 / § 5.3 across iterations (notifier, errors, encryption helper, conversation artefact, route mounting site, permissions, error-handler middleware, permission-coverage gate, CI workflow, OpenTaskView family, sandbox primitive extension, LLM-request writer extension).
- Chunk 8: explicit permission-registry + role-grant + route-mount files.
- Chunk 11: extended to include OpenTaskView/ChatPane/ActivityPane/FilesTab.
- § 9 chunk-order narrative tightened to match § 14 ordering.
- § 8 verdict table added; § 11 deferred items prefixed with `DEFER —`; § 1.3 non-goals gained `Verdict` column.

### Permissions / RLS
- § 6.5b added: explicit route guards for the five new task-action routes (actor rules per `manager+` / `org_admin`).
- RLS manifest wording corrected (TS module updated in chunk/commit, not by SQL migration).
- GC role bypass pinned: `withAdminConnection + SET LOCAL ROLE admin_role` per architecture.md.

### Lifecycle events / namespace discipline
- Added `operator-session.artefact_harvested` with pre-/post-terminal emission rules (post-terminal omits `chain_link_id`).
- Pinned writers for `preparing_checkpoint` (progress handler) and `auto_extending` (adapter with pg-boss singleton key).
- Namespace tightened: `operator.*` is incidents + system-monitoring only; audit rides existing `task.operator.*` / `subaccount.operator_settings.*` namespaces.

### Contract surfaces
- `OperatorSessionEnvelope` and `ApiKeyEnvelope` gain `subaccountId` field for three-way subaccount-match.
- `ApiKeyEnvelope` shape pinned inline.
- `cs.operator_session.suspended_detected` contract added in § 4.8b with locked payload + idempotency key.
- Conversation artefact MIME + Zod schema file pinned.
- Checkpoint encryption helper locked (`agentRunPayloadEncryptionService.ts`; Chunk 1 creates if absent).
- Capability literal: gate allow-list approach instead of new runtime const (per AUTO-DECIDED in iter 1).
- `is_resumable_now` emission contract pinned (boolean in checkpoint step-state; absent/malformed → false).

## Rejected findings

None. All 87 Codex findings + 3 rubric findings were accepted as mechanical. 1 finding (F15 — capability literal import surface, iter 1) was reclassified to directional and AUTO-DECIDED.

## Directional and ambiguous findings

| # | Iteration | Title | Classification | Decision | Routed to |
|---|---|---|---|---|---|
| F15 | 1 | Capability literal import surface — Codex suggested `EXECUTION_CAPABILITIES = { ... } as const` runtime constant | AMBIGUOUS → directional (introduces a new pattern not present in the codebase today; would change Spec A's surface) | AUTO-DECIDED — accept the minimum change: clarify the gate's allow-list to permit literals inside adapter declarations (the type-checker is the enforcement for adapter sites). The runtime-const alternative is held as a deferred item. | `tasks/todo.md` § operator-backend deferred items (OP-BACKEND-SR1) |

No other directional findings surfaced across iterations 1–5. Codex stayed inside the mechanical-tightening lane after iter 1.

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review. The reviewer has adjudicated every finding that surfaced across 5 iterations. However:

- **The review did NOT re-verify the framing assumptions** at § 1.4. Pre-production, no-feature-flags, no-staged-rollout, prefer-existing-primitives are the assumed posture. Re-read if anything has shifted.
- **The review did NOT catch directional findings that Codex and the rubric did not see.** Automated review converges on known classes of problem; it does not generate insight from product judgement. Cap-hit is the deterministic budget exhausting itself, not a "no more issues" signal.
- **Cascade-ripple behaviour observed.** Iterations 2–5 each added 15+ NEW findings even after the previous iteration's findings were resolved. This is normal for a Major spec of this size (1805 lines, 13 contract types, 3 new tables, 2 state machines, 4 pg-boss queues). It means: the spec is large enough that each round of edits creates a new wave of consistency ripples Codex catches in the next round. We do NOT know whether iter 6 would have found another ~15 findings or fewer — the cap forced the exit.
- **The review did NOT prescribe what to build next.** Sprint sequencing, scope trade-offs, and priority decisions are still the human's job. The Chunk 1–15 plan in § 14 is the build sequence; the human approves the plan before the implementation phase.

**Recommended next step:**

1. Read the framing sections (§ 1.4 + § 8 verdict table + § 11 deferred items) one more time, confirm the headline intent matches your current priorities.
2. Review the 1 AUTO-DECIDED item in `tasks/todo.md` § operator-backend deferred items (capability literal pattern). Decide whether to fold the runtime-const alternative into Chunk 2 or leave the gate-allowlist approach as-is.
3. If you want another deterministic pass before build, options are: (a) bump MAX_ITERATIONS in `.claude/agents/spec-reviewer.md` and re-run, (b) forward this spec to `chatgpt-spec-review` for an independent fresh pass with different blind spots.
4. When ready, hand the spec to `feature-coordinator` for plan breakdown.

**Spec verdict line for archive sweep:** `Status: reviewing` (frontmatter; iterate to `accepted` once the human signs off).

## File trail

- Per-iteration logs: `tasks/review-logs/spec-review-log-operator-backend-{1,2,3,4,5}-*.md`
- Codex raw outputs: `tasks/review-logs/_codex_operator-backend_iter{1..5}_*.txt`
- Codex prompt: `tasks/review-logs/_codex_prompt_operator-backend_iter1.md`
- Pre-loop plan: `tasks/review-logs/spec-review-plan-operator-backend-2026-05-12T05-27-43Z.md`
- AUTO-DECIDED items: `tasks/todo.md` § operator-backend deferred items
- Spec final state: `docs/superpowers/specs/2026-05-12-operator-backend-spec.md` (1805 lines, commit `2a56278e`)
