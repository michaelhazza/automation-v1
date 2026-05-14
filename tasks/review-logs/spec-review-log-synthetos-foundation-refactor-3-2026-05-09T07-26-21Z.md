# Spec review log — synthetos-foundation-refactor — iteration 3

- Spec: `tasks/builds/synthetos-foundation-refactor/spec.md`
- Spec commit at start: `95e16fd83f8768e9b4fc2dc0cfe7aa7c3d4cf818`
- Codex output: `tasks/review-logs/_codex_synthetos_foundation_iter3_2026-05-09T07-26-21Z.txt`
- Codex returned 13 findings.

## Index

- Findings 1-13 (Codex)
- Rubric pass
- Summary

## Findings 1-13

### F1 — Terminal status value mismatch (`compute_budget_exceeded` vs `budget_exceeded`)
Sections: §3.6, §4.4.4. Verified against `shared/runStatus.ts` line 32: the TS constant key is `COMPUTE_BUDGET_EXCEEDED` but the string value is `'budget_exceeded'`. The spec embeds the string values in prose so it must use `budget_exceeded`. Mechanical (drift). **Auto-apply** — replace `compute_budget_exceeded` with `budget_exceeded` in both terminal-status enumerations.

### F2 — Controller-style validation depends on Phase 1D schema
Sections: §4.1.6, §5.2.9, §8.1, §6.3. The `controller_style_allowed` validation (§4.1.6) depends on the `subaccount_agents` columns introduced under §5.2 UI work (Phase 1D). Mechanical (sequencing bug). **Auto-apply** — move `NNNN_subaccount_agents_governance.sql` migration into Phase 1A's prerequisite set. Actually rethink: the simpler fix is to defer the validation into §4.1 explicitly — split the migration: create just `controller_style_allowed` in Phase 1A migration (alongside the `controller_style` migration on `agent_runs`), and ship the other three governance columns with Phase 1D UI. OR simpler: move the entire `subaccount_agents_governance.sql` migration to Phase 1A. That's the cleaner option per `migration_batching_preference: batch same-shape DDL into one file`. **Decision: move migration to Phase 1A.**

### F3 — Default `native_only` conflicts with derived Operator defaults
Sections: §4.1.6, §5.2.9. `native_only` is the default for `controller_style_allowed`, but executionMode like `iee_browser` derives `operator`. So derivation produces `operator` and validation rejects it. Mechanical (load-bearing claim conflict). **Auto-apply** — fix the derivation rule: validation applies to the final resolved style; if `controller_style_allowed = 'native_only'`, the derived `operator` is downgraded to `native` (with an audit log) rather than rejected. The route returns 422 ONLY for explicit operator overrides, not for derived ones. (Otherwise existing iee_browser/iee_dev runs would all fail at the validator.)

### F4 — Governance columns lack enforcement wiring
Sections: §5.2.9, §4.5.4, §4.5.7. `allowed_environments`, `max_risk_tier`, `require_approval_at_tier` are declared but no enforcement is named (envelope is for replay/audit, not enforcement per §4.5.7). Mechanical (load-bearing claim without enforcement mechanism). **Auto-apply** — add enforcement points: (a) `allowed_environments` checked at run creation in `agentRunService` against the requested `executionMode` (rejects on mismatch); (b) `max_risk_tier` and `require_approval_at_tier` enforced inside `policyEngineService.evaluatePolicy` (already extended for `riskTier` per §4.2.8) — added as predicate over the resolved gateLevel. Add explicit subsection in §4.2.8 (or a new §4.2.8a) covering these.

### F5 — Risk Tier defaults claim contradicts preserved-gate precedence
Sections: G2, §4.2.4, §7.6 scenario 1. G2 says Tier 0-2 auto-approve by default; §4.2.4 says preserved existing gate level wins. The acceptance scenario "Tier 0 to 2 actions auto-approve" is consistent only when there's no preserved gate — but the registry sweep PRESERVES every existing gate. Mechanical (claim mismatch). **Auto-apply** — reword G2 and §7.6 scenario 1 so they reflect "Tier defaults apply when no preserved existing gate level or policy override applies". For acceptance scenario 1, specify a tier-0-to-2 action that has matching auto preserved gate (which most tier 0-2 actions will have anyway because that was the prior gate level).

### F6 — Run Trace cursor: `source_id` not in UNION SELECT projection
Sections: §4.4.4, §4.4.5. The cursor uses `source_id` but the SQL UNION arms don't project a `source_id` column. Mechanical (contract drift introduced in iteration 2 fix). **Auto-apply** — add `source_id` (table-row PK) to every UNION arm in the §4.4.5 SQL sketch.

### F7 — `toolSlug` filter declared but not specified in query logic
Sections: §4.4.3, §4.4.5, §4.4.6. The endpoint exposes `toolSlug` but the query strategy doesn't specify how the filter is applied across heterogeneous source tables. Mechanical (load-bearing claim — endpoint contract — without backing logic). **Auto-apply** — add a paragraph after the SQL sketch explaining: `toolSlug` filter applies only to events where the source row carries a tool slug (`actions.skill_slug`, `tool_call_security_events.tool_slug`, `agent_execution_events` payload `tool_slug` for `tool_call`/`tool_result`). Events from other source tables are excluded when `toolSlug` is set.

### F8 — Stale Run Trace source count in glossary
Sections: §4.4.1, §4.6.3. The glossary says "`agent_execution_events` plus 4 sibling tables" (5) but §4.4.1 says nine. Mechanical. **Auto-apply** — update glossary to "nine source tables listed in §4.4.1".

### F9 — Subaccount governance down migration missing from inventory
Sections: §5.2.8, §5.2.9, §6.1. INV-4 mandates `.down.sql` for every migration; §5.2.8 file table only lists the up migration. Mechanical. **Auto-apply** — add `migrations/_down/NNNN_subaccount_agents_governance.down.sql` row, and add a small down SQL snippet to §5.2.9.

### F10 — New permission `credentials:audit:read` has no registry/seed owner
Section: §5.4.4. Route requires `credentials:audit:read` but no permission-registry / role-seed file is in the inventory. Mechanical (load-bearing claim — guard requires a permission — without backing). **Auto-apply** — review what permission-registration files exist; either add them to §5.4 inventory or reuse an existing permission. The simpler / cheaper fix is to reuse an existing permission like `subaccount:credentials:read` if one exists. Since I don't know the actual permission registry shape from this spec alone, use a permissive fallback: keep `credentials:audit:read` and add `server/lib/permissions.ts` (or wherever the permission catalogue lives) to the §5.4 file inventory as the place where the new permission is registered.

### F11 — Test posture contradicts integration-test inventory
Sections: §7.1, §7.2. §7.1 says `runtime_tests: pure_function_only` (a quote from the framing yaml) but §7.2 lists two integration tests. Mechanical (wording — the framing-yaml quote is taken literally, but §7.1 prose justifies the carved-out exceptions). **Auto-apply** — restructure §7.1 to lead with "Project default is pure-function only" then explicitly note the two named integration-test exceptions.

### F12 — Controller-style test filename drift
Sections: §4.1.7, §4.1.10, §7.2. §4.1.7 inventory and §7.2 use `controllerStyleResolverPure.test.ts`; §4.1.10 (older prose) refers to `controllerStyleResolver.test.ts`. Mechanical. **Auto-apply** — standardise on `controllerStyleResolverPure.test.ts`.

### F13 — Open decision §12.7 remains OPEN
Section: §12.7. Iteration-2 fix marked it OPEN intentionally because the recommendation says "single feature-coordinator run" but it's a process question, not an implementation question. Codex wants it RESOLVED. Reasonable mechanical close. **Auto-apply** — mark §12.7 RESOLVED with the recommendation as the verdict.

## Rubric pass

No new rubric findings beyond what Codex already surfaced.

## Iteration 3 Summary

- Mechanical findings accepted: 13
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration: (set after commit)

Note on F1: the spec had an outright incorrect terminal-status string (`compute_budget_exceeded`) introduced in iteration 2's "use shared/runStatus.ts" fix — I copied the TS constant key instead of the string value. Fixed.

Note on F4: governance enforcement points were not previously named (the columns existed in §5.2.9 but no service consumed them). Fix adds `subaccount_constraint` as a fourth gate-derivation source and pins enforcement to `agentRunService.createRun` (allowed_environments) and `policyEngineService.evaluatePolicy` (max_risk_tier and require_approval_at_tier).

Stopping heuristic: iteration 2 was 0-directional / 0-ambiguous (mechanical only); iteration 3 was 0-directional / 0-ambiguous (mechanical only). Two consecutive mechanical-only rounds reached → loop exits per spec-reviewer Step 9 stopping condition #2.
