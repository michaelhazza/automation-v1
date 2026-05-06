# Spec Review — subaccount-optimiser — Iteration 1

- Spec commit at start: 638bf157
- Spec-context commit: 03cf8188
- Codex output: tasks/review-logs/_codex_iter1.txt

## Codex findings

### FINDING #1 — `skill.slow` source-of-truth inconsistency
- Section: §3 / §9 / §10 (lines 148, 156, 374-380)
- Issue: Two different timing sources named for one metric — `agent_execution_events` AND a peer-median view "over `agent_runs` joined to `skill_instructions`". Verified `agent_execution_events` has no `skill_slug` column today (timing must come from JSONB `payload`).
- Classification: mechanical
- Disposition: auto-apply. Pick `agent_execution_events` as the single source; document peer-median view definition in matching terms.

### FINDING #2 — render-on-evidence-change without an update path
- Section: §2, §5, §6.2 (lines 96, 198, 261, 502)
- Issue: Spec promises re-render when evidence changes but `output.recommend` is insert-or-no-op only — no update path.
- Classification: mechanical
- Disposition: auto-apply. Add explicit update-on-evidence-change clause to `output.recommend`.

### FINDING #3 — `acknowledged_at` semantics undefined
- Section: §6.1 (lines 220-232) and §11 (line 487)
- Issue: Dedupe unique index ignores only `dismissed_at`, so acknowledging hides a finding from the list AND blocks re-creation.
- Classification: mechanical
- Disposition: auto-apply. Decide: acknowledged still occupies the dedupe slot (no recreation behind the operator's back); list view filters acknowledged out.

### FINDING #4 — single-scope component prop can't express org rollup
- Section: §6.3 (lines 271-279), §7 (lines 304-309), §9 Phase 3 (line 400)
- Issue: Component prop is single-scope but org context must include subaccount-scoped rows.
- Classification: mechanical
- Disposition: auto-apply. Add `includeDescendantSubaccounts?: boolean` to hook + component contract.

### FINDING #5 — sub-account label missing in rolled-up rows
- Section: §7 (lines 306, 317), §6.3 (line 281)
- Issue: Org-context rollup needs a per-row sub-account label; row contract has no client-name field.
- Classification: mechanical
- Disposition: auto-apply.

### FINDING #6 — `subaccount_settings.optimiser_enabled` is a phantom column
- Section: §1 / §4 / §8 / §9 / §11 (lines 82, 175, 347, 391, 482)
- Issue: Verified — no `subaccount_settings` table in current schema. File inventory doesn't add it.
- Classification: mechanical
- Disposition: auto-apply. Move opt-out boolean onto existing `subaccounts` table as `optimiser_enabled`. Update all five references and §10.

### FINDING #7 — `inactive.workflow` references nonexistent schema fields
- Section: §2 / §3 / §9 (lines 109, 152, 375, 387-388)
- Issue: `autoStartOnSchedule` and "cadence" not on `workflowTemplates` or `flowRuns`. `agentScheduleService` operates on `subaccountAgents.scheduleCron` / `scheduleEnabled` instead.
- Classification: ambiguous → AUTO-DECIDED
- Disposition: best-judgment — rewrite trigger to use `subaccountAgents.scheduleEnabled = true AND scheduleCron IS NOT NULL` and check `agent_runs` last-run for that sub-account agent against expected cadence (computed via `scheduleCalendarServicePure`). This matches a real, currently-shipped schedule mechanism. Route to tasks/todo.md.

### FINDING #8 — hard cap of 10 stated as mitigation but not enforced
- Section: §8 (line 347), §13 (line 500)
- Issue: Load-bearing mitigation with no backing mechanism.
- Classification: mechanical
- Disposition: auto-apply. Enforce inside `output.recommend` (count open rows for `(scope, producing_agent_id)` before insert; refuse with `was_new=false, reason='cap_reached'` at the cap).

### FINDING #9 — Phase 4 duplicates Phase 1/2 work for `escalation.repeat_phrase`
- Section: §9 Phase 4 vs Phase 1/2 (lines 371-411)
- Issue: Phase 1/2 already declares `escalationPhrases.ts` query + `repeatPhrase` evaluator. Phase 4 redefines tokeniser/threshold/action_hint as if it's separate work.
- Classification: mechanical
- Disposition: auto-apply. Rename Phase 4 to "Phrase tokeniser implementation (for `escalation.repeat_phrase`)" and drop duplicate threshold + action_hint bullets.

### FINDING #10 — migration ownership `0267` vs `0267a` undecided
- Section: header + §9 + §10 + §14 (lines 6-7, 380, 453, 510)
- Issue: Spec alternates between "folded into 0267" and "split into 0267a".
- Classification: mechanical
- Disposition: auto-apply. Pick: `0267_agent_recommendations.sql` (table + RLS) AND `0267a_optimiser_peer_medians.sql` (cross-tenant view). Update header to claim both.

### FINDING #11 — prototype filename drift
- Section: header (line 23), §7 (lines 331-333)
- Classification: mechanical
- Disposition: auto-apply. Use `home-dashboard.html` + `home-dashboard-subaccount-context.html` (per §7).

### FINDING #12 — `Layout.tsx` listed in §10 with "no change to nav"
- Section: §10 (lines 461-463)
- Classification: mechanical
- Disposition: auto-apply. Remove `Layout.tsx` from §10 file inventory.

## Rubric findings

### RUBRIC #R1 — Contracts subsection missing
- Section: spec as a whole; spec-authoring-checklist Section 3
- Issue: No Contracts subsection pinning the row representation, the API request/response shapes for acknowledge/dismiss, or the socket event payload.
- Classification: mechanical
- Disposition: auto-apply. Add a small Contracts subsection to §6 covering all four shapes.

### RUBRIC #R2 — `## Deferred Items` section missing
- Section: spec as a whole; spec-authoring-checklist Section 7
- Issue: Deferrals scattered through prose with no aggregation section.
- Classification: mechanical
- Disposition: auto-apply. Add `## Deferred Items` between §15 and end-of-doc.

### RUBRIC #R3 — Idempotency posture / concurrency guard for `output.recommend`
- Section: §6.2 + spec-authoring-checklist §10
- Issue: Idempotency posture name, concurrency guard for racing writes, and `23505` mapping not pinned.
- Classification: mechanical
- Disposition: auto-apply. Pin: key-based on `(scope_type, scope_id, category, dedupe_key) WHERE dismissed_at IS NULL`; first-commit-wins; loser catches `23505` and returns `{ was_new: false, recommendation_id: <existing row id> }`.

### RUBRIC #R4 — Permission/RLS posture for cross-tenant peer-median view
- Section: §3 / §6
- Issue: View is "sysadmin-bypassed" but the access pattern, opt-out from `rlsProtectedTables.ts`, and connection mode aren't pinned.
- Classification: mechanical
- Disposition: auto-apply. State: read via `withAdminConnection`, view exposes only aggregates so opted out of `rlsProtectedTables.ts` with one-line rationale.

### RUBRIC #R5 — "Why not extend an existing primitive" paragraph (lighter than checklist depth)
- Classification: ambiguous → AUTO-DECIDED
- Disposition: best-judgment — accept (light edit). Add one short paragraph to §6 stating "Why not extend an existing primitive" so the design-review decision is discoverable. Route to tasks/todo.md for awareness.

### RUBRIC #R6 — Spec mandates full local test runs (CLAUDE.md violation)
- Section: §9 Phase 5 ("All unit + integration tests pass locally")
- Classification: mechanical
- Disposition: auto-apply. Reword to "targeted unit + integration test files for this build pass via `npx tsx <path-to-test>`".

### RUBRIC #R7 — Backfill script missing from §10
- Section: §9 Phase 2 names a "one-shot script" but §10 doesn't list a path.
- Classification: mechanical
- Disposition: auto-apply. Add `scripts/backfill-optimiser-schedules.ts` to §10.

## Iteration counts

- Codex findings: 12 (11 mechanical, 1 ambiguous → AUTO-DECIDED)
- Rubric findings: 7 (6 mechanical, 1 ambiguous → AUTO-DECIDED)
- Mechanical accepted: 17
- Mechanical rejected: 0
- Reclassified → directional: 0
- Directional: 0
- AUTO-DECIDED: 2 (#7, R5) — both routed to tasks/todo.md as F2-AD-1 and F2-AD-2

## Iteration 1 Summary

- Mechanical findings accepted: 17
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 2
- Reclassified → directional: 0
- Autonomous decisions: 2
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 2 (see tasks/todo.md)
- Files modified: docs/sub-account-optimiser-spec.md, tasks/todo.md
- Spec commit after iteration: (set by commit step)

