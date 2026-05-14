# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`
**Spec commit at check:** `40c9d4fb` (HEAD)
**Branch:** `feat/agents-are-employees`
**Base:** `b1e5d29d` (merge-base with main)
**Scope:** Phases A, B, C only (per caller — Phases D and E NOT yet implemented)
**Changed-code set:** ~140 code files (server schema/services/routes/adapters, client pages/components, shared types, migrations, scripts)
**Run at:** 2026-04-29T11:58:52Z
**Commit at finish:** `5a2b4e4c`

---

## Summary

- Requirements extracted: 71 (in-scope subcomponents across Phases A–C)
- PASS: 53
- MECHANICAL_GAP → fixed: 0
- DIRECTIONAL_GAP → deferred: 18
- AMBIGUOUS → deferred: 0
- OUT_OF_SCOPE → skipped: 10 (Phase D + Phase E subcomponents)

> No mechanical gaps surfaced where I was 100% confident the fix was surgical and design-free. Every gap detected either requires a design decision (rate-limit cap shapes, signature-template lookup, identity-tab deep-link wiring), spans multiple files in a way that touches the multi-tenant safety contract (`db` direct imports vs `withOrgTx`), or sits in a UI flow that depends on operator workflow choices (CTA gating, `?newlyOnboarded=1` navigation). Per `spec-conformance` Step 3 fail-closed posture, all routed DIRECTIONAL.

**Verdict:** **NON_CONFORMANT** (18 directional gaps must be addressed by the main session before `pr-reviewer`. Severity span: data-loss potential at D4 and D7/D8, multi-tenant safety at D1–D3, observability/CI at D6/D15/D18, UX-flow polish at D9/D10, missing audit events at D13.)

---

## Requirements extracted (full checklist)

See "Sections" below for the per-phase verdict tables. The breakdown:

- Phase A: 30 subcomponents (schema, manifest, FKs, system-agent rename, permissions, seeds, gates, shared types, seat derivation)
- Phase B: 33 subcomponents (adapter contract, native adapter, services, pipeline, routes, frontend components, modal, identity tab, env vars, iCal builder, rate-limit wrapper)
- Phase C: 4 subcomponents (Google adapter, contract test suite, mock fixtures, env vars)

Phase D and Phase E subcomponents listed at the bottom under OUT_OF_SCOPE.

---

## Phase A verdicts (schema, manifest, permissions, system-agent rename)

| REQ | Subcomponent | Spec ref | Verdict | Evidence |
|---|---|---|---|---|
| A1 | `workspace_actors` table — columns, types, defaults | §6.1 | PASS | `migrations/0254_workspace_canonical_layer.sql:38-49`; `server/db/schema/workspaceActors.ts` |
| A2 | `workspace_identities` table | §6.2 | PASS | `migrations/0254_workspace_canonical_layer.sql:76-96`; `server/db/schema/workspaceIdentities.ts` |
| A3 | `workspace_messages` table | §6.3 | PASS | `migrations/0254_workspace_canonical_layer.sql:162-184`; `server/db/schema/workspaceMessages.ts` |
| A4 | `workspace_calendar_events` table | §6.4 | PASS | `migrations/0254_workspace_canonical_layer.sql:202-218`; `server/db/schema/workspaceCalendarEvents.ts` |
| A5 | `workspace_identity_status` enum | §6.2 | PASS | `migrations/0254_workspace_canonical_layer.sql:15-16` |
| A6 | `connector_configs` partial-unique index split (CRM-scoped + workspace-scoped) | plan §A4 step 3 | PASS | `migrations/0254_workspace_canonical_layer.sql:24-34` |
| A7 | RLS `_org_isolation` policies on all 4 canonical tables | §6.5 | PASS | `migrations/0254_workspace_canonical_layer.sql:229-287` (canonical 0245 template applied) |
| A8 | `RLS_PROTECTED_TABLES` manifest entries (4) | §5 / §10.2 | PASS | `server/config/rlsProtectedTables.ts:844-866` |
| A9 | `workspace_actors_parent_same_subaccount` trigger | §6.1 | PASS | `migrations/0254_workspace_canonical_layer.sql:56-72` |
| A10 | `workspace_identities_actor_same_subaccount` trigger | §6.2 | PASS | `migrations/0254_workspace_canonical_layer.sql:123-138` |
| A11 | `workspace_identities_backend_matches_config` trigger | §6.2 | PASS | `migrations/0254_workspace_canonical_layer.sql:141-158` |
| A12 | `workspace_identities_actor_backend_active_uniq` partial-unique | §6.2 | PASS | `migrations/0254_workspace_canonical_layer.sql:99-101` |
| A13 | `workspace_identities_provisioning_request_uniq` | §6.2 | PASS | `migrations/0254_workspace_canonical_layer.sql:103-105` |
| A14 | `workspace_identities_email_per_config_uniq` | §6.2 | PASS | `migrations/0254_workspace_canonical_layer.sql:108-110` |
| A15 | `workspace_identities_migration_request_actor_uniq` | §6.2 | PASS | `migrations/0254_workspace_canonical_layer.sql:118-120` |
| A16 | `workspace_messages_external_uniq` | §6.3 | PASS | `migrations/0254_workspace_canonical_layer.sql:192-194` |
| A17 | `workspace_messages_dedupe_uniq` | §6.3 | PASS | `migrations/0254_workspace_canonical_layer.sql:196-198` |
| A18 | `workspace_calendar_events_external_uniq` | §6.4 | PASS | `migrations/0254_workspace_canonical_layer.sql:223-225` |
| A19 | `agents.workspace_actor_id` FK | §5 | PASS | `server/db/schema/agents.ts:69`; `migrations/0255_workspace_actor_fks_and_hierarchy.sql:10` |
| A20 | `users.workspace_actor_id` FK | §5 | PASS | `server/db/schema/users.ts:29`; `migrations/0255:11` |
| A21 | `agent_runs.actor_id` FK | §5 | PASS | `server/db/schema/agentRuns.ts:234`; `migrations/0255:12` |
| A22 | `audit_events.workspace_actor_id` FK | §5 | PASS-with-deviation | `server/db/schema/auditEvents.ts:23`; `migrations/0255:13`. Spec §5 wrote `actor_id`; the existing polymorphic `actor_id` column on `audit_events` cannot be repurposed. New column named `workspace_actor_id` per progress.md "Decisions / deviations". |
| A23 | `connector_configs.connector_type` enum widened to include `'synthetos_native' \| 'google_workspace'` | §5 | PASS | `server/db/schema/connectorConfigs.ts:12` |
| A24 | System-agent rename to human names + roles | §2 / §15 | PASS | `migrations/0256_system_agents_human_names.sql` (Sarah, Johnny, Helena, Patel, Riley, Dana with Specialist/Worker roles) |
| A25 | `server/config/c.ts` mirrors system-agent registry | §17 Q-§5 | PASS | `server/config/c.ts:25-43` |
| A26 | 7 permission keys seeded | §10.1 | PASS-with-deviation | `migrations/0257_workspace_permissions.sql`; `server/lib/permissions.ts:162-168`. Keys use dot-namespace (`subaccount.agents.onboard`) instead of spec's example colon-form (`agents:onboard`); existing convention enforced — see D16. |
| A27 | `scripts/seed-workspace-actors.ts` (backfill) | §6.6 | PASS | follows §6.6 step ordering; idempotent guards |
| A28 | `scripts/verify-workspace-actor-coverage.ts` (CI gate) | §5 / §15 | PASS-with-deviation | gate exists; CI workflow wiring deferred per progress.md (see D15) |
| A29 | `shared/types/workspace.ts` types + `deriveActorState` pure fn | §5 / §6.1 | PASS | `shared/types/workspace.ts:86-92` |
| A30 | `shared/billing/seatDerivation.ts` `deriveSeatConsumption` + `countActiveIdentities` | §10.6 | PASS | `shared/billing/seatDerivation.ts`; tsx test passes per progress.md exit checks |


---

## Phase B verdicts (native adapter + canonical pipeline + onboard flow)

| REQ | Subcomponent | Spec ref | Verdict | Evidence |
|---|---|---|---|---|
| B1 | `WorkspaceAdapter` TS interface (server side) | §7 | PASS | `server/adapters/workspace/workspaceAdapterContract.ts` re-exports `shared/types/workspaceAdapterContract.ts` |
| B2 | Shared `workspaceAdapterContract.ts` (interface mirror) | §5 / §7 | PASS | `shared/types/workspaceAdapterContract.ts:79-91` |
| B3 | New `FailureReason` values | §7 | PASS | `shared/iee/failureReason.ts:49-57` — all 5 spec values + `parent_actor_cycle_detected` from §6.1 + bonus `workspace_mirror_write_failed` |
| B4 | `nativeWorkspaceAdapter` implements contract | §7 | PASS | `server/adapters/workspace/nativeWorkspaceAdapter.ts` — every method present, `backend: 'synthetos_native'` |
| B5 | `workspaceActorService` (CRUD + setParent + cycle detection) | §6.1 / §5 | PASS | `server/services/workspace/workspaceActorService.ts` — depth-cap of 20 matches plan §B2 |
| B6 | `workspaceIdentityServicePure` state machine | §14.6 | PASS | `server/services/workspace/workspaceIdentityServicePure.ts` — VALID_TRANSITIONS map matches §14.6; tsx test passes |
| B7 | `workspaceIdentityService.transition` (state-based, race-safe) | §9.2 / §14.1 / §14.3 | PASS | `server/services/workspace/workspaceIdentityService.ts:47-69` — predicate `WHERE status = current.status`, `noOpDueToRace` on 0-row update |
| B8 | `workspaceEmailPipelinePure` (computeDedupeKey, applySignature, resolveThreadId) | §8.1 step 4 / §8.2 step 2 / §8.2 step 3 | PASS | `server/services/workspace/workspaceEmailPipelinePure.ts`; tsx test exists |
| B9 | `workspaceEmailPipeline.send` + `.ingest` | §8.1 / §8.2 / §12 SendEmailParams | PASS-with-deviations | `server/services/workspace/workspaceEmailPipeline.ts` — see D1 (no `withOrgTx`), D18 (rateLimitKey null) |
| B10 | `workspaceOnboardingService.onboard` (idempotent) | §9.1 | PASS-with-deviation | `server/services/workspace/workspaceOnboardingService.ts` — see D13 (missing `identity.provisioned` audit event) |
| B11 | `server/routes/workspace.ts` (configure/onboard/migrate/lifecycle/email-toggle/identity) | §5 | PASS-with-deviations | route file present; `/migrate` returns 501 (Phase E OUT_OF_SCOPE — acceptable); see D2 (db direct), D14 (revoke confirmName source) |
| B12 | `server/routes/workspaceMail.ts` | §5 | PASS-with-deviation | mailbox / send / threads endpoints present; see D2 |
| B13 | `server/routes/workspaceCalendar.ts` | §5 | PASS-with-deviation | calendar / events / respond endpoints present; calls adapter directly (no calendar pipeline; spec doesn't require one); see D2 |
| B14 | `server/routes/workspaceInboundWebhook.ts` (POST `/api/workspace/native/inbound`) | §8.2 | PASS | HMAC-SHA256 verification against `NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET`; postmark+sendgrid normalisation; pipes into `pipeline.ingest` |
| B15 | `server/index.ts` mounts the four route files | §5 (Routes modified) | PASS | `server/index.ts:166-169 + 372-375` |
| B16 | `OnboardAgentModal` (3-step modal) | §5 mockups 4–7 | PASS-with-deviation | identity / confirm / progress + success/error states; see D9 (no `?newlyOnboarded=1`) |
| B17 | `SuspendIdentityDialog` (mockup 12) | §5 | PASS | `client/src/components/workspace/SuspendIdentityDialog.tsx` |
| B18 | `RevokeIdentityDialog` (mockup 13 — type-the-name gate) | §5 | PASS | `client/src/components/workspace/RevokeIdentityDialog.tsx:9` (`canRevoke = confirmName === agentName`) |
| B19 | `IdentityCard` (mockup 09) | §5 | PASS | `client/src/components/workspace/IdentityCard.tsx` — lifecycle bar + email + send-mail toggle + state-conditional CTAs |
| B20 | `LifecycleProgress` inline bar | §5 | PASS | `client/src/components/workspace/LifecycleProgress.tsx` |
| B21 | `SeatsPanel` (Workspace tab) | §10.6 | PASS | `client/src/components/workspace/SeatsPanel.tsx` |
| B22 | `EmailSendingToggle` | §5 | PASS | `client/src/components/workspace/EmailSendingToggle.tsx` |
| B23 | `WorkspaceTabContent` (subaccount Workspace tab body) | plan File Map | PASS | `client/src/components/workspace/WorkspaceTabContent.tsx`; mounted in `AdminSubaccountDetailPage:543-544` |
| B24 | `SubaccountAgentsPage` per-row "Onboard to workplace" CTA | §2 | PASS-with-deviation | CTA present at `client/src/pages/SubaccountAgentsPage.tsx:456-461`; see D10 (not gated on already-onboarded) |
| B25 | `SubaccountAgentEditPage` 'identity' tab added | §5 | PASS | `client/src/pages/SubaccountAgentEditPage.tsx:59,213-219` (activity tab is Phase D, OUT_OF_SCOPE) |
| B26 | `client/src/lib/api.ts` typed wrappers (12 endpoints) | §5 | PASS | `client/src/lib/api.ts:46-91` |
| B27 | `AgentMailboxPage.tsx` (mockup 10) | §5 | PASS-with-deviation | page exists; see D7 (Message field-name mismatch with route response) |
| B28 | `AgentCalendarPage.tsx` (mockup 11) | §5 | PASS-with-deviation | page exists; see D8 (CalendarEvent field-name mismatch) |
| B29 | `transactionalEmailProvider.ts` (resend/sendgrid/smtp) | plan §B7 | PASS-with-deviation | provider routing OK; see D4 (attachments dropped) |
| B30 | `workspaceEmailRateLimit.defaultRateLimitCheck` (per-identity + per-org) | §8.1 amended | PASS-with-deviation | identity + org bucket calls; see D5 (only single 1-hour window) |
| B31 | `verify-pipeline-only-outbound.ts` CI gate | §7 mirroring invariant | PASS-with-deviation | gate exists; see D6 (allow-list missing test fixture path) |
| B32 | `server/lib/env.ts` new env vars | §5 (Configuration) | PASS-with-deviation | `NATIVE_EMAIL_DOMAIN`, `NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET`, `GOOGLE_WORKSPACE_*` present; see D-note (NATIVE_EMAIL_PROVIDER + NATIVE_EMAIL_PROVIDER_API_KEY missing — provider is selected via existing `EMAIL_PROVIDER` instead; reasonable but undocumented in progress.md) |
| B33 | `server/lib/iCalBuilder.ts` (RFC 5546 invite + reply) | §8.3 | PASS | `server/lib/iCalBuilder.ts` exports `buildICalEvent` + `buildICalReply` |


---

## Phase C verdicts (Google adapter)

| REQ | Subcomponent | Spec ref | Verdict | Evidence |
|---|---|---|---|---|
| C1 | `googleWorkspaceAdapter` (Admin SDK + Gmail + Calendar via service-account delegation) | §7 / §15 Phase C | PASS | `server/adapters/workspace/googleWorkspaceAdapter.ts` — all 9 contract methods; ADMIN/GMAIL/CALENDAR scopes declared; idempotent `provisionIdentity` via `provisioningRequestId`; `revokeIdentity` defaults to `users.update {suspended:true}` per §9.4 |
| C2 | `canonicalAdapterContract.test.ts` — both adapters under same scenarios | §7 / §15 Phase C | PASS-with-deviation | `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts` — 8 scenarios run against `mockNativeAdapter` + `mockGoogleAdapter`; see D17 (BASE_PROVISION uses `signature: null` though contract types `signature: string`) |
| C3 | Mock fixtures — `mockNativeAdapter.ts` + `mockGoogleApi.ts` | plan §C | PASS | both files present and used by the contract test; in-memory Maps mirror adapter behaviour |
| C4 | `.env.example` adds Google Workspace env vars | plan §C | PASS | `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON` + `GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER` declared in `server/lib/env.ts:167-169` |


---

## OUT_OF_SCOPE — Phase D + E (not verified)

Per caller invocation: "What's been implemented (Phases A–C only — Phases D and E are NOT yet built)." Verification did not extract requirements from §15 Phase D or Phase E.

| Phase | Subcomponent | Status |
|---|---|---|
| D | `OrgChartPage` extension to render humans + agents via `parent_actor_id` | skipped — not yet implemented |
| D | `ActivityPage` extension (actor filter, new event types) | skipped |
| D | `ActivityFeedTable` shared component | skipped — not yet present in repo |
| D | `AgentActivityTab` inside `SubaccountAgentEditPage` | skipped — only 'identity' tab present |
| D | `'activity'` tab in `SubaccountAgentEditPage.Tab` union | skipped |
| D | `activityService` extension for new event types + `actorId` filter | skipped |
| D | Seat-rollup job extension to call `deriveSeatConsumption` | skipped |
| D | Un-redirect `/admin/subaccounts/:subaccountId/activity` SPA route | skipped |
| E | `workspaceMigrationService` + per-identity migration job | skipped — `/migrate` endpoint stubbed at 501 |
| E | `MigrateWorkspaceModal` frontend (mockup 16) | skipped — file not present in `client/src/components/workspace/` |


---

## Mechanical fixes applied

None. No findings cleared the fail-closed bar for in-session auto-fix.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

Each entry below also lives under `tasks/todo.md` § *Deferred from spec-conformance review — agent-as-employee (2026-04-29)*.

### D1 — `workspaceEmailPipeline.send` does not use `withOrgTx`; raw `db` import bypasses RLS session-var

- **Spec:** §10.5 (multi-tenant safety checklist) ticks "Service layer uses `withOrgTx` for tenant work"; §10.2 establishes org-isolation RLS on canonical workspace tables.
- **Plan:** Task B6 step 1 explicitly shows `withOrgTx(orgId, async (db) => { ... })`.
- **Evidence:** `server/services/workspace/workspaceEmailPipeline.ts:1` imports `db` directly; reads/writes `workspace_identities`, `workspace_actors`, `workspace_messages`, `audit_events` outside any `withOrgTx`.
- **Impact:** RLS will fail-closed when run under non-bypass roles. Currently passes only because dev runs as a superuser with `BYPASSRLS`. Multi-tenant safety contract relies on the session-var being set inside `withOrgTx`.
- **Suggested approach:** Wrap each TX (audit anchor, mirror write, ingest) in its own `withOrgTx`. The audit-anchor / mirror split (TX1 / TX2 from plan invariant #1) maps cleanly to two `withOrgTx` calls.

### D2 — Routes import `db` directly (workspace.ts, workspaceMail.ts, workspaceCalendar.ts, workspaceInboundWebhook.ts)

- **Spec:** §10.5; `DEVELOPMENT_GUIDELINES.md` §2 ("Routes and `server/lib/**` never import `db` directly — call a service.")
- **Evidence:** all four route files import `db` and run agent/identity/subaccount lookups inline (`workspace.ts:5,21-24,45-54,287-290`; `workspaceMail.ts:6,22-38,49-57,176-185`; `workspaceCalendar.ts:5,17-31,43-51`; `workspaceInboundWebhook.ts:24,170-174`).
- **Impact:** same as D1, plus violates the architectural-contract gate (`scripts/verify-rls-contract-compliance.sh`).
- **Suggested approach:** introduce thin lookup helpers in `workspaceActorService` / `workspaceIdentityService` (e.g. `resolveAgentActiveIdentity(agentId, orgId)`). Routes call services, services use `withOrgTx`.

### D3 — Adapters import `db` directly and write canonical rows outside `withOrgTx`

- **Spec:** §7 mirroring invariant says adapters write canonical rows for every external side-effect.
- **Plan:** invariant #6 — "provisionIdentity, createEvent, respondToEvent: these adapters DO write canonical rows".
- **Evidence:** `nativeWorkspaceAdapter.ts:2` and `googleWorkspaceAdapter.ts:20` import `db`; both insert into `workspace_identities` and `workspace_calendar_events` with no `withOrgTx`.
- **Impact:** identical to D1; also `archived_at` and lifecycle invariants are written without org-scoped session var, so any RLS roll-out touches these.
- **Suggested approach:** caller (pipeline / onboarding service) owns the TX; adapters take a `db` argument from the caller's `withOrgTx`. Or: each adapter method opens its own `withOrgTx(organisationId, ...)` using the params it already receives.

### D4 — Calendar invite iCal attachments never delivered

- **Spec:** §8.3 — "Native runs RFC 5546 calendar-over-email — invites and replies are specially-formatted emails with iCalendar (.ics) attachments."
- **Evidence:** `server/lib/transactionalEmailProvider.ts` accepts `attachments` in `SendEmailOptions` (line 11) but the `resend` (lines 22-34) and `sendgrid` (lines 36-48) branches never forward attachments. Native `createEvent` calls `sendThroughProvider` with the iCal payload (`nativeWorkspaceAdapter.ts:114-121`) — the payload is silently dropped.
- **Impact:** calendar invites send a plain text "You have been invited to a calendar event." with no actual calendar payload. Recipients cannot accept / decline. Acceptance criterion §16 "Inviting the agent to a meeting writes a `workspace_calendar_events` row; the agent's calendar shows the event with `response_status='needs_action'`" — local row writes correctly, but the *external invite* contract is broken.
- **Suggested approach:** map `attachments` to provider-specific shape (Resend `attachments`, SendGrid `attachments` array with `content` base64). For SMTP, pass through to nodemailer's `attachments`.

### D5 — Native rate-limit caps deviate from spec §8.1 amended

- **Spec:** §8.1 amended — "per-identity 60/min, 1000/hour, 5000/day. Per-org 600/min, 20000/hour, 100000/day."
- **Evidence:** `server/services/workspace/workspaceEmailRateLimit.ts:4-6` — `IDENTITY_CAP_PER_HOUR = 60`, `ORG_CAP_PER_HOUR = 1000`, `WINDOW_SEC = 3600`. Single 1-hour window only.
- **Impact:** identity cap is 60/hour vs spec's 60/min — 60× tighter. Org cap is 1000/hour vs 20000/hour — 20× tighter. No per-day cap. Agent skills will hit the rate-limit far sooner than the spec intended.
- **Suggested approach:** call `inboundRateLimiter.check` three times per scope (1-min, 1-hour, 1-day), return whichever fails first. Or extend the rate-limit primitive to accept `[{cap, windowSec}]` and check all in one round-trip.

### D6 — `verify-pipeline-only-outbound.ts` allow-list missing the contract test fixture

- **Spec:** §7 — "Static check: `adapter.sendEmail` is only referenced from `workspaceEmailPipeline.ts`; CI lints any other importer."
- **Evidence:** `scripts/verify-pipeline-only-outbound.ts:3` has `const allowed = ['server/services/workspace/workspaceEmailPipeline.ts']`. `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts:59` invokes `adapter.sendEmail(...)`.
- **Impact:** gate would FAIL in CI once wired in. Implementation lands but trips its own conformance check.
- **Suggested approach:** allow-list `server/adapters/workspace/__tests__/**` (test fixtures) in addition to the pipeline file. Spec intent is "production code only goes through the pipeline" — tests of the contract itself are out of scope of that rule.

### D7 — `AgentMailboxPage.tsx` Message shape mismatched with route response

- **Spec:** §5 mockup 10 — per-agent mailbox view; §6.3 `workspace_messages` schema.
- **Evidence:** `client/src/pages/AgentMailboxPage.tsx:6-16` declares `Message { toAddress: string; receivedAt: string; ... }`. Route `GET /api/agents/:agentId/mailbox` returns rows directly from `workspaceMessages` (`workspaceMail.ts:78-97`), which has `toAddresses: text[]` and `receivedAt: timestamptz | null`. Field name and arity mismatch.
- **Impact:** the recipient column on each row will render `undefined`; sort by `receivedAt` may show invalid dates because every inbound row has `receivedAt` set but outbound rows have `receivedAt = null` and the route doesn't normalise.
- **Suggested approach:** align UI types with the schema (`toAddresses: string[]`, `receivedAt: string | null`) and pick a display field (`sentAt` for outbound, `receivedAt ?? sentAt` for inbound).

### D8 — `AgentCalendarPage.tsx` event shape mismatched

- **Spec:** §5 mockup 11; §6.4 `workspace_calendar_events` schema; §7 adapter `CalendarEvent` shape.
- **Evidence:** `client/src/pages/AgentCalendarPage.tsx:6-15` expects `id`, `startAt`, `endAt`, `attendees`, `organizerEmail`, `responseStatus`. Route `GET /api/agents/:agentId/calendar` returns `events` from `nativeWorkspaceAdapter.fetchUpcoming` (`workspaceCalendar.ts:73-75`), which returns `{ externalEventId, organiserEmail, title, startsAt, endsAt, attendeeEmails, responseStatus }` — different field names *and* missing `id`.
- **Impact:** every calendar row renders empty title-only entries.
- **Suggested approach:** adapter returns canonical rows, not adapter-shaped DTOs. Either change the route to return `workspaceCalendarEvents` rows directly, or change `fetchUpcoming` to return a unified `WorkspaceCalendarEvent` shape that matches the schema and the UI.

### D9 — `OnboardAgentModal` does not deep-link to identity tab on success

- **Spec:** §5 (Frontend modified — `SubaccountAgentEditPage.tsx`): "Default to `'identity'` when navigating from a freshly onboarded agent (`?newlyOnboarded=1` query param)."
- **Evidence:** `OnboardAgentModal.onSuccess` calls back with `identityId` but does not navigate. `SubaccountAgentEditPage.tsx:96` reads `tab` URL param, not `newlyOnboarded`.
- **Impact:** mockup 07 (success) → mockup 09 (Identity tab) flow won't auto-navigate — the operator manually finds the agent's edit page and clicks the Identity tab.
- **Suggested approach:** in the parent page (`SubaccountAgentsPage`), `onSuccess: (identityId) => navigate(\`/admin/subaccounts/${subaccountId}/agents/${linkId}/manage?tab=identity&newlyOnboarded=1\`)`. Either honour `newlyOnboarded=1` as default-to-identity OR rely on the `?tab=identity` param the page already understands.

### D10 — Per-row "Onboard to workplace" CTA shown unconditionally

- **Spec:** §2 — "per-row 'Onboard to workplace' action **on agents that aren't yet onboarded**."
- **Evidence:** `client/src/pages/SubaccountAgentsPage.tsx:456-461` — CTA rendered for every link unconditionally.
- **Impact:** clicking on an already-onboarded agent will hit `workspace_identities_provisioning_request_uniq` (idempotent 200 with same identity) or `workspace_identities_actor_backend_active_uniq` (409). Confusing UX; spec wants the CTA hidden on rows whose agent already has an active identity.
- **Suggested approach:** include identity-state in the `/api/subaccounts/:saId/agents` payload (e.g. `link.workspaceIdentityStatus: 'active' | 'provisioned' | null`), gate the button on `=== null`. Or render an "Identity" badge instead and link to the manage page.

### D11 — Signature template hard-coded; `WorkspaceTenantConfig` lookup unwired

- **Spec:** §12 contract `WorkspaceTenantConfig` — `defaultSignatureTemplate`, `discloseAsAgent`, `vanityDomain`. §17 Q3 — disclosure is opt-in per subaccount.
- **Evidence:** `workspaceMail.ts:127-133` calls pipeline with `subaccountName: subaccountId` and `discloseAsAgent: false` literal. Signature template comes from `identity.metadata.signature`, not from a subaccount-level config.
- **Impact:** disclosure (compliance contexts) cannot be opted into; the human-visible subaccount name never appears in signatures.
- **Suggested approach:** add `getWorkspaceTenantConfig(orgId, subaccountId)` to `connectorConfigService` that reads `connector_configs.config_json` for the active workspace backend and returns the spec's `WorkspaceTenantConfig` shape. Pipeline's `signatureContext` is built from that.

### D12 — `workspace_messages.actor_id == workspace_identities.actor_id` invariant not DB-enforced

- **Spec:** §6.3 — "`workspace_messages.actor_id` MUST equal `workspace_identities.actor_id` for the referenced `identity_id`. … treated as a hard data-integrity invariant."
- **Evidence:** pipeline's `send` and `ingest` populate `actor_id: identity.actorId` from a fresh read (correct). No CHECK or trigger on the DB. A future writer that takes `actor_id` from the caller would not be caught.
- **Suggested approach:** add a trigger on `workspace_messages` BEFORE INSERT/UPDATE that asserts `NEW.actor_id = (SELECT actor_id FROM workspace_identities WHERE id = NEW.identity_id)`. Mirrors the `actor_same_subaccount` and `backend_matches_config` triggers already in 0254.

### D13 — Onboarding service does not write `identity.provisioned` audit event

- **Spec:** §9.1 step 8 — "emit audit_events: actor.onboarded + identity.provisioned + identity.activated" (three audit rows).
- **Evidence:** `workspaceOnboardingService.onboard` writes only `actor.onboarded` and `identity.activated` (`workspaceOnboardingService.ts:94-111`). The `identity.provisioned` row is missing.
- **Impact:** activity feed will show two events per onboarding instead of three. The `provisioned` lifecycle moment becomes invisible to operators.
- **Suggested approach:** add the `identity.provisioned` row immediately after the adapter's `provisionIdentity` returns, before the `transition('activate')`. Three-row audit insert in one statement is fine.

### D14 — Revoke confirmName checks against `workspace_actors.displayName`, not the agent's UI-visible name

- **Spec / Mockup:** mockup 13 — "type the agent's name to confirm".
- **Evidence:** `workspace.ts:285-296` — `confirmName !== actorRow.displayName` compares against `workspace_actors.display_name`. If the operator edited `actor.displayName` in the modal during onboarding (e.g. "Sarah" → "Sarah J"), the dialog will reject the user's input that matches the agent's *current* name as shown in the agents table.
- **Impact:** operator cannot revoke if they edited the display name post-onboarding. Confusing failure mode.
- **Suggested approach:** the dialog already passes `agentName` from the page state; route should accept that as the canonical "what you typed" and compare against either `workspace_actors.display_name` OR `agents.name`. Document which field the operator is asked to type in mockup 13.

### D15 — `verify-workspace-actor-coverage.ts` not wired into a CI workflow

- **Plan:** Task A10 step 4 — add to existing CI workflow alongside `verify-rls-coverage.sh`.
- **Evidence:** `progress.md` notes "No `.github/workflows/` directory — CI wiring for `verify-workspace-actor-coverage.ts` deferred until workflow files are created."
- **Impact:** the gate exists but does not block merges. Acceptance criterion §16 "`verify-workspace-actor-coverage.ts` passes in CI" cannot be evaluated.
- **Suggested approach:** either (a) confirm CI is configured outside `.github/workflows/` (e.g. in a Render or other CI provider) and wire the gate there, or (b) document explicitly that this is awaiting the broader CI workflow rollout. Currently silently undocumented in the spec/plan.

### D16 — Permission key naming uses dot-namespace convention; spec lists colon-separated form

- **Spec:** §10.1 — `subaccounts:manage_workspace`, `agents:onboard`, `agents:manage_lifecycle`, `agents:toggle_email`, `agents:view_mailbox`, `agents:view_calendar`, `agents:view_activity`.
- **Evidence:** `migrations/0257_workspace_permissions.sql` and `server/lib/permissions.ts:162-168` use `subaccount.workspace.manage_connector`, `subaccount.agents.onboard`, etc.
- **Impact:** functional equivalent — every key serves the spec's gating role, just with a different string. Existing convention (`subaccount.<group>.<verb>`) is enforced by `permissions.ts` and migrations 0117 / 0010.
- **Suggested approach:** documentation-only fix — note in `docs/capabilities.md` that the spec's example wording was tentative and the implementation follows the established convention. Spec wording should be updated in a follow-up `chatgpt-spec-review` cycle. Do not rewrite the keys.

### D17 — Contract test fixtures pass `signature: null` / `photoUrl: null` though contract types `signature: string`

- **Evidence:** `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts:25-26` — `signature: null, photoUrl: null`. Contract `ProvisionParams.signature: string` (required), `photoUrl?: string` (optional, no `null`).
- **Impact:** TS suppression / `as any` is required to compile. Adapters never read `signature` strictly so test passes; once a future adapter relies on signature, the test fixture will silently return null.
- **Suggested approach:** widen contract to `signature: string | null` if null is a valid "no signature" value, OR change fixtures to use empty strings. Pick one and apply consistently — this should be decided alongside D11 (signature lookup design).

### D18 — `rateLimitKey` always logged as `null` in pipeline INFO line

- **Plan:** invariant #10 — pipeline's start-of-operation INFO log MUST include `rateLimitKey` (the rate-limit primitive's key, when applicable).
- **Evidence:** `workspaceEmailPipeline.ts:87` always emits `rateLimitKey: null`. Pipeline doesn't capture the actual key from `defaultRateLimitCheck`.
- **Impact:** observability gap — on-call cannot grep for "which rate-limit bucket did this send hit?" `defaultRateLimitCheck` already calls `rateLimitKeys.workspaceEmailIdentity(identityId)` and `rateLimitKeys.workspaceEmailOrg(organisationId)` internally; pipeline could emit those.
- **Suggested approach:** thread the resolved key string back from `rateLimitCheck` (extend the return type) and use it in the INFO log. Or compute the key in-line in the pipeline before the rate-limit call and log it.


---

## Files modified by this run

- `tasks/todo.md` — appended `## Deferred from spec-conformance review — agent-as-employee (2026-04-29)` section with 18 deferred items
- `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T11-58-52Z.md` — this log

No source code modified.

---

## Next step

**NON_CONFORMANT** — 18 directional gaps must be addressed by the main session before `pr-reviewer`. See `tasks/todo.md` under "Deferred from spec-conformance review — agent-as-employee (2026-04-29)".

Recommended triage order (highest-first):
1. **D1–D3** (multi-tenant safety): pipeline + adapters + routes import `db` directly, bypassing `withOrgTx` and `app.organisation_id` session-var. RLS protects, but only because dev runs as superuser. Treat as a single design pass — wrap canonical writes in `withOrgTx`, route reads through services, no per-call patches.
2. **D4** (data loss): native calendar invites send no iCal payload because `transactionalEmailProvider` does not forward `attachments` to resend/sendgrid branches. Spec §8.3 RFC 5546 contract is broken.
3. **D7–D8** (UI broken): mailbox + calendar pages read field names that don't match what the routes return. Pages render empty data.
4. **D5** (rate-limit shape): per-min and per-day caps absent.
5. **D6, D15, D18** (observability/CI): pipeline-only-outbound gate self-fails on the contract test; coverage gate not wired into a workflow; rateLimitKey logged as null.
6. **D9–D11, D14** (UX polish): identity-tab deep-link, CTA gating, signature-template lookup, revoke confirmName name source.
7. **D12** (defence-in-depth): add a DB trigger or service-layer assertion for the `workspace_messages.actor_id == workspace_identities.actor_id` invariant.
8. **D13** (audit completeness): emit `identity.provisioned` audit event during onboarding.
9. **D16, D17** (cosmetic): permission-key namespacing wording (already justified by repo convention; spec wording vs implementation is a documentation issue) and contract test fixture nullability.

After addressing the multi-tenant gaps (D1–D3), the changed-code set will expand significantly. **Re-run `spec-conformance: verify`** before invoking `pr-reviewer`.

---

## Permanent record

This log persists at `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T11-58-52Z.md`. Future sessions can grep on `agent-as-employee` for prior review history.
