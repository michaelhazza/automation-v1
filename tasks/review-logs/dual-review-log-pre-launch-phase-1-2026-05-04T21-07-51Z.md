# Dual Review Log — pre-launch-phase-1

**Files reviewed:** Branch diff `main..claude/pre-launch-phase-1` (48 files, +2304/-171). Focus on Chunk-3 onboarding queue (`server/jobs/ghlAutoStartOnboardingJob.ts`, `server/services/queueService.ts`, `server/services/subaccountOnboardingService.ts`, `server/services/ghlAgencyOauthService.ts`), Chunk-2 OAuth popup (`client/src/hooks/useOAuthPopup.ts`, `server/routes/oauthIntegrations.ts`), Chunk-2 auth rate limits (`server/routes/auth.ts`).
**Iterations run:** 3/3
**Timestamp:** 2026-05-04T21:07:51Z

---

## Iteration 1

Codex flagged three findings against the branch diff.

[ACCEPT] **server/services/queueService.ts:1324 — [P1] Run GHL onboarding jobs with tenant/admin DB context**
  Reason: Real bug. The `ghl:auto-start-onboarding` worker registered with `resolveOrgContext: () => null` opts out of the default org-scoped tx that sets `app.organisation_id`. Inside, `subaccountOnboardingService` queries `org_subscriptions`, `subaccounts`, `workflow_runs`, `modules`, `workflow_templates`, `system_workflow_templates` via the **module-level `db`** — fresh pool connections with no GUC set. All those tables are `FORCE ROW LEVEL SECURITY` (verified in `migrations/0245_all_tenant_tables_rls.sql`). With no `app.organisation_id`, the policy `USING (current_setting('app.organisation_id', true) IS NOT NULL ...)` is false, so every read returns zero rows. The worker silently always sees "no owed slugs", auto-start never fires. The job's docstring (and a comment in `ghlAgencyOauthService.ts`) claimed the worker had "a proper admin connection that can bypass RLS" — that was never true as implemented. Architecture rule (`architecture.md:1592`): `getOrgScopedDb()` is the first line of defence; using module-level `db` from a service is the exact bug pattern the architecture warns about.

  Fix applied:
  - Removed `resolveOrgContext: () => null` from `queueService.ts` so the default reads `organisationId` from the payload and opens an org-scoped tx with the GUC set.
  - Refactored `server/services/subaccountOnboardingService.ts` to use `getOrgScopedDb('subaccountOnboardingService.<method>')` at every query site (11 sites across `resolveOwedSlugsForOrg`, `listOwedOnboardingWorkflows`, `startOwedOnboardingWorkflow`, `templateAutoStartsOnOnboarding`).
  - Updated stale docstrings in `server/jobs/ghlAutoStartOnboardingJob.ts` and `server/services/ghlAgencyOauthService.ts` that claimed the worker bypassed RLS via an admin connection.

[REJECT] **server/routes/auth.ts:51 — [P2] Preserve login brute-force throttling window**
  Reason: The 60-second window is the explicit value mandated by the build spec (`tasks/builds/pre-launch-hardening/plan.md` Task 2.2 / S-P0-5: "compound key (IP + email) prevents both distributed-IP and credential-stuffing abuse" with `10, 60`). The PR-fix commit `1162c14e` corrected to spec. Codex's security observation is legitimate (10/60s allows ~14400/day vs the prior 10/900s ~960/day at the same limit), but contradicting an explicit spec value mid-review-loop would undermine the spec-as-source-of-truth pattern and the `pr-reviewer` decision that already accepted this. Codex's suggested mitigation (dual-bucket design — short-window for UX + long-window for credential stuffing) is sound and warrants a security spec revision, not a unilateral fix. Routed to `tasks/todo.md` § *Deferred from dual-reviewer — pre-launch-phase-1*.

[ACCEPT] **client/src/hooks/useOAuthPopup.ts:8 / server/routes/oauthIntegrations.ts:294 — [P2] Send OAuth popup messages to the app origin**
  Reason: Real bug. The branch added `VITE_API_ORIGIN` to the receiver-side allowlist (correct, per spec S-P0-7), but the callback HTML at `server/routes/oauthIntegrations.ts:294` calls `window.opener.postMessage({type:'oauth_success'}, window.location.origin)`. In a split-origin deployment (`api.example.com` serves the callback HTML; `app.example.com` is the popup opener), `window.location.origin` is the API origin but the opener is the app origin — the browser drops `postMessage` when `targetOrigin ≠ opener origin`. The success notification never reaches the popup parent, popup never auto-closes, the OAuth completion is never observed by the app. Spec did not call out the sender side, so this is a fix the spec missed.

  Fix applied: parse `env.APP_BASE_URL` via `new URL(...).origin` to derive a clean origin, embed via `JSON.stringify` in the inline script, fall back to `window.location.origin` only when `APP_BASE_URL` is malformed (preserves pre-fix same-origin behaviour as a safety net).

## Iteration 2

[ACCEPT] **server/services/subaccountOnboardingService.ts:55 — [P1] Preserve a live transaction for fire-and-forget onboarding**
  Reason: Real regression introduced by iteration 1's fix. After moving `subaccountOnboardingService` to `getOrgScopedDb()`, the captured tx becomes the request tx. The route `server/routes/subaccounts.ts:122` calls `autoStartOwedOnboardingWorkflows(...)` as a fire-and-forget `.then()` chain, then returns the response. Auth middleware closes the tx on `res.finish`. Awaited continuations inside the service then run against a closed tx, throwing `MissingOrgContext` or hitting the closed connection. The route's `.catch()` swallows the failure silently and auto-start no-ops on UI-driven subaccount creation — same end state as the iteration-1 bug, different mechanism. Codex's suggested fix is correct: enqueue this path via pg-boss instead of fire-and-forget.

  Fix applied: replaced the fire-and-forget direct service call in `server/routes/subaccounts.ts` with `enqueueGhlOnboarding({ organisationId, subaccountId, startedByUserId: req.user.id })`. The job runs in its own org-scoped tx with a fresh, alive connection. Removed the now-unused `subaccountOnboardingService` import from the route.

## Iteration 3

[ACCEPT] **server/routes/subaccounts.ts:127-130 — [P2] Preserve the creating user for queued onboarding**
  Reason: Real bug exposed by iteration 2's enqueue change. The worker hardcoded `startedByUserId: 'system'`, but `workflow_runs.started_by_user_id` is a nullable UUID FK and `'system'` is not a valid UUID — Postgres `invalid_input_syntax_for_type_uuid` aborts the run. Pre-existing in this branch (the webhook trigger path also has this bug because it never had a user id), but iteration 2's change made the regression more visible by routing UI-authenticated subaccount creation through the same broken worker. Codex's fix is correct: thread the user id through the payload, default to null for unauthenticated trigger paths.

  Fix applied:
  - Extended `GhlAutoStartOnboardingPayload` with optional `startedByUserId?: string | null`.
  - Worker reads it from the payload; passes `?? null` to the service.
  - Service signatures (`startOwedOnboardingWorkflow`, `autoStartOwedOnboardingWorkflows`) widened to `string | null`. `startInput.startedByUserId` and `taskService.createTask`'s userId arg use `?? undefined` to satisfy their `string | undefined` types while letting the DB column accept null.
  - `server/routes/subaccounts.ts` now passes `req.user.id` in the enqueue payload.

---

## Changes Made

- `server/services/queueService.ts` — Removed `resolveOrgContext: () => null` from `ghl:auto-start-onboarding` worker registration; updated comment.
- `server/services/subaccountOnboardingService.ts` — Migrated all 11 query sites from module-level `db` to `getOrgScopedDb('subaccountOnboardingService.<method>')`; widened `startedByUserId` to `string | null`; pass `?? undefined` where downstream signatures require `string | undefined`.
- `server/jobs/ghlAutoStartOnboardingJob.ts` — Added optional `startedByUserId` to payload; worker reads it from payload and passes `?? null` to the service; updated docstring.
- `server/services/ghlAgencyOauthService.ts` — Updated stale comment that claimed the worker uses module-level `db` (it now uses an org-scoped tx).
- `server/routes/subaccounts.ts` — Replaced fire-and-forget direct service call with `enqueueGhlOnboarding`; removed dead import; threads `req.user.id` into the payload as `startedByUserId`.
- `server/routes/oauthIntegrations.ts` — `postMessage` target origin now derives from `env.APP_BASE_URL` via `new URL(...).origin`, with same-origin fallback if `APP_BASE_URL` is malformed.
- `tasks/todo.md` — Appended deferred items from this review (login rate-limit dual-bucket consideration; pre-existing `taskService` module-level db usage).

## Rejected Recommendations

- **Codex iteration 1, finding 2: Login throttle window (10/60s vs prior 10/900s).** Routed to `tasks/todo.md`. Rationale: the value is spec-mandated (S-P0-5); modifying it without spec revision would contradict spec authority. Codex's dual-bucket suggestion is sound and warrants a follow-up security spec, not a unilateral dual-reviewer fix.

---

**Verdict:** APPROVED (3 iterations, 4 fixes accepted across 3 findings; 1 finding rejected with deferred routing)
