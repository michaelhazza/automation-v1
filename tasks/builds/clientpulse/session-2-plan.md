# ClientPulse Session 2 — Build Plan

**Session spec (authoritative):** `tasks/builds/clientpulse/session-2-spec.md` (1,519 lines, spec-reviewer clean)
**Predecessor:** Session 1 — `tasks/builds/clientpulse/session-1-foundation-spec.md` (shipped 2026-04-20, Phases 4+4.5 merged to main, ship gates B2+B3+B5 closed)
**Progress tracker:** `tasks/builds/clientpulse/progress.md`
**Branch:** to be cut from `main` at Chunk 2 kickoff (naming: `claude/clientpulse-session-2`)
**Packaging:** one PR, 14 chunks, ~4–5 weeks.

This plan translates the spec's §§0–14 into an executable chunk-by-chunk build. It does **not** re-derive the spec — every chunk section points at the spec sections that own the deep detail and inherits them verbatim. Read this plan in parallel with the spec.

---

## Contents

0. Executive summary
1. Ship-gate crosswalk
2. File inventory (flat view, attributed to chunk)
3. Chunk 2 — B.1 `apiAdapter` real GHL wiring
4. Chunk 3 — B.2 Live-data pickers + editor modal rewire
5. Chunk 4 — B.3 Drilldown page (minimal scope)
6. Chunk 5 — C.1 `notify_operator` channel fan-out
7. Chunk 6 — C.2 Outcome-weighted recommendation
8. Chunk 7 — C.3 Typed `InterventionTemplatesEditor`
9. Chunk 8 — C.4 Dual-path UX copy + per-block deep-links
10. Chunk 9 — C.5 (conditional) wizard scan / alert controls
11. Chunk 10 — D.1 Create-org modal rebuild + `createFromTemplate`
12. Chunk 11 — D.2 Typed Settings editors for 9 blocks
13. Chunk 12 — D.3 Panel extraction + 15-min resume window
14. Chunk 13 — D.4 Integration test + `recordHistory` refactor
15. Chunk 14 — Housekeeping + pr-reviewer + PR open
16. Risk register + mitigations
17. Decisions log (Q1–Q5, scope-expansion, deferrals)
18. Meta — Chunk 1 architect pass (this document)
19. Architect pass self-check (pre-authoring checklist satisfaction)

---

## §0. Executive summary

Session 2 is the final ClientPulse delivery before pilot launch. It ships three things concurrently, packaged as one PR:

- **Pilot enablement (Phase 6 — B-chunks):** `apiAdapter.execute()` becomes a real GHL dispatcher with a pure retry classifier and four-precondition gate (B.1); five intervention editor modals swap free-text ID inputs for live-data pickers backed by new read-only adapter endpoints (B.2); a minimal per-client drilldown surfaces intervention history, signal panel, band transitions, and a contextual Configuration Assistant trigger (B.3).
- **Pilot polish (Phase 8 — C-chunks):** `notify_operator` fans out to in-app + email + Slack through a thin orchestrator (C.1); `recommendedActionType` becomes outcome-weighted against `intervention_outcomes` aggregates (C.2); the Session 1 JSON editor for intervention templates is replaced by a typed editor with per-`actionType` sub-forms + merge-field picker (C.3); the Configuration Assistant chat surfaces dual-path copy for sensitive vs non-sensitive writes (§6 of C.4) and every Settings block gets an "Ask the assistant" deep-link (§9 of C.4); Screen 3 of the wizard gains scan-frequency + alert-cadence controls (C.5, conditional on schema audit).
- **Session 1 close-out (D-chunks):** deliberately-deferred Session 1 items land — create-org modal rebuild with `createFromTemplate` service method + template picker + tier toggle (D.1); typed form editors for the 9 non-template Settings blocks (D.2); clean `<ConfigAssistantPanel>` extraction that replaces the Session 1 iframe MVP and wires the 15-minute resume window at the hook level (D.3); the 8-case integration test for `/api/organisation/config` + the `recordHistory` version-return refactor that eliminates a redundant `SELECT MAX(version)` (D.4).

The 14 chunks are **serialised by design** — later chunks consume primitives introduced earlier (B.2 consumes the B.1 retry classifier for picker 429 handling; D.3's panel extraction consumes C.4's dual-path renderer; D.2's typed editors consume the `ArrayEditor` shared primitive introduced by C.3). Reordering breaks the dependency chain. Chunk 1 is this architect pass (no code); Chunk 14 is the housekeeping + review + PR-open pass. Chunks 2–13 are the build.

**Ship gates:** ten gates close across Session 2 — S2-6.1, S2-6.2, S2-6.3, S2-8.1, S2-8.2, S2-8.3, S2-8.4, S2-8.5, S2-8.6 (conditional), S2-D.1, S2-D.2, S2-D.3, S2-D.4. Each chunk names the gate(s) it closes; the crosswalk in §1 below maps them explicitly. `pr-reviewer` runs after Chunk 13; `dual-reviewer` only on explicit user request and only when Codex CLI is local.

---

## §1. Ship-gate crosswalk

Maps each Session 2 ship gate (from spec §1.1) to the chunk that closes it. The main session marks the gate closed in `tasks/builds/clientpulse/progress.md` at the end of the named chunk.

| Gate | Description | Closing chunk |
|---|---|---|
| **S2-6.1** | `apiAdapter.execute()` dispatches 5 `crm.*` action types; retries honour `actionDefinition.retryPolicy` per Q2 classifier | Chunk 2 (B.1) |
| **S2-6.2** | 5 editor modals use live-data pickers; free-text ID fallback removed | Chunk 3 (B.2) |
| **S2-6.3** | `/clientpulse/clients/:subaccountId` drilldown mounts with history, signal panel, band transitions, contextual assistant trigger | Chunk 4 (B.3) |
| **S2-8.1** | `buildInterventionContext.recommendedActionType` outcome-weighted when trials ≥ N; priority fallback otherwise | Chunk 6 (C.2) |
| **S2-8.2** | Dual-path chat copy: "Applied." vs "Sent to review queue." vs error | Chunk 8 (C.4) |
| **S2-8.3** | `notify_operator` fans out in-app + email + Slack within one worker tick | Chunk 5 (C.1) |
| **S2-8.4** | Typed `InterventionTemplatesEditor` replaces Session 1 JSON editor; round-trip preserved | Chunk 7 (C.3) |
| **S2-8.5** | "Ask the assistant" button on each of the 10 Settings cards | Chunk 8 (C.4) |
| **S2-8.6** (conditional) | Scan frequency + alert cadence editable from wizard Screen 3 | Chunk 9 (C.5) |
| **S2-D.1** | Create-org modal with picker + tier toggle + live preview; `createFromTemplate` seeds per spec §7.2 | Chunk 10 (D.1) |
| **S2-D.2** | Typed form editors for all 9 non-template Settings blocks | Chunk 11 (D.2) |
| **S2-D.3** | `<ConfigAssistantPanel>` extracted; popup drops iframe; 15-min resume window enforced on client | Chunk 12 (D.3) |
| **S2-D.4** | `organisationConfig.integration.test.ts` lands (8-case matrix); `recordHistory` returns version | Chunk 13 (D.4) |

Review gates (from spec §12.2):

- **After Chunk 4** — architect review-pass on B-chunks alone.
- **After Chunk 9** — architect review-pass on C-chunks alone.
- **After Chunk 13** — full `pr-reviewer` on the combined Session 2 diff. Caller persists the log to `tasks/pr-review-log-clientpulse-session-2-<timestamp>.md`.

---

## §2. File inventory (flat view, attributed to chunk)

Reproduces spec §13 as a single flat list with a new "Chunk" column so the inventory is grep-friendly. No new files relative to §13 — column is purely attribution. `NNNN` = Session 2 migration number; see §12.4 in spec and Chunk 2 kickoff audit for the actual values (expected `0185` through `0188` given highest-existing migration is `0184`).

### §2.1 Migrations

| Path | Chunk | Notes |
|------|-------|-------|
| `migrations/NNNN_actions_replay_of_action_id.sql` | Chunk 2 (B.1) | Pre-document replay column per contract (s); column stays NULL until Session 3 runtime |
| `migrations/_down/NNNN_actions_replay_of_action_id.sql` | Chunk 2 (B.1) | Rollback pair |
| `migrations/NNNN+1_intervention_outcomes_score_delta.sql` | Chunk 6 (C.2) | **Conditional** — only if kickoff audit finds `score_delta` missing |
| `migrations/_down/NNNN+1_intervention_outcomes_score_delta.sql` | Chunk 6 (C.2) | Rollback pair |
| `migrations/NNNN+2_operational_config_scan_frequency.sql` | Chunk 9 (C.5) | **Conditional** — only if §10 audit finds schema field missing |
| `migrations/_down/NNNN+2_operational_config_scan_frequency.sql` | Chunk 9 (C.5) | Rollback pair |
| `migrations/NNNN+3_organisations_tier.sql` | Chunk 10 (D.1) | **Conditional** — only if kickoff audit finds `tier` column missing |
| `migrations/_down/NNNN+3_organisations_tier.sql` | Chunk 10 (D.1) | Rollback pair |

### §2.2 Server — new files

| Path | Chunk |
|------|-------|
| `server/services/adapters/apiAdapterClassifierPure.ts` | Chunk 2 (B.1) |
| `server/services/adapters/ghlEndpoints.ts` | Chunk 2 (B.1) |
| `server/services/adapters/ghlReadHelpers.ts` | Chunk 3 (B.2) |
| `server/services/crmLiveDataService.ts` | Chunk 3 (B.2) |
| `server/routes/clientpulseDrilldown.ts` | Chunk 4 (B.3) |
| `server/services/drilldownService.ts` | Chunk 4 (B.3) |
| `server/services/drilldownOutcomeBadgePure.ts` | Chunk 4 (B.3) |
| `server/services/recommendedInterventionPure.ts` | Chunk 6 (C.2) |
| `server/services/notifyOperatorFanoutService.ts` | Chunk 5 (C.1) |
| `server/services/notifyOperatorChannels/inAppChannel.ts` | Chunk 5 (C.1) |
| `server/services/notifyOperatorChannels/emailChannel.ts` | Chunk 5 (C.1) |
| `server/services/notifyOperatorChannels/slackChannel.ts` | Chunk 5 (C.1) |
| `server/services/notifyOperatorChannels/availabilityPure.ts` | Chunk 5 (C.1) |

### §2.3 Server — modifications

| Path | Chunk | What changes |
|------|-------|--------------|
| `server/services/adapters/apiAdapter.ts` | Chunk 2 (B.1) | **REWRITE** — stub → real dispatcher (spec §2.5) |
| `server/jobs/executeApprovedActionsJob.ts` | Chunk 2 (B.1) | Add 4 precondition gates (spec §2.6) |
| `server/services/ghlOAuthService.ts` | Chunk 2 (B.1) | **Conditional audit** — confirm `getValidToken(orgId)` + refresh-on-expire |
| `server/config/limits.ts` | Chunk 2 (B.1) | `DEFAULT_ADAPTER_TIMEOUT_MS = 30_000` |
| `server/db/schema/actions.ts` | Chunk 2 (B.1) | Add `replay_of_action_id` column |
| `server/routes/clientpulseInterventions.ts` | Chunk 3 (B.2) | 5 new picker GETs (spec §3.2) |
| `server/services/skillExecutor.ts` | Chunk 5 (C.1) | `notify_operator` case → fan-out orchestrator |
| `server/services/clientPulseInterventionContextService.ts` | Chunk 6 (C.2) | Add `aggregateOutcomesByTemplate`; consume `pickRecommendedTemplate`; surface `recommendedReason` |
| `server/services/operationalConfigSchema.ts` | Chunk 6 (C.2) + Chunk 9 (C.5, cond.) | Add `minTrialsForOutcomeWeight`; optional `scanFrequencyHours` |
| `server/services/organisationService.ts` | Chunk 10 (D.1) | Add `createFromTemplate` |
| `server/routes/systemOrganisations.ts` | Chunk 10 (D.1) | POST route routes through `createFromTemplate` when `systemTemplateId` present |
| `server/db/schema/organisations.ts` | Chunk 10 (D.1) | **Conditional** — add `tier` column |
| `server/services/configHistoryService.ts` | Chunk 13 (D.4) | `recordHistory` returns `Promise<number>` version when called with `tx` |
| `server/services/configUpdateOrganisationService.ts` | Chunk 13 (D.4) | Consume returned version; drop `SELECT MAX(version)` |
| `server/index.ts` | Chunk 4 (B.3) | Register `clientpulseDrilldownRouter` |

### §2.4 Server — new test files

| Path | Chunk |
|------|-------|
| `server/services/adapters/__tests__/apiAdapterClassifierPure.test.ts` | Chunk 2 (B.1) |
| `server/services/adapters/__tests__/apiAdapter.integration.test.ts` | Chunk 2 (B.1) |
| `server/services/__tests__/drilldownOutcomeBadgePure.test.ts` | Chunk 4 (B.3) |
| `server/services/__tests__/recommendedInterventionPure.test.ts` | Chunk 6 (C.2) |
| `server/services/__tests__/notifyOperatorFanoutServicePure.test.ts` | Chunk 5 (C.1) |
| `server/services/__tests__/organisationServiceCreateFromTemplate.test.ts` | Chunk 10 (D.1) |
| `server/routes/__tests__/organisationConfig.integration.test.ts` | Chunk 13 (D.4) |

### §2.5 Client — new files

| Path | Chunk |
|------|-------|
| `client/src/components/clientpulse/pickers/LiveDataPicker.tsx` | Chunk 3 (B.2) |
| `client/src/pages/ClientPulseDrilldownPage.tsx` | Chunk 4 (B.3) |
| `client/src/components/clientpulse/drilldown/SignalPanel.tsx` | Chunk 4 (B.3) |
| `client/src/components/clientpulse/drilldown/BandTransitionsTable.tsx` | Chunk 4 (B.3) |
| `client/src/components/clientpulse/drilldown/InterventionHistoryTable.tsx` | Chunk 4 (B.3) |
| `client/src/components/clientpulse/drilldown/OutcomeBadge.tsx` | Chunk 4 (B.3) |
| `client/src/components/config-assistant/toolResultRenderers/ConfigUpdateToolResult.tsx` | Chunk 8 (C.4) |
| `client/src/components/config-assistant/ConfigAssistantPanel.tsx` | Chunk 12 (D.3) |
| `client/src/components/clientpulse-settings/editors/InterventionTemplatesEditor.tsx` | Chunk 7 (C.3) |
| `client/src/components/clientpulse-settings/editors/payloadSubEditors/FireAutomationDefaultsEditor.tsx` | Chunk 7 (C.3) |
| `client/src/components/clientpulse-settings/editors/payloadSubEditors/SendEmailDefaultsEditor.tsx` | Chunk 7 (C.3) |
| `client/src/components/clientpulse-settings/editors/payloadSubEditors/SendSmsDefaultsEditor.tsx` | Chunk 7 (C.3) |
| `client/src/components/clientpulse-settings/editors/payloadSubEditors/CreateTaskDefaultsEditor.tsx` | Chunk 7 (C.3) |
| `client/src/components/clientpulse-settings/editors/payloadSubEditors/NotifyOperatorDefaultsEditor.tsx` | Chunk 7 (C.3) |
| `client/src/components/clientpulse-settings/editors/MergeFieldPicker.tsx` | Chunk 7 (C.3) |
| `client/src/components/clientpulse-settings/editors/interventionTemplateRoundTripPure.ts` | Chunk 7 (C.3) |
| `client/src/components/clientpulse-settings/editors/HealthScoreFactorsEditor.tsx` | Chunk 11 (D.2) |
| `client/src/components/clientpulse-settings/editors/ChurnRiskSignalsEditor.tsx` | Chunk 11 (D.2) |
| `client/src/components/clientpulse-settings/editors/ChurnBandsEditor.tsx` | Chunk 11 (D.2) |
| `client/src/components/clientpulse-settings/editors/InterventionDefaultsEditor.tsx` | Chunk 11 (D.2) |
| `client/src/components/clientpulse-settings/editors/AlertLimitsEditor.tsx` | Chunk 11 (D.2) |
| `client/src/components/clientpulse-settings/editors/StaffActivityEditor.tsx` | Chunk 11 (D.2) |
| `client/src/components/clientpulse-settings/editors/IntegrationFingerprintsEditor.tsx` | Chunk 11 (D.2) |
| `client/src/components/clientpulse-settings/editors/DataRetentionEditor.tsx` | Chunk 11 (D.2) |
| `client/src/components/clientpulse-settings/editors/OnboardingMilestonesEditor.tsx` | Chunk 11 (D.2) |
| `client/src/components/clientpulse-settings/shared/ArrayEditor.tsx` | Chunk 7 (C.3) — first consumer; re-used in Chunk 11 (D.2) |
| `client/src/components/clientpulse-settings/shared/NormalisationFieldset.tsx` | Chunk 11 (D.2) |
| `client/src/lib/configAssistantPrompts.ts` | Chunk 8 (C.4) |

**ArrayEditor attribution note.** Spec §13.4 lists `ArrayEditor.tsx` under §11.2's D.2 block, but §8.7's `InterventionTemplatesEditor` uses the same primitive. Build it in Chunk 7 (C.3) so C.3 is self-sufficient; Chunk 11 (D.2) then consumes the already-landed primitive. If the D.2 editors need an ArrayEditor shape that C.3 didn't anticipate, extend in Chunk 11 rather than re-forking.

### §2.6 Client — modifications

| Path | Chunk | What changes |
|------|-------|--------------|
| `client/src/components/clientpulse/FireAutomationEditor.tsx` | Chunk 3 (B.2) | 1 picker |
| `client/src/components/clientpulse/EmailAuthoringEditor.tsx` | Chunk 3 (B.2) | 2 pickers |
| `client/src/components/clientpulse/SendSmsEditor.tsx` | Chunk 3 (B.2) | 2 pickers |
| `client/src/components/clientpulse/CreateTaskEditor.tsx` | Chunk 3 (B.2) | 2 pickers |
| `client/src/components/clientpulse/ProposeInterventionModal.tsx` | Chunk 6 (C.2) | Render `recommendedReason` badge |
| `client/src/pages/ClientPulseDashboardPage.tsx` | Chunk 4 (B.3) | Deep-link to drilldown |
| `client/src/pages/ConfigAssistantPage.tsx` | Chunk 8 (C.4) + Chunk 12 (D.3) | C.4 adds `ConfigUpdateToolResult` branch; D.3 collapses page to thin wrapper over `<ConfigAssistantPanel>` |
| `client/src/components/config-assistant/ConfigAssistantPopup.tsx` | Chunk 12 (D.3) | Drop iframe; mount panel |
| `client/src/hooks/useConfigAssistantPopup.tsx` | Chunk 12 (D.3) | Wire 15-min resume window via `updatedAfter` |
| `client/src/pages/ClientPulseSettingsPage.tsx` | Chunk 7 (C.3) + Chunk 8 (C.4) + Chunk 11 (D.2) | C.3 renders typed template editor + JSON fallback toggle; C.4 adds "Ask the assistant" per block; D.2 wires per-block typed editors |
| `client/src/pages/OnboardingWizardPage.tsx` | Chunk 9 (C.5) | **Conditional** — Screen 3 scan/alert controls |
| `client/src/pages/SystemOrganisationsPage.tsx` | Chunk 10 (D.1) | Create-org modal rebuild |
| `client/src/App.tsx` | Chunk 4 (B.3) | Register `/clientpulse/clients/:subaccountId` route |

**Multi-chunk files.** `ClientPulseSettingsPage.tsx` is touched in three chunks (7, 8, 11) and `ConfigAssistantPage.tsx` in two (8, 12). Each chunk's edits must be additive and non-overlapping; `git blame` should show distinct commits per edit. If a later chunk needs to rip out a primitive an earlier chunk landed, that is a scope drift — flag to the user rather than silently unwinding.

**Concurrent-edit guard.** When a later chunk touches a multi-chunk file, re-read the current state of the file before editing — do not rely on what the spec says the file looks like. If an earlier chunk's edits overlap unexpectedly with the current chunk's intended edits, stop and flag.

### §2.7 Docs

| Path | Chunk | What changes |
|------|-------|--------------|
| `architecture.md` | Chunk 14 | Update ClientPulse intervention pipeline section; update Configuration Assistant subsection for panel extraction |
| `docs/capabilities.md` | Chunk 14 | Customer-facing changelog entry — vendor-neutral per editorial rules |
| `docs/integration-reference.md` | Chunk 14 | GHL block: expand `skills_enabled` to reflect real dispatch per action_type |
| `docs/configuration-assistant-spec.md` | Chunk 14 | Dual-path UX copy contract documented |
| `CLAUDE.md` | Chunk 14 | "Current focus" pointer → Session 2 closed; "Key files per domain" rows updated |
| `tasks/builds/clientpulse/progress.md` | Chunk 14 | Session 2 entry after PR opens |

### §2.8 File-inventory audit

Every file in spec §13 appears above with a chunk attribution. No orphan entries. No file appears only in prose and not in the inventory. Main session confirms this at Chunk 2 kickoff by grepping the spec for "NEW" + "MODIFY" prose references and cross-checking against this section.

---

## §3. Chunk-by-chunk build plan

Each subsection below is the build contract for one chunk. Chunks 2–14 are ordered per spec §12.1; Chunk 1 (this architect pass) is covered in §8 below.

For each chunk: **scope recap** pins the chunk to its spec sections; **dependency + ordering note** pulls from §12.1's dependency column; **files touched** references the §2 inventory by row rather than re-listing; **migration plan** names the actual file or says "no migration"; **implementation order** is 4–8 ordered sub-steps; **verification plan** runs the §12.3 sanity gates plus any chunk-specific smoke; **review posture** names any ship gate(s) closed + whether this chunk is one of the three review-gate boundaries; **rollback notes** points at §12.5; **open-question resolutions / kickoff audits** lists whatever the main session must resolve at chunk kickoff.

**Migration-number convention.** Session 2 starts at `0185` per spec §12.4 (assuming highest-existing migration is `0184`; confirm at Chunk 2 kickoff). The first migration this session writes (actions `replay_of_action_id`) takes whatever number the audit produces; subsequent migrations take `+1`, `+2`, … in chunk order. If the audit produces a different base, every chunk below shifts consistently — do not re-number individually.

---

### §3.1 Chunk 2 — B.1 `apiAdapter` real GHL wiring

**Scope recap.** Rewrites the Phase-1A `apiAdapter.execute()` stub into a real GHL dispatcher: ships the pure `classifyAdapterOutcome` retry classifier (spec §2.3), 5 endpoint mappings (spec §2.4), the four-precondition gate (spec §2.6), structured logging keyed on `actionId` (spec §2.2), and the `replay_of_action_id` schema pre-documentation per contract (s) (spec §1.3). Closes ship gate S2-6.1.

**Dependency + ordering note.** Depends on Chunk 1 (this plan) only. No code dependency on earlier chunks. Blocks Chunks 3 (B.2 picker 429 handling reuses the classifier), 5 (C.1 execution-engine precondition gate is shared), and transitively every chunk that depends on 3 or 5.

**Files touched.** Per §2.1 (first migration row + `_down` pair), §2.2 rows 1–2 (`apiAdapterClassifierPure.ts`, `ghlEndpoints.ts`), §2.3 rows 1–5 (`apiAdapter.ts` rewrite, `executeApprovedActionsJob.ts` gate, `ghlOAuthService.ts` conditional audit, `limits.ts`, `actions.ts` schema), §2.4 rows 1–2 (`apiAdapterClassifierPure.test.ts`, `apiAdapter.integration.test.ts`). No client files. No multi-chunk file edits.

**Migration plan.** Confirm at chunk kickoff the highest existing migration number. Assuming `0184`, this chunk ships:
- `migrations/0185_actions_replay_of_action_id.sql` — `ALTER TABLE actions ADD COLUMN replay_of_action_id uuid NULL REFERENCES actions(id);` plus an index `CREATE INDEX actions_replay_of_action_id_idx ON actions(replay_of_action_id) WHERE replay_of_action_id IS NOT NULL;`.
- `migrations/_down/0185_actions_replay_of_action_id.sql` — drop index, drop column.

Column stays NULL in Session 2 per Q4 (spec §14.1); runtime-write wiring is deferred.

**Implementation order.**

1. **Kickoff audits** — verify migration number base; confirm `ghlOAuthService.getValidToken(orgId)` exists with refresh-on-expire (spec §2.7 row 3); confirm `executeApprovedActionsJob` already acquires the PG advisory lock per contract (v) (spec §2.8 Q2).
2. **Schema + migration pair** — add `replay_of_action_id` to `server/db/schema/actions.ts`; write the migration + `_down` pair.
3. **Pure classifier** — `apiAdapterClassifierPure.ts` per spec §2.3 table (10 rules including the "other 5xx respects `retryPolicy.maxRetries`" handoff); unit tests for ~10 cases covering each branch.
4. **Endpoint mappings** — `ghlEndpoints.ts` with the 5 rows from spec §2.4 (URL template + method + required payload fields for each).
5. **Adapter rewrite** — `apiAdapter.ts` from stub to dispatcher: resolve base URL + auth token → dispatch by `actionType` → consume classifier → return the spec §2.5 discriminated union. Structured log line per dispatch keyed on `actionId`.
6. **Precondition gate** — extend `executeApprovedActionsJob.ts` with the four spec §2.6 checks (approved + validationDigest match + advisory lock + timeout budget); each failed precondition transitions `actions.status → blocked` with the mapped `blockedReason`.
7. **`limits.ts`** — add `DEFAULT_ADAPTER_TIMEOUT_MS = 30_000`.
8. **Integration test** — `apiAdapter.integration.test.ts` using `nock` for a mocked GHL sandbox: 5 happy paths + rate-limit retry + auth failure + 422 validation failure + timeout → retryable.

**Verification plan.** Server `tsc --noEmit` (zero-new-errors vs Session 2 kickoff baseline); `npx tsx server/services/adapters/__tests__/apiAdapterClassifierPure.test.ts`; `npx tsx server/services/adapters/__tests__/apiAdapter.integration.test.ts`; `npm run lint` on touched files. No integration-reference verifier needed (docs update lands in Chunk 14).

**Review posture.** Closes ship gate S2-6.1. Not a spec §12.2 review-gate boundary — architect review on B-chunks runs after Chunk 4, not this chunk. `pr-reviewer` runs only after Chunk 13.

**Rollback notes.** Per spec §12.5 "Adapter rollback" — revert the `apiAdapter.ts` rewrite; stub returns `not_implemented`; approved actions queue but don't fire. Migration rollback via `_down/0185` is clean (column never written).

**Open-question resolutions / kickoff audits.**

- **Migration-number audit** — changes scope only numerically; if base is not `0184`, shift all §3 migration numbers consistently.
- **`ghlOAuthService.getValidToken` audit** — if missing, the chunk expands by +1 sub-step to add it with refresh-on-expire semantics. Flag to user if refresh-on-expire semantics need new provider calls (likely not — OAuth refresh is standard).
- **Concurrency-lock audit** — if `executeApprovedActionsJob` does NOT take the advisory lock, this chunk's precondition gate expands to add it; that is in-scope since the gate needs it anyway.
- **Per-endpoint zod-schema location** (spec §2.8 Q1) — default: co-locate with primitive (`crmFireAutomationServicePure.ts` already exports `validateFireAutomationPayload`); adapter imports and calls each.

---

### §3.2 Chunk 3 — B.2 Live-data pickers + editor modal rewire

**Scope recap.** Adds 5 new subaccount-scoped read-only GHL adapter endpoints (spec §3.2), a reusable `<LiveDataPicker>` component with debounced search + keyboard nav + 429 backoff (spec §3.4), the `crmLiveDataService` orchestration layer with 60-second Redis cache (spec §3.3), and rewires 4 of the 5 intervention editors to use pickers instead of free-text ID inputs (spec §3.5). `OperatorAlertEditor` keeps its internal-user picker unchanged. Closes ship gate S2-6.2.

**Dependency + ordering note.** Depends on Chunk 2 (B.1) — shares the GHL OAuth-token retrieval path (`ghlOAuthService.getValidToken`) and reuses the 429-classification branch of the retry classifier for picker rate-limit handling (spec §3.7). Blocks Chunk 4 (drilldown's intervention-propose flow mounts the rewired editors; not strictly blocking but ordering-consistent).

**Files touched.** Per §2.2 rows 3–4 (`ghlReadHelpers.ts`, `crmLiveDataService.ts`), §2.3 row 6 (`clientpulseInterventions.ts` route additions), §2.5 row 1 (`LiveDataPicker.tsx`), §2.6 rows 1–4 (4 editor rewires). No migration. No multi-chunk file edits.

**Migration plan.** No migration.

**Implementation order.**

1. **GHL read helpers** — `server/services/adapters/ghlReadHelpers.ts`: 5 low-level read calls (list-automations, list-contacts, list-users, list-from-addresses, list-from-numbers) against GHL's REST API, keyed on `locationId` resolved via `canonicalSubaccountScopes`.
2. **Service layer** — `server/services/crmLiveDataService.ts`: orchestration + canonicalisation of GHL's mixed `firstName`/`name` shapes + Redis caching per spec §3.3 key shape `(orgId, subaccountId, endpoint, searchQuery)` with 60s TTL. On 429 from GHL, return `{ rateLimited: true, retryAfterSeconds }` (consumed by the picker per spec §3.7).
3. **Routes** — 5 new GET routes on `clientpulseInterventions.ts` per spec §3.2 table. All `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` + `resolveSubaccount(subaccountId, orgId)`. 50-row max cap per endpoint; `?q=<search>` prefix matching.
4. **Picker component** — `LiveDataPicker.tsx` per spec §3.4 props + behaviour: 200ms debounce, keyboard nav (↑/↓/Enter/Esc), loading/empty/error states, `preloadOnFocus` variant for finite sets (from-addresses, from-numbers), 429 banner with "retry in N seconds" disabled input.
5. **Editor rewires** — one picker field per editor per spec §3.5 table (FireAutomation: 1; EmailAuthoring: 2; SendSms: 2; CreateTask: 2). Remove the free-text `<input type="text">` for each; operators can still paste IDs into the search box (deliberate power-user UX per spec §3.5).
6. **Smoke through each editor** — open each editor in the dashboard, confirm picker dropdown + search + selection + keyboard nav + error state (disconnect GHL mock).

**Verification plan.** Server `tsc --noEmit`; client `tsc --noEmit` (zero-new-errors vs baseline); `npm run lint` on touched files. No pure-test suite — pickers are client-side with no pure module. Manual smoke per editor is the ship-gate verification per spec §1.1 S2-6.2 "Manual smoke per editor; typecheck baseline held."

**Review posture.** Closes ship gate S2-6.2. Not a spec §12.2 review-gate boundary on its own — B-chunk architect review runs after Chunk 4.

**Rollback notes.** Per spec §12.5 "Picker rollback" — revert editor rewires via `git revert`; free-text ID fallback returns; Redis-cached responses evict on TTL. Route additions stay (dormant) — they're new endpoints, no backwards-incompatibility.

**Open-question resolutions / kickoff audits.**

- **Debounce window** (spec §3.8 Q1) — 200ms default; re-time at kickoff by measuring a typical GHL list-contacts response; bump to 300ms if p50 > 250ms. No scope change either way.
- **Max-result cap** (spec §3.8 Q2) — 50 rows per picker with "showing first 50 matches" footer. Deferred the "show more" affordance per spec §14.3 item 9.

---

### §3.3 Chunk 4 — B.3 Drilldown page (minimal scope)

**Scope recap.** Ships the per-client drilldown at `/clientpulse/clients/:subaccountId` with the Q5-locked minimal surface (spec §4.1): intervention history table with outcome badges, signal panel, band-transitions table (90d window), header with health-score delta + contextual "Open Configuration Assistant" trigger + "Propose intervention" button. Backed by 4 new read routes (spec §4.3), a read-orchestration service (spec §4.6), and a pure outcome-badge derivation module (spec §4.4). Closes ship gate S2-6.3.

**Dependency + ordering note.** Depends on Chunk 3 (the rewired `ProposeInterventionModal` mounts on the drilldown header; without Chunk 3's pickers the proposal flow is the old free-text UX). No blocking relationship with Chunks 5–13 — Chunk 6 (C.2) later re-renders `recommendedReason` in the drilldown's proposal modal, but the drilldown ships without that in Chunk 4 and gains the badge in Chunk 6.

**Files touched.** Per §2.2 rows 5–7 (`clientpulseDrilldown.ts` route, `drilldownService.ts`, `drilldownOutcomeBadgePure.ts`), §2.3 row 13 (`server/index.ts` router registration), §2.4 row 3 (`drilldownOutcomeBadgePure.test.ts`), §2.5 rows 2–6 (drilldown page + 4 sub-components), §2.6 rows 6 + 12 (`ClientPulseDashboardPage.tsx` deep-link + `App.tsx` route registration). No migration.

**Migration plan.** No migration.

**Implementation order.**

1. **Pure outcome-badge module** — `drilldownOutcomeBadgePure.ts` per spec §4.4 discriminated union; unit tests for ~10 cases covering each badge shape, `notify_operator` no-signal branch, execution-failed branch, pending-window branch.
2. **Drilldown read service** — `drilldownService.ts` orchestrates four reads: summary (band + health score + 7d delta from `client_pulse_churn_assessments` + `client_pulse_health_snapshots`), signals (top contributors), band transitions (90d window over `client_pulse_churn_assessments` ordered by `assessed_at`), interventions (left-join `actions` + `intervention_outcomes`, filter to 5 intervention `actionType` values, scoped by subaccount, limit 50).
3. **Routes** — `clientpulseDrilldown.ts` with 4 GETs per spec §4.3. All `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` + `resolveSubaccount(subaccountId, orgId)`. Register router in `server/index.ts`.
4. **Page component** — `ClientPulseDrilldownPage.tsx` layout per spec §4.2 ASCII sketch: header row (subaccount name + band + health score + delta + `[Propose]` + `[Open Configuration Assistant]`), then Signal Panel, Band Transitions Table, Intervention History Table, each as its own card.
5. **Sub-components** — `SignalPanel.tsx`, `BandTransitionsTable.tsx`, `InterventionHistoryTable.tsx`, `OutcomeBadge.tsx` (renders each discriminated-union shape from the pure module).
6. **"Open Configuration Assistant" wiring** — drilldown's button calls `useConfigAssistantPopup().openConfigAssistant(prompt)` with the subaccount-aware prompt per spec §4.5 (resumes any in-window conversation via the Session 1 15-minute resume semantics).
7. **Dashboard deep-link** — `ClientPulseDashboardPage.tsx` high-risk client rows deep-link into `/clientpulse/clients/:subaccountId`. Add the route to `App.tsx` under the same lazy-loaded conventions as other ClientPulse pages.

**Verification plan.** Server `tsc --noEmit`; client `tsc --noEmit`; `npx tsx server/services/__tests__/drilldownOutcomeBadgePure.test.ts`; `npm run lint` on touched files. Manual smoke per spec §1.1 S2-6.3 verification posture — open the drilldown for a subaccount with real intervention history, confirm all four cards render + contextual assistant trigger opens the popup seeded with the prompt.

**Review posture.** Closes ship gate S2-6.3. **Review-gate boundary per spec §12.2** — after this chunk, architect runs a review-pass on B-chunks (Chunks 2–4) as a cohort before Phase 8 begins. Pass criteria: adapter dispatches, pickers wire cleanly, drilldown mounts with real data. If the architect flags anything, fix before Chunk 5.

**Rollback notes.** Per spec §12.5 — no dedicated drilldown rollback line, but surface is additive (new route + new page); revert via `git revert` on the PR commits in reverse. Deep-link in dashboard degrades gracefully if the page is absent.

**Open-question resolutions / kickoff audits.**

- **Band-transition window** (spec §4.7 resolution 1) — 90d default via query param; no config surface.
- **Pending-window branch** (spec §4.7 resolution 2) — outcome badge shows `pending: window_open` when `proposedAt + measurementWindowHours > now()`; after the window, `pending: no_snapshot` if no snapshot arrived, else real badge.
- **Pagination** (spec §4.7 resolution 3) — 50 rows + "load more" appends next 50; no virtualisation.
- **Scope-drift guard** — if during implementation the urge arises to add segmented outcome charts or signal-overlay timelines, stop and flag. Spec §14.3 items 6 explicitly defers these; scope lock on Q5 (spec §14.1) is binding.

---

### §3.4 Chunk 5 — C.1 `notify_operator` channel fan-out

**Scope recap.** Turns the Session 1 `notify_operator` stub (returns `{ queued: true, channels }` with no delivery) into a real three-channel fan-out: in-app (notifications INSERT), email (existing `emailService.sendTransactional`), Slack (webhook POST via `organisationSecrets`). Ships the orchestrator, three thin channel adapters, a pure availability helper, and rewires `skillExecutor.ts`'s `notify_operator` case. Kickoff audit determines which channels already have delivery paths (Q3 locked to audit-then-ship). Closes ship gate S2-8.3.

**Dependency + ordering note.** Depends on Chunk 2 — shares the execution-engine precondition gate (fan-out is called from the approval-execute path after the four contract (u) preconditions pass). Not dependent on Chunks 3 or 4. Blocks Chunk 7 (C.3's `NotifyOperatorDefaultsEditor` surfaces the `channels` multi-select + the severity enum; Chunk 7 assumes the fan-out shape is stable).

**Files touched.** Per §2.2 rows 8–12 (fan-out service + 3 channel adapters + availability pure), §2.3 row 7 (`skillExecutor.ts` `notify_operator` case), §2.4 row 5 (`notifyOperatorFanoutServicePure.test.ts`). No migration, no client files.

**Migration plan.** No migration.

**Implementation order.**

1. **Kickoff audit** (spec §7.2) — for each of in-app / email / Slack, determine: (a) does a delivery path already exist, (b) is it wired to an org-configured provider? Document findings on the chunk's work list. If a channel is missing its provider path, this chunk expands to build the thin wrapper (email likely has `emailService`; Slack likely needs a minimal webhook-POST helper reading from `organisationSecrets`).
2. **Availability pure module** — `availabilityPure.ts`: pure helpers that derive per-channel availability from `{ emailConfigured, slackConfigured }` inputs. In-app is always true. Unit-testable with no I/O.
3. **Channel adapters** — three thin files in `notifyOperatorChannels/`. `inAppChannel.ts` INSERTs into `notifications` (one row per recipient). `emailChannel.ts` wraps `emailService.sendTransactional({ to, subject, body })` with subject = `payload.title`, body = `payload.message` + review-queue link. `slackChannel.ts` POSTs Slack-blocks JSON to the webhook URL resolved from `organisationSecrets['SLACK_WEBHOOK_URL']`.
4. **Fan-out orchestrator** — `notifyOperatorFanoutService.ts` per spec §7.3 signature: resolve recipients from `payload.recipients` (preset like `on_call` or explicit `userIds`), then for each requested channel check availability → dispatch → record per-channel `FanoutResult`. Returns `FanoutResult[]`.
5. **`skillExecutor.ts` rewire** — `notify_operator` case calls `fanoutOperatorAlert(...)`, returns `{ queued: true, channels, fanoutResults }`. Caller (the action handler) records `fanoutResults` on `actions.metadata_json.fanoutResults` for audit.
6. **Pure tests** — `notifyOperatorFanoutServicePure.test.ts` covers ~8 cases: channel-selection logic, skip-when-unavailable, result-aggregation shape, preset-recipient resolution for `on_call`. The orchestrator itself is not fully pure (it calls the channel adapters) but extract a pure `selectChannelsForDispatch({ requested, available })` helper so the selection logic is test-locked.
7. **Smoke** — propose + approve a `notify_operator` intervention on a test org with all three channels wired; confirm per-channel delivery + `fanoutResults` recorded on the action.

**Verification plan.** Server `tsc --noEmit`; pure tests; `npm run lint`. Manual smoke per spec §1.1 S2-8.3: propose + approve alert on an org with all channels configured, observe fan-out within one worker tick.

**Review posture.** Closes ship gate S2-8.3. Not a spec §12.2 review-gate boundary on its own — C-chunk architect review runs after Chunk 9.

**Rollback notes.** Per spec §12.5 "Fan-out rollback" — revert the `skillExecutor.ts` `notify_operator` case to the Session 1 stub; delivered notifications stay in their respective channels; in-flight fan-outs may deliver to some channels and skip others. Acceptable per pre-production framing (spec §12.6).

**Open-question resolutions / kickoff audits.**

- **Audit finding shape** (spec §7.2 table) — audit outcome changes scope: if all three channels present, chunk collapses to orchestrator + skillExecutor rewire + tests. If Slack missing, this chunk ships the minimal webhook helper.
- **`on_call` preset resolution** (spec §7.6 Q3) — audit `orgUserRoles` for an existing on-call role or a flag. If none, define as "users with `ORG_PERMISSIONS.OPERATIONS_REVIEW` permission" as the pilot-phase proxy; document the simplification on the chunk's work list. Real `on_call` role is a post-pilot refinement.
- **Per-channel retry posture** (spec §7.6 resolution 2) — in-app INSERT: no retry (DB write). Email: consume `emailService`'s existing retry. Slack: no retry in Session 2 (deferred per §14.3 item 7).
- **Failure semantics** (spec §7.6 resolution 1) — per-channel failure does NOT fail the fan-out; `fanoutResults` array captures per-channel status.

---

### §3.5 Chunk 6 — C.2 Outcome-weighted `recommendedActionType`

**Scope recap.** Replaces the Phase 4 priority-only `recommendedActionType` with an outcome-weighted pick: when `intervention_outcomes` rows per `(org_id, template_slug, band_before)` hit a trial threshold (`minTrialsForOutcomeWeight`, default 5), the recommendation becomes `(improvedCount/trials)*100 + avgScoreDelta`; sparse-data orgs fall back to priority-based. Ships the pure decision function, the aggregation query in the context service, a new non-sensitive config leaf, and the `recommendedReason` badge on `ProposeInterventionModal`. Conditional migration only if `intervention_outcomes.score_delta` is missing. Closes ship gate S2-8.1.

**Dependency + ordering note.** Depends on Chunk 4 — the drilldown surfaces `recommendedReason` in the proposal modal (Chunk 4 ships the drilldown + modal mount; Chunk 6 adds the badge). Not dependent on Chunks 2, 3, or 5. Blocks Chunk 7 (C.3's `InterventionDefaultsEditor` exposes `minTrialsForOutcomeWeight`; Chunk 11 wires the typed editor).

**Files touched.** Per §2.1 rows 3–4 (conditional `score_delta` migration + `_down` pair), §2.2 row 6 (`recommendedInterventionPure.ts`), §2.3 rows 8–9 (`clientPulseInterventionContextService.ts` rewire + `operationalConfigSchema.ts` leaf), §2.4 row 4 (`recommendedInterventionPure.test.ts`), §2.6 row 5 (`ProposeInterventionModal.tsx` badge render).

**Migration plan.** **Conditional.** Kickoff audit: `psql -c '\d intervention_outcomes'` — confirm `score_delta` column exists (Phase 4 shipped it per B2 ship gate). If present: no migration. If missing:

- `migrations/NNNN+1_intervention_outcomes_score_delta.sql` — `ALTER TABLE intervention_outcomes ADD COLUMN score_delta numeric NULL;`.
- `migrations/_down/NNNN+1_intervention_outcomes_score_delta.sql` — `ALTER TABLE ... DROP COLUMN score_delta;`.

Migration number = base + 1 (first conditional migration this session after Chunk 2's `replay_of_action_id`).

**Implementation order.**

1. **Kickoff audit** — confirm `score_delta` column; confirm sign convention (positive = improvement per spec §5.7 resolution 2).
2. **Pure decision function** — `recommendedInterventionPure.ts` per spec §5.2 signature. Three branches: no-candidates → `reason: 'no_candidates'`; sparse data → `priority_fallback`; sufficient trials → `outcome_weighted` with score `(improvedCount/trials)*100 + avgScoreDelta`, tie-break on trials desc → priority → slug.
3. **Pure tests** — `recommendedInterventionPure.test.ts` covers ~8 cases: empty candidates, all below threshold, mixed (some above + some below), tie-break cases, sign-convention correctness.
4. **Aggregation query** — in `clientPulseInterventionContextService.ts`, add `aggregateOutcomesByTemplate(orgId, currentBand)` per spec §5.3 SQL: `GROUP BY template_slug, band_before` with `COUNT(*) AS trials`, `SUM(... ) AS improved_count`, `AVG(score_delta) AS avg_score_delta`.
5. **Context service rewire** — `buildInterventionContext()` consumes `pickRecommendedTemplate`; surfaces `recommendedActionType` + `recommendedReason` on the response envelope per spec §5.4 code block.
6. **Config leaf** — `operationalConfigSchema.ts` adds `interventionDefaults.minTrialsForOutcomeWeight: z.number().int().positive().default(5)`. Non-sensitive (spec §5.5). Registered in `ALLOWED_CONFIG_ROOT_KEYS`.
7. **Modal badge** — `ProposeInterventionModal.tsx` renders "Recommended (outcome-weighted)" vs "Recommended (priority fallback)" badge next to the suggested action based on `recommendedReason`.

**Verification plan.** Server `tsc --noEmit`; client `tsc --noEmit`; pure tests; `npm run lint`. Manual verification: seed ≥5 outcomes for a template, confirm recommendation surfaces `outcome_weighted`; seed <5, confirm `priority_fallback`.

**Review posture.** Closes ship gate S2-8.1. Not a review-gate boundary on its own.

**Rollback notes.** Per spec §12.5 — revert the context-service rewire; `recommendedActionType` falls back to priority-only per Phase 4 shape. Migration rollback via `_down/` pair is clean (column might already exist pre-Session 2 per audit).

**Open-question resolutions / kickoff audits.**

- **`score_delta` schema audit** — **audit outcome changes scope.** If missing, this chunk ships the migration pair; if present, no migration. Either way the pure function + aggregation + badge are constant.
- **Subaccount-scoped vs org-scoped aggregation** (spec §5.7 resolution 1) — aggregate at org level. Per-subaccount aggregation deferred per §14.3 item 8.
- **Staleness window** (spec §5.7 resolution 3) — no staleness filter in Session 2; all outcomes aggregate. 90-day filter is a post-pilot tunable.
- **Sign convention** (spec §5.7 resolution 2) — positive `score_delta` = improvement. Align with existing column semantics; audit confirms.

---

### §3.6 Chunk 7 — C.3 Typed `InterventionTemplatesEditor`

**Scope recap.** Replaces the Session 1 `InterventionTemplatesJsonEditor` (raw JSON textarea) with a typed form editor: list-of-templates UI (spec §8.4), per-`actionType` payload sub-editors (spec §8.3 — 5 variants), merge-field picker chip-inserter (spec §8.3), pure round-trip serialiser (spec §8.5). JSON fallback stays in-tree per spec §8.6 until pilot validates the typed editor. Also introduces the `ArrayEditor.tsx` shared primitive that Chunk 11 reuses. Closes ship gate S2-8.4.

**Dependency + ordering note.** Depends on Chunk 5 — the `NotifyOperatorDefaultsEditor` sub-editor references the fan-out channel list (in-app / email / Slack); if Chunk 5's channel shape shifted mid-chunk, the sub-editor's multi-select needs to match. Blocks Chunk 11 (reuses `ArrayEditor.tsx`) and Chunk 8 (assistant deep-links mount on the same Settings page).

**Files touched.** Per §2.5 rows 9–16 (main editor + 5 sub-editors + `MergeFieldPicker` + round-trip pure), §2.5 row 23 (`ArrayEditor.tsx`), §2.6 row 10 slice (first of three edits to `ClientPulseSettingsPage.tsx` — wiring the typed editor + JSON fallback toggle). No migration. No server files.

**Migration plan.** No migration.

**Implementation order.**

1. **Kickoff audit** (spec §14.4) — confirm merge-field vocabulary endpoint `GET /api/clientpulse/subaccounts/:id/merge-field-vocabulary` exists; if missing, add it in this chunk (reads from the Phase-4 `mergeFieldResolver`'s known tokens).
2. **Round-trip pure module** — `interventionTemplateRoundTripPure.ts` with `serialiseTemplateForSave(form) → InterventionTemplate` + `deserialiseTemplateForEdit(template) → TemplateFormState`. Enforce discriminated-union exhaustiveness on `actionType` via TypeScript. No pure-test file per Session 1 convention — exhaustiveness check is the gate.
3. **Shared `ArrayEditor.tsx`** — reusable add / remove / reorder row helper per spec §11.2.2. Generic over `T`; consumers pass `renderRow(item, onChange)`, `emptyRow()`, keyed by stable index. First consumer is this chunk; re-used in Chunk 11.
4. **`MergeFieldPicker.tsx`** — dropdown of merge tokens from the vocabulary endpoint; click a chip → insert at cursor position of the bound textarea. Props: `{ subaccountId, onInsert(token) }`.
5. **Per-actionType sub-editors** — 5 files under `payloadSubEditors/` per spec §8.3 table: `FireAutomationDefaultsEditor` (workflowId optional + scheduleHint), `SendEmailDefaultsEditor` (subjectTemplate + bodyTemplate + merge-field picker + fromAddress), `SendSmsDefaultsEditor` (messageTemplate + merge-field + fromNumber), `CreateTaskDefaultsEditor` (titleTemplate + priority + dueInDays), `NotifyOperatorDefaultsEditor` (title + message + severity + channels multi-select — channel list pinned to Chunk 5's fan-out channels).
6. **Main editor** — `InterventionTemplatesEditor.tsx` renders the list (spec §8.4 ASCII sketch): per-row label + gateLevel + Edit/Duplicate/Delete. Edit expands to the typed form with all §8.2 fields + the per-`actionType` sub-editor. Uses `ArrayEditor` for the list. Save POSTs to `/api/organisation/config/apply` with `path: 'interventionTemplates'` + the wholesale updated array (sensitive path → routes through review queue; dual-path copy renders via Chunk 8's renderer, but C.4 is a separate chunk — for now Session 1's generic JSON tool-result renders, then Chunk 8 replaces with `ConfigUpdateToolResult`).
7. **Settings page wiring** — `ClientPulseSettingsPage.tsx`: `interventionTemplates` block renders `<InterventionTemplatesEditor>` by default; "Use JSON editor" toggle preserves Session 1 `InterventionTemplatesJsonEditor` fallback per spec §8.6.
8. **Round-trip smoke** — load a template, edit via typed form, save, reload, confirm data integrity (field-by-field). Spec §8.5 round-trip contract is the ship-gate verification.

**Verification plan.** Client `tsc --noEmit` (exhaustiveness check on the round-trip discriminated unions is the primary type gate); `npm run lint`. Manual smoke per spec §1.1 S2-8.4: load + edit + save each of the 5 sub-editor shapes; round-trip verification.

**Review posture.** Closes ship gate S2-8.4. Not a review-gate boundary — C-chunk architect review runs after Chunk 9.

**Rollback notes.** Per spec §12.5 "Settings-page editor rollback" — JSON editor fallback is in-tree; reverting the typed editor defaults the block back to Session 1's JSON shape. Zero data loss.

**Open-question resolutions / kickoff audits.**

- **Merge-field vocabulary endpoint audit** (spec §8.8 Q1) — if missing, adds one route to `clientpulseInterventions.ts`. Known Phase-4 primitive (`mergeFieldResolver`) so scope expansion is bounded (one route + a service getter).
- **Template uniqueness** (spec §8.8 Q2) — client-side check on Save; server-side existing schema constraint enforces the ground truth.
- **Default `actionType`** (spec §8.8 Q3) — "Add" button creates a template with `actionType: 'crm.fire_automation'` (most common pilot use case per spec).
- **`ArrayEditor` surface** (plan §2.5 ArrayEditor-attribution note) — build first for C.3's template list; extend in Chunk 11 if D.2 editors need a shape C.3 didn't anticipate. Do not re-fork.

---

### §3.7 Chunk 8 — C.4 Dual-path UX copy + per-block deep-links

**Scope recap.** Two surfaces, one chunk. **Dual-path UX copy (spec §6):** extends the Configuration Assistant's tool-result renderer to render distinct affordances for committed-inline vs queued-for-review vs error outcomes on `config_update_organisation_config` tool results. No server changes — `applyOrganisationConfigUpdate` already returns the right discriminated union. **Per-block deep-links (spec §9):** adds an "Ask the assistant →" button to each of the 10 Settings block cards; clicking opens the popup seeded with a path-aware prompt via `openAssistantWithBlockContext` helper. Closes ship gates S2-8.2 + S2-8.5.

**Dependency + ordering note.** Depends on Chunk 1 (plan only — no code dependency) and Chunk 7 (per-block buttons mount on the Settings page the typed editor re-rendered). Blocks Chunk 12 (D.3's extracted panel must render the `ConfigUpdateToolResult` via the panel, not the page).

**Files touched.** Per §2.5 row 7 (`ConfigUpdateToolResult.tsx`), §2.5 row 24 (`configAssistantPrompts.ts`), §2.6 row 7 slice (C.4's edit to `ConfigAssistantPage.tsx` — add the `ConfigUpdateToolResult` branch to the tool-result renderer mapping), §2.6 row 10 slice (second edit to `ClientPulseSettingsPage.tsx` — add "Ask the assistant" button per `BlockCard` header). No migration, no server files.

**Migration plan.** No migration.

**Implementation order.**

1. **Tool-result renderer** — `ConfigUpdateToolResult.tsx` per spec §6.3 code block: parse the raw JSON, branch on `committed` + `classification`, render the matching copy block + affordances. Three branches: `applied_inline`, `queued_for_review`, `error`, plus `unknown` fallback (renders JSON view per spec §6.7 resolution 1 + `console.warn` for shape drift).
2. **Internal parser** — co-located `parseConfigUpdateResult` helper. Per spec §6.4: lives in the same file (not a separate pure-test file — client-side test-infra absent; discriminated-union exhaustiveness is the gate).
3. **Page wiring for dual-path** — `ConfigAssistantPage.tsx`: when tool-result message's `tool === 'config_update_organisation_config'`, render via `<ConfigUpdateToolResult>` instead of the generic JSON renderer.
4. **Prompt helper** — `configAssistantPrompts.ts` exports `openAssistantWithBlockContext(block, effectiveValue, openConfigAssistant)` per spec §9.3. Cleaner variant (resolution): returns the prompt string; caller hands it to `openConfigAssistant`. Locked prompt shape per spec §9.5 resolution 1 — do not let per-block prompts drift.
5. **Settings page button** — `ClientPulseSettingsPage.tsx`: per `BlockCard` header, add `<button onClick={() => openConfigAssistant(buildBlockPrompt(block, effectiveValue))}>Ask the assistant →</button>` positioned right side of the header (not bottom — bottom is reserved for Save/Cancel in edit mode per spec §9.5 resolution 2).
6. **Smoke both branches** — trigger a sensitive config change via the assistant → confirm "Sent to review queue." copy + "Open review queue →" link; trigger a non-sensitive change → confirm "Applied." copy + "View history →" link; trigger a failing change → confirm "Couldn't apply this change." copy + retry button. Click "Ask the assistant" on each of the 10 Settings block cards → confirm popup opens seeded with the block-aware prompt.

**Verification plan.** Client `tsc --noEmit`; `npm run lint`. Manual smoke covering the three dual-path branches + each of the 10 block cards. Per spec §1.1 S2-8.2: screenshot per branch.

**Review posture.** Closes ship gates S2-8.2 + S2-8.5. Not a review-gate boundary on its own — C-chunk architect review runs after Chunk 9.

**Rollback notes.** Per spec §12.5 — no dedicated C.4 line, but surface is additive client-only; revert via `git revert` restores the generic JSON tool-result renderer + removes the per-block buttons.

**Open-question resolutions / kickoff audits.**

- **Unknown-shape fallback** (spec §6.7 resolution 1) — JSON view + `console.warn`, not a blank card.
- **Popup renderer parity** (spec §6.7 resolution 2) — the popup embeds the page today (iframe) and will embed the panel post-Chunk 12 (D.3). Either way the renderer runs inside the panel's message list; no separate popup renderer needed.
- **Prompt shape consistency** (spec §9.5 resolution 1) — locked. If a block-specific prompt ever diverges mid-implementation, escalate rather than drift.
- **Multi-chunk file guard** — `ClientPulseSettingsPage.tsx` edits are additive to Chunk 7's wiring. Re-read the current state before editing.

---

### §3.8 Chunk 9 — C.5 (conditional) Wizard scan-frequency + alert-cadence controls

**Scope recap.** Conditionally re-adds the two Screen-3 controls dropped in Session 1 iter-5 directional finding 5.1: scan-frequency radio group (writes `scanFrequencyHours`) + alert-cadence number inputs (write `alertLimits.maxAlertsPerAccountPerDay` + `.maxAlertsPerRun`). Conditional on schema audit per spec §10.1: ship only if both underlying schema fields exist OR can be added without scope creep (≤20 LOC + one migration per spec §10.5 resolution 1). Closes ship gate S2-8.6 (conditional).

**Dependency + ordering note.** Depends on Chunk 7 — C.3's typed editors already wire `alertLimits` (as one of the 9 D.2 blocks, but C.3 lands the Settings page shape the wizard reads). Blocks nothing — wizard Screen 3 is an independent surface.

**Files touched.** **All conditional.** Per §2.1 rows 5–6 (`operational_config_scan_frequency` migration + `_down`), §2.3 row 9 (`operationalConfigSchema.ts` additional leaf — shared with Chunk 6 but different leaf), §2.6 row 11 (`OnboardingWizardPage.tsx` Screen 3 controls). No new files.

**Migration plan.** **Conditional.** Kickoff audit per spec §10.1: does `operationalConfigSchema.ts` already have `scanFrequencyHours`? Does it have an `alertCadence` block (likely no — `alertLimits` is closest)? Three outcomes:

- **Both present** → no migration; ship both controls.
- **Only one present** → ship that one; defer the other; document on chunk kickoff output.
- **Neither present** → authorise schema extension at kickoff. `scanFrequencyHours` lands as a non-sensitive leaf; `alertLimits.*` already in registry. Migration `migrations/NNNN+2_operational_config_scan_frequency.sql` adds the leaf if needed + `_down/` pair. `alertLimits` is pre-existing so no migration for it.

Per spec §10.5 resolution 1: if schema extension exceeds 20 LOC or requires more than one migration, defer and flag as blocker.

**Implementation order.**

1. **Kickoff audit** — inspect `operationalConfigSchema.ts` for both fields; inspect `ALLOWED_CONFIG_ROOT_KEYS`; decide ship-vs-defer per spec §10.1 matrix.
2. **Schema extension (conditional)** — add `scanFrequencyHours: z.number().int().positive().default(4)` (non-sensitive per spec §10.5 resolution 2); add migration if audit outcome requires.
3. **Wizard Screen 3** — `OnboardingWizardPage.tsx`: add Scan frequency radio group (1h / 4h (recommended) / 12h / 24h) + Alert cadence number inputs (max per day + max per run) per spec §10.2 ASCII sketch.
4. **Save behaviour** — dirty-leaf tracking per spec §10.3: only changed fields POST to `/api/organisation/config/apply`; one POST per leaf; non-sensitive (scan frequency) commits inline; sensitive (alertLimits.*) queues for review. Wizard advances regardless.
5. **Smoke** — run wizard on a fresh org; confirm both controls render; change each; confirm correct path (inline vs review) per sensitivity.

**Verification plan.** Server `tsc --noEmit` (if schema extended); client `tsc --noEmit`; `npm run lint`. Schema inspection: `psql -c 'SELECT jsonb_pretty(operational_config_override) FROM organisations WHERE id=<test-org>;'` confirms writes landed. Manual smoke per spec §1.1 S2-8.6.

**Review posture.** Closes ship gate S2-8.6 (conditional). **Review-gate boundary per spec §12.2** — after this chunk, architect runs a review-pass on C-chunks (Chunks 5–9) as a cohort before Session 1 carry-forward chunks start. Pass criteria: fan-out delivers, recommendation is outcome-weighted, typed editor round-trips, dual-path copy + deep-links wire cleanly, wizard controls are coherent (or defer is documented).

**Rollback notes.** Per spec §12.5 — revert wizard page edits; migration rollback via `_down/` pair is clean.

**Open-question resolutions / kickoff audits.**

- **Schema audit outcome changes scope.** **Fully conditional chunk** — if audit defers both, chunk collapses to "schema audit output documented; ship gate S2-8.6 defers to post-pilot; flag as todo in `tasks/todo.md`." Do not silently expand scope beyond spec §10.5 resolution 1's 20-LOC bound.
- **Non-sensitive vs sensitive path** (spec §10.5 resolution 2) — `scanFrequencyHours` non-sensitive (pure cadence), `alertLimits.*` sensitive (per Session 1 registry). Behaviour matches existing Settings page.
- **If deferred** — document at chunk kickoff output, mark S2-8.6 as deferred on `progress.md`, continue to Chunk 10 without shipping controls.

---

### §3.9 Chunk 10 — D.1 Create-organisation modal rebuild + `createFromTemplate`

**Scope recap.** Session 1 carry-forward closing the deferred portion of S1-7.1 / S1-7.2: server-side `organisationService.createFromTemplate` 6-step transaction per spec §11.1.1; integration test asserting the creation-event `config_history` row + `hierarchy_templates` seed + NULL `operational_config_override`; client-side create-org modal rebuild on `SystemOrganisationsPage` with template picker cards + tier toggle + live preview pane per spec §11.1.2. Conditional migration for `organisations.tier` column per spec §11.1.3. Closes ship gate S2-D.1.

**Dependency + ordering note.** Independent — no dependency on B- or C-chunks. Blocks nothing. Can run in parallel with other D-chunks in principle but kept serialised per spec §12.1's no-parallelism posture.

**Files touched.** Per §2.1 rows 7–8 (conditional `organisations_tier` migration + `_down`), §2.2 row 15 (`organisationServiceCreateFromTemplate.test.ts`), §2.3 rows 10–12 (`organisationService.ts` new method + `systemOrganisations.ts` route + conditional `organisations.ts` schema field), §2.6 row 13 (`SystemOrganisationsPage.tsx` modal rebuild).

**Migration plan.** **Conditional.** Kickoff audit per spec §11.1.3: does `organisations.tier` column exist? If missing:

- `migrations/NNNN+3_organisations_tier.sql` — `ALTER TABLE organisations ADD COLUMN tier text NOT NULL DEFAULT 'operate' CHECK (tier IN ('monitor', 'operate', 'internal'));`.
- `migrations/_down/NNNN+3_organisations_tier.sql` — drop column.

Also audit at kickoff: is the system-templates endpoint (`GET /api/system/organisation-templates`) already present? If not, expand scope or flag.

**Implementation order.**

1. **Kickoff audits** — `organisations.tier` column; `GET /api/system/organisation-templates` endpoint existence; POST route name on `systemOrganisations.ts` (spec §11.1.4 flags route filename as audit).
2. **Schema extension (conditional)** — add `tier` field to `server/db/schema/organisations.ts`; ship migration + `_down/` pair if missing.
3. **`createFromTemplate` service method** — `organisationService.ts`: 6-step transaction per spec §11.1.1 — INSERT organisation (with `applied_system_template_id`), leave `operational_config_override` NULL, create default `hierarchy_templates` row with `isDefaultForSubaccount=true` + `operational_config_seed` from template, seed system agents declared by template, create org-admin user + invite email, write `config_history` creation-event row (`change_source='system_sync'`, `snapshot_after=NULL`). All in one tx. Returns `{ organisationId }`.
4. **Integration test** — `organisationServiceCreateFromTemplate.test.ts`: seed two system templates; call `createFromTemplate` with each; assert each of the four assertions from spec §11.1.1 (operational_config_override NULL, applied_system_template_id set, exactly one default hierarchy_templates row, one config_history creation-event row).
5. **Route wiring** — `systemOrganisations.ts` POST route routes through `createFromTemplate` when `systemTemplateId` is present in body; existing path preserved when not.
6. **Modal rebuild** — `SystemOrganisationsPage.tsx` extends the existing modal per spec §11.1.2: template picker cards (populated from `/api/system/organisation-templates`), tier toggle radio group (Monitor / Operate / internal), live preview pane on right that updates on template selection, Confirm → POST + success toast + link to new org.

**Verification plan.** Server `tsc --noEmit`; client `tsc --noEmit`; `npx tsx server/services/__tests__/organisationServiceCreateFromTemplate.test.ts` (integration, DB-fixture backed); `npm run lint`. Manual smoke: create two orgs via modal with different templates + different tiers; confirm creation-event `config_history` rows + seeded hierarchy templates via DB inspection.

**Review posture.** Closes ship gate S2-D.1. Not a review-gate boundary.

**Rollback notes.** Per spec §12.5 — no dedicated D.1 rollback line. Service-method + route revert via `git revert`. Migration rollback via `_down/` pair is reversible inside pre-production envelope.

**Open-question resolutions / kickoff audits.**

- **`organisations.tier` audit** — **audit outcome changes scope.** If missing, chunk ships migration; if present, verify current default value + check constraint match spec.
- **System-templates endpoint audit** — if `GET /api/system/organisation-templates` is absent, flag as blocker and surface to user; this chunk should not invent a system-templates surface without prior design (the template catalogue is a Session 0 / Session 1 primitive).
- **POST route filename audit** (spec §11.1.4) — confirm route file location before editing.
- **D6 tier gating is deferred** (spec §14.3 item 1) — `tier` column ships for future use; runtime enforcement is not this chunk's scope.

---

### §3.10 Chunk 11 — D.2 Typed Settings editors for 9 non-template blocks

**Scope recap.** Replaces the Session 1 generic JSON editor with typed form editors for the 9 non-template Settings blocks per spec §11.2.1 table: `HealthScoreFactorsEditor`, `ChurnRiskSignalsEditor`, `ChurnBandsEditor`, `InterventionDefaultsEditor` (includes Chunk 6's new `minTrialsForOutcomeWeight`), `AlertLimitsEditor`, `StaffActivityEditor`, `IntegrationFingerprintsEditor`, `DataRetentionEditor`, `OnboardingMilestonesEditor`. Reuses Session 1 shared primitives (`OverrideBadge`, `ManuallySetIndicator`, `ResetToDefaultButton`, `differsFromTemplate`, `ProvenanceStrip`) + Chunk 7's `ArrayEditor.tsx`. Ships one new shared primitive (`NormalisationFieldset.tsx`). Save behaviour: per-block wholesale-replace POSTs to `/api/organisation/config/apply` per Session 1 §6.3 semantics. Closes ship gate S2-D.2.

**Dependency + ordering note.** Depends on Chunk 7 — reuses `ArrayEditor.tsx` for `HealthScoreFactorsEditor`, `ChurnRiskSignalsEditor`, `StaffActivityEditor`'s `countedMutationTypes`, `OnboardingMilestonesEditor`. If the D.2 editors need an `ArrayEditor` shape Chunk 7 didn't anticipate, extend in this chunk rather than re-forking per plan §2.5 ArrayEditor-attribution note. Depends on Chunk 6 for `minTrialsForOutcomeWeight` leaf (surfaced in `InterventionDefaultsEditor`).

**Files touched.** Per §2.5 rows 17–22 (9 editor components), §2.5 row 25 (`NormalisationFieldset.tsx`), §2.6 row 10 slice (third edit to `ClientPulseSettingsPage.tsx` — per-block rendering picks typed editor per `block.path`; JSON fallback toggle retained). No migration, no server files.

**Migration plan.** No migration.

**Implementation order.**

1. **`NormalisationFieldset.tsx`** — shared sub-form helper for `healthScoreFactors` per-row normalisation (min/max/clamp inputs). Small primitive; built first.
2. **Editor components in dependency order** — start with simple leaf-only editors (`AlertLimitsEditor`, `DataRetentionEditor`, `InterventionDefaultsEditor`, `ChurnBandsEditor`), then array-based editors (`HealthScoreFactorsEditor`, `ChurnRiskSignalsEditor`, `OnboardingMilestonesEditor`, `StaffActivityEditor`), then the mixed-shape `IntegrationFingerprintsEditor`.
3. **Per-editor responsibilities** — each editor: owns its block's field inventory per spec §11.2.1 table, consumes Session 1 shared primitives for override/provenance UX, uses `ArrayEditor` for array-typed blocks. Save button POSTs the wholesale block value to `/api/organisation/config/apply` with `path: '<block-path>'` per Session 1 §6.3.
4. **Sum-constraint validation** — `HealthScoreFactorsEditor`: weights must sum to 1.0 ± 0.001. Client-side check on blur (convenience) + server-side on save (system of record) per spec §11.2.3.
5. **Settings page wiring** — `ClientPulseSettingsPage.tsx`: per-block rendering picks the typed editor per `block.path` (switch/map on the 9 block paths); JSON fallback toggle retained for defence-in-depth per Session 1 convention.
6. **Smoke each block** — load + edit + save each of the 9 blocks; confirm typed fields render, override badges update, dirty-state + save flow work; confirm sensitive blocks route through review queue (dual-path copy from Chunk 8).

**Verification plan.** Client `tsc --noEmit`; `npm run lint`. Manual smoke per spec §1.1 S2-D.2: all 9 blocks editable via typed forms, typecheck baseline held.

**Review posture.** Closes ship gate S2-D.2. Not a review-gate boundary.

**Rollback notes.** Per spec §12.5 "Settings-page editor rollback" — JSON editor fallback stays in-tree; reverting the typed editors defaults to Session 1 JSON shape. Zero data loss.

**Open-question resolutions / kickoff audits.**

- **Multi-chunk file collision** — `ClientPulseSettingsPage.tsx` is the third edit (after Chunks 7 + 8). Re-read current state; edits additive to the block-rendering map. If an earlier chunk's edits look unexpected, stop and flag per plan §2.6 concurrent-edit guard.
- **`ArrayEditor` extension** — if D.2 array editors need props Chunk 7's `ArrayEditor` didn't ship, extend in this chunk. Do not fork.
- **Sum-constraint server parity** — confirm at kickoff that `operationalConfigSchema.ts` enforces the weight-sum validation server-side; client-side check is convenience. If server enforcement is missing, add in this chunk (in-scope as a correctness gap).
- **`interventionDefaults.minTrialsForOutcomeWeight` wiring** — the leaf ships in Chunk 6; this chunk's `InterventionDefaultsEditor` surfaces it via the Session 1 numeric-input convention.

---

### §3.11 Chunk 12 — D.3 `<ConfigAssistantPanel>` extraction + 15-min resume window

**Scope recap.** Replaces the Session 1 iframe-wrapped popup MVP with a clean React-component extraction: the full-page `ConfigAssistantPage` collapses to a thin wrapper over the new `<ConfigAssistantPanel>`; the popup (`ConfigAssistantPopup`) drops its iframe and mounts the panel directly. Tightens the 15-minute resume window per Session 1 pr-review N1 — moves enforcement from URL-param plumbing (Session 1) to hook-level direct enforcement (Session 2). Panel ownership: chat message list, composer, session load, plan-preview-execute UX. Page / popup ownership: parent chrome + conversation-selection decision. Closes ship gate S2-D.3.

**Dependency + ordering note.** Depends on Chunk 8 — the dual-path `ConfigUpdateToolResult` renderer must live inside the panel's message list, not the page's. Blocks nothing remaining.

**Files touched.** Per §2.5 row 8 (`ConfigAssistantPanel.tsx`), §2.6 row 7 slice (D.3's edit to `ConfigAssistantPage.tsx` — collapse page to thin wrapper), §2.6 rows 8–9 (`ConfigAssistantPopup.tsx` drop iframe; `useConfigAssistantPopup.tsx` wire resume window). No migration, no server files.

**Migration plan.** No migration.

**Implementation order.**

1. **Kickoff audit** (spec §11.3.4) — confirm the Session 1 URL-param reader still exists in `ConfigAssistantPage.tsx` (expected removal target). Confirm `sessionStorage.getItem('configAssistant.activeConversationId')` is the Session 1 convention.
2. **Extract `<ConfigAssistantPanel>`** — new component; owns chat message list rendering + composer + session load + plan-preview-execute UX; consumes `conversationId | null`, `initialPrompt?`, `onConversationReady`, `onPlanPreview`, `onPlanComplete`, `compactMode?` props per spec §11.3.1 signature. Move all tool-result renderers (including Chunk 8's `ConfigUpdateToolResult`) into the panel.
3. **Collapse page** — `ConfigAssistantPage.tsx` becomes a thin wrapper per spec §11.3.2 code block: reads `conversationId` from route params, mounts `<ConfigAssistantPanel>` with `compactMode=false`. Session 1 URL-param reader for `updatedAfter` removed per spec §11.3.4.
4. **Refactor popup** — `ConfigAssistantPopup.tsx` drops the iframe per spec §11.3.3 code block: mounts `<ConfigAssistantPanel>` directly with `compactMode=true`, passes `activeConversationId` + `initialPrompt` from `useConfigAssistantPopup` context.
5. **Wire resume window** — `useConfigAssistantPopup.tsx`: on `openConfigAssistant(prompt?)`, read `sessionStorage.getItem('configAssistant.activeConversationId')`; if set, fetch `GET /api/agents/<configAssistantAgentId>/conversations?updatedAfter=<15-min-ago-iso>&limit=1&order=updated_desc`; if response includes the stored conversationId → resume; otherwise create fresh. 15-min constant pulled from existing `CONFIG_ASSISTANT_RESUME_WINDOW_MIN`. Per spec §11.3.4 the hook owns conversation selection; panel consumes `conversationId` from props.
6. **Smoke both surfaces** — open full-page `/config-assistant` route → panel mounts with `compactMode=false`; open popup from any page → panel mounts with `compactMode=true`; resume within 15 min → existing conversation surfaces; resume after 15 min → fresh conversation starts.

**Verification plan.** Client `tsc --noEmit`; `npm run lint`. Manual smoke per spec §1.1 S2-D.3: page + popup both mount; `CONFIG_ASSISTANT_RESUME_WINDOW_MIN` constant actually applied (test by setting `sessionStorage` with an old conversation id + waiting 15 min + triggering — fresh conversation expected).

**Review posture.** Closes ship gate S2-D.3. Not a review-gate boundary.

**Rollback notes.** Per spec §12.5 — no dedicated D.3 line. Revert restores the iframe-wrapped popup; functional parity held.

**Open-question resolutions / kickoff audits.**

- **Session 1 URL-param reader location** (spec §11.3.4) — audit at kickoff; expected removal during page-collapse step.
- **Multi-chunk file collision** — `ConfigAssistantPage.tsx` is the second edit (after Chunk 8). Chunk 8 added `ConfigUpdateToolResult` branch to the page's renderer map; Chunk 12 moves that mapping into the panel. Re-read state, ensure the branch migrates cleanly.
- **Panel `compactMode` semantics** — `compactMode=true` collapses vertical spacing + hides page-level chrome; locked by spec §11.3.1 comment. Do not invent additional compact-mode behaviours in this chunk.

---

### §3.12 Chunk 13 — D.4 Integration test + `recordHistory` version refactor

**Scope recap.** Closes Session 1 S1-A4's deferred integration test + pr-review N4's redundant version read-back. Ships the 8-case integration matrix for `/api/organisation/config` per Session 1 plan §5.2 (now spec §11.4.1); refactors `configHistoryService.recordHistory` to return the version it wrote when called with a `tx` argument so `configUpdateOrganisationService.commitOverrideAndRecordHistory` can drop its redundant `SELECT MAX(version)` read-back. Closes ship gate S2-D.4.

**Dependency + ordering note.** Independent — no dependency on other D-chunks or C-chunks. Service-layer tidy; doesn't touch client surface. Blocks Chunk 14 (review + PR) only as the final pre-review chunk.

**Files touched.** Per §2.4 row 6 (`organisationConfig.integration.test.ts`), §2.3 rows 11–12 (`configHistoryService.ts` signature change + `configUpdateOrganisationService.ts` consumption). No migration, no client files.

**Migration plan.** No migration.

**Implementation order.**

1. **Integration test skeleton** — `organisationConfig.integration.test.ts` using the existing test-db setup. Covers 8 cases per spec §11.4.1 table: (1) POST non-sensitive → 200 committed + version; (2) POST sensitive → 200 requiresApproval + actionId; (3) POST empty path → 400 INVALID_BODY; (4) POST unknown root → 400 INVALID_PATH; (5) POST schema-invalid → 400 SCHEMA_INVALID; (6) POST sum-constraint violation → 400 SUM_CONSTRAINT_VIOLATED; (7) POST sensitive without resolvable agent → 400 AGENT_REQUIRED_FOR_SENSITIVE; (8) GET → 200 with effective/overrides/systemDefaults/appliedSystemTemplateId/appliedSystemTemplateName, overrides raw sparse, systemDefaults null when template id null.
2. **`recordHistory` refactor** — `configHistoryService.ts`: `recordHistory({...}, tx)` returns `Promise<number>` (the version it wrote). Pre-existing signature without `tx` preserved for backwards compatibility; that branch continues returning `Promise<void>`. Advisory lock posture unchanged.
3. **Call-site update** — `configUpdateOrganisationService.ts`: `commitOverrideAndRecordHistory` consumes the returned version; remove the redundant `SELECT MAX(version)` + the `Number(row?.v ?? 0)` post-processing.
4. **Test the refactor** — add a test case in `organisationConfig.integration.test.ts` (or a dedicated `configHistoryServicePure.test.ts` if a pure seam is useful) that asserts `recordHistory` returns the version number matching the row it wrote.
5. **Smoke** — run the integration test locally against a disposable test db; confirm all 8 cases pass.

**Verification plan.** Server `tsc --noEmit`; `npx tsx server/routes/__tests__/organisationConfig.integration.test.ts` (DB-fixture-backed — requires test db up); `npm run lint` on touched files.

**Review posture.** Closes ship gate S2-D.4. **Review-gate boundary per spec §12.2** — after this chunk, full `pr-reviewer` pass runs on the combined Session 2 diff before PR opens. Caller persists log to `tasks/pr-review-log-clientpulse-session-2-<timestamp>.md` per CLAUDE.md contract.

**Rollback notes.** Per spec §12.5 — no dedicated D.4 line. Service-method signature change is backwards-compatible (tx-less call continues to return void); revert removes the new `Promise<number>` overload + restores the redundant read-back.

**Open-question resolutions / kickoff audits.**

- **Session 1 plan §5.2 matrix** — verify the 8 cases still match the current route behaviour at kickoff (contracts may have shifted during Session 1 blockers). If a case is stale, surface to user rather than silently adjusting.
- **Backwards-compatible signature** — `recordHistory` without `tx` preserves `Promise<void>` return; only the `tx`-ful overload returns `Promise<number>`. Confirm at kickoff that no existing call-site expects the new shape without the tx path.
- **Advisory lock posture** — spec §11.4.2 pins "advisory lock is still held inside recordHistory so the version is stable." Confirm during the refactor that the lock release happens after the version return, not before.

---

### §3.13 Chunk 14 — Housekeeping + pr-reviewer + PR open

**Scope recap.** The close-out pass. No new product code. Runs the full Session 2 pr-review loop, syncs docs, writes the `progress.md` Session 2 entry, and opens the PR. Covers all §2.7 docs rows: `architecture.md`, `docs/capabilities.md`, `docs/integration-reference.md`, `docs/configuration-assistant-spec.md`, `CLAUDE.md`, `tasks/builds/clientpulse/progress.md`.

**Dependency + ordering note.** Depends on Chunks 2–13 (every product chunk complete + sanity gates passed). Blocks nothing — last chunk.

**Files touched.** Per §2.7 (all 6 docs rows). No code files, no test files, no migrations.

**Migration plan.** No migration.

**Implementation order.**

1. **Cold re-read** — re-read the Session 2 diff at a high level; spot any drift between shipped code and the spec / plan. Flag drift as a todo before proceeding.
2. **Docs sync** — `architecture.md` updates the ClientPulse intervention pipeline section (real adapter dispatch) + the Configuration Assistant subsection (panel extraction). `docs/capabilities.md` adds a customer-facing changelog entry — vendor-neutral per CLAUDE.md editorial rules (no provider names in customer-facing sections). `docs/integration-reference.md` expands the GHL block's `skills_enabled` to reflect real dispatch per `action_type`. `docs/configuration-assistant-spec.md` documents the dual-path UX copy contract from Chunk 8. `CLAUDE.md` updates the Current focus pointer to "Session 2 closed — pilot launch ready" and updates Key files per domain rows (adapter, fan-out, drilldown, typed editors).
3. **`node scripts/verify-integration-reference.mjs`** — zero blocking errors expected; fix any drift the verifier flags.
4. **`progress.md` entry** — `tasks/builds/clientpulse/progress.md` gets a Session 2 entry: date, chunks shipped, ship gates closed (10 gates + conditional S2-8.6), deferrals carried forward (spec §14.3 items 1–12).
5. **Final sanity gates** — full pass of spec §12.3 sanity gates: server `tsc --noEmit`, client `tsc --noEmit`, all pure tests, `npm run lint`, `node scripts/verify-integration-reference.mjs`, `npm run build` on client.
6. **`pr-reviewer` loop** — invoke `pr-reviewer` on the combined Session 2 diff. Caller (main session) extracts the fenced `pr-review-log` block and persists to `tasks/pr-review-log-clientpulse-session-2-<timestamp>.md` per CLAUDE.md contract **before fixing any issues**. Fix blocking findings, re-run `pr-reviewer` until clean.
7. **PR open** — open the PR only after `pr-reviewer` is clean. PR description references this plan, the spec, and the `pr-review-log-*` file.

**Verification plan.** All spec §12.3 sanity gates pass. `pr-reviewer` log persisted. Optional: if user explicitly requests and Codex CLI is local, invoke `dual-reviewer` per CLAUDE.md — never auto-invoke.

**Review posture.** **Review-gate boundary per spec §12.2** — this IS the review gate. `pr-reviewer` is mandatory; `dual-reviewer` is opt-in per user request + local Codex availability.

**Rollback notes.** N/A — no product code changes. If docs drift lands wrong, amend-in-place before PR opens.

**Open-question resolutions / kickoff audits.**

- **Docs editorial compliance** — `docs/capabilities.md` updates must observe CLAUDE.md rules 1–5 (no specific LLM / AI provider names in customer-facing sections; marketing-ready terminology; vendor-neutral positioning). Violations block the edit.
- **Scope of Session 2 "current focus" update** — reset to the next work item or `none` if no in-flight spec queued. Do not leave stale.
- **PR-review log persistence** — per CLAUDE.md the log must exist regardless of task classification. If for any reason the pr-reviewer log was not written before fixing issues, that is a process violation — escalate rather than paper over.

---

## §4. Risk register + mitigations

Highest-risk items in Session 2 and the mitigations already pinned in the spec. Each entry cites the spec section that owns the mitigation — this register is the map, not a new decision.

- **Adapter retry classifier correctness (Chunk 2 / B.1).** The classifier is the hinge of the whole adapter: a wrong classification transitions the action to the wrong terminal state (e.g. retrying a 422 wastes budget; terminating a 429 loses a delivery). **Mitigation:** classifier is pure, lives in `apiAdapterClassifierPure.ts`, and is exhaustively unit-tested per spec §2.3 table (10 rules: 429/502/503/timeout → retryable, 401/403/404/422 → terminal, 2xx → success, other 5xx respects `retryPolicy.maxRetries`, other 4xx → terminal). Tests land with the classifier in the same chunk.
- **Fan-out partial-delivery semantics (Chunk 5 / C.1).** A partial fan-out (e.g. in-app succeeds, Slack fails) could confuse operators about whether the alert "delivered." **Mitigation:** per-channel `FanoutResult` rows are recorded on `actions.metadata_json.fanoutResults` per spec §7.3; a per-channel failure does NOT fail the fan-out per spec §7.6 resolution 1. Acceptable per spec §12.5 rollback posture — pre-production framing holds.
- **Typed editor round-trip fidelity (Chunk 7 / C.3).** If the typed `InterventionTemplatesEditor` drops, reorders, or materialises fields, existing pilot templates break silently on first edit. **Mitigation:** round-trip contract in spec §8.5 locks the three invariants (unknown fields preserved, optional absent fields not materialised as undefined, array order preserved); discriminated-union exhaustiveness on `actionType` is the TypeScript gate; the JSON editor fallback stays in-tree per spec §8.6 as defence-in-depth until pilot validates the typed surface.
- **Drilldown scope creep (Chunk 4 / B.3).** The drilldown is the kind of surface where "one more chart" is always tempting, but the pilot has no usage-shaped signal yet for what's actually valuable. **Mitigation:** Q5 scope lock in spec §4.1 + §14.1 pins the minimal shape (history + signal panel + band transitions + contextual assistant trigger); spec §14.3 item 6 explicitly defers segmented outcome charts + signal-overlay timelines to post-pilot. Scope-drift guard in this plan's §3.3 open-questions tells the implementer to stop and flag if the urge to add richer visualisations arises.
- **D.3 panel extraction breaking existing callers (Chunk 12 / D.3).** The extraction touches both `ConfigAssistantPage` and `ConfigAssistantPopup`, plus the 15-min resume window moves from URL-param plumbing (Session 1) to hook-level enforcement. A subtle regression could break Session 1's shipped popup flow. **Mitigation:** the integration test in Chunk 13 (D.4) covers the GET branch of the route the panel consumes; the manual smoke in this chunk (panel on both page + popup, resume inside + outside 15 min) is explicit in the verification plan; the Session 1 URL-param reader removal is a single diff-able change rather than a stealth refactor.
- **Multi-chunk file collision (Chunks 7 / 8 / 11 on `ClientPulseSettingsPage.tsx`; Chunks 8 / 12 on `ConfigAssistantPage.tsx`).** Three additive edits to the same Settings page file + two additive edits to the Configuration Assistant page file risk accidental overwrite if a later chunk assumes the spec shape rather than the actual file shape. **Mitigation:** plan §2.6's multi-chunk note pins additive non-overlapping edits with distinct commits per chunk; plan §2.6's concurrent-edit guard tells the implementer to re-read the file state at the start of each later chunk rather than relying on spec text. If overlap surfaces unexpectedly, stop and flag.

---

## §5. Decisions log carry-over

Reproduced verbatim from spec §14 so this plan is self-contained against the spec. Duplication is intentional here — these decisions define the build's acceptance envelope.

### §5.1 Q1–Q5 locked at kickoff (user-confirmed, 2026-04-20)

| Q | Decision | Rationale (user-facing one-liner) | Spec location |
|---|----------|-----------------------------------|---------------|
| Q1 | Subscription tier gating (D6) | **Defer to post-pilot.** Pilot's one agency is Operate-tier by default; a tier-check middleware built before a Monitor-tier customer exists is code we'd refactor the minute that customer appears. | spec §14.3 |
| Q2 | Adapter retry strategy | **Retryable: 429, 502, 503, network timeout. Terminal: 401, 403, 404, 422. Other 5xx: retry once then terminal.** Matches industry-standard REST-API retry shape. | spec §2.3 |
| Q3 | Channel fan-out — audit first or build net-new? | **Kickoff audit, ship only missing paths.** Zero-risk; if all three channels work, P8.3 collapses to verification. | spec §7.2 |
| Q4 | Manual replay (`replay_of_action_id`) in Session 2? | **Defer. Pre-document the column but do not wire runtime.** Pilot feedback is the trigger for replay UX. | spec §1.3 + §12.4 |
| Q5 | Drilldown scope | **Minimal: history + outcome badges + signal panel + tier migration + contextual assistant trigger.** Pilot hasn't used drilldown; ship structural surface and iterate. | spec §4.1 |

### §5.2 Scope-expansion decisions (Session 1 carry-forward folded in)

User-confirmed 2026-04-20: all four Session 1 deferred items (D.1–D.4) fold into Session 2 as one PR. Raises effort estimate from the brief's ~2–2.5 weeks to ~4–5 weeks. Trade-off: bigger PR, longer review, but avoids a fragmented Session 2.5 cleanup sprint and unblocks pilot launch with a single merge.

### §5.3 Re-opening locked Session 1 decisions (policy)

Session 2 **does not re-open** any Session 1 §10 decisions. The contracts (a)–(v), the `InterventionEnvelope` type, and the §1.6 invariants are inherited verbatim. If a Session 2 implementation discovery reveals that a Session 1 contract is wrong, surface as "Open question for the user" rather than silently override. The user decides whether to re-open.

---

## §6. Deferred items (post-Session 2)

Reproduced verbatim from spec §14.3 so the main session knows what Session 2 explicitly does NOT ship. Do not silently pull any of these into a Session 2 chunk — if one of them becomes critical mid-session, escalate to the user and re-scope.

1. **D6 full tier-gating runtime** (Q1 above).
2. **Custom intervention-type authoring beyond the 5 primitives.** Operators can edit existing intervention templates; they can't define new `actionType` primitives. Post-pilot decision tied to real usage patterns.
3. **Dedicated `ORG_PERMISSIONS.CONFIG_EDIT` split.** Inherits `AGENTS_EDIT` per Session 1 §4.10 decision.
4. **Runtime `operationalConfigSchema.parse()` on effective-read hot path.** Deferred per Session 1 §4.5 iter-5 finding 5.2 — adding validation to every read is a posture change that needs a repair migration for legacy rows.
5. **Manual replay runtime** (Q4 above). Schema pre-documented; runtime later.
6. **Segmented outcome charts + signal-overlay timeline on drilldown** (Q5 above). Minimal drilldown ships first; richer visualisations post-pilot.
7. **Slack webhook retries.** Ship without retry; if pilot shows Slack flakiness, add retry posture.
8. **Subaccount-scoped outcome aggregation for recommendations.** Spec §5.7 — Session 2 aggregates at org level; per-subaccount aggregation post-pilot if signals noisy.
9. **Picker "show more" affordance** (spec §3.8 Q2). 50-row cap; expand if pilot operators have >50 matches.
10. **JSON editor fallback removal** (spec §8.6). Typed `InterventionTemplatesEditor` ships; JSON fallback stays until pilot validates the typed surface.
11. **Global permission / auth context.** Session 1's `useOnboardingRedirect` fetches `/api/my-permissions` inline alongside `/api/onboarding/status`. `Layout.tsx` already fetches the same permission set for nav-gate decisions. Consolidating the fetch into a single app-level React context (e.g. `PermissionContext`) would eliminate the duplicate network round-trip and give every consumer a uniform `hasPermission(key)` helper. Flagged by the Session 1 third-round review as non-blocking; worth a small follow-up chunk post-pilot rather than mid-Session 2. Not in the current §12.1 chunk list — will shape into a D.5 if the user wants it folded in, otherwise ships as its own small PR after Session 2 merges.
12. **Server-side 15-minute resume-window enforcement.** Session 1 + Session 2 both enforce the resume window on the client (spec contract (k)). A hardened posture would add a server-side guardrail on `GET /api/agents/:id/conversations` that caps `updatedAfter` to a minimum of `now - 15min` regardless of what the client sends, so a modified client can't resume a stale conversation outside the spec window. Low-priority; adds server complexity for a low-risk client-trust attack surface. Revisit if the Configuration Assistant ever holds sensitive state that a stale resume could compromise.

---

## §7. Architect pass self-check

Pre-authoring checklist from `docs/spec-authoring-checklist.md`. For each item, either confirms the spec + this plan pair satisfies the item, or names a specific gap. Honest audit — gaps are flagged even when inconvenient.

- **Primitives-reuse search — SATISFIED.** Spec is explicit about reusing Session 1 primitives: inherited contracts (a)–(v) (spec §1.2), the `InterventionEnvelope` type (spec §1.2), Session 1 shared UI primitives (`OverrideBadge`, `ManuallySetIndicator`, `ResetToDefaultButton`, `differsFromTemplate`, `ProvenanceStrip` — spec §11.2.2), the Session 1 JSON editor kept as fallback (spec §8.6), Phase-4 `mergeFieldResolver` (spec §8.8 Q1), existing `ghlOAuthService.getValidToken` (spec §2.7), existing `emailService.sendTransactional` (spec §7.4), existing `organisationSecrets` for Slack (spec §7.4), existing `canonicalSubaccountScopes` for location-id resolution (spec §3.3). Plan §3 chunks each re-state which primitives they consume; chunk 7's `ArrayEditor` is explicitly built once and reused in chunk 11 rather than re-forked.
- **File-inventory lock — SATISFIED.** Plan §2 is the single flat inventory with chunk attribution for every file in spec §13. Plan §2.8 explicitly states "every file in spec §13 appears above with a chunk attribution; no orphan entries; no file appears only in prose." Plan §2.6 flags multi-chunk files (`ClientPulseSettingsPage.tsx`, `ConfigAssistantPage.tsx`) with additive-edit guards. `ArrayEditor.tsx` attribution reconciled at plan §2.5.
- **Contracts — SATISFIED.** Session 1 contracts (a)–(v) inherited verbatim per spec §1.2; two Session 2 refinements documented in spec §1.3 (retry-classification pure contract; `replay_of_action_id` schema pre-documentation). No new top-level contracts introduced, per the session's "no re-opening Session 1" policy (plan §5.3).
- **RLS / permissions — SATISFIED with caveat.** Every new route names its auth posture: `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` + `resolveSubaccount(subaccountId, orgId)` for picker routes (spec §3.2) and drilldown routes (spec §4.2). Permission key for config edits inherits `AGENTS_EDIT` per spec §14.3 item 3 — deliberate deferral of the `CONFIG_EDIT` split. **Caveat:** plan does not restate the permission key for every chunk individually — relies on spec §3.2 / §4.2's blanket "all new routes use this posture" line. If the main session adds a new route to an existing file (e.g. merge-field-vocabulary endpoint in Chunk 7), the auth posture is the pattern shipped elsewhere in that file. Not a gap but worth noting.
- **Execution model — SATISFIED.** Spec §1.2 inherits (t) internal-first-external-last + (u) four-precondition gate + (v) PG advisory lock. Plan §3.1 (Chunk 2) pins the four preconditions into the execution-engine rewrite; plan §3.4 (Chunk 5) re-uses the same gate for fan-out; plan §3.12 (Chunk 13) preserves the advisory-lock posture during the `recordHistory` refactor (note in open-questions). No execution-model drift.
- **Phase sequencing — SATISFIED.** Plan §3 orders 13 chunks per spec §12.1's serialised dependency chain; each chunk's "Dependency + ordering note" pulls from the spec's dependency column. Review gates at Chunks 4 / 9 / 13 per spec §12.2. Plan §3.3 (Chunk 4) and §3.8 (Chunk 9) and §3.12 (Chunk 13) each flag their review-gate boundary.
- **Deferred items — SATISFIED.** Plan §6 reproduces spec §14.3 verbatim (12 items). Each chunk's open-questions section names the specific deferrals that could be tempting mid-chunk (e.g. drilldown scope creep in plan §3.3 points at spec §14.3 item 6; picker "show more" in plan §3.2 points at spec §14.3 item 9).
- **Self-consistency — SATISFIED with one watchpoint.** Plan does not introduce contradictions with spec. The only spot worth flagging: spec §8.4 text says "per-template save POSTs to `/api/organisation/config/apply`" which matches Session 1 §6.3 wholesale-replace semantics; plan §3.6 (Chunk 7) re-states this. If a reviewer challenges the wholesale-replace posture (a per-template POST could look more granular but would break the Session 1 atomicity contract), that's not a drift — it's Session 1 semantics held firm.
- **Testing posture — SATISFIED.** Plan names every test file per chunk (server pure tests named in §2.4; integration tests in §2.4; client-side pure tests absent per Session 1 convention — exhaustiveness checks are the gate per spec §6.4 + §8.5). Plan §3 per-chunk "Verification plan" names the sanity gates + any chunk-specific smoke. Manual-smoke-backed ship gates (S2-6.2, S2-6.3, S2-8.2, S2-8.3, S2-8.5, S2-8.6, S2-D.2, S2-D.3) are marked as such rather than silently expecting pure tests; pure-test-backed gates (S2-6.1, S2-8.1, S2-8.4, S2-D.1, S2-D.4) each have a named pure or integration test file. No gap.

**No blocking gaps surfaced.** The two watchpoints (permission-key-per-chunk not restated; wholesale-replace posture on template edits) are inherited-from-Session-1 patterns, not drifts — flagged for reviewer awareness only.

---

## §8. Chunk 1 meta note

This plan IS Chunk 1's output. The architect pass produced §§0–8 above as the build contract for Chunks 2–14 per spec §12.1. No code was written in Chunk 1 — the architect role does not build.

**Next action:** Chunk 2 kickoff. The main session starts B.1 by running the two kickoff audits from plan §3.1 — migration-number base (expected `0185`; confirm by grepping `migrations/*.sql` for the highest number) and `ghlOAuthService.getValidToken(orgId)` existence with refresh-on-expire semantics — then begins the B.1 implementation order (schema + migration pair → pure classifier → endpoint mappings → adapter rewrite → precondition gate → `limits.ts` constant → integration test).

Optional: per CLAUDE.md, user may request a `spec-reviewer` pass on this plan before Chunk 2 kickoff. Only if user explicitly asks and Codex CLI is local; do not auto-invoke. Session 2 spec already hit the 5/5 lifetime spec-review cap, so this plan document is the only reviewable artefact left for that pipeline.

---
