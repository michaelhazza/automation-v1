# Spec Self-Review — Run Continuity & Workspace Health

**Spec:** `docs/run-continuity-and-workspace-health-spec.md`
**Iteration:** 1 (manual self-review)
**Reviewer:** Claude (acting as both Codex and adjudicator)
**Why self-review:** Codex CLI is not installed in this environment. The `spec-reviewer` agent depends on `codex review` and cannot run. The rubric portion of the spec-reviewer agent is the same on every iteration regardless of Codex output, so this self-review applies the rubric directly.
**Spec-context:** `docs/spec-context.md` — pre-production, rapid evolution, static-gates-primary, no frontend tests, no feature flags. The spec is consistent with this framing.

---

## Rubric findings + adjudications

### Mechanical findings (auto-applied below)

#### F1 — P1 test file path drift
**Rubric category:** Convention drift
**Section:** P1 — Files to change table
**Issue:** Spec lists `server/services/agentRunHandoffServicePure.test.ts` but the existing convention puts pure-helper tests under `server/services/__tests__/` (e.g. `critiqueGatePure.test.ts`, `agentRunMessageServicePure` tests).
**Fix:** Move test file path to `server/services/__tests__/agentRunHandoffServicePure.test.ts`.
**Classification:** mechanical
**Disposition:** auto-apply

#### F2 — P1 read-path scoping for org-level runs
**Rubric category:** Under-specified contract
**Section:** P1 — Design — Read path
**Issue:** Spec says the seeding looks up "the most recent completed run for the same `(agentId, subaccountId)` scope" but does not specify the org-level case (where `subaccountId` is null and the lookup should match `executionScope='org' AND agentId=...` instead).
**Fix:** Add a sentence specifying that org-level runs look up the most recent completed run by `(agentId, executionScope='org')`, and subaccount-level runs look up by `(agentId, subaccountId, executionScope='subaccount')`.
**Classification:** mechanical
**Disposition:** auto-apply

#### F3 — P1 latest-handoff route guards
**Rubric category:** Under-specified contract
**Section:** P1 — Files to change — `server/routes/agentRuns.ts`
**Issue:** Two new routes added (`/api/agents/:agentId/latest-handoff`, `/api/subaccounts/:subaccountId/agents/:agentId/latest-handoff`) but their permission guards are unstated.
**Fix:** Specify both as `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` (matches the existing pattern for `GET .../runs` on the same router file).
**Classification:** mechanical
**Disposition:** auto-apply

#### F4 — P2 plan-to-tool-call matching ambiguity
**Rubric category:** Under-specified contract
**Section:** P2 — Design — Dual-source rendering
**Issue:** "First matching call" is ambiguous when the same tool is called multiple times. Need to specify whether each tool call is consumed at most once.
**Fix:** Restate the matching rule as "first **unconsumed** tool call matching the tool name in encounter order; each tool call is consumed at most once".
**Classification:** mechanical
**Disposition:** auto-apply

#### F5 — P2 CSS file ambiguous in Files table
**Rubric category:** Convention drift
**Section:** P2 — Files to change
**Issue:** Spec lists `client/src/components/ExecutionPlanPane.module.css` as "new OR tailwind-inline". The rest of the project uses tailwind-inline (no CSS modules). The "OR" is ambiguous.
**Fix:** Drop the CSS module file from the Files to change table. Tailwind-inline only, matching `RunTraceViewerPage.tsx` and the rest of the client.
**Classification:** mechanical
**Disposition:** auto-apply

#### F6 — P4 detector logic for `process.broken_connection_mapping`
**Rubric category:** Under-specified contract
**Section:** P4 — Design — v1 detectors
**Issue:** Detector triggers when "the process has a required slot with no mapping for the subaccounts that link the process". The "subaccounts that link the process" relationship is not stated explicitly in the detector context.
**Fix:** Specify the rule precisely: for each `(processId, subaccountId)` pair where at least one row exists in `processConnectionMappings`, the detector emits a finding if any required key from `processes[processId].requiredConnections` has no row in that pair's mapping set.
**Classification:** mechanical
**Disposition:** auto-apply

#### F7 — P4 audit transaction boundary
**Rubric category:** Under-specified contract
**Section:** P4 — Design — Storage / auto-resolution
**Issue:** Spec describes the upsert and the auto-resolution UPDATE separately but doesn't say they run in a single transaction. Without that guarantee, a partial sweep could leave the table in an inconsistent state (some new findings inserted, the resolve UPDATE not yet run).
**Fix:** Add a sentence: "The upsert + resolve sequence runs in a single `withOrgTx(...)` transaction. A partial-failure mid-sweep rolls back the entire batch — the previous sweep's findings remain visible."
**Classification:** mechanical
**Disposition:** auto-apply

#### F8 — P4 permission keys hedged
**Rubric category:** Under-specified contract
**Section:** P4 — Design — Trigger model + Files to change
**Issue:** Spec says "All `requireOrgPermission(ORG_PERMISSIONS.ORG_ADMIN)` or equivalent" and "Add `ORG_PERMISSIONS.HEALTH_AUDIT_VIEW` and `HEALTH_AUDIT_RESOLVE` if not already covered by `ORG_ADMIN`". Both phrases hedge — pick concrete keys.
**Fix:** Define two new keys: `org.health_audit.view` (read findings + run on-demand audit) and `org.health_audit.resolve` (mark a finding resolved). Org admin inherits both via `Object.values(ORG_PERMISSIONS)` per existing convention. Drop both hedges from the spec.
**Classification:** mechanical
**Disposition:** auto-apply

#### F9 — P4 dashboard widget placement ambiguous
**Rubric category:** Under-specified contract
**Section:** P4 — Design — Dashboard widget
**Issue:** "On the existing `DashboardPage` (or admin dashboard)" — pick one.
**Fix:** Specify `DashboardPage` (the file exists and is the primary dashboard target).
**Classification:** mechanical
**Disposition:** auto-apply

#### F10 — P6 Current focus section will go stale
**Rubric category:** Maintenance gotcha
**Section:** P6 — Design — Section 1
**Issue:** A hand-maintained "current focus" pointer in `CLAUDE.md` will go stale unless it's part of the close-out workflow. Worth flagging in the spec so future readers understand the trade-off.
**Fix:** Add a one-sentence warning: "This pointer is hand-maintained. Update it whenever the current spec or sprint changes; if it goes stale it is worse than missing because it misleads future agent sessions."
**Classification:** mechanical
**Disposition:** auto-apply

---

### Directional / ambiguous findings

**None.** Every issue identified is mechanical consistency or under-specification — none of them change scope, sequencing, testing posture, rollout posture, or architecture. The spec respects the framing in `docs/spec-context.md` end-to-end:

- Pre-production posture: confirmed (no flags, no staged rollout, no canary).
- Rapid-evolution testing posture: confirmed (only pure unit tests added, no frontend / contract / E2E tests).
- Prefer-existing-primitives: confirmed (extends `agent_runs`, `agentExecutionService`, `agentActivityService`, `RunTraceViewerPage`, `pg-boss`, `withOrgTx`, etc.).
- Migrations without flags: confirmed.
- No new abstractions where existing primitives fit: confirmed (handoff is a new concept that doesn't have an existing primitive; workspace health is also new).

---

### Rejected findings

**None.** All ten mechanical findings are real and the fixes apply.

---

## Iteration 1 summary

- Mechanical findings accepted: 10
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- HITL checkpoint path: none this iteration
- HITL status: none

The mechanical-only result with zero rejections means iteration 2 would also be a mechanical-only round under the spec-reviewer's stopping heuristic — the loop converges immediately. Exit after applying.

---

## Mechanical changes applied

See git diff on `docs/run-continuity-and-workspace-health-spec.md` for the exact edits. Each fix corresponds to a finding above, and the fix is the minimum change needed — no opportunistic rewrites.
