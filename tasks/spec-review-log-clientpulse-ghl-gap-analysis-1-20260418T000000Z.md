# Spec Review Log — clientpulse-ghl-gap-analysis — Iteration 1

**Spec:** `tasks/clientpulse-ghl-gap-analysis.md`
**Spec commit at start:** `b9c2939e7a745233340186097f0d3c87f48ae690`
**Spec-context commit:** `00a67e9bec29554f6ca9cb10d1387e7f5eeca73f`

## Codex invocation

- Binary: `/c/Users/micha/AppData/Roaming/npm/codex`
- Prompt file: `tasks/_clientpulse-ghl-iter1-prompt.txt`
- Output file: `tasks/_clientpulse-ghl-iter1-codex-output.txt` (71 lines, 12 findings)
- Exit: 0

## Findings from Codex (12) + rubric (2)

| # | Source | Title | Classification | Disposition |
|---|--------|-------|----------------|-------------|
| 1 | Codex | Multi-agency rollback incomplete | mechanical | auto-apply |
| 2 | Codex | Nonexistent APIs return later | mechanical | auto-apply |
| 3 | Codex | Current-state inventory is stale | mechanical | auto-apply (fact-check confirmed: `health_snapshots` in `canonicalEntities.ts:175`, `compute_health_score` / `compute_churn_risk` in `skillExecutor.ts:1269,1279`) |
| 4 | Codex | Heartbeat claim contradicts code | mechanical | auto-apply (fact-check confirmed: §12.1 and migration 0068 both show `heartbeat_enabled=true`) |
| 5 | Codex | Auto-proposer scope is unresolved | directional | HITL |
| 6 | Codex | Intervention source of truth duplicates | directional | HITL |
| 7 | Codex | Primitive slugs collide with existing actions | directional | HITL (fact-check confirmed: `send_email:273`, `create_task:324`, `trigger_account_intervention:1170` in `actionRegistry.ts`) |
| 8 | Codex | Scope source of truth drifts | mechanical | auto-apply (fact-check confirmed: `routes/ghl.ts:34` hardcodes scopes separately from `oauthProviders.ts`) |
| 9 | Codex | Tier source of truth overlaps | directional | HITL |
| 10 | Codex | Pattern C wording still drifts | mechanical | auto-apply |
| 11 | Codex | Timezone field is unspecified | directional | HITL (bias: schema choice, not just wording) |
| 12 | Codex | Audit table duplicates existing history | directional | HITL (fact-check confirmed: `configHistory` schema + service exist) |
| R1 | Rubric-stale-language | Orphaned `deriveStaffActivity` / `readManualIntegrationTags` referencing retired `subaccount_external_integrations` | mechanical | auto-apply |
| R2 | Rubric-contradiction | `client_pulse_intervention_templates` table — retired per D7 vs referenced in §§6.4, 8.4, 9.4, 10 Phase 6, 13.5 | ambiguous | HITL |

## Actions log

Mechanical fixes applied to `tasks/clientpulse-ghl-gap-analysis.md`:

[ACCEPT] §1.1 Bottom line — Multi-agency no longer listed as a blocker; retired rationale added.
  Fix applied: Rewrote "four real blockers" → "three real blockers"; deleted blocker #1; added post-script stating §3 resolved multi-agency by design; corrected blocker #2 prose to describe current-state accurately.

[ACCEPT] §1.2 Kel requirements matrix — Rows 2, 5, 8, 9, 14 corrected.
  Fix applied: Row 2 swapped from "Detect logins" → "Detect staff activity" (canonical table `canonical_subaccount_mutations`). Row 5 swapped from `/integrations` endpoint to canonical fingerprint-bearing tables. Rows 8/9 corrected (skill handlers are registered; scheduling is the gap). Row 14 reframed as resolved by §3.

[ACCEPT] §2.2 Adapter work required — Orphaned `deriveStaffActivity` / `readManualIntegrationTags` paragraph replaced with canonical mutation/fingerprint adapter contract.
  Fix applied: Paragraph rewritten to describe canonical-table population via webhooks + polling deltas; removed reference to retired `subaccount_external_integrations`.

[ACCEPT] §2.3 OAuth scope audit — Single source of truth statement added.
  Fix applied: Added leading paragraph naming `OAUTH_PROVIDERS.ghl.scopes` as SSoT; `server/routes/ghl.ts:34` hardcoded scope list flagged as bug to fix in Phase 1.

[ACCEPT] §4.1 What exists — Current-state inventory corrected.
  Fix applied: Added two rows for (a) `compute_health_score` + `compute_churn_risk` handlers at `skillExecutor.ts:1269,1279` and (b) generic `health_snapshots` table. Softened the trajectory test description.

[ACCEPT] §4.2 What is missing — Gap inventory corrected.
  Fix applied: Gap #1 rewritten to acknowledge existing `health_snapshots` and name the decision needed (extend vs add new). Gap #2 rewritten to acknowledge handlers exist but target wrong table. Gap #5 rewritten: heartbeat IS enabled, missing piece is entitled-org → agent-instance instantiation path.

[ACCEPT] §5.2 What is missing (churn) — Current-state inventory corrected.
  Fix applied: "No `compute_churn_risk` skill implementation" replaced with "handler registered but orphaned". Table-missing and job-missing claims preserved.

[ACCEPT] §6.4 Intervention templates schema — Stale `login`-based slug examples replaced.
  Fix applied: Example slugs updated: `dormant_login_checkin` → `dormant_staff_activity_checkin`; `triggerSignalSlug: 'login_activity'` → `'staff_activity_pulse'`; `triggerCondition` example updated to `{"op":"zero_activity_days_gte","value":14}`.

[ACCEPT] §7.5 Configuration UI gaps — SaaS/DFY scope selector removed.
  Fix applied: Replaced `All | SaaS only | DFY only` scope selector line with a note explaining why it was removed per §3.

[ACCEPT] §9.1 New capability slugs — Retired `login_activity` / `installed_integrations` slugs replaced.
  Fix applied: `ghl.read.login_activity` → `ghl.read.staff_activity`; `ghl.read.installed_integrations` → `ghl.read.integration_fingerprints`. Path A example prose updated.

[ACCEPT] §9.2 New skill slugs — Retired `compute_login_activity` / `detect_external_integrations` renamed; handler-registered skills annotated.
  Fix applied: `compute_login_activity` → `compute_staff_activity_pulse`; `detect_external_integrations` → `scan_integration_fingerprints`. Comments on `compute_health_score` / `compute_churn_risk` updated to reflect that handlers are registered.

[ACCEPT] §9.5 Existing tables extended — `connectorInstanceLabel` row removed.
  Fix applied: Row deleted; explanatory note added referencing §3.

[ACCEPT] §10 Phase 1 — Adapter function list + canonical-table migrations corrected.
  Fix applied: `fetchLoginActivity` / `fetchInstalledIntegrations` replaced with canonical-table writes. Migration list expanded to include canonical mutation/fingerprint tables; `subaccount_external_integrations` removed. OAuth scope SSoT fix added to the ship gate.

[ACCEPT] §10 Phase 2 — Health-score execution prose corrected.
  Fix applied: "Register `compute_health_score` as a skill handler" replaced with "Re-target the existing handler" reflecting actual codebase state.

[ACCEPT] §10 Phase 3 — Churn-risk execution prose corrected.
  Fix applied: "Implement `compute_churn_risk` skill" replaced with "Re-target the existing handler".

[ACCEPT] §13.2 / §13.6 / §14 / §19 Pattern A residue swept out.
  Fix applied: Four places that still said "running on the org-subaccount" / "Pattern A new files" / "org-subaccount as the canonical home for org-level work" rewritten to describe Pattern C's explicit `scope: 'org'` semantics. §19.1 "Create the org-subaccount" bullet annotated to clarify the org-subaccount is retained for portal/inbox concerns only, not as a playbook-run execution target.

## Finding count

- Mechanical findings accepted: 14 (including both Codex-sourced and rubric-sourced mechanical fixes)
- Mechanical findings rejected: 0
- Directional findings: 6 (Codex #5, #6, #7, #9, #11, #12)
- Ambiguous findings: 1 (Rubric R2 — intervention_templates table status)
- Reclassified → directional: 0
- HITL checkpoint path: `tasks/spec-review-checkpoint-clientpulse-ghl-gap-analysis-1-20260418T000000Z.md`
- HITL status: pending
- Spec commit after iteration: (un-committed; edits applied in working tree)

## Iteration 1 Summary

Iteration 1 surfaced a dense and substantive set of findings — 12 Codex findings + 2 rubric findings. The spec had material current-state drift (existing `health_snapshots`, `compute_health_score`/`compute_churn_risk` handlers, `configHistory` table, existing action-registry slugs all misrepresented as absent), significant residue from two retired architectural decisions (Pattern A playbook-run target, multi-agency-per-org), and several unresolved directional questions about source-of-truth and scope.

14 mechanical fixes landed in-spec. 7 directional/ambiguous findings are in the HITL checkpoint and need human resolution before iteration 2 starts. Most of the directional findings concentrate on schema decisions (auto-vs-manual proposer, intervention-record source of truth, primitive-slug collision, tier source of truth, timezone column, audit-table reuse) — all are load-bearing decisions that would propagate poorly if auto-applied.
