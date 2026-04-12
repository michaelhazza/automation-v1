# Spec Review Final Report

**Spec:** `docs/clientpulse-dev-spec.md`
**Spec commit at start:** `87723bf046029c6c8b06abc7613b613f6ae67d5b`
**Spec commit at finish:** `87723bf046029c6c8b06abc7613b613f6ae67d5b` (changes in-session, not yet committed)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iterations run:** 4 of 5
**Exit condition:** two-consecutive-mechanical-only (iterations 3 and 4 both had zero directional/ambiguous findings)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|----|----|----|----|----|----|----|
| 1 | 0 (not available) | 3 | 3 | 0 | 0 | 1 | resolved |
| 2 | 0 (not available) | 6 | 5 | 0 | 0 | 1 | resolved (apply-with-modification) |
| 3 | 0 (not available) | 7 | 7 | 0 | 0 | 0 | none |
| 4 | 0 (not available) | 1 | 1 | 0 | 0 | 0 | none |

**Note on Codex availability:** The Codex CLI `review` command is designed for code diffs (`--commit`, `--base`, `--uncommitted`), not document review. All iterations used the rubric pass only.

---

## Mechanical changes applied

### §2.1 — Current state audit (systemHierarchyTemplates columns)
- Removed `slug` from "Exists" column list (slug is added by migration 0104, not pre-existing) — Iteration 2
- Added `requiredConnectorType` (text) column to the column inventory (was missing from the audit) — Iteration 3

### §2.3 — Migration 0043 column names
- Corrected `execution_mode` → `execution_scope` in the audit table — Iteration 2
- Corrected `result_status` → `run_result_status` in the audit table — Iteration 2

### §3.5 — Sidebar config integration
- Added route table entry for `GET /api/my-sidebar-config` with auth and purpose — Iteration 4
- Added route file designation: `server/routes/modules.ts` — Iteration 4

### §4.2 — subscriptionService contract
- Added `getSubscriptionBySlug(slug: string): Promise<Subscription>` to the service API (was called in §9.2 but undefined here) — Iteration 3

### §4.6 — subscriptionTrialCheckJob registration
- Corrected job registration file reference from non-existent `server/jobs/index.ts` to correct location `server/services/queueService.ts` with explicit `boss.schedule()` call — Iteration 3

### §6.5 — reports table migration comment
- Updated SQL comment from stale `0106_reports.sql (or combined)` to `0104 (combined migration — see §11)` — Iteration 3

### §8.2.1 — Dashboard sync status bar hook
- Corrected `useSocketRoom` → `useSocket('dashboard:update', callback)` (was an internal contradiction with §6.9 and line 1140 of the same section) — Iteration 2

### §8.2.2 — Reports API route table
- Added missing `POST /api/reports/:id/resend` route — Iteration 2
- Reordered `GET /api/reports/latest` before `GET /api/reports/:id` (Express route capture bug) — Iteration 2

### §8.3 — Integrations page requiredConnectorType
- Corrected description of `requiredConnectorType` from "inside operationalDefaults JSONB" to "top-level column on system_hierarchy_templates" — Iteration 3

### §9.2 — Signup handler call site
- Updated `subscriptionService.getBySlug('starter')` → `subscriptionService.getSubscriptionBySlug('starter')` — Iteration 3

### §9.3 — Onboarding wizard state mechanism (HITL resolution)
- Replaced ambiguous "wizard_step field on the org OR localStorage" with derive-from-API pattern — Iteration 2 (HITL apply-with-modification)
- Added `GET /api/onboarding/status` endpoint returning `OnboardingStatus` interface derived from existing DB tables — Iteration 2 (HITL)
- Added `GET /api/onboarding/status` to route table — Iteration 2 (HITL)
- Added `GET /api/onboarding/sync-status` to route table (was in Step 3 prose but missing from table) — Iteration 3

### §9.5 — onboardingService contract
- Added `getOnboardingStatus(orgId: string): Promise<OnboardingStatus>` function — Iteration 2 (HITL)

### §9.6 — Onboarding verification checklist
- Added 4 verification items for `GET /api/onboarding/status` states (pre-OAuth, post-OAuth, post-first-run, cross-device resumption) — Iteration 3

---

## Rejected findings

None. All identified findings were accepted and applied.

---

## Directional and ambiguous findings (resolved via HITL)

### Iteration 1 — Finding 1.1

**Classification:** directional  
**Title:** RLS policies for `reports` and `org_subscriptions`  
**Human's decision:** apply  
**Applied:** Added RLS policies for both tables to migration 0104 inventory and `rlsProtectedTables.ts` additions.  
**Source:** Iteration 1 checkpoint `tasks/spec-review-checkpoint-clientpulse-dev-spec-1-2026-04-12T01-53-23Z.md`

### Iteration 2 — Finding 2.1

**Classification:** ambiguous  
**Title:** Onboarding wizard state tracking mechanism unspecified  
**Human's decision:** apply-with-modification  
**Modification:** Replaced the "wizard_step OR localStorage" ambiguity with a derive-from-API pattern. Added `GET /api/onboarding/status` endpoint returning `{ ghlConnected, agentsProvisioned, firstRunComplete }` derived from existing DB tables. No migration needed. localStorage scoped to within-session UX only. Cross-device safe.  
**Source:** Iteration 2 checkpoint `tasks/spec-review-checkpoint-clientpulse-dev-spec-2-2026-04-12T03-50-42Z.md`

---

## Open questions deferred by `stop-loop`

None. The loop exited via the two-consecutive-mechanical-only stopping heuristic, not a human `stop-loop` decision.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and Codex's review methodology (rubric-only, Codex CLI not applicable for doc review). The human has adjudicated every directional and ambiguous finding that surfaced (2 HITL checkpoints, both resolved).

However:

- The review did not re-verify the framing assumptions at the top of this document. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's §1 Summary and §12 Build phases sections yourself before calling the spec implementation-ready.
- The review did not catch directional findings that the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.

**Recommended next step:** read the spec's §1 Summary, §12 Build phases, and §14 Open items one more time, confirm the headline findings match your current intent, and then start implementation with Phase 1 (Module A + Module G admin).
