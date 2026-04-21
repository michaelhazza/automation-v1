# Dual Review Log — clientpulse-session-1

**Files reviewed:** see sections below
**Iterations run:** 3/3
**Timestamp:** 2026-04-20T05:00:00Z

---

## Iteration 1

**Files reviewed:**
- `client/src/hooks/useConfigAssistantPopup.tsx`
- `client/src/pages/OnboardingCelebrationPage.tsx`
- `client/src/pages/ClientPulseSettingsPage.tsx`
- `server/services/systemTemplateService.ts`
- `server/services/skillExecutor.ts`
- `server/services/configHistoryService.ts`

[ACCEPT] `client/src/hooks/useConfigAssistantPopup.tsx` — iframe recursion via deep-link effect
  Reason: Real P1 bug. The iframe src includes `?config-assistant=open&popup=1`, so without a guard the embedded app triggers the same `useEffect` and opens a nested popup indefinitely.
  Fix: add `if (params.get('popup') === '1') return;` before the `config-assistant` check.

[ACCEPT] `client/src/pages/OnboardingCelebrationPage.tsx` — onboarding completion API never called
  Reason: Real P1 bug. Without calling `POST /api/onboarding/complete`, `onboarding_completed_at` stays NULL, `needsOnboarding` stays `true`, and users are permanently redirected back to the wizard.
  Fix: call the endpoint in a `useEffect` on mount.

[REJECT] `client/src/pages/OnboardingWizardPage.tsx` — prompt seeding for direct-URL navigation
  Reason: The spec only seeds a prompt when a user follows a deep-link from the config assistant. Direct navigation to `/onboarding` has no prompt context; pre-seeding would fabricate a prompt that no user action produced. Intentional design.
## Iteration 2

[ACCEPT] `server/services/systemTemplateService.ts` — `applied_system_template_id` FK not set on adoption
  Reason: Real P1 gap. Migration 0181 only backfills existing rows; `loadToOrg()` must write the FK for new adoptions. Without it, `orgConfigService.getOperationalConfig` reads `systemDefaults = {}` and all template defaults are silently dropped for newly adopted orgs.
  Fix: add `db.update(organisations).set({ appliedSystemTemplateId: template.id }).where(...)` after the upsert in `loadToOrg()`.

[ACCEPT] `client/src/pages/ClientPulseSettingsPage.tsx` — silent success on `errorCode` 200 response
  Reason: Real P2 bug. Server returns HTTP 200 with `{ committed: false, errorCode }` for schema/sum-constraint rejections. Original code called `setEditing(false)` unconditionally, closing the editor with no feedback to the operator.
  Fix: check `errorCode`, keep editor open, show toast error.

[REJECT] `client/src/pages/OnboardingCelebrationPage.tsx` — direct-URL access bypasses wizard state
  Reason: Acceptable edge case. No UI path leads to `/onboarding/ready` without completing Step 3. Server-side can enforce guards if needed. Not worth adding a redirect-back gate that would break session-restore navigation.

[REJECT] `client/src/hooks/useConfigAssistantPopup.tsx` — prompt seeding repeat
  Reason: Same as Iteration 1 — intentional design, no prompt context exists for direct navigation.
## Iteration 3

[ACCEPT] `server/services/skillExecutor.ts` — worker dispatch missing legacy alias resolution
  Reason: Real P1 issue. `resolveActionSlug` already exists in `actionRegistry.ts` for exactly this purpose but was not called on the inbound worker `action_type`. Any config review actions queued before the `config_update_hierarchy_template` rename would be permanently silently dropped.
  Fix: call `resolveActionSlug(actionType)` and use the result in the dispatch switch.

[ACCEPT] `server/services/configHistoryService.ts` — union query entity-ID filter drops legacy rows
  Reason: Real P2 correctness bug. Legacy `clientpulse_operational_config` rows store `entityId = hierarchy_templates.id` (a template UUID), not the org ID. Filtering by `eq(configHistory.entityId, orgId)` silently excludes all legacy rows from the union result.
  Fix: for the union query path, set `entityIdCondition = undefined` so only `organisationId` scoping is applied.

[REJECT] `client/src/pages/OnboardingWizardPage.tsx` — missing `org_admin` permission gate
  Reason: Intentional design. The onboarding wizard is shown to all authenticated org members when `needsOnboarding: true`. An `org_admin` gate would break onboarding for staff accounts. The server-side endpoint enforces the permission on the write path.

[REJECT] `client/src/pages/ClientPulseSettingsPage.tsx` — ProvenanceStrip block-vs-leaf count
  Reason: Session 1 intentionally counts blocks (10 top-level config keys), not leaves. Per-leaf counting requires a recursive diff walk deferred to Session 2. Pre-existing design decision not introduced by this change.
## Changes Made

1. `client/src/hooks/useConfigAssistantPopup.tsx` — added `popup=1` guard in deep-link `useEffect` to prevent iframe recursion.
2. `client/src/pages/OnboardingCelebrationPage.tsx` — added `POST /api/onboarding/complete` call on mount; wrapped CTA navigation in `useCallback`.
3. `server/services/systemTemplateService.ts` — added `organisations.appliedSystemTemplateId` write after template adoption in `loadToOrg()`.
4. `client/src/pages/ClientPulseSettingsPage.tsx` — split save response into `committed` / `requiresApproval` / `errorCode` branches to prevent silent failure on schema/constraint violations.
5. `server/services/skillExecutor.ts` — added `resolveActionSlug` normalization before worker dispatch switch to handle legacy action slugs.
6. `server/services/configHistoryService.ts` — set `entityIdCondition = undefined` for the union query case so legacy config history rows are not silently excluded.
## Rejected Recommendations

1. **Prompt pre-seeding for direct-URL onboarding navigation** (Iterations 1 and 2) — intentional design; no prompt context exists when navigating directly to `/onboarding`.
2. **Direct-URL access to `/onboarding/ready` bypasses wizard state** (Iteration 2) — acceptable edge case; no UI path leads there without completing Step 3; server can enforce if needed.
3. **Onboarding wizard `org_admin` permission gate** (Iteration 3) — intentional; all authenticated org members see onboarding when `needsOnboarding: true`; write-side enforces the permission.
4. **ProvenanceStrip leaf-vs-block count** (Iteration 3) — intentional Session 1 design; per-leaf counting deferred to Session 2 per spec.

---

**Verdict:** `PR ready. All critical and important issues resolved.` Six P1/P2 bugs identified and fixed across three iterations: iframe popup recursion, onboarding completion never persisted, settings page silent validation failure, system template FK not written on adoption, worker dispatch missing alias resolution, and config history union query dropping legacy rows. All four rejected recommendations are intentional design decisions or explicitly deferred Session 2 work — none affect correctness in the Session 1 scope.
