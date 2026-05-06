# Spec Review Final Report

**Spec:** `docs/sub-account-optimiser-spec.md`
**Spec commit at start:** `638bf157`
**Spec commit at finish:** `a69182ae`
**Spec-context commit:** `03cf8188`
**Iterations run:** 4 of 5
**Exit condition:** two-consecutive-mechanical-only (iter 3 + iter 4 each had 0 ambiguous / 0 directional / 0 reclassified)
**Verdict:** READY_FOR_BUILD (4 iterations, 40 mechanical fixes applied, 3 AUTO-DECIDED routed to tasks/todo.md)

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 12 | 7  | 17 | 0 | 0 | 0 | 2 (F2-AD-1, F2-AD-2) |
| 2 | 9  | 0  | 8  | 0 | 0 | 0 | 1 (F2-AD-3) |
| 3 | 9  | 0  | 9  | 0 | 0 | 0 | 0 |
| 4 | 6  | 0  | 6  | 0 | 0 | 0 | 0 |
| **Σ** | **36** | **7**  | **40** | **0** | **0** | **0** | **3** |

## Mechanical changes applied

### §0 / Header
- Migrations claimed updated to `0267` + `0267a`.
- Prototype list updated to `home-dashboard.html` + `home-dashboard-subaccount-context.html`.

### §2 Recommendation taxonomy
- `inactive.workflow` trigger rewritten to use `subaccount_agents.scheduleEnabled + scheduleCron + scheduleCalendarServicePure` (no longer references nonexistent `autoStartOnSchedule`).
- `inactive.workflow` dedupe key changed from `<workflow_id>` to `<subaccount_agent_id>` for consistency with the new trigger.
- Each-recommendation row enumeration extended with `evidence_hash`.
- Render cache key pinned to `(category, dedupe_key, evidence_hash)` (was "by `dedupe_key`").

### §3 Telemetry sources
- Workflow last-run row split: `flow_runs` for escalation joins; `subaccount_agents` joined to `agent_runs` for `inactive.workflow`.
- HITL escalation source extended to include `flow_step_outputs` (`stepId`, `status='failed'`) for the modal-step join.
- Cross-tenant median view source rewritten: `optimiser_skill_peer_medians` over `agent_execution_events` (skill_slug + duration extracted from JSONB payload), keyed by `skill_slug`.
- Cross-tenant median view section: pinned access posture (read via `withAdminConnection`, opted out of `rlsProtectedTables.ts` because no per-tenant rows; HAVING-clause threshold of 5).

### §4 Agent definition
- "Configurable" qualifier removed; schedule explicitly stored on `subaccount_agents.scheduleCron` etc.
- Sub-account-agent row bootstrap path added (backfill at deploy + hook in `subaccountService.create`).
- Default-on prose rewritten — column-only, no operator UI in v1, settings UI deferred.

### §5 Skills
- `output.recommend` skill table return type updated to full discriminated union with optional `reason`.
- `optimiser.scan_inactive_workflows` description rewritten and return shape changed to `{subaccount_agent_id, agent_id, agent_name, expected_cadence, last_run_at}`.
- `optimiser.scan_workflow_escalations` return shape uses `common_step_id` (was ambiguous `common_step`).
- Render cache key pinned to `(category, dedupe_key, evidence_hash)` and re-render condition tightened to "evidence_hash mismatch" (was "evidence shape changes").

### §6 Storage model + generic primitive

**§6.1**
- New `evidence_hash` column added to schema (sha256 over canonical-JSON of `evidence`).
- New `updated_at` column added (set on insert + every mutation; replaces `created_at` as the authoritative recency for sort and freshness copy).
- Open-by-scope index switched to sort on `updated_at` instead of `created_at`.
- "Why not extend an existing primitive" paragraph added (compares against `system_incidents`, `feature_requests`, `org_memories` / `workspace_memory`).
- "Acknowledged-row semantics" paragraph added — pins that acknowledge does NOT clear the dedupe slot but evidence_hash mismatch DOES clear `acknowledged_at`.

**§6.2**
- Output type expanded to discriminated union with `reason: 'cap_reached' | 'updated_in_place'`.
- Update-in-place path defined explicitly: bumps `updated_at`, clears `acknowledged_at`, re-renders copy.
- Idempotency posture pinned (key-based on `(scope_type, scope_id, category, dedupe_key) WHERE dismissed_at IS NULL`).
- Concurrency guard pinned: first-commit-wins via unique index; loser catches `23505` and returns `was_new=false` with the existing row id.
- Retry classification pinned (`safe` for `output.recommend`; `guarded` for acknowledge/dismiss).
- Cap of 10 enforced via `pg_advisory_xact_lock` on `(scope_type, scope_id, producing_agent_id)` (was an unsafe count-then-insert).
- Pre-write candidate ordering pinned (severity desc → category asc → dedupe_key asc) so cap-eviction is deterministic.
- `producing_agent_id` provenance pinned (executor-derived from agent execution context; never caller-supplied; non-agent invocations rejected).
- Evidence hash definition pinned (RFC 8785 canonical JSON; covers values, not just shape).

**§6.3**
- `includeDescendantSubaccounts?: boolean` prop added (default false; only meaningful when `scope.type='org'`).
- `mode?: 'collapsed' | 'expanded'` prop added.
- `onTotalChange?: (total: number) => void` callback added.
- `onExpandRequest?: () => void` callback added.
- Row-data contract pinned including `subaccount_display_name?: string` for org-rollup rows and `updated_at`.
- Org-rollup row label rendering rule pinned.
- Row sort changed from `created_at desc` to `updated_at desc`.
- Implicit-acknowledge-on-deep-link-click rule added.

**§6.4**
- (Unchanged.)

**§6.5 Contracts (new subsection)**
- Row contract pinned (producer, consumer, nullability, defaults, worked example).
- `output.recommend` input/output contract cross-referenced from §6.2.
- Read endpoint `GET /api/recommendations` pinned with full query-param surface and response shape.
- Acknowledge / dismiss endpoint contracts pinned with state-based idempotency and the CTE pattern that distinguishes 404 from 200-already*.
- `action_hint` deep-link schema pinned (per-category table with worked examples).
- Socket event payload pinned (`dashboard.recommendations.changed` shape + emitting paths + consumers).

### §7 Output surface
- Org context wiring example updated to pass `includeDescendantSubaccounts={true}`.
- Section sub-header copy updated to derive freshness label from max-`updated_at` of in-scope rows.
- "See all N →" wiring spelled out: parent holds `mode` state; component flips `mode` via `onExpandRequest`; expanded mode fetches `limit=100`.

### §8 Cost model
- LLM render cost description updated: cache key is `(category, dedupe_key, evidence_hash)`; byte-equal re-runs incur zero LLM spend.
- Default-on prose tightened to reference column-only opt-out + cap mechanism.

### §9 Build chunks
- Phase 0: read endpoint added to the routes bullet; migration scope clarified to include `subaccounts.optimiser_enabled` column; pure-test bullet kept.
- Phase 1: `inactiveWorkflows.ts` description rewritten; `escalationRate.ts` description extended for `flow_step_outputs` join; phrase tokeniser folded into `escalationPhrases.ts` with a tightened test bullet; cross-tenant median view migration claimed as `0267a`.
- Phase 2: `subaccountService.create` hook bullet added; backfill bullet rewritten to spell out idempotent `INSERT … ON CONFLICT DO NOTHING` for the `subaccount_agents` link before each schedule write; LLM-render cache key updated.
- Phase 3: `<AgentRecommendationsList>` wiring updated to pass `includeDescendantSubaccounts={true}` in org context; rollup behaviour clarified.
- Phase 4 (was Phase 4 phrase-tokeniser): collapsed — work folded into Phase 1.
- Phase 4 (was Phase 5 verification): renumbered; full-suite local run reworded to comply with CLAUDE.md "test gates are CI-only".
- Total estimate updated from ~28h to ~25h to reflect Phase 4 collapse.

### §10 Files touched
- Added: `server/db/schema/subaccounts.ts` (extend with `optimiser_enabled`).
- Added: `server/services/subaccountService.ts` (extend with optimiser-link hook).
- Added: `scripts/backfill-optimiser-schedules.ts`.
- Added: `server/websocket/emitters.ts` (extend) + `server/index.ts` (mount router).
- Added: `migrations/0267a_optimiser_peer_medians.sql` (+ `.down.sql`).
- Removed: `client/src/components/Layout.tsx` (was listed as touched but actually read-only context).
- Acknowledge / dismiss bullet rewritten to also include the GET endpoint.

### §13 Risks
- Cost-overrun mitigation tightened to reference `evidence_hash` (was "evidence shape changes").

### §14 Concurrent-build hygiene
- Migration ownership rewritten to claim both `0267` and `0267a` and explain the two-file split.

### §15 Riley W3 categories
- Phase number reference updated from "Phase 6" to "Phase 5" (after Phase 4 collapse).

### `## Deferred Items` (new section)
- Aggregated 8 deferral entries from prose markers throughout the spec (org-tier optimiser, auto-execution, standalone `/suggestions` page, brand-voice ML, wider scope-awareness, Riley W3 categories, primitive extensions, notification surfaces, settings UI).

## Rejected findings

None. All 40 mechanical findings raised by Codex or the rubric pass were accepted in their adjudicated form.

## Directional and ambiguous findings (autonomously decided)

| # | Iter | Description | Decision type | Rationale |
|---|------|-------------|---------------|-----------|
| F2-AD-1 | 1 | `inactive.workflow` trigger redefined to use `subaccount_agents` schedule columns (was nonexistent `autoStartOnSchedule`) | AUTO-DECIDED — accept | Anchored against a real currently-shipped schedule mechanism (`scheduleCalendarServicePure` is an accepted primitive); keeps the category in v1 instead of deferring it. Routed to `tasks/todo.md` as F2-AD-1 — flag if you intended this category to track workflow templates specifically. |
| F2-AD-2 | 1 | "Why not extend an existing primitive" paragraph added to §6 | AUTO-DECIDED — accept | Spec-authoring-checklist Section 1 expects this depth; design-review decision was already made but not made discoverable. Routed to `tasks/todo.md` as F2-AD-2 — flag if the paragraph misframes the design-review intent. |
| F2-AD-3 | 2 | Opt-out toggle downgraded from "operator-visible UI" to "backend boolean only" | AUTO-DECIDED — accept | UI surface for sub-account settings is genuinely larger scope; v1 ships the column + admin-SQL flip + Configuration Assistant prompt. Routed to `tasks/todo.md` as F2-AD-3 — flag if you intended an operator-visible toggle in v1. Listed in Deferred Items. |

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review. The reviewer adjudicated every directional finding that surfaced and routed three best-judgment decisions to `tasks/todo.md` for human awareness. However:

- The review did not re-verify the framing assumptions at the top of the agent definition. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's §0 / §1 / §13 sections yourself before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. The reviewer converges on known classes of problem; it does not generate insight from product judgement. In particular: the cost model assumes fixed-shape Sonnet pricing that may shift; the cross-tenant peer-median view's privacy guarantee depends on the 5-tenant threshold being right (not just being enforced); the primitive's lifecycle assumption — that operator-facing recommendations are a fundamentally different shape from `system_incidents` / `feature_requests` / `org_memories` — is itself a directional bet.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.

**Recommended next step:** read §0 (design summary) + §11 (done definition) + the new `## Deferred Items` section one more time to confirm the headline findings match your current intent, then start implementation.

