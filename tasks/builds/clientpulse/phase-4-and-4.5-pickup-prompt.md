# Phase 4 + 4.5 Pickup Prompt

Copy the block below into a fresh Claude Code session to resume the ClientPulse build. Everything the next session needs — scope, contracts, file pointers, ship gates — is inlined so the agent does not waste turns re-reading the 2,827-line spec.

## Contents

1. Session kickoff prompt
2. Orientation — read these first
3. Branch
4. Scope (locked)
5. Locked contracts (non-negotiable)
6. Ship gates this PR must close
7. Per-phase ship-gate tests
8. Files to create — Phase 4
9. Files to create — Phase 4.5
10. Files to modify
11. Work sequence (7 chunks)
12. Sanity gates between chunks
13. Review gates
14. Things that will trip you up
15. Docs Stay In Sync With Code
16. How to start the session

---

## 1. Session kickoff prompt (paste this into a new session)

I'm resuming the ClientPulse V1 build. The previous session shipped Phases 0 + 0.5 + 1 + 2 + 3 + Phase 1 follow-ups to `main` (branch `claude/clientpulse-phases-4-6-agu8s`, merged PR). **Your job now is Phase 4 + Phase 4.5 in a single PR on a new branch.**

## 2. Orientation — read these first (in order)

1. `tasks/clientpulse-ghl-gap-analysis.md` §§27, 26, 25, 15, 16, 17 (§17.6 especially), 23 — the spec. Use these sections as ground truth; do not re-invoke `spec-reviewer` (5/5 lifetime cap reached).
2. `tasks/builds/clientpulse/progress.md` — Chunks 1–6 are **done**; Chunk 7 (Phase 4) is pending. Update it as you go.
3. `tasks/builds/clientpulse/plan.md` — existing plan for Phases 0–3 + Phase 1 follow-ups. Append new sections for Phase 4 + 4.5 at the bottom.
4. `CLAUDE.md` + `architecture.md` — non-negotiable rules.

## 3. Branch

Create and work on a **new branch** off current `main`: `claude/clientpulse-phases-4-4.5-<suffix>`. Do **not** reuse the Phase 1 follow-ups branch.

## 4. Scope (locked — do not widen)

**Phase 4: Intervention pipeline (server + UI).** Closes ship-gate B2.

**Phase 4.5: Configuration Agent extension.** Closes ship-gates B3 + B5.

**Out of scope for this PR** (explicitly deferred):
- Phase 5 (settings UI + template editor beyond what 4.5 needs)
- Phase 5.5 (operator onboarding)
- Phase 6 (pilot polish)
- B6 (Configuration Assistant UX copy) — Phase 5
- Any Monitor-tier / Operate-tier subscription gating logic (D6) — defer; scope this PR to Operate-tier behaviour unconditionally so we can pilot without billing plumbing

## 5. Locked contracts (non-negotiable)

| Letter | Contract |
|--------|----------|
| (a) | 5 namespaced action slugs: `crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`, `clientpulse.operator_alert`. Register in `server/config/actionRegistry.ts` alongside existing primitives. No collision with existing unprefixed `send_email` / `create_task` (per §27 C5). |
| (b) | Interventions are `actions` rows with `gateLevel='review'` + `metadataJson={ triggerTemplateSlug, triggerReason, bandAtProposal, healthScoreAtProposal, configVersion, recommendedBy: 'scenario_detector' }` — **no parallel intervention table**. |
| (c) | Configuration Agent writes flow through `config_update_hierarchy_template` skill → `operational_config` JSONB + `config_history` rows with `entity_type='clientpulse_operational_config'`. **Reuse the existing `config_history` table** (per §17.2.6). No new audit table. |
| (d) | Intervention templates live in `operational_config.interventionTemplates[]` JSONB. Seeded in migration 0170 (Phase 0); editable per-org via Configuration Agent or settings UI. |
| (e) | **No auto-execution path in V1.** Scenario-detector writes HITL-gated `reviewItems` only; operator approval is the only execution path. |
| (f) | Sensitive-path writes require `actions` row with `gateLevel='review'` (§17.6.2). Paths come from `SENSITIVE_CONFIG_PATHS` in `server/services/operationalConfigSchema.ts` (shipped Phase 0). |
| (g) | Merge-field resolver (§16) is strict V1 grammar — no fallback syntax, no conditionals. Namespaced: `{{contact.*}}`, `{{subaccount.*}}`, `{{signals.*}}`, `{{org.*}}`, `{{agency.*}}`. |

## 6. Ship gates this PR must close

| # | Item | §ref |
|---|------|------|
| B2 | `measureInterventionOutcomeJob` exists and writes `intervention_outcomes` rows with band-change attribution within 14d of `action.completedAt` | §23.3 |
| B3 | Configuration Agent writes land as `config_history` rows with `entity_type='clientpulse_operational_config'`, `change_source='config_agent'` | §17.2.6 |
| B5 | Sensitive-path mutations route through action→review→approve (not inline commit) | §17.6.2 |

## 7. Per-phase ship-gate tests

**Phase 4 ship-gate (end-to-end):** Simulated intervention fired against a cold-start sub-account, followed by synthetic observations that improve the health score past the band threshold; `measureInterventionOutcomeJob` runs, writes an outcome row with `bandChange: 'at_risk → watch'`, visible in the drilldown's intervention history.

**Phase 4.5 ship-gate:** Sysadmin types "bump pipeline velocity weight to 0.35" in chat; Orchestrator routes to Configuration Agent; agent presents confirm card with before/after diff; operator confirms; skill writes to `operational_config`; `config_history` row recorded (`entity_type='clientpulse_operational_config'`); next-scan banner shown; settings page reflects the new value on refresh. **Plus** at least one sensitive-path mutation successfully gated through action→review→approve.

## 8. Files to create — Phase 4

Use the architect to confirm shape before writing. Approximate inventory:

**Migrations:**
- `migrations/NNNN_clientpulse_interventions_phase_4.sql` — any additional indexes on `actions.metadataJson` needed for proposer queries. No new tables (per contract (b)). Check next-free migration number at kickoff (> 0177).

**Server:**
- `server/skills/crm_fire_automation.ts` + `crm_send_email.ts` + `crm_send_sms.ts` + `crm_create_task.ts` + `clientpulse_operator_alert.ts` — 5 new primitive handlers. Register each in `actionRegistry.ts` + `skillExecutor.ts` with `idempotencyStrategy='keyed_write'`.
- `server/services/mergeFieldResolver.ts` + `mergeFieldResolverPure.ts` + `__tests__/mergeFieldResolverPure.test.ts` — V1 grammar only. JSON Schema for the namespace surface per §16.1.
- `server/jobs/proposeClientPulseInterventionsJob.ts` — scenario detector. Runs per sub-account after each churn assessment. Enforces `maxProposalsPerDayPerSubaccount` + `maxProposalsPerDayPerOrg` (from `operational_config.interventionDefaults`). Calls `interventionService.checkCooldown()` before emitting a proposal.
- `server/jobs/measureInterventionOutcomeJob.ts` — hourly; closes B2. For each `action` with 5-primitive `actionType`, `status='executed'`, `executed_at > now() - 14d`, `outcome IS NULL`: reads current health snapshot, compares to `metadataJson.healthScoreAtProposal`, writes `interventionOutcomes` row. Honours `template.measurementWindowHours`.
- `server/services/clientPulseInterventionProposerPure.ts` + `__tests__/*.test.ts` — pure matcher: `(templates, observations, snapshot, cooldownState) → proposal[]`.
- Register both jobs in `server/jobs/index.ts`.

**Client (intervention editor modals + proposer review flow):**
- `client/src/components/clientpulse/FireAutomationEditor.tsx`
- `client/src/components/clientpulse/EmailAuthoringEditor.tsx`
- `client/src/components/clientpulse/SendSmsEditor.tsx`
- `client/src/components/clientpulse/CreateTaskEditor.tsx`
- `client/src/components/clientpulse/OperatorAlertEditor.tsx`
- `client/src/components/clientpulse/ProposeInterventionModal.tsx` — wraps the 5 editors behind a primitive picker.

Mockup references (already in repo):
- `tasks/clientpulse-mockup-fire-automation.html`
- `tasks/clientpulse-mockup-email-authoring.html`
- `tasks/clientpulse-mockup-send-sms.html`
- `tasks/clientpulse-mockup-create-task.html`
- `tasks/clientpulse-mockup-operator-alert.html`
- `tasks/clientpulse-mockup-proposer-modal.html` (if present)

## 9. Files to create — Phase 4.5

**Skill + registration:**
- `server/skills/config_update_hierarchy_template.md` — skill definition.
- `server/services/configUpdateHierarchyTemplateService.ts` + `configUpdateHierarchyTemplatePure.ts` + `__tests__/*.test.ts` — schema-validated merge-update on `hierarchyTemplates.operationalConfig`. Rejects writes that violate sum-constraints (weights sum to 1.00) or sensitive-path gating. Write path goes through `actions` row with `gateLevel='review'` when the target path is flagged `sensitive: true` in `SENSITIVE_CONFIG_PATHS`.
- Register in `server/config/actionRegistry.ts` + `server/services/skillExecutor.ts`.

**Routing + docs:**
- Update `docs/capabilities.md` — add 4 capability slugs: `clientpulse.config.read`, `clientpulse.config.update`, `clientpulse.config.reset`, `clientpulse.config.history`.
- Update `docs/integration-reference.md` — add `clientpulse_configuration` pseudo-integration block (structured YAML per §17.2.2).
- Update `docs/configuration-assistant-spec.md` — add mutation tool #16 (`update_clientpulse_config`), move ClientPulse from out-of-scope to in-scope v2.
- Update `docs/orchestrator-capability-routing-spec.md` — add ClientPulse config routing hints.

**UI:**
- `client/src/components/clientpulse/ConfigAssistantChatPopup.tsx` — global popup, opens from settings callouts / global nav / ⌘K. Confirm-before-write card with before/after diff. Mockup: `tasks/clientpulse-mockup-config-assistant-chat.html`.

## 10. Files to modify (Phase 4 + 4.5)

- `server/config/actionRegistry.ts` — register 5 primitives + `config_update_hierarchy_template`.
- `server/services/skillExecutor.ts` — 6 new case statements. Decrement `SkillExecutionContext.capabilityQueryCallCount` if any of the 5 primitives call capability discovery.
- `server/routes/clientpulseReports.ts` — wire proposer output to dashboard high-risk widget.
- `server/jobs/portfolioRollupJob.ts` — no changes expected; verify it picks up new intervention history.
- `server/services/interventionService.ts` — extend `recordOutcome()` signature if needed for the new job.

## 11. Work sequence (7 chunks, serialised)

1. **Architect pass.** `architect: ClientPulse Phase 4 + 4.5 — 5 action primitives, scenario-detector job, outcome-measurement job, merge-field resolver, Configuration Agent extension. Spec ref: tasks/clientpulse-ghl-gap-analysis.md §§15, 16, 17, 23. Locked contracts inlined in the pickup prompt at tasks/builds/clientpulse/phase-4-and-4.5-pickup-prompt.md.` Output → `tasks/builds/clientpulse/plan.md` appended as §§10–11.
2. **Phase 4 chunk A — 5 action primitives + merge-field resolver + pure tests.** One commit. Run typecheck + pure tests.
3. **Phase 4 chunk B — `proposeClientPulseInterventionsJob` + pure proposer tests.** One commit.
4. **Phase 4 chunk C — `measureInterventionOutcomeJob` + simulated end-to-end fixture test. Closes B2.** One commit.
5. **Phase 4 chunk D — intervention editor modals + proposer review flow UI.** One commit. Start dev server + manually verify the flow end-to-end in browser (per CLAUDE.md UI rule).
6. **Phase 4.5 chunk A — `config_update_hierarchy_template` skill + sensitive-path routing + pure tests. Closes B3 + B5.** One commit.
7. **Phase 4.5 chunk B — Configuration Agent chat popup + routing doc updates.** One commit. Manually verify chat flow in browser.

## 12. Sanity gates between chunks

Run after **every** chunk:
- `npx tsc --noEmit -p server/tsconfig.json` — zero new errors vs the 43-error baseline.
- Relevant `npx tsx server/services/__tests__/*Pure.test.ts` — all pass.
- `npm run lint` on touched files.
- `scripts/verify-integration-reference.mjs` after Phase 4.5 doc updates.

## 13. Review gates

- After Phase 4 chunks A–D complete: `pr-reviewer` on the combined Phase 4 diff.
- After Phase 4.5 chunks A–B complete: `pr-reviewer` on the combined Phase 4 + 4.5 diff.
- **Do not auto-invoke `dual-reviewer`.** Only invoke if the user explicitly asks and the session is running locally (per CLAUDE.md).
- Update `tasks/builds/clientpulse/progress.md` after each chunk. Mark Chunk 7 done only when all 7 sub-chunks land + `pr-reviewer` is clean + all 3 ship gates (B2, B3, B5) are verifiably closed.

## 14. Things that will trip you up

- **Migration number races.** Main was at 0177 at Phase 1 follow-ups merge. Re-check `ls migrations/ | tail -5` at kickoff. If main moved, renumber your migration(s) before committing.
- **Action-slug collisions.** Do **not** reuse existing `send_email` or `create_task` slugs — the new primitives are namespaced (`crm.send_email`, `crm.create_task`). Existing unprefixed primitives keep their direct-send semantics.
- **Sensitive-path routing is not "validate then write" — it is "create action row with `gateLevel='review'` and wait for approval".** The skill's write to `operational_config` happens only after the review item is approved. Sum-constraint validation happens at proposal time, not at approval time.
- **Proposer quotas are backend-enforced.** `maxProposalsPerDayPerSubaccount` (default 1) and `maxProposalsPerDayPerOrg` (default 20) live in `operational_config.interventionDefaults` and are read via `orgConfigService.getInterventionDefaults(orgId)`. Do **not** trust upstream UI gating.
- **`interventionService.checkCooldown()` already exists** (`server/services/interventionService.ts:14–51`). Call it from the proposer. Do **not** reimplement cooldown logic.
- **`intervention_outcomes` table already exists** (`server/db/schema/interventionOutcomes.ts`). The missing piece is the **job** that writes to it. Do **not** create a parallel schema.
- **`config_history` table already exists and is RLS-protected.** Use it — do not introduce `config_changes` or similar (explicitly rejected in §17.2.6).
- **Dual-write to legacy tables already set up for Phase 2/3.** `compute_health_score` + `compute_churn_risk` write to both `health_snapshots` (legacy) and `client_pulse_health_snapshots` / `client_pulse_churn_assessments`. Do not touch this dual-write path — Phase 5+ will deprecate the legacy writes.

## 15. Docs Stay In Sync With Code

Per CLAUDE.md §11: **update `docs/capabilities.md`, `docs/integration-reference.md`, `docs/configuration-assistant-spec.md`, `docs/orchestrator-capability-routing-spec.md`, and `architecture.md` in the same commits as the code changes.** Editorial rules for `docs/capabilities.md` are strict (no vendor names in customer-facing sections); re-read CLAUDE.md §0 before editing.

## 16. How to start the session

```
architect: ClientPulse Phase 4 + 4.5 — intervention pipeline + Configuration Agent extension.
Spec: tasks/clientpulse-ghl-gap-analysis.md §§15, 16, 17, 23.
Locked contracts, ship gates, and file inventory: tasks/builds/clientpulse/phase-4-and-4.5-pickup-prompt.md.
Append the plan as §§10–11 of tasks/builds/clientpulse/plan.md.
```

Then implement chunk-by-chunk per the 7-chunk sequence above.
