# Spec Review Final Report — phase-1-showcase-mvps

**Spec:** `tasks/builds/phase-1-showcase-mvps/spec.md`
**Spec commit at start:** `9e82e1a8c585d539e71361510a730c8ebe8ea9a2`
**Spec commit at finish:** `fd3d6d36aaedd4370812211ab9b82c8ba36089e4`
**Spec-context commit:** unchanged (`docs/spec-context.md` last_reviewed_at 2026-05-09; staleness gate green)
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only (iter 2 = 0 directional, iter 3 = 0 directional)
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | AUTO-DECIDED |
|---|----|----|----|----|----|
| 1 | 17 | 3 | 18 | 0 | 2 (PSM-D1, PSM-D2 routed to tasks/todo.md) |
| 2 | 7 | 0 | 7 | 0 | 0 |
| 3 | 5 | 0 | 5 | 0 | 0 |

Total: 30 mechanical fixes applied across 3 iterations; 2 directional findings auto-decided to leave the spec as-is (deferred for human review).

---

## Mechanical changes applied (grouped by section)

### Frontmatter and §0 (anchors / authority)
- Frontmatter aligned to canonical Status / Spec date / Last updated / Author convention (R3).
- §0.2 / §0.4 predecessor "build pending" prose removed; canonical layer treated as locked (C4).

### §1 Background and §2 Goals/Non-Goals
- §1.2 / §1.3 wording: both MVPs run as Native Controller throughout Phase 1; light Operator escalation = `assign + internal note + Run Trace event` (C3).
- §2.2 NG1: canonical_tickets `sla_due_at` / `sla_breached` / `sla_policy_external_id` columns called out as inert provider metadata only (C5).
- §2.2 NG3: no `search_knowledge_base`, no `web_search` in the Support Agent's default skills for Phase 1 (C6).

### §3 Constraints / Invariants
- INV-8: every Support Agent run sets `controllerStyle: 'native'`; no per-task switch (C3).
- INV-10: default mode by lifecycle pinned (brand-new = `disabled`; agent-enabled = `assisted`; operator may flip to `autonomous`) (iter2-1).
- INV-16 split into "run-rendered events" (1:1 with `agent_execution_events.event_type`) and "log-only events" (Activity feed + structured logs only); eval drift + file_delivery events moved to log-only list (iter3-4).
- INV-16 list extended with `phase1.support.collision_skipped`, `phase1.support.ticket_terminal`, `phase1.macro.login_failed`, `phase1.macro.run_stuck` (C14, iter2-3).

### §4 42 Macro Full MVP
- §4.4.3: file path corrected from `agentRunCompletedHandler.ts` to existing `ieeRunCompletedHandler.ts` (C17).
- §4.4.3: PDF byte-determinism contract added — pin `@react-pdf/renderer` exact version, post-render normalization (zero `/CreationDate` + `/ModDate`, sort xref, strip `/ID`); the hash and uploaded bytes are the normalised bytes (iter3-5).
- §4.5.3: replaced React component test row with a single integration test for the new artifacts route (C2).
- §4.6.1: S3 upload-failure row revised — run terminates cleanly with `failureReason: 'artifact_upload_failed'`; no partial run_artifacts row, no phantom Retry-upload UI (C11).
- §4.6.3: replaced "failure-mode integration tests" with a pure-function test for the stale-step detector (C2).

### §5 Support Inbox MVP
- §5.3.1: default skill list = 12 entries (11 `support.*` + `ask_clarifying_question`); `web_search` removed (C6, C7).
- §5.3.1: agent_config shape aligned with existing `SupportInboxAgentConfig` Zod schema; three additive optional fields (`minConfidence`, `voiceProfile`, `escalationCategories`) declared with defaults; `shared/types/supportInboxAgentConfig.ts` added to file inventory (C8).
- §5.3.2: master prompt placeholder names aligned with the existing schema (`collisionWindow.minMinutesSinceHumanActivity`, `promptOverride`, etc.) (C8).
- §5.3.3: human-activity collision check moved to immediately after claim acquisition, BEFORE thread read or classification (iter2-2).
- §5.3.4: NEW per-ticket atomic claim contract — optimistic `UPDATE canonical_tickets SET bot_claimed_at=now()...`; idempotency posture (state-based), retry classification (safe under TTL), claim TTL 15 min, claim release on terminal verdict (C9).
- §5.3.4: per-ticket terminal-verdict-to-event mapping made explicit per checklist §10.4 (iter2-3); added `phase1.support.ticket_terminal` event for `escalated_to_human` / `skipped_low_confidence` / `skipped_no_action_needed` branches.
- §5.4.2: `ask_clarifying_question` row added to risk-tier table (C7); `support.approve_draft` row clarified — agent-callable Tier 6 in autonomous mode only; human approval in assisted mode flows through the existing review queue path, not via `support.approve_draft` (iter3-1).
- §5.4.3: `agentSkills.ts` corrected to `server/db/schema/systemSkills.ts` (iter2-7); pure-function tests + a `*Pure.ts` helper file added to inventory (C2).
- §5.5.4: RLS registration in `rlsProtectedTables.ts` added; `scripts/gates/verify-support-agent-eval-thresholds.sh` added as CI-only static gate (C13, R5); pure-function test for threshold/drift math (C2).
- §5.6.2: UI fields use existing `SupportInboxAgentConfig` field names (C8).
- §5.6.3: Run Trace event names aligned to `phase1.support.*` namespace (C14); 6 events documented (5 per-ticket + ticket_terminal); `phase1.support.eval_drift_detected` clarified as admin-alert only (iter2-4).
- §5.6.4: `routes/operate/` corrected to `server/routes/support/supportAgentRoutes.ts` (iter2-7); `shared/types/supportInboxAgentConfig.ts` additive fields added to inventory (C8); component test row removed (C2); renderer count corrected to 6 (iter2-3).

### §6 Shared Infrastructure
- §6.1.2: `UNIQUE (storage_provider, storage_key)` index added; idempotency posture (key-based), retry classification (safe), HTTP 409→200 idempotent-hit mapping documented (C10).
- §6.1.2: `iee_artifacts` vs `run_artifacts` source-of-truth precedence pinned (C12).
- §6.1.2b: NEW retention-sweep subsection — Phase 1 hard-deletes; no soft-delete columns; sweeper deletes S3 object, deletes row, emits `phase1.file_delivery.expired` (iter3-3).
- §6.1.4: "single contract, two physical paths" clarified — row insertion + event emission always in main app; Option A (worker direct + finalize endpoint) and Option B (main-app proxy) bind to the same logical contract (iter3-2).
- §6.1.5b: file_delivery payload contracts pinned for the four `phase1.file_delivery.*` events; emit points clarified; download-proxy attribution path made canonical (iter2-6, iter3-2).
- §6.1.6: pure-function tests + a single integration test for the round-trip; broader "E2E test" row removed (C2).

### §7 Test Strategy
- §7.1 / §7.2 rewritten to align with framing: static-gates-primary, pure-function unit tests, two narrow integration tests (file-delivery round-trip; per-ticket atomic-claim contention), no frontend/E2E component tests (C2).
- §7.3 eval CI gate fully specified: minimal `support_eval_runs` row shape, two-consecutive-run logic, fail-open under fewer than two rows (logged) so fresh CI doesn't block all merges (iter2-5).

### §8 Rollout
- §8.3 / §8.4 feature flags removed; per-subaccount enablement uses existing `subaccount_agents.is_active` and `canonical_inboxes.agent_config.mode`; rollback documented as commit-and-revert + per-subaccount disable (C1).

### §9 Acceptance Criteria
- §9.2 "13 listed skills" → "12 listed default skills" (C7).
- §9.2 "All 5 new event types" → "All 6 Run Trace event types from §5.6.3"; admin-only eval drift event excluded (iter2-3).
- §9.1 PDF byte-determinism criterion references the §4.4.3 normalization step (iter3-5).

### §10.5 Deferred Items (NEW section per checklist §7)
- 11 entries summarising NG1/NG2/NG3/NG4/NG6 plus prose-level deferrals (Operator Session Identity, PDF run-over-run delta, dedicated agentRunCompletedHandler, worker-direct S3 IAM, Haiku-classify routing, generic skill-result cache, run-artifacts retry endpoint).

## Rejected findings

None. All Codex mechanical findings were accepted; the two directional findings were auto-decided per framing assumptions and recorded in `tasks/todo.md`.

## Directional / ambiguous findings (autonomously decided)

| Iteration | Finding | Classification | Decision | Rationale | Routed to |
|---|---|---|---|---|---|
| 1 | C15 — §9.2 eval threshold "≥85% per intent OR tuned-during-pilot" makes merge gate movable | Directional (scope/posture) | AUTO-DECIDED reject | Operator pre-pass deliberately tagged thresholds tunable during pilot. Tightening pre-build forces Product sign-off into build flow which conflicts with rapid-evolution posture. Eval harness is Phase 1 instrumentation, not a regulated launch gate. | `tasks/todo.md` § Deferred spec decisions — phase-1-showcase-mvps (PSM-D1) |
| 1 | C16 — §11.1–11.4 open decisions block build planning | Directional (sequencing) | AUTO-DECIDED reject | Caller framing said spec is intentionally architecture-level. The four decisions all carry explicit recommendations; the architect-agent can resolve them during plan breakdown. Forcing pre-build resolution is over-constraint. | `tasks/todo.md` § Deferred spec decisions — phase-1-showcase-mvps (PSM-D2) |

Both items remain open in `tasks/todo.md` — the human can revisit either before Phase 2 build begins or accept the recommendations and move on.

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against three iterations of Codex review. The reviewer adjudicated every finding that surfaced and routed the two directional calls to deferred review. However:

- The review did not re-verify the framing assumptions in `docs/spec-context.md`. Pre-production / rapid evolution / static-gates-primary / no feature flags / commit-and-revert rollout are all assumed current. If product context shifts, re-read the spec's framing sections (§1, §2, §3, §7, §8) before treating this verdict as still valid.
- The review did not catch directional findings that Codex and the rubric did not see. Three iterations is a strong upper bound for automated convergence, but it is not a substitute for an architect's read.
- The two directional findings (PSM-D1, PSM-D2) sit in `tasks/todo.md` as informational deferrals. PSM-D2 in particular ("resolve §11 open decisions before build planning, or carry them into the architect's plan breakdown?") is worth a 30-second decision before invoking `architect`. Resolving PSM-D2 in the spec lets the architect produce a tighter chunk plan; carrying it forward gives the architect more flexibility but produces more chunks.
- The review did not prescribe what to build first. Sequencing within the build (file delivery → 42 Macro → Support Inbox, all per §0.6 / §8.1) is the architect's call.

**Recommended next step.** Before invoking `architect: implement phase-1-showcase-mvps`, take one quick pass through the framing sections (§0–§3 + §10.5 Deferred Items) and the two PSM-D* items in `tasks/todo.md`. If the framing reads true and you have no preference on PSM-D2, the spec is implementation-ready and architect plan-breakdown can begin.
