# Spec Review Final Report (Complete — All 5 Iterations)

**Spec:** `docs/clientpulse-dev-spec.md`
**Spec commit at start:** `87723bf046029c6c8b06abc7613b613f6ae67d5b`
**Spec commit at finish:** `ccb6d68e401feca01bfcce276225503a551769e3` (iteration 5 changes applied in-session, not yet committed)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap (MAX_ITERATIONS = 5 reached; HITL for Finding 5.1 resolved by human with `apply-with-modification`)

**Note on Codex availability:** The Codex CLI `review` command is designed for code diffs, not document review. All 5 iterations used the rubric pass only.

**Relationship to prior final report:** A partial final report was written after iteration 4 at `tasks/spec-review-final-clientpulse-dev-spec-2026-04-12T06-15-00Z.md`. That report covered iterations 1–4 only (exit: two-consecutive-mechanical-only). Iteration 5 was subsequently triggered because §15 (UX polish) was added to the spec in commits `bb2fe1d` and `ccb6d68` after the prior exit. This report supersedes the prior one and covers the full 5-iteration lifetime.

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|----|----|----|----|----|----|----|
| 1 | 0 (not available) | 4 | 3 | 0 | 1 | 0 | resolved (apply) |
| 2 | 0 (not available) | 6 | 5 | 0 | 0 | 1 | resolved (apply-with-modification) |
| 3 | 0 (not available) | 7 | 7 | 0 | 0 | 0 | none |
| 4 | 0 (not available) | 1 | 1 | 0 | 0 | 0 | none |
| 5 | 0 (not available) | 4 | 3 | 0 | 0 | 1 | resolved (apply-with-modification) |

**Totals across all iterations:** 22 rubric findings raised; 19 mechanical findings accepted; 0 rejected; 3 HITL checkpoints (all resolved).

## Mechanical changes applied

Grouped by spec section:

### §2.1 — Current state audit (systemHierarchyTemplates columns)
- Removed `slug` from "Exists" column list (`slug` is added by migration 0104, not pre-existing) — Iteration 2
- Added `requiredConnectorType` (text) column to the column inventory (was missing from the audit) — Iteration 3

### §2.3 — Migration 0043 column names
- Corrected `execution_mode` → `execution_scope` in the audit table — Iteration 2
- Corrected `result_status` → `run_result_status` in the audit table — Iteration 2

### §3.5 — Sidebar config integration
- Added route table entry for `GET /api/my-sidebar-config` with auth and purpose — Iteration 4
- Added route file designation: `server/routes/modules.ts` — Iteration 4

### §4.2 — subscriptionService contract
- Added `getSubscriptionBySlug(slug: string): Promise<Subscription>` to the service API (was called in §9.2 but not defined here) — Iteration 3

### §4.6 — subscriptionTrialCheckJob registration
- Corrected job registration file reference from non-existent `server/jobs/index.ts` to correct location `server/services/queueService.ts` with explicit `boss.schedule()` call — Iteration 3

### §6.5 — reports table migration comment
- Updated SQL comment from stale `0106_reports.sql (or combined)` to `0104 (combined migration — see §11)` — Iteration 3

### §8.2.1 — Dashboard page route and sync status bar hook
- Corrected `useSocketRoom` → `useSocket('dashboard:update', callback)` (internal contradiction with §6.9 and line 1140 of the same section) — Iteration 2
- Updated page route from `/dashboard` to `/clientpulse` (HITL resolution, Finding 5.1) — Iteration 5

### §8.2.2 — Reports API route table
- Added missing `POST /api/reports/:id/resend` route — Iteration 2
- Reordered `GET /api/reports/latest` before `GET /api/reports/:id` (Express route capture bug — specific route must precede parameterised route) — Iteration 2

### §8.3 — Integrations page requiredConnectorType
- Corrected description of `requiredConnectorType` from "inside operationalDefaults JSONB" to "top-level column on system_hierarchy_templates" — Iteration 3

### §8.4 — Verification checklist
- Updated `/dashboard` → `/clientpulse` in the post-login redirect verification item — Iteration 5

### §9.2 — Signup handler pseudocode
- Updated `signup()` signature from `signup(email, password)` to `signup(email, password, agencyName)` — Iteration 5
- Replaced auto-generated org name `${email.split('@')[0]}'s Agency` with `agencyName.trim()` — Iteration 5
- Added step 5: "Send welcome email async (see §15.1) — fire-and-forget" — Iteration 5
- Renumbered old step 5 (JWT generation) to step 6 — Iteration 5
- Updated `subscriptionService.getBySlug('starter')` → `subscriptionService.getSubscriptionBySlug('starter')` — Iteration 3

### §9.3 — Onboarding wizard
- Replaced ambiguous "wizard_step field on the org OR localStorage" with derive-from-API pattern — Iteration 2 (HITL apply-with-modification)
- Added `GET /api/onboarding/status` endpoint returning `OnboardingStatus` interface derived from existing DB tables — Iteration 2 (HITL)
- Added `GET /api/onboarding/status` to route table — Iteration 2 (HITL)
- Added `GET /api/onboarding/sync-status` to route table (was in Step 3 prose but missing from table) — Iteration 3
- Updated `/dashboard` → `/clientpulse` in the post-first-run redirect (Step 3) — Iteration 5

### §9.4 — Post-onboarding landing
- Updated `/dashboard` → `/clientpulse` in the post-first-report redirect — Iteration 5

### §9.5 — onboardingService contract
- Added `getOnboardingStatus(orgId: string): Promise<OnboardingStatus>` function — Iteration 2 (HITL)

### §9.6 — Onboarding verification checklist
- Added 4 verification items for `GET /api/onboarding/status` states (pre-OAuth, post-OAuth, post-first-run, cross-device resumption) — Iteration 3

### §10.2 — Billing implementation notes
- Updated `/dashboard` → `/clientpulse` in the Stripe Checkout success redirect — Iteration 5

### §14 — Design decisions table
- Updated decision #4 from "Keep existing dashboard; `/dashboard` only for ClientPulse module orgs" to "Keep existing dashboard; `/clientpulse` only for ClientPulse module orgs" — Iteration 5

### §15.5 — First-report celebration
- Updated `/dashboard` → `/clientpulse` in the interstitial redirect description — Iteration 5

### §15.9 — §15 verification checklist
- Added missing `- [ ] "Email me when ready" option shown on sync progress screen; toast confirms opt-in` — Iteration 5

## Rejected findings

None. All identified mechanical findings were accepted and applied across all 5 iterations. Zero rejection rate.

## Directional and ambiguous findings (resolved via HITL)

### Iteration 1 — Finding 1.1

**Classification:** directional
**Title:** RLS policies for `reports` and `org_subscriptions`
**Signal matched:** Sequencing signals — introduces a new dependency edge (migration section must also cover RLS setup for these tables)
**Source:** Rubric-sequencing-ordering-bugs
**Human's decision:** apply
**Applied:** Added RLS policies for both `reports` and `org_subscriptions` tables to migration 0104 inventory and to the `rlsProtectedTables.ts` additions list.
**Checkpoint:** `tasks/spec-review-checkpoint-clientpulse-dev-spec-1-2026-04-12T01-53-23Z.md`

---

### Iteration 2 — Finding 2.1

**Classification:** ambiguous
**Title:** Onboarding wizard state tracking mechanism unspecified
**Signal matched:** Ambiguous — "wizard_step OR localStorage" is unclear enough that auto-applying any resolution would be a product call, not a mechanical tidy-up
**Source:** Rubric-load-bearing-claims-without-contracts
**Human's decision:** apply-with-modification
**Modification applied:** Replaced the "wizard_step field on the org OR localStorage" ambiguity with a derive-from-API pattern. Added `GET /api/onboarding/status` endpoint returning `{ ghlConnected, agentsProvisioned, firstRunComplete }` derived from existing DB tables (`ghl_connectors`, `agent_templates`, `agent_runs`). No migration needed. localStorage scoped to within-session UX only. Cross-device safe.
**Checkpoint:** `tasks/spec-review-checkpoint-clientpulse-dev-spec-2-2026-04-12T03-50-42Z.md`

---

### Iteration 5 — Finding 5.1

**Classification:** ambiguous
**Title:** ClientPulse dashboard route: `/dashboard` vs `/clientpulse`
**Signal matched:** Could be "Contradictions" (mechanical — align 8 locations to one route) or "Change the interface of X" (directional — the route path is a product/UX decision with downstream consequences for user bookmarks, onboarding instructions, and Stripe redirect URLs)
**Source:** Rubric-contradictions
**Human's decision:** apply-with-modification
**Modification applied (Option A):** Updated all 7 page-route references from `/dashboard` to `/clientpulse` across §§8.2.1, 8.4, 9.3 Step 3, 9.4, 10.2, 14, and 15.5. The §15 App.tsx additions table already said `/clientpulse` and was left unchanged (it was the correct reference). Rationale provided by human: ClientPulse is an agency-specific product and `/clientpulse` is the honest route name. The existing `/` is already the reusable Synthetos dashboard. A generic `/dashboard` URL would not be meaningful for non-agency orgs and is not worth the added complexity.
**Checkpoint:** `tasks/spec-review-checkpoint-clientpulse-dev-spec-5-2026-04-12T07-00-00Z.md`

## Open questions deferred by `stop-loop`

None. All 3 HITL checkpoints were resolved with `apply` or `apply-with-modification`. The loop exited via the iteration cap (MAX_ITERATIONS = 5), not a human `stop-loop` decision. No findings were left unresolved.

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric across all 5 iterations. The human has adjudicated every directional and ambiguous finding that surfaced (3 HITL checkpoints across iterations 1, 2, and 5 — all resolved). Codex CLI was not available for document review in any iteration; all findings came from the adjudicator's rubric pass.

However:

- The review did not re-verify the framing assumptions at the top of this document. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's §1 Summary and §12 Build phases sections yourself before calling the spec implementation-ready.
- The review did not catch directional findings that the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.
- §15 (UX polish) was added after iterations 1–4 completed. Iteration 5 reviewed §15 and its consistency against the rest of the spec, but only a single rubric pass was performed on this content. If §15 grows further, it warrants attention — though the lifetime cap has been reached and any further spec-reviewer invocation requires a human decision to bust the cap.
- The `/clientpulse` route decision (Finding 5.1) is now codified in the spec. The actual App.tsx already uses `/clientpulse`, so spec and implementation are aligned. If this route ever changes, update all 8 locations (§§8.2.1, 8.4, 9.3, 9.4, 10.2, 14, 15.5, and the §15 App.tsx table) together.

**Recommended next step:** read the spec's §1 Summary, §12 Build phases, and §14 Open items one more time, confirm the headline findings match your current intent, and then start implementation with Phase 1 (Module A + Module G admin).
