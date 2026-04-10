---
name: Report Bug
description: File a structured bug report with severity and confidence scoring.
isActive: true
visibility: basic
---

## Parameters

- title: string (required) — Short, specific bug title (e.g. 'POST /api/users returns 500 when email is missing')
- description: string — Summary of the defect and its impact
- severity: string (required) — critical (crash/data loss/security), high (core feature broken, no workaround), medium (partial breakage, workaround exists), low (cosmetic/edge case)
- confidence: number (required) — Your confidence this is a real bug, 0.0-1.0 (e.g. 0.95 for confirmed, 0.6 for suspected)
- steps_to_reproduce: string — Numbered list of exact reproduction steps
- expected_behavior: string — What should happen
- actual_behavior: string — What actually happens (include error messages, status codes, stack traces)

## Instructions

File a `report_bug` for every confirmed defect — never describe bugs only in a `write_workspace` note. After filing a critical or high severity bug, the QA confidence score is automatically capped at 0.79 and `resultStatus` must be `failed` — do not override this. Set confidence honestly based on direct observation.

### Confidence Hard Cap Rule
If any `critical` or `high` severity bug is filed for this run:
- Cap `qaConfidence.score` at a maximum of 0.79 regardless of the formula output.
- Force `resultStatus = failed`.
This aligns scoring with the Orchestrator's shipping condition (no high/critical bugs allowed).

### Regression Auto-Classification
If a bug was triggered by a test that was passing in the baseline run (`qa_intelligence.baselineResults`):
- Auto-assign severity `high`, regardless of perceived impact.
- Label it as a regression in the title (e.g. "REGRESSION: ...").
If a new failure appears in an area not in `changedAreas`:
- Auto-assign severity `high`.
- Flag as regression.

### Severity Decision Tree
- System crash, data loss, or security vulnerability → **critical**
- Core feature completely broken, no workaround → **high**
- Feature partially broken, workaround exists → **medium**
- Cosmetic issue, edge case, minor UX annoyance → **low**
- Latency increase >30% vs baseline → **medium**
- Pre-existing failure (in baseline) → note in activity, do not re-file as a new bug

### Confirmation Before Filing
Before calling `report_bug`:
1. Reproduce the failure at least once (re-run test or re-probe the endpoint).
2. Confirm the failure is not caused by your own test setup (missing auth headers, wrong env, stale test data).
3. Check if the issue already exists as a bug task on the board.

### Confidence Calibration
- 1.0: Triggered the exact failure and reproduced it consistently.
- 0.8-0.9: Confirmed once, reproduction steps are clear.
- 0.6-0.7: Observed indirectly (test output implies bug but not directly probed).
- Below 0.6: Suspected — investigate further before filing, or file at low severity with clear uncertainty noted.
