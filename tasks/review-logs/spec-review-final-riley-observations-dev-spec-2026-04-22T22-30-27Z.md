# Spec Review Final Report — Riley Observations

**Spec:** `docs/riley-observations-dev-spec.md`
**Spec commit at start:** `0d5978062347ac9e50dae7acfa7e5e361586d9fe`
**Spec commit at finish:** uncommitted (in-session edits — 407 insertions, 136 deletions)
**Spec-context commit:** `1eb4ad72f73deb0bd79ad333b3f8caef23418392`
**HEAD at start:** `db8590cdadb79bb81de60327e456772f58984d21`
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only-rounds
**Iteration log:** `tasks/review-logs/spec-reviewer-log-riley-observations-dev-spec-2026-04-22T21-45-51Z.md`

---

## Iteration summary

| # | Codex | Rubric | Accepted | Rejected | Framing-auto | Convention-auto | Best-judgment |
|---|----|----|----|----|----|----|----|
| 1 | 26 | 2 | 22 | 0 | 0 | 0 | 7 |
| 2 | 11 | 0 | 11 | 1 | 0 | 0 | 0 |
| 3 | 6 | 0 | 6 | 0 | 0 | 0 | 0 |

Totals: 45 findings, 39 mechanical fixes applied, 1 rejected (framing-aligned — already fixed), 7 routed to `tasks/todo.md`.

---

## Mechanical changes (section-by-section)

### §1.3 — Success criteria
- SC1 scope clarified: grep scope is `client/src/**/*.{ts,tsx,md,html}` + server-rendered templates + portal copy; migration files + review logs explicitly out-of-scope.
- SC3 updated from "three migrations" to "all five migrations" with cross-reference to §10.1.
- SC5 expanded with "excluding Universal Brief simple_reply paths" exclusion to match §8.7 edge 1.

### §3.1 — Existing system reference
- Removed nonexistent `playbooks` top-level table; added clarification that primary identity lives on `playbook_templates` + `playbook_runs`; enumerated 4 additional playbook services.

### §4.3 / §4.6 / §4.8 — Part 1 naming pass
- Migrations renumbered: 0172/0173/0174 → 0202/0203/0204 (0172-0179 occupied by ClientPulse work; next free slot is 0202).
- §4.6 permission table expanded with every `PROCESSES_*` key (`ACTIVATE`, `VIEW_SYSTEM`, `CLONE`, full `SUBACCOUNT_PERMISSIONS.PROCESSES_*` set, group-name strings).
- §4.6 file inventory expanded: `CommandPalette.tsx`, `AdminSubaccountDetailPage.tsx`, `PortalExecutionPage.tsx`, `PortalExecutionHistoryPage.tsx`, `OrgSettingsPage.tsx`, `server/routes/subaccounts.ts`, `server/routes/portal.ts`.
- §4.8 service list expanded: all 9 `playbook*Service*.ts` files named explicitly; `server/lib/playbook/*` directory rename added.
- §4.8 route list expanded: `playbookRuns.ts`, `playbookTemplates.ts`, `playbookStudio.ts`, `subaccountOnboarding.ts`.
- §4.8 cross-table columns enumerated explicitly: `playbook_slug`, `last_written_by_playbook_slug`, `created_by_playbook_slug`, `playbook_step_run_id`, slug-array columns.

### §5 — Part 2 Workflows calling Automations
- `InvokeAutomationStep.gateLevel` narrowed to `'auto' | 'review'` (authoring-time rejection of `'block'`); branch removed from §6.5 gate algorithm.
- Scope-matching made explicit: same-subaccount equality required; cross-subaccount rejected with `automation_scope_mismatch`.
- `TemplateExpression` replaces `JsonPathExpression`; matches existing DSL; stale refs in §5.11 + §12.2 removed.
- `timeoutSeconds` default references existing `DEFAULT_TIMEOUT_SECONDS = 300` constant (not a nonexistent column).
- §5.4 / §5.5 runtime schema validation softened to best-effort; validator + format deferred to §12.23.
- §5.9 step-output storage clarified: `workflow_step_runs.output_json` (native Workflow), NOT `flow_step_outputs` (internal flow stack).
- §5.9 telemetry: `dispatched` conditional on successful resolution; `completed` status enum extended with `automation_not_found` + `automation_scope_mismatch`.

### §6 — Part 3 Explore / Execute Mode
- Migration renumbered 0175 → 0205.
- Pre-existing `playbook_runs.run_mode` (migration 0086, 4 values) preserved; NEW column `safety_mode` added (architect confirms via §12.24).
- `user_run_mode_preferences` → `user_agent_safety_mode_preferences` throughout.
- PK fixed: surrogate `id uuid` + two partial unique indexes for nullable `subaccount_id`.
- RLS contract added as §6.3a: `organisation_id` column, policy, manifest entry, route guard, principal context.
- `resolveSafetyMode()` has 5-step priority including `parentRun` inheritance; §6.7 edge 7 derives from the resolver.
- Shared gate resolver `server/services/gateResolutionServicePure.ts` called from both `agentExecutionService.ts` and `workflowEngineService.ts`.
- `side_effects` static gate `scripts/gates/verify-skill-side-effects.sh` named; runtime storage deferred to §12.22.
- Naming consistency: `safetyMode` (TS) / `safety_mode` (SQL); UI copy and telemetry updated; `run.mode.selected` → `run.safety_mode.selected`.

### §7 — Part 4 Heartbeat activity-gate
- Migration renumbered 0176 → 0206.
- `last_tick_evaluated_at` column added; §7.7 queries updated.
- `HeartbeatGateInput.lastTickEvaluatedAt` added; §7.6 hook expanded with explicit state load.
- `HeartbeatGateReason` union extracted with `gate_error` included.
- `ticksSinceLastRun` → `ticksSinceLastMeaningfulRun` everywhere; §9a example corrected.
- Rule 2 first-tick branch added.
- Run-completion hook named: `agentRunFinalizationService.ts` (architect confirms via §12.17).

### §8 — Part 5 Context-assembly telemetry
- `gapFlags` enum extended with `context_pressure_unknown` + `workspace_memory_truncated`.
- `contextPressure` semantics pinned when `contextBudget = 0`: set to 0 plus `context_pressure_unknown` flag.

### §9a (new) — Contracts
- 10 boundary shapes with Name/Type/Producer/Consumer/Nullability/Example per checklist §3.

### §9b (new) — Deferred Items
- Consolidates every prose deferral across Parts 1–6 and cross-cutting concerns per checklist §7.

### §10 — Data migration plan
- §10.1 "Down file" column added; `_down/` files required for each migration.
- §10.4 codemod + rebase scripts explicitly scoped as new files.
- §10.5 rollback clarified: `git revert` alone doesn't execute DDL.

### §11 — Rollout plan + test strategy
- §11.1 W0: "Rec 5" → "Part 6 (§9)".
- §11.2 Part 2: pure-function unit coverage with service-boundary mocking; no MSW.
- §11.2 Part 3 cites `gateResolutionServicePure.test.ts` and `resolveSafetyModeServicePure.test.ts`.

### §12 — Open Questions
- Items 22, 23, 24 added; §12.13, §12.14, §12.16, §12.17 sharpened.
- Numbering gap (23 → 25) fixed: 25 renumbered to 24.

### §13 — Appendix
- §13.1 glossary row "Run safety mode" rewritten as new dimension distinct from legacy `run_mode`.

### TOC
- §9a and §9b entries added.

---

## Rejected findings

| Iteration | Section | Finding | Rejection reason |
|---|---|---|---|
| 2 | §11.2 | Codex suggested replacing the Part 2 integration test with additional coverage | The integration tests named in §11.2 are small carved-outs the framing allows ("small carved-out integration tests are OK if the spec already names them"). The MSW-based test was already rewritten in iter 1 to pure-function unit coverage; no further change needed. |

---

## Directional / ambiguous findings routed to `tasks/todo.md`

All 7 routed to `tasks/todo.md` under `## Deferred from spec-reviewer review — riley-observations-dev-spec (2026-04-22)`:

| # | Finding | Classification | Decision type | Rationale |
|---|---|---|---|---|
| 1 | F6 — `safety_mode` vs pre-existing `run_mode` reconciliation | Directional | AUTO-DECIDED | Conservative best-judgment: introduce new `safety_mode` column rather than repurpose existing `run_mode` (4 execution-style values). Preserves architect's ability to decide the final shape via §12.24. |
| 2 | F10 — Portal mode field unnamed | Ambiguous → Directional | AUTO-DECIDED | Agent sharpened §12.13: architect must name existing column OR add new one; non-negotiable before Part 3 ships. |
| 3 | F11 — `side_effects` runtime storage | Directional | AUTO-DECIDED | Agent recommends `system_skills.side_effects boolean` top-level column (option a) for fast gate-resolution reads; architect confirms via §12.22. |
| 4 | F15 — Runtime schema validator + format | Ambiguous → Directional | AUTO-DECIDED (mixed) | Spec edit softened the "must validate" claim to best-effort v1; architect picks via §12.23. |
| 5 | F21 — Rule 3 "Check now" trigger OR Rule 3 removal | Directional | AUTO-DECIDED | "Check now" doesn't exist in the codebase. Agent recommends dropping Rule 3 from v1; architect confirms via §12.16. |
| 6 | F22 — Definition of "meaningful" output | Ambiguous → Directional | AUTO-DECIDED | Architect-pass concern. Recommendation: `status='completed'` AND (action proposed OR memory block written). Captured in §7.6 and §12.17. |
| 7 | Supervised-mode removal audit | Directional (reframed) | AUTO-DECIDED | §6.8 already decided removal; §12.14 is now an audit step for architect, not an open decision. |

No findings were auto-rejected via framing. Codex's single framing-adjacent suggestion (§11.2 MSW → pure-function unit tests) ALIGNED with framing, so it was auto-applied as mechanical rather than rejected.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review. However:

- **The review did not re-verify the framing assumptions.** If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's §1 Goals / §2 Background / §6–§9 Parts yourself before calling the spec implementation-ready.
- **The review did not catch directional findings that Codex and the rubric did not see.** Automated review converges on known classes of problem; it does not generate insight from product judgement. The spec's central product decision (Explore / Execute Mode as a first-class safety affordance) was not stress-tested against user research — only internally stress-tested for consistency.
- **The review did not prescribe what to build next.** Sprint sequencing and scope trade-offs remain the human's job.
- **Seven open architect decisions remain in `tasks/todo.md`.** Four of the seven (F6 / F10 / F11 / F21) are non-negotiable before Part 3 or Part 4 migrations can ship. Architect must resolve during plan decomposition.

**Recommended next step:** read the spec's §1.1 Goals, §1.3 Success Criteria, §6.1, §6.13, and the 7 items in `tasks/todo.md` (dated 2026-04-22). Confirm the headline findings match your current intent. Then invoke `architect` on this spec to decompose into build plans (one per Wave per §11.1 — W0/W1/W2/W3/W4).
