# Spec Review HITL Checkpoint — Iteration 2

**Spec:** `docs/clientpulse-dev-spec.md`
**Spec commit:** `87723bf046029c6c8b06abc7613b613f6ae67d5b`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 2 of 5
**Timestamp:** 2026-04-12T03:50:42Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 3 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

Mechanical fixes for this iteration (5 findings) have already been applied to `docs/clientpulse-dev-spec.md` without blocking:
1. §2.3 — corrected `execution_mode` → `execution_scope` and `result_status` → `run_result_status` in migration 0043 audit row
2. §2.1 — removed `slug` from systemHierarchyTemplates "Exists" column list (slug doesn't exist yet, added by migration 0104)
3. §8.2.1 — corrected sync status bar from `useSocketRoom` to `useSocket('dashboard:update', callback)`
4. §8.2.2 — added missing `POST /api/reports/:id/resend` route; reordered `GET /api/reports/latest` before `GET /api/reports/:id`
5. §4.2 — clarified `archiveSubscription` uses `status='archived'` (not `deleted_at`)

---

## Finding 2.1 — Onboarding wizard state tracking mechanism unspecified

**Classification:** ambiguous
**Signal matched:** Could be "Load-bearing claim without contract" (mechanical) or "Add a new DB column" (architectural scope change) depending on which option is chosen
**Source:** Rubric-load-bearing-claims-without-contracts
**Spec section:** §9.3 (line 1263)

### Spec's current text (verbatim)

> A multi-step wizard shown after signup. The wizard tracks progress via a `wizard_step` field on the org or a separate `onboarding_state` in localStorage.

### Tentative recommendation (non-authoritative)

If this were mechanical and the answer is localStorage: remove "or a `wizard_step` field on the org" and commit to localStorage only. No migration change needed. The migration inventory (§11) already doesn't include this column, so localStorage is the implementation the spec currently implies.

If this were mechanical and the answer is a DB column: add `organisations.onboarding_step TEXT` to the migration 0104 inventory in §11, and remove the localStorage option.

Given that §11 (the authoritative migration inventory) does NOT include any `wizard_step` or `onboarding_step` column, the implied default is localStorage. Recommending: resolve to localStorage and remove the ambiguous "or" phrasing.

### Reasoning

The spec says "via X or Y" without committing to one. The migration inventory at §11 does not include a `wizard_step` column on `organisations`. This means either:
- (a) The intent was always localStorage, and the "field on the org" option was speculative prose that wasn't followed through to the migration — in which case we should remove the DB-column option from the spec to avoid confusion during implementation.
- (b) The intent was a DB column that was accidentally omitted from the migration inventory — in which case §11 needs updating.

I cannot determine which of these is true without product context. The consequence of getting it wrong: if implementation uses a DB column but §11 says no migration needed, the migration will be missing and the CI gate will fail. If implementation uses localStorage but the spec says DB column, the implementation will differ from the spec.

Given that pre-production/localStorage is simpler and the migration inventory already doesn't include it, option (a) is likely. But this is the human's call.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason. If `stop-loop`, the review loop exits and the spec stays in its current state for the human to rethink.

```
Decision: apply-with-modification
Modification (if apply-with-modification): Remove the "wizard_step field on the org OR localStorage" ambiguity entirely. Replace with the derive-from-API pattern: (1) Add a GET /api/onboarding-status endpoint that returns { ghlConnected: bool, agentsProvisioned: bool, firstRunComplete: bool } derived from real DB tables (integration_connections, org agent provisioning state, agent_runs) — no dedicated column. (2) The wizard client reads this endpoint and skips already-completed steps automatically, making it cross-device safe. (3) localStorage tracks only the current wizard page (within-session UX continuity). No migration change needed — this is consistent with §11 having no wizard_step column. The GET /api/onboarding-status route should be added to the §9.4 route table.
Reject reason (if reject): 
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 3.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.
