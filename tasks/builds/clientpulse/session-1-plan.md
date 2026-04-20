# Session 1 — Implementation Plan

**Spec:** `tasks/builds/clientpulse/session-1-foundation-spec.md`
**Branch:** `claude/clientpulse-session-1-<suffix>`
**Est. effort:** ~2 weeks, one PR
**Architect pass:** this document. Produced from the locked Session 1 spec; contracts (a)–(v) and §1.6 invariants are referenced verbatim, never re-interpreted.

---

## Contents

0. Summary of Session 1 surface (contracts + invariants)
1. Ship-gate verification matrix
2. Chunk sequence (8 chunks, serialised)
3. Chunk A.1 — Data model + core renames (migrations, schema, read-chain pure)
4. Chunk A.2 — Config service refactor (configUpdateOrganisationService + composable sensitive-paths registry)
5. Chunk A.3 — Generic route + UI renames
6. Chunk A.4 — Configuration Assistant popup (real agent loop)
7. Chunk 5 — ClientPulse Settings page + Subaccount Blueprint editor refactor
8. Chunk 6 — Operator onboarding wizard (sysadmin create-org + org-admin first-run)
9. Chunk 7 — pr-reviewer pass + housekeeping
10. Open questions for the user

---

## §0. Summary of Session 1 surface

### Locked contracts that receive their **first implementation** in Session 1

From spec §1.3 — carried forward verbatim; this plan never re-numbers or re-interprets them.

| Contract | First-implementation surface in Session 1 | Where |
|---|---|---|
| **(h)** `organisations.operational_config_override` as the single org-owned writable source of truth for operational-config overrides; NULL until first explicit edit; effective config is `system_hierarchy_templates.operational_defaults` deep-merged with that row | New column + backfill migration + read-chain swap + `createFromTemplate` step 2 leaves NULL | A.1, A.2, Chunk 6 |
| **(i)** Platform primitives are module-agnostic (un-namespaced or `ops.*` / `system.*`); module-branded slugs reserved for genuinely module-specific concepts | `clientpulse.operator_alert → notify_operator` rename; generic `/api/organisation/config/apply`; capability taxonomy renames | A.1, A.3 |
| **(j)** Settings page and Configuration Assistant are equal surfaces on the same mechanism (both write through `configUpdateOrganisationService.applyOrganisationConfigUpdate`; same `config_history` audit trail; same sensitive-path split) | Generic route wraps the renamed service; popup's `config_update_organisation_config` skill wraps the same service; Settings page POSTs to the generic route | A.2, A.3, Chunk 5 |
| **(k)** Session lifecycle for the Configuration Assistant popup — opening resumes the most recent agent run < 15 minutes old, else creates a fresh one; closing does not kill the run; minimised pill surfaces background execution | `<ConfigAssistantPopup>` + `useConfigAssistantPopup` hook + `sessionStorage` + extended `GET /api/agents/:agentId/conversations` list endpoint (query params `updatedAfter`, `order`, `limit`) | A.4 |
| **(l)** All inbound action-slug surfaces MUST normalise via `resolveActionSlug` | Introduced in action registry; webhook/route-handler audit at chunk A.1 kickoff; legacy aliases log-once per process | A.1, A.2 |
| **(n)** Config gating is pure; execution is deterministic; execute never mutates config during execution (re-validate for drift, then apply the already-validated merge in a single transaction) | `configUpdateOrganisationConfigPure.ts` keeps every side-effect-free validator; `applyOrganisationConfigUpdate` consumes the pure output | A.2 |
| **(u)** External side effect preconditions (approved + validated + idempotency-locked + timeout-budget-remaining) before any adapter call; failed preconditions transition to `blocked` with `errorJson.blockedReason` | No new execution-layer surface in Session 1; existing `skillExecutor.ts` dispatch preserved via `resolveActionSlug`; precondition contract inherited from Phase 4.5 | A.1, A.2 |

Not explicitly re-implemented in Session 1 — still binding, inherited from Phase 4/4.5 and referenced by §1.3 verbatim:

- **(m)** Intervention state machine is strictly linear (`proposed → (approved | rejected | blocked) → executing → (completed | failed | skipped)`); `blocked` + `skipped` are terminal and carry their enum reasons in `actions.errorJson`.
- **(o)** Canonical idempotency key pattern (`clientpulse:intervention:{source}:{subaccountId|orgId}:{templateSlug|actionType}:{correlation}`); Session 1 edits the slug literal consumed by `buildScenarioDetectorIdempotencyKey` + `buildOperatorIdempotencyKey`, nothing structural.
- **(p)** Atomicity boundaries (action insert vs review_items; config write + config_history atomic; execution vs status transition separate with stale-run reconciliation; outcome insertion eventual).
- **(q)** Every log / event / audit row carries `actionId` as first-class correlation key — no new emitters introduced; existing call-sites continue to comply.
- **(r)** Replayability — every decision function lives in a `*Pure.ts` module. Session 1 adds three new pure modules (alias resolver, sensitive-paths registry, migration read-chain), each with a `*Pure.test.ts`.
- **(s)** Retry vs replay. Session 1 touches neither; `replay_of_action_id` stays deferred.
- **(t)** Internal state writes first, external side effects last, audit never skipped. Configuration writes in the generic route continue to honour this: drift re-validation → `organisations.operational_config_override` write + `config_history` insert (atomic) → no external side effect in the inline-commit path.
- **(v)** Deterministic ordering under concurrency (PG advisory lock per subaccount; config-history advisory lock per org). Not touched.

### §1.6 lifecycle invariants advanced in Session 1

| Invariant | Session 1 surface |
|---|---|
| **Every intervention produces exactly one terminal outcome** | Preserved by slug rename + alias resolver. No state-machine edits. `notify_operator` rows continue to follow the same terminal-state rules as `clientpulse.operator_alert` rows. |
| **Every intervention is traceable via `action.id`** | Preserved. No changes to `action_events`, `intervention_outcomes`, or the `actionId` correlation in logs. |

### `InterventionEnvelope` type (§1.5) — status in Session 1

Documentation-only; no new persisted table; no code change. Logs and correlation continue to use `actionId` as the first-class key. `interventionId` becomes distinct from `actionId` only when manual replay lands (deferred, spec §1.3(s)).

---

## §1. Ship-gate verification matrix

One row per ship gate from spec §1.2. Every gate must close in its named chunk and its named verification artefact before the PR opens — see §9 (Chunk 7) for the final housekeeping checklist.

| Ship gate | Closing chunk | Verification path |
|-----------|---------------|-------------------|
| **S1-A1** — Phase-4.5 config writes target `organisations.operational_config_override`; `orgConfigService.getOperationalConfig` reads the new column; existing data backfilled idempotently by the migration. | Chunk A.1 (migration + schema + read-chain) closes the migration half · Chunk A.2 (service retarget) closes the write-path half | Pure: `server/services/__tests__/orgOperationalConfigMigrationPure.test.ts` (read-chain pure decode) · Integration: `server/services/__tests__/configUpdateOrganisationService.test.ts` (DB fixture — seed legacy overrides, run migration, assert write path lands on new column) |
| **S1-A2** — `clientpulse.operator_alert → notify_operator` rename across registry + skill executor + proposer + metadata + UI + historical `actions` rows. Legacy alias resolves via `resolveActionSlug`. | Chunk A.1 (migration + registry alias + literal renames in server + pure tests) | Pure: `server/config/__tests__/actionSlugAliasesPure.test.ts` (every alias key resolves to a registered slug; log-once guard respected) · Updated literals asserted by `clientPulseInterventionProposerPure.test.ts`, `interventionActionMetadataPure.test.ts`, `interventionIdempotencyKeysPure.test.ts`, `measureInterventionOutcomeJobPure.test.ts` |
| **S1-A3** — `SENSITIVE_CONFIG_PATHS` is module-composable; a synthetic module's paths register + `isSensitiveConfigPath` covers them without touching core. Extended in spec §3.8 to `ALLOWED_CONFIG_ROOT_KEYS` via the same single file. | Chunk A.2 (registry primitive + boot-time registration + retire the array export) | Pure: `server/config/__tests__/sensitiveConfigPathsRegistryPure.test.ts` (register synthetic module paths + asserts on both `isSensitiveConfigPath` and `isValidConfigPath`) |
| **S1-A4** — `POST /api/organisation/config/apply` is the sole platform-wide config-write surface. `POST /api/clientpulse/config/apply` retired entirely; `GET /api/organisation/config` returns effective + overrides + systemDefaults per §4.5. | Chunk A.3 (new generic route + retire legacy route + docs slug renames) | Integration: `server/routes/__tests__/organisationConfig.test.ts` (POST valid non-sensitive path → `committed: true` · POST sensitive path → `committed: false, requiresApproval: true, actionId` · invalid body / invalid path / schema violation → correct `errorCode` branches · GET returns `{ effective, overrides, systemDefaults, appliedSystemTemplateId, appliedSystemTemplateName }` with `overrides` as raw sparse JSON) |
| **S1-A5** — Configuration Assistant popup mounts the real agent loop (not the Phase-4.5 direct-patch form). Session resume < 15 min works; close doesn't kill run; minimised pill shows execution; legacy `ConfigAssistantChatPopup.tsx` deleted. | Chunk A.4 (extract `<ConfigAssistantPanel>`, build `<ConfigAssistantPopup>` + hook, retire legacy popup) | Manual: checklist in `tasks/builds/clientpulse/session-1-verification.md` §2 — open → prompt → plan preview → minimise → reopen (same session resumes) → approve → close mid-execute → reopen (completed transcript visible) · Server-side: extended `conversationService.listConversations` behaviour change is type-checked; no new pure test required (integration-smoke-only surface) |
| **S1-5.1** — ClientPulse Settings page at `/clientpulse/settings` has an editor for every `operational_config` block (9 typed editors + `InterventionTemplatesJsonEditor`); every write routes through `POST /api/organisation/config/apply`; `config_history` lands; override row reflects the change. | Chunk 5 (Settings page + all editors + provenance strip + reset-to-default affordance) | Manual: verification doc §3 — per block: edit → save → verify `config_history` row → refresh → verify persistence · Test both non-sensitive (direct commit) and sensitive (review-queue) branches · Test reset-to-default affordance per §6.4 (option a — explicit override write of system default) · No client unit tests per spec §8.3 / §8.6; static gates (typecheck + lint + `npm run build`) cover the compile surface |
| **S1-5.2** — Subaccount Blueprint editor exposes zero editable `operationalConfig` fields; `operational_config_seed` rendered read-only with "change live config in ClientPulse Settings" callout; new subaccounts under the default blueprint inherit org effective config via `orgConfigService.getOperationalConfig(orgId)`. | Chunk 5 (blueprint editor refactor; audit-deferred `orgConfigService` read-path tap for subaccount create, per spec §10.8 chunk-6 audit) | Manual: verification doc §4 — open blueprint editor, confirm read-only seed preview + no editable operational fields · Create a new subaccount from the default blueprint, confirm agents seed correctly and operational config comes from the org override chain, not the seed column |
| **S1-7.1** — Create-org + first-run flows use the new terminology end-to-end ("Organisation Template" picker, "ClientPulse Settings" reference, "Subaccount Blueprints" in nav). No legacy labels leak into either flow. | Chunk 6 (create-org modal rebuild + onboarding wizard) | Manual: verification doc §5 + §6 — screenshot every screen of both flows, grep each screenshot for legacy terms ("Config Template", "Agent Template", "clientpulse.operator_alert"), assert zero hits |
| **S1-7.2** — Onboarding wizard soft-gates GHL OAuth — workspace usable at first sign-in, ClientPulse data appears only after the connection lands, no broken-state pages. | Chunk 6 (onboarding wizard screens 2 + 4 + redirect logic) | Manual: verification doc §6 — complete onboarding with "Skip for now" → confirm dashboard renders empty states cleanly (no broken cards, no unhandled fetch errors) · Re-run with "Connect GHL" → confirm data lights up within one scan cycle |

All 9 gates must pass before the PR opens. Chunk 7 (§9 of this plan) owns the final pr-reviewer pass + housekeeping checklist that confirms every row above is green.

---

## §2. Chunk sequence (8 chunks, serialised)

Mirrors spec §8.1 verbatim — same order, same names, same one-commit boundary per chunk. Each chunk leaves the system in a runnable state; a reviewer could merge Chunks 1–4 even if 5–7 need rework. `main` lands in one PR via Chunk 7's final commit.

| # | Chunk | Contract/invariant surface | Sanity-gate expectation |
|---|-------|---------------------------|-------------------------|
| 1 | **Architect pass** (this file) | Locks §§1–10 of `session-1-plan.md` against spec §§1–10. No code. | Plan self-consistent; `spec-reviewer` optional (local-only, user-gated). |
| 2 | **A.1 — Data model + core renames** | Contracts (h), (i), (l), (o), §1.6 traceability. Three migrations land (override column + seed rename + onboarding gate column; slug rewrite + index rebuild; conditional 0178 renumber). Schema + type updates. Read-chain pure + alias-resolver pure ship. | Migration sequence `0180/0181/0182[/0183]`; server typecheck ≤ 43 errors, client ≤ 10; new pure tests pass; `resolveActionSlug` log-once guard asserted. |
| 3 | **A.2 — Config service refactor** | Contracts (h), (j), (n), (u). Rename `configUpdateHierarchyTemplate{Service,Pure}` → `configUpdateOrganisation{Service,ConfigPure}`. Retarget writer at `organisations.operational_config_override`. `SENSITIVE_CONFIG_PATHS` + `ALLOWED_CONFIG_ROOT_KEYS` both move to `sensitiveConfigPathsRegistry.ts`. Boot-time registration wires ClientPulse's paths. 18 existing pure cases carry forward verbatim; 8 new registry cases land. | Typecheck baseline held; all renamed pure tests pass; registry pure tests pass; `integration-reference.mjs` clean. |
| 4 | **A.3 — Generic route + UI renames** | Contracts (i), (j), (t). New `POST /api/organisation/config/apply` + `GET /api/organisation/config`. Retire `POST /api/clientpulse/config/apply`. Config-history entity-type union ships. UI renames (route, nav labels, page titles) across `client/src/`. Capability taxonomy + pseudo-integration slugs renamed. | Route integration tests pass (valid / sensitive / schema-invalid / root-key-invalid branches); `verify-integration-reference.mjs` clean; client + server typecheck baselines held. |
| 5 | **A.4 — Configuration Assistant popup** | Contracts (j), (k), (r). Extract `<ConfigAssistantPanel>`; build `<ConfigAssistantPopup>` + `useConfigAssistantPopup` hook + context provider; mount at App shell; delete Phase-4.5 popup; wire global nav trigger + deep-link. Extend `conversationService.listConversations` + `GET /api/agents/:agentId/conversations` with `updatedAfter` / `order` / `limit`. | Typecheck baseline held; manual browser smoke per verification doc §2; no new server pure tests (integration-smoke surface only). |
| 6 | **Chunk 5 — ClientPulse Settings page + blueprint editor refactor** | Ship gates S1-5.1 + S1-5.2. 9 typed editors + `InterventionTemplatesJsonEditor`. Provenance strip, save flow, reset-to-default (option a). Subaccount Blueprint editor strips editable `operationalConfig` fields + renders `operational_config_seed` read-only. Subaccount-create audit (§10.8) confirms `orgConfigService.getOperationalConfig(orgId)` read path. | `npm run build`; typecheck baselines held; manual verification doc §§3–4 green. No client unit tests per §8.6 of the spec. |
| 7 | **Chunk 6 — Operator onboarding wizard** | Ship gates S1-7.1 + S1-7.2. System-admin create-org modal rebuild (Organisation Template picker + tier toggle + live preview). Org-admin 4-screen wizard + redirect logic + completion endpoint. `organisationService.createFromTemplate` transaction (§7.2 six-step sequence) ships. | New service test for `createFromTemplate` passes (leaves override NULL, seeds template FK + blueprint); manual verification doc §§5–6 green (screenshots + terminology grep); typecheck baselines held. |
| 8 | **Chunk 7 — pr-reviewer + housekeeping** | Final review loop. Ship-gate matrix (§1) walked top to bottom; every row green. Migration 0178 collision addressed (see chunk A.1). Docs updated (architecture.md, capabilities.md, integration-reference.md, configuration-assistant-spec.md, orchestrator-capability-routing-spec.md, CLAUDE.md key-files index + Current focus pointer, progress.md). `tasks/pr-review-log-clientpulse-session-1-<timestamp>.md` persisted per CLAUDE.md contract. | All nine ship gates S1-A1..A5 + S1-5.1/5.2 + S1-7.1/7.2 green. `pr-reviewer` blocking findings resolved. Typecheck ≤ 43 server / ≤ 10 client. No new lint errors on touched files. |

The eight chunks are deliberately serialised — no parallelism. Later chunks consume the primitives introduced earlier (e.g. Chunk 6 calls the generic route from Chunk 4; Chunk 5 assumes the renamed service from Chunk 3). Reordering breaks that dependency chain and re-opens contract surface that was explicitly locked in spec §8.1.

---

## §3. Chunk A.1 — Data model + core renames

### §3.1 Contract/invariant surface

Contracts **(h)** `organisations.operational_config_override` becomes the single org-owned writable source of truth (data model lands here; service retarget lands in Chunk A.2); **(i)** `clientpulse.operator_alert → notify_operator` rename + `config_update_hierarchy_template → config_update_organisation_config` rename carry the "platform primitives are module-agnostic" principle; **(l)** every inbound action-slug surface normalises via `resolveActionSlug`; **(o)** canonical idempotency key pattern updates in place (slug literal changes; key structure unchanged). §1.6 traceability invariant preserved — historical `actions` + `intervention_outcomes` rows are rewritten to the new slug by the migration, so `actionId` continues to resolve against a single canonical `actionType`.

### §3.2 File inventory

**Migrations (new):**

| Path | Change |
|------|--------|
| `migrations/0180_org_operational_config_override.sql` | Spec §2.4 — ADD `organisations.operational_config_override jsonb`, ADD `organisations.applied_system_template_id uuid FK → system_hierarchy_templates(id) ON DELETE SET NULL` + supporting partial index, backfill both from existing `hierarchy_templates` rows, RENAME `hierarchy_templates.operational_config → operational_config_seed`, add `COMMENT ON COLUMN` for both new columns. Deterministic tie-break via `ORDER BY updated_at DESC` when multiple candidate templates match — spec §2.4 calls this slight hardening out explicitly. |
| `migrations/0181_rename_operator_alert.sql` | Spec §3.3 — `UPDATE actions SET action_type='notify_operator' WHERE action_type='clientpulse.operator_alert'`; same on `intervention_outcomes.intervention_type_slug`; `DROP INDEX actions_intervention_outcome_pending_idx` + `CREATE INDEX` with the new 5-slug IN list. |
| `migrations/0182_organisations_onboarding_completed_at.sql` | Spec §7.5 — ADD `organisations.onboarding_completed_at timestamptz`, `UPDATE organisations SET onboarding_completed_at = created_at WHERE onboarding_completed_at IS NULL` (backfill all pre-existing orgs as onboarded). |
| `migrations/0183_renumber_skill_analyzer_migration.sql` | **Conditional — land this slot only if the `git mv migrations/0178_skill_analyzer_execution_lock_token.sql migrations/0180_skill_analyzer_execution_lock_token.sql` isn't safe because Drizzle's `meta/_journal.json` references the old filename. Audit at chunk kickoff (`rg 0178_skill_analyzer migrations/meta/`). If clean, skip this slot; the filename rename handles it. If the meta references the old name, land this slot as a meta-rewrite migration.** Chunk kickoff resolves the branch. |

Note: the skill-analyzer file itself should renumber to `0184_skill_analyzer_execution_lock_token.sql` (not 0180 as spec §4.7 writes; 0180 is consumed by the override-column migration). The spec's `git mv` target is a placeholder — the actual target is the next free slot above Session 1's migrations. Flagged in §10 (Open questions). Per the spec's own direction ("check at kickoff"), the actual number is resolved then; this plan reserves `0184` pending kickoff audit.

**Schema (modify):**

| Path | Change |
|------|--------|
| `server/db/schema/organisations.ts` | Add `operationalConfigOverride: jsonb('operational_config_override').$type<Record<string, unknown> \| null>()`, `appliedSystemTemplateId: uuid('applied_system_template_id').references(() => systemHierarchyTemplates.id, { onDelete: 'set null' })`, `onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true })`. |
| `server/db/schema/hierarchyTemplates.ts` | Rename field `operationalConfig` → `operationalConfigSeed`. Type unchanged. |

**Action registry + slug literals (modify):**

| Path | Change |
|------|--------|
| `server/config/actionRegistry.ts` | Rename entry `clientpulse.operator_alert → notify_operator`. Rename `config_update_hierarchy_template → config_update_organisation_config`. Add `ACTION_SLUG_ALIASES: Record<string,string>` + `resolveActionSlug(slug)` with `Set<string>` log-once guard per contract (l). Route `getActionDefinition()` through the resolver. |
| `server/services/skillExecutor.ts` | Rename case statements; dispatch via `resolveActionSlug`. |
| `server/services/interventionActionMetadata.ts` | Rename the `clientpulse.operator_alert` entry in the `INTERVENTION_ACTION_TYPES` tuple to `notify_operator` (single authoritative source — all downstream consumers pick up via import). |
| `server/services/clientPulseInterventionContextService.ts` | Remove `resolveDefaultHierarchyTemplateId` (no longer needed — writer targets caller's org). Rename zod-enum literal for `createOperatorProposal`. |
| `server/services/clientPulseInterventionIdempotencyPure.ts` | Rename `clientpulse.operator_alert → notify_operator` in `InterventionActionTypeName` hard-coded union (consumed by both `buildScenarioDetectorIdempotencyKey` + `buildOperatorIdempotencyKey`). |
| `server/skills/clientPulseOperatorAlertServicePure.ts` | Rename `clientpulse.operator_alert → notify_operator` in hard-coded slug literal (idempotency-key builder + JSDoc header). |
| `server/jobs/proposeClientPulseInterventionsJob.ts` | Rename literal in the `actionType === 'clientpulse.operator_alert'` branch. |
| `server/jobs/measureInterventionOutcomeJob.ts` | Rename literal in raw-SQL `action_type IN (…)` clause. |
| `server/jobs/measureInterventionOutcomeJobPure.ts` | Rename literal in operator-alert branch of `decideOutcomeMeasurement`. |
| `server/routes/clientpulseInterventions.ts` | Rename zod-enum literal; alias-accept on input via `resolveActionSlug`. |

**Client literals (modify):**

| Path | Change |
|------|--------|
| `client/src/components/clientpulse/ProposeInterventionModal.tsx` | Rename `clientpulse.operator_alert` in `InterventionActionType` union + submit payload. |
| `client/src/components/clientpulse/OperatorAlertEditor.tsx` | Rename in submit payload literal. |

**Pure tests (new):**

```ts
// server/config/__tests__/actionSlugAliasesPure.test.ts
// Covers contracts (l), (o):
// - (l) resolveActionSlug normalises every inbound action-slug surface
// - (o) alias entries preserve the idempotency-key slug invariant — legacy
//       slug → new slug resolution does NOT mutate the key's structure
// ~6 cases: alias present → resolves; unknown slug → passthrough;
//           log-once Set<string> fires once per process per alias hit;
//           every ACTION_SLUG_ALIASES key resolves to a registered slug
//           (prevents typos in the alias map itself).
```

```ts
// server/services/__tests__/orgOperationalConfigMigrationPure.test.ts
// Covers contract (h) read-chain pure decode:
// - Deep-merge (systemDefaults, overrides) → effective
// - Null override → returns systemDefaults untouched
// - Null systemDefaults + non-null override → returns override as-is
//   (legacy pre-Session-1 org case per spec §4.5)
// - Null both → returns {}
// - Array leaves replace-wholesale (not merge-concatenate)
// ~6 cases. NOTE: this file exercises the pure decoder ONLY. The write-path
// integration test lives in configUpdateOrganisationService.test.ts (Chunk A.2).
```

**Pure tests (modify — update literals only):**

| Path | Changes |
|------|---------|
| `server/services/__tests__/clientPulseInterventionProposerPure.test.ts` | `clientpulse.operator_alert → notify_operator` literals (14 cases, no logic change). |
| `server/services/__tests__/clientPulseInterventionPrimitivesPure.test.ts` | Same rename (23 cases). |
| `server/services/__tests__/interventionActionMetadataPure.test.ts` | Same rename (9 cases). |
| `server/services/__tests__/interventionIdempotencyKeysPure.test.ts` | Same rename (14 cases; consumes the `InterventionActionTypeName` union renamed in this chunk). |
| `server/services/__tests__/measureInterventionOutcomeJobPure.test.ts` | Same rename (11 cases). |
| `server/services/__tests__/mergeFieldResolverPure.test.ts` | No changes expected — resolver is slug-agnostic. Flagged for verification grep at kickoff. |

**Webhook handler audit (spec §10.8, chunk-2 kickoff task):**

At kickoff, `rg "action_type" server/routes/ server/services/webhooks/ server/services/integrations/` to enumerate handlers accepting inbound `action_type`. Every hit gets `resolveActionSlug` normalisation in this chunk. Add touched file(s) to this inventory as the audit discovers them. The contract (l) rule stands regardless of the audit outcome — if nothing needs touching, that's a finding, not a skip.

### §3.3 Migration plan

- **Next free sequence verified: `0180`.** `migrations/` currently ends at `0179_clientpulse_intervention_defensive_cooldown.sql`.
- **Existing `0178` collision** between `0178_clientpulse_interventions_phase_4.sql` and `0178_skill_analyzer_execution_lock_token.sql` per spec §4.7. The `git mv` of the skill-analyzer file to a free slot is the fix. Land the rename in Chunk A.1 alongside the three new migrations so Session 1 ships with a clean journal. Target slot: **`0184`** (the next slot after Session 1's three forward migrations). If the kickoff audit finds `meta/_journal.json` references the old filename, add a conditional `0183_renumber_skill_analyzer_migration.sql` that rewrites the journal row; otherwise the `git mv` plus a Drizzle regen suffices.
- **Rollback safety (spec §8.8).** Forward migration is reversible via `_down/` pairs: rename `operational_config_seed → operational_config` first; drop `organisations_applied_system_template_id_idx`; drop `organisations.applied_system_template_id`; drop `organisations.operational_config_override`. Data recoverable from `operational_config_seed` **pre-rewrite** (any writes landing on the new override column **after** the forward migration are lost on a straight `_down` — spec §8.8 documents this as acceptable under the current `commit_and_revert` / `live_users: no` framing). Slug rewrite rollback: `UPDATE actions SET action_type='clientpulse.operator_alert' WHERE action_type='notify_operator'` + index rebuild with the old predicate. Onboarding column rollback: `DROP COLUMN onboarding_completed_at`. Rollback window: one release cycle.
- **Hot-table concern.** `organisations` is tiny (one row per org; thousands at most at steady state). Adding two nullable columns is trivial. No index churn beyond the one partial index on `applied_system_template_id`.

### §3.4 Test plan

- Pure: two new files (above). All 7 existing pure-test files updated for literal renames — no logic changes, so existing coverage is preserved.
- Integration: none in this chunk (write-path integration test lives in Chunk A.2 after the service is retargeted).
- Manual: apply migration to a dev DB with seeded `hierarchy_templates.operational_config` data; assert `organisations.operational_config_override` carries the expected rows post-backfill and `hierarchy_templates.operational_config_seed` is present. Rollback the migration; assert original state restored.

### §3.5 Sanity gate

- `npx tsc --noEmit -p server/tsconfig.json` — zero new errors vs 43-error baseline.
- `npx tsc --noEmit -p client/tsconfig.json` — zero new errors vs 10-error baseline.
- `npx tsx server/services/__tests__/clientPulseInterventionProposerPure.test.ts` (and the 6 other updated pure-test files) — all pass.
- `npx tsx server/config/__tests__/actionSlugAliasesPure.test.ts` — all pass.
- `npx tsx server/services/__tests__/orgOperationalConfigMigrationPure.test.ts` — all pass.
- `npm run lint` on touched files.
- `node scripts/verify-integration-reference.mjs` — not run until Chunk A.3 (no taxonomy touch yet).

### §3.6 Commit message

```
A.1 — data model + core renames (spec §§2, 3, 7.5)

Lands three migrations: org operational_config_override column + applied_system_template_id FK + hierarchy_templates.operational_config_seed rename (spec §2.4); clientpulse.operator_alert → notify_operator rewrite + index rebuild (spec §3.3); organisations.onboarding_completed_at with backfill (spec §7.5). Advances contracts (h), (i), (l), (o). Fixes the 0178 migration-number collision. Alias resolver lands with log-once guard (contract l).
```

---

## §4. Chunk A.2 — Config service refactor

### §4.1 Contract/invariant surface

Contracts **(h)** the writer targets `organisations.operational_config_override` (write-path half of S1-A1 — the read-path half landed in A.1); **(j)** Settings page and Configuration Assistant are equal surfaces on the same mechanism — both converge on `configUpdateOrganisationService.applyOrganisationConfigUpdate`; **(n)** config gating is pure + execution is deterministic — the renamed `configUpdateOrganisationConfigPure.ts` retains every side-effect-free validator (`applyPathPatch`, `validateProposedConfig`, `classifyWritePath`, snapshot builder); the service consumes pure output, re-validates for drift, applies the merge + `config_history` row in a single transaction; **(u)** precondition contract inherited — no execution-layer change; the Configuration Assistant skill path continues to route sensitive paths through `actions` row with `gateLevel='review'` via `proposeReviewGatedAction`.

### §4.2 File inventory

**Service rename (modify — file rename, contents rewritten):**

| Path | Change |
|------|--------|
| `server/services/configUpdateHierarchyTemplateService.ts` → `server/services/configUpdateOrganisationService.ts` | Rewrite to target `organisations.operational_config_override`. `resolveDefaultHierarchyTemplateId` retired — the target row is always the caller's organisation (one row per org). `resolvePortfolioHealthAgentId` stays (still needed for sensitive-path action enqueue). Exported function: `applyOrganisationConfigUpdate({ organisationId, path, value, reason, sourceSession, changedByUserId, agentId })` returning the same discriminated-union response as the Phase-4.5 writer. Transaction boundary preserved: atomic write of override row + `config_history` insert per contract (p). |
| `server/services/configUpdateHierarchyTemplatePure.ts` → `server/services/configUpdateOrganisationConfigPure.ts` | Rename only. Logic unchanged — still deep-merges, classifies sensitive via `isSensitiveConfigPath(path)`, validates via `validateProposedConfig`, builds the drift-digest snapshot. All 18 existing pure cases carry over verbatim. |
| `server/services/__tests__/configUpdateHierarchyTemplatePure.test.ts` → `server/services/__tests__/configUpdateOrganisationConfigPure.test.ts` | Rename + update imports. All 18 existing cases carry unchanged per spec §8.3. Add pre-written header comment: |

```ts
// server/services/__tests__/configUpdateOrganisationConfigPure.test.ts
// Covers contracts (n), (s), (t), (u) pure surface:
// - (n) applyPathPatch + validateProposedConfig + classifyWritePath are pure
//   — same input → same output; no DB access; no side effects
// - (s) retry-vs-replay precondition: pure module produces idempotency-key-
//   ready output that the service layer consumes without re-validation
// - (t) internal-state-writes-first ordering: pure module emits the snapshot
//   + the merged result in one return; service layer writes them atomically
// - (u) precondition inputs: pure validator flags sensitive paths so the
//   service layer can route them to gate="review" instead of committing
// 18 cases carried over from configUpdateHierarchyTemplatePure.test.ts
// unchanged — only file + import renames.
```

**Skill definition (rename):**

| Path | Change |
|------|--------|
| `server/skills/config_update_hierarchy_template.md` → `server/skills/config_update_organisation_config.md` | Rename file + skill slug. Update skill description to reflect new target row (org override, not template). Payload schema no longer accepts `templateId` — the target is always the caller's organisation (carried implicitly via the authenticated `req.orgId`). Update `when-to-use` + examples. |

**Sensitive-paths + root-keys registry (new):**

| Path | Change |
|------|--------|
| `server/config/sensitiveConfigPathsRegistry.ts` | **NEW** — single composability surface (spec §§3.6, 3.8). Two `Set<string>` fields (registered-paths, registered-root-keys). Exports: `registerSensitiveConfigPaths(moduleSlug, paths)`, `getAllSensitiveConfigPaths()`, `isSensitiveConfigPath(path)`, `registerOperationalConfigRoots(moduleSlug, roots)`, `isValidConfigPath(path)`. Registry is append-only within a process lifetime. |
| `server/modules/clientpulse/registerSensitivePaths.ts` | **NEW** — ClientPulse's registration. Calls `registerSensitiveConfigPaths('clientpulse', […15 paths per spec §3.6])` + `registerOperationalConfigRoots('clientpulse', […9 root keys matching `OperationalConfig` block names])`. |
| `server/services/operationalConfigSchema.ts` | Replace the `SENSITIVE_CONFIG_PATHS` array export with a function-backed alias `export const getSensitiveConfigPaths = (): readonly string[] => getAllSensitiveConfigPaths()` (spec §3.6 — no empty frozen array; live delegation). `isSensitiveConfigPath` delegates to the registry. Migrate every in-repo import off the array export in the same chunk. |
| `server/index.ts` | Import `./modules/clientpulse/registerSensitivePaths` at the very top of the route-wiring section, before any route registers (spec §4.10). Co-located with other boot-time module init. |
| `server/services/configUpdateOrganisationConfigPure.ts` (already renamed above) | Use the registry helpers: `getAllSensitiveConfigPaths()` for the sensitive-path classification + `isValidConfigPath()` for the typo-guard allow-list. Replaces any hardcoded arrays inside the pure module. |

**Registry pure tests (new):**

```ts
// server/config/__tests__/sensitiveConfigPathsRegistryPure.test.ts
// Covers contract (n) — purity of config gating — via the registry primitive
// that feeds it, and the §3.6/§3.8 locked "single composability surface" pattern:
// - registerSensitiveConfigPaths('syntheticModule', ['x.y', 'a.b.c']) →
//   isSensitiveConfigPath('x.y') === true
// - Prefix match: isSensitiveConfigPath('x.y.deep.leaf') === true
// - Non-match: isSensitiveConfigPath('unrelated.path') === false
// - registerOperationalConfigRoots('syntheticModule', ['foo']) →
//   isValidConfigPath('foo.anything') === true
// - isValidConfigPath('notRegistered.root') === false
// - Registry is append-only: duplicate register calls for the same path are
//   idempotent (no throw, no double-count)
// - ClientPulse's boot registration covers every path in the spec §3.6 list
// - Empty path / null path → isValidConfigPath returns false
// ~8 cases total.
```

**Intervention-context service (modify):**

| Path | Change |
|------|--------|
| `server/services/clientPulseInterventionContextService.ts` | Remove `resolveDefaultHierarchyTemplateId` helper (no longer called by the service layer). No other behavioural change in this chunk. |

**Action registry (modify — builds on A.1):**

| Path | Change |
|------|--------|
| `server/config/actionRegistry.ts` | Ensure the `config_update_organisation_config` entry's `handlerKind` + skill-markdown path point at the renamed skill definition from above. A.1 already renamed the action slug; this chunk aligns the registry's skill-pointer field to the renamed file. |

### §4.3 Migration plan

None. This chunk has zero migrations — the data model was finalised in Chunk A.1. The service now writes to the column A.1 added.

### §4.4 Test plan

- Pure: the renamed `configUpdateOrganisationConfigPure.test.ts` (18 cases, unchanged logic) + the new `sensitiveConfigPathsRegistryPure.test.ts` (~8 cases).
- Integration (DB fixture): `server/services/__tests__/configUpdateOrganisationService.test.ts` — S1-A1 ship gate. Seeds an org + a hierarchy_template with non-null `operational_config`, runs the forward migration via the in-memory migration harness, asserts `applyOrganisationConfigUpdate({ path: 'alertLimits.maxAlertsPerRun', value: 10, ... })` writes to `organisations.operational_config_override`, leaves `hierarchy_templates.operational_config_seed` untouched, emits a `config_history` row with `entity_type='organisation_operational_config'` + non-null `snapshot_after`. Both non-sensitive + sensitive branches covered. Header comment:

```ts
// server/services/__tests__/configUpdateOrganisationService.test.ts
// Covers ship gate S1-A1 write path + contracts (h), (j), (n), (p):
// - (h) writer targets organisations.operational_config_override, never
//   hierarchy_templates
// - (j) the service returns the same discriminated-union response that the
//   generic route (A.3) will expose verbatim — equal surfaces = shared payload
// - (n) validator is called pre-write; drift re-validation on commit
// - (p) atomic write of override row + config_history row within a single tx
// ~6 cases: non-sensitive path → committed: true + history row; sensitive
//   path → committed: false + requiresApproval: true + actionId; invalid
//   path → INVALID_PATH; schema-invalid value → SCHEMA_INVALID; sum-
//   constraint violation → SUM_CONSTRAINT_VIOLATED; missing org → 400.
```

- Manual: none required for this chunk in isolation; the manual smoke happens after Chunk A.3 when the generic route surface is live.

### §4.5 Sanity gate

- `npx tsc --noEmit -p server/tsconfig.json` — zero new errors vs baseline.
- `npx tsc --noEmit -p client/tsconfig.json` — no client touches in this chunk; baseline held trivially.
- `npx tsx server/services/__tests__/configUpdateOrganisationConfigPure.test.ts` — 18/18 pass.
- `npx tsx server/config/__tests__/sensitiveConfigPathsRegistryPure.test.ts` — all pass.
- `npx vitest run server/services/__tests__/configUpdateOrganisationService.test.ts` (or the repo's equivalent integration harness) — all pass.
- `npm run lint` on touched files.
- `rg "SENSITIVE_CONFIG_PATHS" server/ client/` — zero hits on the **array** export (function alias `getSensitiveConfigPaths()` is the only surviving surface).

### §4.6 Commit message

```
A.2 — config service refactor (spec §§2.5, 3.6, 3.8)

Rename configUpdateHierarchyTemplate{Service,Pure} → configUpdateOrganisation{Service,ConfigPure}. Writer targets organisations.operational_config_override directly (contract h write-path). Extract sensitiveConfigPathsRegistry as the single composability surface for both SENSITIVE_CONFIG_PATHS and ALLOWED_CONFIG_ROOT_KEYS (S1-A3). 18 existing pure cases carry forward unchanged; 8 new registry cases land. Skill definition renamed. Advances contracts (h), (j), (n), (u).
```

---

## §5. Chunk A.3 — Generic route + UI renames

### §5.1 Contract/invariant surface

Contracts **(i)** route path moves from `/api/clientpulse/config/apply` (module-branded) to `/api/organisation/config/apply` (generic — any module's settings UI can converge here); **(j)** Settings page and Configuration Assistant are equal surfaces — this chunk lands the Settings-page side of the contract by exposing the write surface the Settings page will call; **(t)** audit never skipped — the config-history entity-type union ships so operators see a single contiguous timeline across the pre-Session-1 legacy rows and the new org-scoped rows.

### §5.2 File inventory

**New route (new):**

| Path | Change |
|------|--------|
| `server/routes/organisationConfig.ts` | **NEW** per spec §4.4. Registers `POST /api/organisation/config/apply` + `GET /api/organisation/config`. Middleware chain: `authenticate` → `requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT)` → `asyncHandler`. Body-validation via zod schema matching the spec §4.4 shape verbatim (`path: z.string().min(1).max(500)`, `value: z.unknown()`, `reason: z.string().min(1).max(5000)`, optional `sessionId: z.string().uuid()`). `min(1)` guards against empty-string payloads — do not drop. Service calls: `resolvePortfolioHealthAgentId(orgId)` + `applyOrganisationConfigUpdate({ …parsed.data, organisationId: orgId, changedByUserId: req.user.id, agentId })`. Response pass-through of the service's discriminated-union. GET returns `{ effective, overrides, systemDefaults, appliedSystemTemplateId, appliedSystemTemplateName }` per spec §4.5; the `overrides` field is the **raw sparse JSON** from `organisations.operational_config_override` (not schema-filled) so the Settings UI can derive `hasExplicitOverride` + `differsFromTemplate`. `systemDefaults` is `null` iff `appliedSystemTemplateId IS NULL`. |

**Legacy route retirement (delete):**

| Path | Change |
|------|--------|
| `server/routes/clientpulseConfig.ts` | **DELETE** per spec §4.2. No redirect. Rollback via `git revert` if audit uncovers an external caller. |
| `server/index.ts` | Remove the `app.use('/api/clientpulse/config', clientpulseConfigRouter)` line; add `app.use('/', organisationConfigRouter)` (the router carries its own full `/api/organisation/config/...` paths). |

**Config-history union (modify):**

| Path | Change |
|------|--------|
| `server/services/configHistoryService.ts` | Add `clientpulse_operational_config` AND `organisation_operational_config` to `CONFIG_HISTORY_ENTITY_TYPES` per spec §4.8. Both entity types now pass the gate-set validator. |
| `server/routes/configHistory.ts` | Accept `organisation_config_all` as a special `entityType` query value that internally `OR`s the two concrete entity types so operators see a single contiguous timeline; preserve direct literal querying for callers that pass either concrete type per spec §4.8. |

**UI renames (modify):**

| Path | Change |
|------|--------|
| `client/src/App.tsx` | Rename route `/system/config-templates` → `/system/organisation-templates`. Update lazy-import target from `SystemCompanyTemplatesPage` → `SystemOrganisationTemplatesPage`. |
| `client/src/pages/SystemCompanyTemplatesPage.tsx` → `client/src/pages/SystemOrganisationTemplatesPage.tsx` | Rename file + default-exported component class name. Update page H1 + copy from "Config Templates" → "Organisation Templates". |
| `client/src/components/Layout.tsx` | Rename nav label "Config Templates" → "Organisation Templates". Update any "Agent Templates" or "Config Template" text that refers to a platform-admin surface per spec §4.6. |
| `client/src/pages/AdminAgentTemplatesPage.tsx` → `client/src/pages/SubaccountBlueprintsPage.tsx` | **Rename only in this chunk — the operational-config-field removal lands in Chunk 5 (§6)** — spec §9.6 assigns the rename itself to the Phase 5 chunk so the editor refactor and file rename stay in one commit. Re-anchor here as an audit: confirm at chunk A.3 kickoff whether to rename the file now (if the current file already has no operational-config fields visible) or defer to Chunk 5. Default: defer to Chunk 5 per spec §9.6. |
| `client/src/pages/ClientPulseDashboardPage.tsx` | No changes in this chunk (the popup-button rewire lands in Chunk A.4). |
| Grep scope: `client/src/**/*.{ts,tsx}` + `server/**/*.md` + `docs/**/*.md` | Rename any "config template" → "Organisation Template" (platform-admin meaning) and "agent template" → "Subaccount Blueprint" (org-admin meaning). Server code referencing the table name `hierarchy_templates` stays — we're not renaming the table. |

**Capability taxonomy + docs (modify):**

| Path | Change |
|------|--------|
| `docs/integration-reference.md` | Rename taxonomy slugs per spec §4.9: `clientpulse.config.read → organisation.config.read`, `clientpulse.config.update → organisation.config.update`, `clientpulse.config.reset → organisation.config.reset`, `clientpulse.config.history → organisation.config.history`. Rename pseudo-integration block `clientpulse-configuration → organisation-configuration`. |
| `docs/orchestrator-capability-routing-spec.md` | Rename routing-hint capability slugs to match the taxonomy update. |
| `docs/configuration-assistant-spec.md` | Tool #29 renamed from `config_update_hierarchy_template → config_update_organisation_config`; target description updated from "hierarchy template row" → "organisation's operational_config_override row." |
| `docs/capabilities.md` | Customer-facing changelog entry per the editorial rules (no provider names; no technical identifiers). One bullet: "Organisation-scoped configuration surface — Settings and Configuration Assistant share the same audited write path." |
| `architecture.md` | Update the "ClientPulse Intervention Pipeline (Phases 4 + 4.5)" section to reflect the new writer target + route path. Update the Configuration Assistant subsection to reference the renamed skill + the generic route. |
| `CLAUDE.md` | Update "Key files per domain" index — the Configuration-Assistant row points at the renamed files; the ClientPulse-config-write row points at the new route + service; the `/clientpulse/config/apply` reference is removed. Update the "Current focus" pointer to reference Session 1 if the user wants that step taken in this chunk; if not, defer to Chunk 7 housekeeping. |

**Route integration test (new):**

```ts
// server/routes/__tests__/organisationConfig.test.ts
// Covers ship gate S1-A4 + contracts (i), (j):
// - (i) the canonical write surface is /api/organisation/config/apply; the
//   retired /api/clientpulse/config/apply returns 404 (delete verified)
// - (j) POST response shape matches the service-layer discriminated-union
//   verbatim — no route-specific re-shaping
// ~8 cases (one per errorCode branch + success branches):
// - POST non-sensitive path → 200 { committed: true, configHistoryVersion, ... }
// - POST sensitive path → 200 { committed: false, requiresApproval: true, actionId }
// - POST invalid body (missing `path`, empty string on `path` or `reason`) → 400 { errorCode: 'INVALID_BODY' }
// - POST invalid path (not in allow-list) → 400 { errorCode: 'INVALID_PATH' }
// - POST schema-invalid value → 400 { errorCode: 'SCHEMA_INVALID' }
// - POST sum-constraint violation → 400 { errorCode: 'SUM_CONSTRAINT_VIOLATED' }
// - POST sensitive path without agentId resolved → 400 { errorCode: 'AGENT_REQUIRED_FOR_SENSITIVE' }
// - GET /api/organisation/config → 200 with { effective, overrides, systemDefaults,
//   appliedSystemTemplateId, appliedSystemTemplateName }; assert `overrides` is the
//   raw sparse JSON (presence-only, no schema filling); assert `systemDefaults`
//   null when appliedSystemTemplateId is null.
```

### §5.3 Migration plan

None. No schema changes in this chunk.

### §5.4 Test plan

- Pure: none new in this chunk (the pure-module landscape was locked in A.1 + A.2).
- Integration: `organisationConfig.test.ts` per above.
- Manual: verification doc §3 (prep work — the full manual pass against the Settings page lands in Chunk 5, but a curl-level smoke on the route post-deploy confirms POST / GET both return the expected shapes).
- Docs-drift check: `node scripts/verify-integration-reference.mjs` — must exit zero. Taxonomy rename in this chunk is the first touch that exercises the integration-reference verifier in Session 1.

### §5.5 Sanity gate

- `npx tsc --noEmit -p server/tsconfig.json` — zero new errors vs 43-baseline.
- `npx tsc --noEmit -p client/tsconfig.json` — zero new errors vs 10-baseline.
- `npx vitest run server/routes/__tests__/organisationConfig.test.ts` — all pass.
- `npm run lint` on touched files.
- `node scripts/verify-integration-reference.mjs` — zero blocking errors.
- `rg "/api/clientpulse/config/apply" server/ client/` — zero hits (retirement verified).
- `rg "clientpulse.config.(read|update|reset|history)" docs/ server/` — zero hits outside the historical `config_history.entity_type` literal (which stays for audit continuity).

### §5.6 Commit message

```
A.3 — generic config-apply route + UI renames (spec §§4, 4.9)

New POST /api/organisation/config/apply + GET /api/organisation/config (S1-A4). Retire /api/clientpulse/config/apply (no redirect — spec §4.2). config_history entity-type union lands (spec §4.8). UI route rename /system/config-templates → /system/organisation-templates; page copy + nav labels updated. Taxonomy slugs renamed (clientpulse.config.* → organisation.config.*). Docs refreshed. Advances contracts (i), (j), (t).
```

---

## §6. Chunk A.4 — Configuration Assistant popup (real agent loop)

### §6.1 Contract/invariant surface

Contracts **(j)** Configuration Assistant is an equal surface to the Settings page — both converge on `configUpdateOrganisationService.applyOrganisationConfigUpdate` via the `config_update_organisation_config` skill reached through the existing `/api/agents/:agentId/conversations/...` agent loop; **(k)** session lifecycle for the popup — open resumes the most recent agent run < 15 minutes old, else creates fresh; close does not kill run; minimised pill surfaces background execution; **(r)** replayability — no decision logic added in this chunk; the panel + popup are pure UI wrappers around server-persistent agent-run state.

### §6.2 File inventory

**Shared panel extraction (new):**

| Path | Change |
|------|--------|
| `client/src/components/config-assistant/ConfigAssistantPanel.tsx` | **NEW** per spec §5.7. Extracted from `ConfigAssistantPage.tsx`. Renders session list + active conversation chat transcript + composer + plan-preview + actions bar. Props: `{ conversationId: string \| null, initialPrompt?: string, onConversationReady?: (id) => void, onPlanPreview?: (plan) => void, onPlanComplete?: (summary) => void, compactMode?: boolean }`. `compactMode=true` tightens spacing for the popup; `false` is the full-page default. Plan-preview size-check: if `plan.steps.length > 5`, render summary view with a "View full plan →" link to `/admin/config-assistant` (spec §5.11). |
| `client/src/components/config-assistant/ConfigAssistantPopup.tsx` | **NEW** per spec §5.7. Modal wrapper + minimised pill. Props: `{ open: boolean, initialPrompt?: string, onClose: () => void }`. Internal state: `{ minimised: boolean, conversationId: string \| null, planState: 'idle' \| 'preview' \| 'executing' \| 'complete' }`. Minimise collapses to a floating pill in the bottom-left matching the mockup. Pill click re-expands. Mounts `ConfigAssistantPanel` with `compactMode=true`. |

**Trigger hook + context (new):**

| Path | Change |
|------|--------|
| `client/src/hooks/useConfigAssistantPopup.ts` | **NEW** per spec §5.9. Exports `useConfigAssistantPopup(): { open, openConfigAssistant, closeConfigAssistant }`. Manages React context so `openConfigAssistant(initialPrompt?)` is callable from any component tree. Reads/writes `sessionStorage` under key `configAssistant.activeConversationId` for the 15-minute resume window (constant `CONVERSATION_RESUME_WINDOW_MIN = 15` exported from the hook file for future tuning). Parses `?config-assistant=open&prompt=<url-encoded>` deep-link on route change (spec §5.5). Registers the popup mount once at App-shell level. |

**Shell wiring (modify):**

| Path | Change |
|------|--------|
| `client/src/App.tsx` | Wrap the routed tree in the `useConfigAssistantPopup` context provider. Mount `<ConfigAssistantPopup />` once at shell level; pass `open` + `onClose` from the hook. Register the onboarding-wizard redirect (deferred to Chunk 6 — this chunk just threads the provider). |
| `client/src/components/Layout.tsx` | Add nav item "Configuration Assistant" (no emoji per CLAUDE.md) that calls `openConfigAssistant()` from the hook. Matches the spec §5.6 global-trigger list. |
| `client/src/pages/ConfigAssistantPage.tsx` | Refactor to mount `<ConfigAssistantPanel compactMode={false} />`. No UX change for the full-page view; internal logic now routes through the shared panel. |
| `client/src/pages/ClientPulseDashboardPage.tsx` | Remove the local `ConfigAssistantChatPopup` state + JSX; replace the "Open Configuration Assistant" button with a call to `openConfigAssistant()` from the hook. |

**Retired popup (delete):**

| Path | Change |
|------|--------|
| `client/src/components/clientpulse/ConfigAssistantChatPopup.tsx` | **DELETE** per spec §5.8 / §9.6. Rollback via `git revert`; no stub kept. |

**Server-side list endpoint extension (modify):**

| Path | Change |
|------|--------|
| `server/routes/agents.ts` | Extend `GET /api/agents/:agentId/conversations` with optional query params `updatedAfter` (ISO-8601 timestamp), `order` (`updated_desc` \| `updated_asc` \| `created_desc` \| `created_asc`; default `updated_desc`), `limit` (positive int, cap 50) per spec §5.4 / §5.10. Auth middleware + org-scope guards unchanged. User-scoping stays implicit via `req.user.id` (existing behaviour). Pass parsed params through to `listConversations`. |
| `server/services/conversationService.ts` | Extend `listConversations({ agentId, userId, organisationId, subaccountId?, updatedAfter?, order?, limit? })` to translate the new filters into Drizzle `where`/`orderBy`/`limit`. `updatedAfter` maps to `agentConversations.updatedAt >= <ts>`. `order` maps to `ORDER BY updated_at DESC/ASC` or `created_at DESC/ASC`. `limit` applies `LIMIT <n>` (defence-in-depth cap at 50 in the service layer). Existing callers (pass none) see unchanged behaviour — spec §5.10 locks this. |

### §6.3 Migration plan

None.

### §6.4 Test plan

- Pure: none new. No decision logic added — the popup is a UI wrapper around server-persistent agent-run state.
- Integration: none new for the `listConversations` extension (behaviour change is type-checked; spec §8.2 row for S1-A5 notes "integration-smoke-only surface" — explicit no-pure-test decision). If the typecheck boundary feels too weak, the verification doc §2 manual walkthrough is the coverage of record. Flagged in §10 (Open questions) as a possible add in response to reviewer feedback.
- Manual (S1-A5 ship-gate verification — documented in `tasks/builds/clientpulse/session-1-verification.md` §2):
  1. Open popup from nav → send a prompt → plan preview renders.
  2. Minimise → pill appears in bottom-left with current step if executing.
  3. Reopen (same tab) → same conversation resumes, transcript intact.
  4. Approve plan → execution progresses.
  5. Close popup mid-execute → reopen → see completed transcript (run continued server-side).
  6. Reopen after > 15 minutes idle → fresh conversation starts (resume window expired).
  7. Open two tabs against the same conversation → both receive real-time WebSocket updates.
  8. Deep-link `?config-assistant=open&prompt=Set%20maxAlertsPerRun%20to%2010` → popup opens, prompt seeded, not auto-sent.

### §6.5 Kickoff audits (spec §10.8)

- **⌘K command palette:** audit at kickoff (`rg "cmdk|command-palette|CommandPalette" client/`). Register the "Open Configuration Assistant" entry if a palette exists; otherwise file a follow-up and skip.
- **`useSocket` rejoin-after-remount:** audit at kickoff. If the existing `useSocket` hook doesn't cleanly re-subscribe after popup close + reopen (unmount/remount), extend it in this chunk. Flagged: this is the only potential scope-creep bucket for Chunk A.4; if the extension is non-trivial (> ~50 LOC), surface as a blocker and the user decides whether to in-chunk it or carve out.

### §6.6 Sanity gate

- `npx tsc --noEmit -p server/tsconfig.json` — zero new errors vs baseline.
- `npx tsc --noEmit -p client/tsconfig.json` — zero new errors vs 10-baseline.
- `npm run build` (client) — succeeds. Lazy-load chunking for the new popup components verified.
- `npm run lint` on touched files.
- Manual browser smoke per verification doc §2 — every step green.
- `rg "ConfigAssistantChatPopup" client/` — zero hits (deletion verified).

### §6.7 Commit message

```
A.4 — Configuration Assistant popup with real agent loop (spec §5)

Extract <ConfigAssistantPanel> as the shared child of the full-page and popup surfaces. Build <ConfigAssistantPopup> + useConfigAssistantPopup hook + context provider; mount at App shell. Delete Phase-4.5 ConfigAssistantChatPopup. Extend GET /api/agents/:agentId/conversations with updatedAfter / order / limit for the 15-minute resume query (contract k). Advances contracts (j), (k), (r). Closes S1-A5.
```

---

## §7. Chunk 5 — ClientPulse Settings page + Subaccount Blueprint editor refactor

### §7.1 Contract/invariant surface

Ship gate **S1-5.1** (typed editor per `operational_config` block; every write via `POST /api/organisation/config/apply`; `config_history` lands; override row reflects the change). Ship gate **S1-5.2** (Subaccount Blueprint editor exposes zero editable `operationalConfig` fields; `operational_config_seed` rendered read-only; new subaccounts inherit via `orgConfigService.getOperationalConfig(orgId)`). Contract **(j)** the Settings-page half of the equal-surfaces contract. Contract **(n)** the sensitive-path split is honoured at the UI layer — sensitive edits show "Sent to review queue" toast, non-sensitive edits show "Saved — history v<n>."

### §7.2 File inventory

**Settings page + editors (new):**

| Path | Change |
|------|--------|
| `client/src/pages/ClientPulseSettingsPage.tsx` | **NEW** per spec §6.1. Route `/clientpulse/settings`. Reads `GET /api/organisation/config`. Renders: page header (breadcrumb + title + subtitle + provenance strip showing override-row location + adopted Organisation Template name), "Open Configuration Assistant" button wired to `openConfigAssistant()` from the hook (Chunk A.4), one section card per `OperationalConfig` block mounted from the per-block editor list below. |
| `client/src/components/clientpulse-settings/HealthScoreFactorsEditor.tsx` | **NEW** — array-of-rows editor (weight slider 0.0–1.0, label, metric slug, normalisation type + bounds) with client-side sum-validator (`sum(weights) = 1.0 ± 0.001`). Blocks save while invalid. |
| `client/src/components/clientpulse-settings/ChurnRiskSignalsEditor.tsx` | **NEW** — array-of-rows editor (weight, signal slug, type enum, condition, thresholds). |
| `client/src/components/clientpulse-settings/ChurnBandsEditor.tsx` | **NEW** — 4 band range pickers (healthy / watch / atRisk / critical) with 0–100 sliders + overlap-check + gap-check. |
| `client/src/components/clientpulse-settings/InterventionDefaultsEditor.tsx` | **NEW** — numeric inputs: `cooldownHours`, `cooldownScope` enum, `defaultGateLevel` enum, `maxProposalsPerDayPerSubaccount`, `maxProposalsPerDayPerOrg`. |
| `client/src/components/clientpulse-settings/InterventionTemplatesJsonEditor.tsx` | **NEW** — JSON editor with schema-validation + side-by-side schema-reference panel per spec §6.2 / §10.5. Typed editor deferred to Session 2. Still routes through the standard save flow + audit. |
| `client/src/components/clientpulse-settings/AlertLimitsEditor.tsx` | **NEW** — `maxAlertsPerRun`, `maxAlertsPerAccountPerDay`, `batchLowPriority` toggle. |
| `client/src/components/clientpulse-settings/StaffActivityEditor.tsx` | **NEW** — `countedMutationTypes` array, `excludedUserKinds` multi-select, `automationUserResolution` (strategy enum + threshold + `cacheMonths`), `lookbackWindowsDays`, `churnFlagThresholds`. |
| `client/src/components/clientpulse-settings/IntegrationFingerprintsEditor.tsx` | **NEW** — `seedLibrary` read-only list + `scanFingerprintTypes` multi-select + `unclassifiedSignalPromotion` thresholds. |
| `client/src/components/clientpulse-settings/DataRetentionEditor.tsx` | **NEW** — per-resource retention days (nullable = unlimited): `metricHistoryDays`, `healthSnapshotDays`, `anomalyEventDays`, `orgMemoryDays`, `syncAuditLogDays`, `canonicalEntityDays`. |
| `client/src/components/clientpulse-settings/OnboardingMilestonesEditor.tsx` | **NEW** — array of milestone rows: `slug` + `label` + `targetDays` + `signal`. |

**Shared primitives (new):**

| Path | Change |
|------|--------|
| `client/src/components/clientpulse-settings/shared/ProvenanceStrip.tsx` | **NEW** — per-card provenance banner: "Stored in `organisations.operational_config_override` · Adopted template: `<template-name>`" (legacy org fallback per spec §4.5: "Adopted template: none (legacy org)"). |
| `client/src/components/clientpulse-settings/shared/OverrideBadge.tsx` | **NEW** — "Overridden" pill next to a leaf that satisfies `differsFromTemplate(path) === true`. |
| `client/src/components/clientpulse-settings/shared/ResetToDefaultButton.tsx` | **NEW** — reset icon button. Enabled iff `differsFromTemplate(path) === true`. On click: POST a save with `value: <system-default-value>` (option a per spec §10.5). Disabled tooltip: "Already at template default." |
| `client/src/components/clientpulse-settings/shared/ManuallySetIndicator.tsx` | **NEW** — optional micro-indicator for `hasExplicitOverride && !differsFromTemplate` audit state. Ship in Session 1 if trivial; spec §6.4 calls this out as optional polish. |
| `client/src/components/clientpulse-settings/shared/SaveBar.tsx` | **NEW** — per-card dirty-state tracker + Save button. Dispatches one POST per changed leaf (or a wholesale replace on array roots per spec §6.3 — the editor decides). Response handling: `committed: true` → toast "Saved · history v<n>"; `committed: false` → toast "Sent to review queue · Action <id>" with link; error → inline banner. |
| `client/src/components/clientpulse-settings/shared/differsFromTemplate.ts` | **NEW** — deep-equal helper. Audit at kickoff (spec §10.8) whether `fast-deep-equal` or an equivalent is already in the client bundle; if yes, re-export. If no, ship a minimal local util. Used by `ResetToDefaultButton` + `OverrideBadge`. |

**Subaccount Blueprint editor refactor (modify):**

| Path | Change |
|------|--------|
| `client/src/pages/AdminAgentTemplatesPage.tsx` → `client/src/pages/SubaccountBlueprintsPage.tsx` | **RENAME + REFACTOR** per spec §§6.5, 9.6. File rename from Chunk A.3 lands here (spec §9.6 assigns this commit to Chunk 5 so the refactor + rename ship together). **Remove** every editable `operationalConfig` field. **Render** the `operational_config_seed` block as a read-only informational preview with the callout "This is the operational-config snapshot captured when this blueprint was adopted from the system template. It is informational only — new subaccounts created under this blueprint inherit the org's effective operational config (via `orgConfigService.getOperationalConfig(orgId)`), not this snapshot. Change the live config in ClientPulse Settings." Editor now controls only: blueprint name + description, agent hierarchy (agents linked, roles, skills, schedules), default-for-subaccount toggle, delete / archive. Route updated to `/agents/blueprints`. Page H1 → "Subaccount Blueprints." |
| `client/src/App.tsx` | Register `<Route path="/clientpulse/settings" element={<ClientPulseSettingsPage user={user!} />} />` + `<Route path="/agents/blueprints" element={<SubaccountBlueprintsPage user={user!} />} />`. Lazy-load both per CLAUDE.md architecture rules. |
| `client/src/components/Layout.tsx` | Add nav items "ClientPulse Settings" (→ `/clientpulse/settings`) + "Subaccount Blueprints" (→ `/agents/blueprints`) under the Configuration section group (create the section group if it doesn't exist). |

**Subaccount-create audit (spec §10.8 chunk-6 kickoff task):**

| Path | Change |
|------|--------|
| `server/services/subaccountService.ts` (or equivalent — confirm at audit) | Audit first: does the subaccount-create path already read the org's effective operational config via `orgConfigService.getOperationalConfig(orgId)`, or does it read `hierarchy_templates.operational_config_seed` / a raw override row? If it reads the seed / raw override, retarget it to `getOperationalConfig(orgId)` and add the touched file here. If it already reads `getOperationalConfig(orgId)`, no code touch required — the contract holds. This row stays conditional until the audit resolves. |

### §7.3 Migration plan

None.

### §7.4 Test plan

- Pure: none new — no server-side decision logic added in this chunk (the editors are pure-UI; all writes go through the Chunk A.2/A.3 service + route surface which already has coverage).
- Integration: none new. The route-level integration test from Chunk A.3 (`organisationConfig.test.ts`) covers the write path the Settings page exercises.
- Manual (S1-5.1 + S1-5.2 ship-gate verification — verification doc §3 + §4):
  1. **Per-block Settings page smoke (§3):** open page → edit a field in each of the 10 editors → Save → verify toast matches classification (sensitive vs non-sensitive) → verify `config_history` row lands with correct `entity_type='organisation_operational_config'` and non-null `snapshot_after` → refresh page → verify persistence.
  2. **Reset-to-default (§3):** edit a leaf to differ from template → Save → click reset-to-default → verify POST with system-default value → verify effective value now matches system default; `hasExplicitOverride` still true; `differsFromTemplate` now false; button disabled with "Already at template default" tooltip.
  3. **Sensitive vs non-sensitive split (§3):** edit a sensitive path (e.g. `interventionDefaults.defaultGateLevel`) → Save → toast shows "Sent to review queue · Action <id>" with link; verify action row with `gateLevel='review'`, `status='proposed'`. Edit a non-sensitive path (e.g. `alertLimits.maxAlertsPerRun`) → Save → toast shows "Saved · history v<n>"; verify `organisations.operational_config_override` mirrors the edit.
  4. **Blueprint editor (§4):** open `/agents/blueprints` → confirm no editable operational-config fields; read-only seed preview renders with the callout.
  5. **Subaccount creation (§4):** create a new subaccount from the default blueprint → confirm agents seed correctly and operational config comes from `orgConfigService.getOperationalConfig(orgId)`, not the seed column.

### §7.5 Kickoff audits (spec §10.8)

- **Deep-equal helper in the client bundle:** `fast-deep-equal` present? audit via `rg "fast-deep-equal" client/` + `rg "\"fast-deep-equal\"" client/package.json`. Default: re-export if present; ship a local util otherwise.
- **Subaccount-create code path:** per §7.2 above.

### §7.6 Sanity gate

- `npx tsc --noEmit -p server/tsconfig.json` — zero new errors vs baseline (audit may touch `subaccountService.ts`).
- `npx tsc --noEmit -p client/tsconfig.json` — zero new errors vs 10-baseline.
- `npm run build` (client) — succeeds; lazy-loaded new routes chunk correctly.
- `npm run lint` on touched files.
- Manual verification doc §§3–4 green.

### §7.7 Commit message

```
Chunk 5 — ClientPulse Settings page + blueprint editor refactor (spec §6)

New /clientpulse/settings page with 9 typed editors + InterventionTemplatesJsonEditor (S1-5.1). Shared primitives: provenance strip, override badge, reset-to-default, save bar, deep-equal helper. Subaccount Blueprint editor renamed + stripped of editable operationalConfig fields; seed rendered read-only (S1-5.2). Nav + route wiring updated. Advances contracts (j), (n).
```

---

## §8. Chunk 6 — Operator onboarding wizard

### §8.1 Contract/invariant surface

Ship gate **S1-7.1** (create-org + first-run flows use new terminology end-to-end; no legacy labels leak). Ship gate **S1-7.2** (onboarding wizard soft-gates GHL OAuth; workspace usable at first sign-in; ClientPulse data appears only after the connection lands; no broken-state pages). Contract **(h)** create-from-template leaves `organisations.operational_config_override` NULL; contract holds for Option A ("override row initialised by the first explicit edit"). Contract **(i)** labels are Organisation Template, Subaccount Blueprint, ClientPulse Settings — generic-named throughout both flows.

### §8.2 File inventory

**System-admin create-org modal (modify):**

| Path | Change |
|------|--------|
| `client/src/pages/SystemOrganisationsPage.tsx` | Rebuild the "Create organisation" modal per spec §7.1. Card-based picker for Organisation Template backed by `GET /api/system/organisation-templates` (existing endpoint). Tier toggle (Monitor / Operate / internal) — sets the value; billing wiring is D6 scope. Live preview pane updates on template selection: "You'll create `<Org Name>` with `<Template Name>` · `<N>` agents will be seeded · `<M>` subaccount blueprints available · Operational defaults: inherited from the template (no org-specific overrides until the operator edits settings)." Submit button POSTs to the new service endpoint (below). |

**Organisation service (modify):**

| Path | Change |
|------|--------|
| `server/services/organisationService.ts` | Add method `createFromTemplate({ name, slug, systemTemplateId, tier, orgAdminEmail })` per spec §7.2. Six-step transaction (one atomic unit): (1) INSERT `organisations` row with `applied_system_template_id = systemTemplateId`; (2) leave `operational_config_override` NULL (contract h); (3) create a `hierarchy_templates` row as the default Subaccount Blueprint sourced from the system template, `isDefaultForSubaccount=true`, `operational_config_seed` populated from `systemHierarchyTemplates.operational_defaults`; (4) seed system agents declared by the template (e.g. portfolio-health-agent); (5) create the org-admin user row + queue invite email via existing invite infra; (6) write a `config_history` row: `entity_type='organisation_operational_config'`, `entity_id=<new-org-id>`, `change_source='system_sync'`, `change_summary='Organisation created from template <template-slug>'`, `snapshot_after=NULL` (semantic marker per spec §4.8 / §7.2). Return `{ organisationId, inviteSent: boolean }` for the modal to display success. Existing service methods (`listOrganisations`, `createOrganisation`, etc.) preserved unchanged. |

**Sysadmin service route (modify):**

| Path | Change |
|------|--------|
| `server/routes/system/organisations.ts` (or existing analogous file — confirm at kickoff) | Register `POST /api/system/organisations/create-from-template` (or equivalent — follow the existing file's naming convention). Middleware: `authenticate` + `requireSystemAdmin`. Body-validation via zod matching `createFromTemplate` param shape. Service call + response pass-through. |

**Org-admin onboarding wizard (modify):**

| Path | Change |
|------|--------|
| `client/src/pages/OnboardingWizardPage.tsx` | Replace the existing wizard structure with the 4-screen flow per spec §7.3. Route entry in `App.tsx` retained at `/onboarding`. |
| `client/src/components/onboarding/Screen1Welcome.tsx` | **NEW** — branded welcome screen; explains what ClientPulse monitors; hints at the 2 remaining steps. Primary button "Next." |
| `client/src/components/onboarding/Screen2ConnectGhl.tsx` | **NEW** — GHL OAuth soft-gate. Two primary actions: "Connect GHL" (kicks off OAuth via the canonical helper — audit at kickoff per spec §10.8 for the helper + callback path) and "Skip for now" (workspace usable; ClientPulse data empty-state until connected). Both advance to Screen 3 when user clicks Next. |
| `client/src/components/onboarding/Screen3ConfigureDefaults.tsx` | **NEW** — one impactful override per spec §7.3 (churn-band cutoffs summary view with "Adjust thresholds" link that expands the editor inline or defers). Sensitive path → Save queues via `POST /api/organisation/config/apply` standard review-queue flow. Non-sensitive paths would commit immediately. Per spec §7.3 iter-5 resolution: scan-frequency + alert-cadence controls **dropped** from Session 1; do not render. Only fields the operator actually changed get POSTed on Next (one POST per dirty leaf path). Advancing without edits performs zero config writes; override row stays NULL. |
| `client/src/components/onboarding/Screen4Ready.tsx` | **NEW** — summary card: org name, adopted template, GHL connection status, next scan ETA. Link to dashboard. On click "Complete onboarding" → POST `/api/onboarding/complete`. |

**Onboarding endpoints (modify):**

| Path | Change |
|------|--------|
| `server/services/onboardingService.ts` | Extend `getOnboardingStatus(orgId)` return shape to `{ needsOnboarding, ghlConnected, agentsProvisioned, firstRunComplete }` per spec §7.3 / §7.4. `needsOnboarding = (organisations.onboarding_completed_at IS NULL)`. Existing derivation logic for the three legacy fields is preserved unchanged — extend-not-replace per spec §7.3 HITL-resolved iter-1. Add `markOnboardingComplete(orgId)` method that sets `organisations.onboarding_completed_at = NOW()`. |
| `server/routes/onboarding.ts` | Extend `GET /api/onboarding/status` response shape (adds `needsOnboarding` field; other three fields unchanged). Add `POST /api/onboarding/complete` — middleware: `authenticate` + org-scope resolver (same chain as the sync-status endpoint per spec §7.4 auth contract); calls `markOnboardingComplete(req.orgId)`. Existing endpoints (`/api/onboarding/sync-status`, `/api/onboarding/confirm-locations`, `/api/onboarding/notify-on-complete`) unchanged. |

**Redirect logic (modify):**

| Path | Change |
|------|--------|
| `client/src/App.tsx` | Add a top-level effect: on first render (when `user` is resolved), `GET /api/onboarding/status`; if `needsOnboarding=true` and current route is not `/onboarding`, `navigate('/onboarding')`. Do NOT block unauthenticated flows; redirect only for authenticated org-admin users. |

**Migration (already landed in Chunk A.1):** `migrations/0182_organisations_onboarding_completed_at.sql` added `organisations.onboarding_completed_at` + backfilled existing orgs. No new migration in this chunk.

### §8.3 Migration plan

None — the onboarding-gate column shipped in Chunk A.1 (migration `0182`).

### §8.4 Test plan

- Pure: none new.
- Integration (new): `server/services/__tests__/organisationServiceCreateFromTemplate.test.ts` — DB-fixture-backed per spec §8.3. Asserts the six-step transaction lands atomically:

```ts
// server/services/__tests__/organisationServiceCreateFromTemplate.test.ts
// Covers §7.2 sysadmin service contract + contract (h) Option A lifecycle:
// - (h) organisations.operational_config_override is NULL post-creation;
//       override row is initialised only by the first explicit edit
// - §7.2 step 1: INSERT organisations with applied_system_template_id set
// - §7.2 step 3: default Subaccount Blueprint row created (isDefaultForSubaccount=true)
//   with operational_config_seed populated from systemHierarchyTemplates.operational_defaults
// - §7.2 step 4: system agents seeded under the new org
// - §7.2 step 5: org-admin user row + invite email queued
// - §7.2 step 6: config_history row with entity_type='organisation_operational_config',
//       snapshot_after=NULL, change_summary mentioning the template slug
// - Transaction atomicity: a forced failure in step 4 rolls back steps 1–3
// ~6 cases.
```

- Manual (S1-7.1 + S1-7.2 ship-gate verification — verification doc §5 + §6):
  1. **Sysadmin flow (§5):** open the create-org modal → verify all labels use "Organisation Template" (not "Config Template"). Pick a template → submit → verify: org created, default blueprint seeded, operational-config override NULL, invite email queued. Screenshot every screen; grep for legacy terms ("Config Template", "Agent Template", "clientpulse.operator_alert") — assert zero hits.
  2. **Org-admin flow — skip-GHL path (§6):** sign in as the new org-admin → wizard auto-opens. Screen 2: click "Skip for now." Screen 3: advance without edits → verify zero config writes; `operational_config_override` stays NULL. Screen 4: complete → dashboard renders empty states cleanly (no broken cards, no unhandled fetch errors).
  3. **Org-admin flow — connect-GHL path (§6):** run a second fresh org; on Screen 2 click "Connect GHL" → OAuth completes → back to wizard → complete. Verify data lights up within one scan cycle.
  4. **Re-entry:** subsequent sign-ins as the completed org-admin skip the wizard (`onboarding_completed_at` set).
  5. **Terminology grep (§5 + §6):** every screenshot of both flows inspected for "Config Template" / "Agent Template" / "clientpulse.operator_alert" — zero hits.

### §8.5 Kickoff audits (spec §10.8)

- **Canonical OAuth helper + callback path for GHL in the wizard:** audit at chunk-7 kickoff. `rg "initiate.*oauth\|oauthRedirect\|startOAuth" server/` + inspect existing wizard's Connect-GHL surface if any. Reuse the pattern.

### §8.6 Sanity gate

- `npx tsc --noEmit -p server/tsconfig.json` — zero new errors vs 43-baseline.
- `npx tsc --noEmit -p client/tsconfig.json` — zero new errors vs 10-baseline.
- `npm run build` (client) — succeeds.
- `npx vitest run server/services/__tests__/organisationServiceCreateFromTemplate.test.ts` — all pass.
- `npm run lint` on touched files.
- Manual verification doc §§5–6 green including terminology grep.

### §8.7 Commit message

```
Chunk 6 — operator onboarding wizard + sysadmin create-org (spec §7)

Rebuild the create-org modal with an Organisation Template picker, tier toggle, and live preview. New organisationService.createFromTemplate method lands the six-step transaction (spec §7.2): organisation row + applied_system_template_id + default Subaccount Blueprint + system agents + org-admin invite + creation config_history marker. Override row stays NULL per contract (h) Option A. 4-screen onboarding wizard (Welcome → Connect GHL soft-gate → Configure defaults → Ready). New POST /api/onboarding/complete endpoint + redirect logic. Advances S1-7.1 + S1-7.2.
```

---

## §9. Chunk 7 — pr-reviewer pass + housekeeping

### §9.1 Contract/invariant surface

All 9 ship gates green (§1 matrix). Every contract (a)–(v) referenced verbatim; no silent rewrite. §1.6 invariants preserved. All docs (`architecture.md`, `docs/capabilities.md`, `docs/integration-reference.md`, `docs/configuration-assistant-spec.md`, `docs/orchestrator-capability-routing-spec.md`, `CLAUDE.md`) in sync with code per CLAUDE.md's docs-stay-in-sync-with-code rule.

### §9.2 File inventory

This chunk is primarily a review + fix-pass. Code touches are follow-on fixes to `pr-reviewer` findings; not a new inventory. Housekeeping writes + the final tracker updates are the net-new work:

**Tracker + docs (modify):**

| Path | Change |
|------|--------|
| `tasks/builds/clientpulse/progress.md` | Append Session 1 entry: branch name, merge date, all 9 ship gates ticked, file-count summary, list of deferred items punted to Session 2 per spec §10.7. |
| `CLAUDE.md` "Current focus" pointer | Update `In-flight spec` to reference the Session 2 brief once Session 1 merges, or set to `none` if nothing queued. Do NOT leave the Session-1 pointer stale per CLAUDE.md's stale-pointer warning. |
| `CLAUDE.md` "Key files per domain" index | Confirm every row updated in earlier chunks is live (A.2 touched the config-update row; A.3 touched the config-write route row; A.4 touched the Configuration-Assistant row). This chunk is a final pass to grep for any stale path references. |
| `tasks/builds/clientpulse/session-1-verification.md` | **NEW** — manual verification checklist per spec §8.4. Seven top-level sections: (1) migration safety (fresh DB + pre-merge data + rollback); (2) popup lifecycle (S1-A5); (3) Settings page CRUD per block (S1-5.1); (4) Subaccount Blueprint editor (S1-5.2); (5) onboarding sysadmin (S1-7.1); (6) onboarding org-admin (S1-7.2); (7) parity check (Settings page vs Configuration Assistant both land in the override column + both emit `config_history` rows with correct `change_source`). |

**PR-review log (new — generated by the review loop, persisted by the caller per CLAUDE.md contract):**

| Path | Change |
|------|--------|
| `tasks/pr-review-log-clientpulse-session-1-<timestamp>.md` | **NEW** — written by the caller (main session or feature-coordinator) verbatim from the `pr-review-log` fenced block emitted by the `pr-reviewer` agent. Persist BEFORE applying any fixes per CLAUDE.md review-log contract. One file per invocation; if multiple rounds run, multiple log files are produced. |

### §9.3 Migration plan

None. The `0178` skill-analyzer renumber already landed in Chunk A.1. This chunk only verifies the journal is clean.

### §9.4 Test plan

This chunk is verification + fix-forward, not new test authorship. The test matrix:

1. **Re-run every pure test file touched or added in Session 1** — all must pass.
2. **Re-run every integration test added in Session 1** — `configUpdateOrganisationService.test.ts`, `organisationConfig.test.ts`, `organisationServiceCreateFromTemplate.test.ts`. All green.
3. **Full verification doc pass** — all 7 sections of `session-1-verification.md` green, with screenshots attached.
4. **Ship-gate matrix walk-through (§1 of this plan)** — every row walked top to bottom; green-tick per row; any row that cannot be ticked is a blocker.
5. **`pr-reviewer` invocation** — `"pr-reviewer: review the Session 1 changes (branch claude/clientpulse-session-1-<suffix>)"`. Persist the log file (§9.2). Triage findings:
   - **Blocking** findings fix in this chunk, then re-invoke `pr-reviewer` for a second pass.
   - **Non-blocking** findings ship as follow-up tickets in `tasks/todo.md`.
6. **Optional `dual-reviewer`** — only if the user explicitly asks AND the session is local with Codex CLI available. Never auto-invoke per CLAUDE.md rule. If invoked, `dual-reviewer` self-writes its log to `tasks/dual-review-log-clientpulse-session-1-<timestamp>.md`.

### §9.5 Sanity gate (full-diff final check)

- `npx tsc --noEmit -p server/tsconfig.json` — zero new errors vs 43-baseline.
- `npx tsc --noEmit -p client/tsconfig.json` — zero new errors vs 10-baseline.
- `npm run build` (client + server) — succeeds.
- `npm run lint` on the full diff — zero new errors on touched files.
- `node scripts/verify-integration-reference.mjs` — zero blocking errors.
- `node scripts/run-all-gates.sh` (if applicable) — all gates green.
- `rg "clientpulse.operator_alert" server/ client/` — zero hits outside the alias map in `actionRegistry.ts` (the alias line and its test remain; all other hits are bugs).
- `rg "config_update_hierarchy_template" server/ client/` — zero hits outside the alias map line.
- `rg "/api/clientpulse/config/apply" server/ client/` — zero hits (retirement verified).
- `rg "SENSITIVE_CONFIG_PATHS" server/ client/` — zero hits on the array export; `getSensitiveConfigPaths()` function alias is the only surviving surface.
- `rg "operational_config\b" server/db/schema/` — zero hits outside `operational_config_override` (on `organisations`) and `operational_config_seed` (on `hierarchy_templates`).
- Terminology grep on every verification-doc screenshot — zero hits on "Config Template" / "Agent Template" / "clientpulse.operator_alert."

### §9.6 Commit message

```
Chunk 7 — pr-reviewer pass + housekeeping (session 1 close-out)

Final ship-gate walk: S1-A1..A5 + S1-5.1/5.2 + S1-7.1/7.2 all green. pr-reviewer findings resolved. Docs verified in sync: architecture.md, capabilities.md, integration-reference.md, configuration-assistant-spec.md, orchestrator-capability-routing-spec.md, CLAUDE.md (key-files + Current focus). progress.md updated with Session 1 entry. session-1-verification.md manual checklist attached. 0178 migration collision resolved (skill-analyzer renumbered in A.1). Ready for PR open.
```

---

## §10. Open questions for the user

The spec's §10 decisions log is locked — this section does NOT re-open any of those decisions. Items below are plan-level interpretation calls the architect surfaced while translating the spec into a build contract. Each has a recommended default; flag any you want changed before implementation begins.

### §10.1 Skill-analyzer migration renumber target

**Question.** Spec §4.7 suggests renumbering `0178_skill_analyzer_execution_lock_token.sql` to `0180_skill_analyzer_execution_lock_token.sql`, but Session 1's own forward migrations start at `0180`. Two candidate slots for the skill-analyzer file: (a) `0180` (collides with Session 1's override-column migration); (b) a slot above Session 1's migrations, i.e. `0184` (next free after 0180/0181/0182/0183).

**Candidate answers.** (a) `0180` — follows spec §4.7 verbatim but creates a second collision. (b) `0184` — respects Session 1's own numbering.

**Recommended default.** **(b) `0184`** — land the `git mv` to `0184_skill_analyzer_execution_lock_token.sql` in Chunk A.1 alongside the three forward migrations. The spec's `0180` target is almost certainly a typo (spec §4.7 was written before the exact forward-migration numbers were locked).

### §10.2 `server/index.ts` registration — one new file or inline block

**Question.** Spec §3.6 says `server/modules/clientpulse/registerSensitivePaths.ts` is imported once at boot "before routes register." `server/index.ts` doesn't currently have a `modules/<slug>/register*` import pattern — Session 1 introduces it. Should the file additionally register a module-level `onBoot()` hook for symmetry, or is the side-effecting import sufficient?

**Candidate answers.** (a) Side-effecting import only (spec §3.6's reading). (b) A thin `onBoot()` export in the module file that `server/index.ts` calls explicitly.

**Recommended default.** **(a) Side-effecting import only.** Matches the spec's reading; keeps the boot surface minimal. If Session 2 adds a second module, promote to (b) at that point.

### §10.3 `conversationService.listConversations` — add a pure wrapper, or trust typecheck?

**Question.** Spec §8.2 (S1-A5) calls the listConversations extension "integration-smoke-only surface · no new pure test required." This is a defensible posture, but every other Session 1 server-side change has pure-test coverage. Is the reviewer expected to flag this as "missing pure coverage"?

**Candidate answers.** (a) Trust spec §8.2 — typecheck + manual smoke is sufficient. (b) Add `conversationServicePure.test.ts` exercising the sort/filter/limit param translation as a pure fn separate from the DB call.

**Recommended default.** **(a) Trust the spec.** The spec-reviewer already ran 5 iterations and accepted this. The decision surfaces if `pr-reviewer` flags it as blocking; then (b) lands as a fix commit in Chunk 7.

### §10.4 Subaccount-create retarget — in-chunk or kickoff-audit-driven?

**Question.** Spec §10.8 lists "does subaccount-create already read `getOperationalConfig(orgId)` or the seed?" as a chunk-6-kickoff audit. If the audit finds the seed is being read, the retarget fix is a `server/services/subaccountService.ts` edit — potentially a small one, potentially not. Two postures: (a) in-chunk fix regardless of size; (b) size-gate — if > ~30 LOC, surface as a blocker and decide whether to carve out.

**Candidate answers.** (a) / (b) as above.

**Recommended default.** **(a) In-chunk fix regardless of size.** The audit exists because leaving the seed-read in place would re-open contract (h). Carving out re-opens the ship gate. If the fix is surprisingly large, that's a signal the data model has other consumers too — better to uncover in this chunk than to defer.

### §10.5 Manually-set indicator — ship or defer?

**Question.** Spec §6.4 calls the "manually-set" micro-indicator (for `hasExplicitOverride && !differsFromTemplate` state) "optional UX polish — ship in Session 1 if trivial, defer otherwise." The judgement call is the architect's, but the threshold for "trivial" isn't spec'd.

**Candidate answers.** (a) Ship — it's a one-pill component with a consistent style from the override badge. (b) Defer to Session 2.

**Recommended default.** **(a) Ship.** The component is trivially composable with `OverrideBadge` (same shape, different state). The audit cost for reviewers comparing spec to implementation is lower if the full per-leaf state matrix is visible.

### §10.6 Deep-link prompt seeding — auto-send or review?

**Question.** Spec §5.5 says a deep-link prompt on a **fresh** conversation seeds as the first user message — but doesn't specify whether it auto-sends or waits for the operator to click Send. Existing full-page Configuration Assistant behaviour: auto-send (the chat is the entire UI; there's nothing to review first).

**Candidate answers.** (a) Match the full-page surface — auto-send. (b) Wait for user click — safer UX for surprise popups.

**Recommended default.** **(a) Auto-send on fresh conversation.** Consistent with the full-page surface per contract (j) equal-surfaces. If an operator triggered the deep-link (nav button, contextual button), they already opted in to running the prompt. Wait-for-click would create an unnecessary extra step.

### §10.7 Scope-fence verification — items that look like Session 2 creep

**Question.** Two items in the spec could read as scope creep into Session 2:

1. **Live preview pane in the sysadmin create-org modal (spec §7.1).** The spec describes seeding-agent counts + blueprint counts + operational-defaults summary. Computing these server-side requires a new endpoint or expanding `GET /api/system/organisation-templates`. Is this in Session 1 scope?
2. **`InterventionTemplatesJsonEditor` schema-reference panel (spec §6.2).** The side-by-side schema reference is a polished UX touch that could expand into a "schema explorer" feature.

**Candidate answers.** (a) Both stay in Session 1 — spec locked them. (b) Flag either to the user for explicit confirmation.

**Recommended default.** **(a) Both stay in Session 1.** Spec §6.2 + §7.1 are locked. The "live preview" is cheap — it's just fields from the system template row rendered in the modal (no new endpoint required). The schema-reference panel is a collapsible side panel rendering the zod schema as markdown; not a new feature surface. If either expands beyond ~100 LOC during implementation, surface then and the user decides.

### §10.8 Summary

Seven plan-level interpretation calls surfaced above. None re-open spec §10 decisions. Recommended defaults are conservative — they favour spec-verbatim readings and in-chunk fixes over deferrals.

---

**End of Session 1 plan.**

Ready for implementation starting at Chunk A.1. Ship-gate matrix (§1) is the binding verification contract; every chunk's sanity gate must be green before the next chunk starts.
