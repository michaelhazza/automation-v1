# Pull request review — audit/track-workflow-engine (Track A2 — workflowEngine split, post-refactor audit)

**Reviewer:** pr-reviewer (independent, read-only)
**Timestamp (UTC):** 2026-05-15T00:00:00Z

Blocking: 0 / Should-fix: 2 (both applied) / Consider: 3 (logged)
**Verdict:** APPROVED

---

## Files reviewed

- `tasks/review-logs/codebase-audit-log-workflow-engine-2026-05-14T16-30-31Z.md`
- `tasks/audit-progress-workflow-engine-2026-05-14T16-30-31Z.md`
- `tasks/todo.md` (Track A2 appended sections)
- `KNOWLEDGE.md` (2 new pattern entries)

**Audit-bearing files re-verified independently:**

- `migrations/0276_workflows_v1_additive_schema.sql`, `0221_rename_playbooks_to_workflows.sql`, `0219_rename_workflow_runs_to_flow_runs.sql`, `0262_integration_test_blockers.sql`, `0037_phase1c_memory_and_workflows.sql`
- `server/services/workflowEngineService.ts` (4,073 LOC confirmed; lines 146–157, 830–855, 3880–3920)
- `server/services/workflowEngineServicePure.ts` (95 LOC confirmed)
- `server/services/workflowAgentRunHook.ts`
- `server/routes/workflowRuns.ts` (lines 1–320)
- `server/lib/permissions.ts` (workflow perm enumeration)
- `.claude/agents/audit-runner.md`, `docs/codebase-audit-framework.md` (Rule 8 severity table)
- `tasks/todo-archive-2026-Q2.md` (AR-3.1 closure status)

---

## 🔴 Blocking — none

The audit log is well-evidenced, every claim spot-checked reproduces, and the no-Pass-2 call was correct per the framework. Every original Pass 1 finding touches RLS plumbing, migrations, or product judgement — Rules 7 + 8 mandate Pass 3 for all of them.

---

## 🟡 Should-fix — both applied in this PR

🟡 **R1 — WF1 severity calibration: framework default for "RLS bypass" is `critical`, audit log used `high`.** Progress tracker line 27 already named this "critical" — internal inconsistency. Framework `docs/codebase-audit-framework.md:241` enumerates "RLS bypass" under `critical`. The audit's downgrade argument (practical safety holds today because the stepRunId at workflowEngineService.ts:151 comes from a prior org-scoped query) is defensible defence-in-depth analysis but not a severity reduction. **APPLIED — WF1 re-graded to `critical/high` in audit log with explicit downgrade-rationale note.**

🟡 **R2 — WF7's self-assigned re-check not completed.** Audit said "re-check that the existing AR-3.1 todo entry is still open; if absent, re-add." I checked: AR-3.1 was CLOSED on 2026-05-06 in `tasks/todo-archive-2026-Q2.md:3075` (pre-launch-phase-3 PR #267, singletonKey-is-load-bearing rationale; full-tx wrap deferred to Phase 4 if profiling shows singletonKey insufficient). The audit didn't follow through on its own remediation. The in-source comment at `workflowEngineService.ts:845` still says "deferred to AR-3.1 resolution and tracked in tasks/todo.md under ## Deferred" — that's now a stale pointer to a closed item. **APPLIED — updated the inline comment to drop the stale AR-3.1 pointer and replace with the closure rationale + Phase 4 profiling trigger. 1-line surgical behaviour-preserving comment fix. WF7 in todo.md marked `[status:closed-during-audit]`. Pass 2 entry added to audit log.**

---

## 💭 Consider — logged, no in-PR action

💭 **C1 — WF5/WF8 lift from "product call deferred" to "likely-gap with confirmation requested."** Evidence: `server/lib/permissions.ts:70-77` shows the codebase HAS org-tier workflow perms (`WORKFLOW_TEMPLATES_READ/WRITE/PUBLISH`, `WORKFLOW_STUDIO_ACCESS`, `WORKFLOW_RUNS_START`); the absence of `WORKFLOW_RUNS_VIEW_ALL` / `WORKFLOW_RUNS_ADMIN` looks like an oversight, not "workflows-as-agents by design." Severity-confidence `medium/medium` undersells the evidence weight. **Logged; no audit-log re-grade — the deferred-todo entry already names the recommendation correctly.**

💭 **C2 — KNOWLEDGE.md format consistency.** The FK-scoped RLS pattern entry includes the detection one-liner inside the **Rule** paragraph; the pg-boss footgun entry has no detection one-liner at all. Adding a one-line `**Detection:**` field would match the format of other recent pattern entries (iee-browser-on-e2b at lines 1302, 1314). **Logged; minor format consistency win not applied in-PR.**

💭 **C3 — Q6 lint-gate naming.** Q6 (lint gate flagging `requireOrgPermission(AGENTS_*)` in `workflow*.ts` routes) bundles two intent classes. Implementation should prefer the more specific name `verify-workflow-route-perm-family.sh` with a one-line allowlist comment grammar so deliberate cross-family choices can be marked. **Logged for implementer of Q6.**

---

## Calibration notes per operator's specific asks

A. **WF1 evidence validity** — VERIFIED. Independent grep across `migrations/*.sql` for each of the five table names + `POLICY|ENABLE ROW|FORCE ROW` returns zero matches.

B. **WF1 severity** — see R1 above. Framework says `critical`; audit downgraded to `high` for defence-in-depth framing. Re-graded to `critical/high` with explicit downgrade rationale.

C. **WF5/WF8** — see C1 above. Evidence leans toward "real gap."

D. **WF2 line counts** — CONFIRMED. 4,073 (main) / 95 (Pure) exact.

E. **KNOWLEDGE.md entries** — calibrated correctly; specific, file-bearing, rule-and-detection structured. Minor format nit in C2.

F. **No-Pass-2 justification** — CORRECT for WF1–WF6 and WF8. WF7's stale-comment substring DID qualify for Pass 2 and was applied per R2.

G. **Anything else** — WF7's incomplete self-assigned verification (AR-3.1 closure status) was the one substantive thing missed in the audit's own remediation flow; resolved.

---

## Files NOT read

- `client/**` — no client changes; verified via audit log scope.

Unread files cannot invalidate the verdict — the audit's scope is server services + routes + migrations + KNOWLEDGE.md.

---

Blocking: 0 / Should-fix: 2 (both applied) / Consider: 3 (logged)
**Verdict:** APPROVED — ready to open PR.
