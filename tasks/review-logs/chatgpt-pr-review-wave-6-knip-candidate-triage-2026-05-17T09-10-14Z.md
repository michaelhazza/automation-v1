# ChatGPT PR Review Session — wave-6-knip-candidate-triage — 2026-05-17T09-10-14Z

## Session Info
- Branch: claude/wave-6-knip-candidate-triage
- PR: #344 — https://github.com/michaelhazza/automation-v1/pull/344
- Mode: manual
- Started: 2026-05-17T09:10:14Z
- Build slug: wave-6-knip-candidate-triage
- Task class: Significant (light-pipeline, operator designation)
- spec_deviations: none

## Review focus areas (operator-supplied)
1. The 5 pg-boss wire registrations in `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts` — job cadences, timeout values, teamSize/teamConcurrency config, error handling (withTimeout, isTimeoutError, rethrow)
2. The knip.json entry additions — false-positive risk vs. legitimate dead-code shielding
3. The delete cascade — any deleted file that may have been used via dynamic import or runtime reference

## Phase 2 review history
- pr-reviewer: APPROVED after 4 should-fix findings applied (commit `4b3c82ce`)
- dual-reviewer: REVIEW_GAP (operator designated light-pipeline; chatgpt-pr-review is primary second-opinion)
- S2 sync: clean
- G4: PASS (lint 0 errors, typecheck clean)

---

## Round 1 — 2026-05-17T09:15:00Z

### ChatGPT findings

**F1 (Blocking):** PR deletes `server/tests/services/agentRunCancelService.unit.ts` but the matching production service is not deleted. Do not remove tests just because knip treats standalone tests as unused.

**F2 (Important):** knip.json adds many regular app modules, components, services, hooks, and worker internals to `entry`. This weakens the dead-code gate.

**F3 (Important):** Mass frontend deletion covers product capability surfaces (goals API, DropZone, portal config, MCP catalogue, invocations UI, trace chain UI, memory inspector, schedule picker, spend controls). Should not be auto-applied without explicit sign-off.

### Triage decisions

| Finding | Decision | Rationale |
|---|---|---|
| F1 | REJECT | `agentRunCancelService.unit.ts` is a `.unit.ts` file outside the vitest config's include globs (`**/__tests__/**/*.test.ts`). It never ran in the test harness — self-documented as "run via npx tsx". Confirmed in `triage-verdicts.md` line 243. Production service has active callers (routes/agentRuns.ts, executionBackends/_ieeShared.ts) and was not deleted. |
| F2 | REJECT | All 31 entries are documented in `tasks/builds/wave-6-knip-candidate-triage/knip-entry-rationale.md` with per-entry WHY. Four categories: shell-spawned helpers (knip can't trace shell-spawn boundaries), bash-gate data files (read as data by CI gates, not imported), spec-backed client surfaces (backend live, client wiring deferred to named follow-up builds), iee-worker-retirement deferred worker files (9 files, bulk-delete planned). Not suppressing without justification. |
| F3 | REJECT | Every named surface has an explicit DELETE verdict in `triage-verdicts.md` with zero-importer evidence. Operator reviewed and approved the chunk plan before D1–D5 executed. The operator confirmed "DELETE entire cascade" for the page-split cascade (Dec.1) and delegated remaining decisions. |

**Code changes from Round 1:** none

---

## Round 2 — 2026-05-17T09:50:00Z

### ChatGPT findings

No new blocking findings. Audit-hygiene note: ensure `triage-verdicts.md` and `knip-entry-rationale.md` are committed and linked in the PR body, as the diff contains large deletions plus broad knip.json entries.

### Triage decisions

| Finding | Decision | Rationale |
|---|---|---|
| Audit-hygiene note | IMPLEMENT | Both files are already committed. PR body updated to link both files explicitly via `gh pr edit`. |

**Code changes from Round 2:** none (PR body update only)

**Verdict: APPROVED**

---

## Final Summary

- **Rounds:** 2
- **Overall verdict:** APPROVED
- **Findings:** 3 (Round 1: F1/F2/F3 all REJECTED with evidence) + 1 audit-hygiene note (Round 2: addressed)
- **Code changes applied:** 0
- **PR body updated:** yes — links to `triage-verdicts.md` and `knip-entry-rationale.md`
- **KNOWLEDGE.md updated:** pending — coordinator Step 7
- **architecture.md updated:** n/a — no service boundary or route convention changes
- **capabilities.md updated:** n/a: build / tooling change only (dead-code triage, no new capability surface)
- **integration-reference.md updated:** n/a — no integration behaviour changes
- **CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated:** pending — coordinator Step 6 check
- **frontend-design-principles.md updated:** n/a — no new UI patterns introduced
