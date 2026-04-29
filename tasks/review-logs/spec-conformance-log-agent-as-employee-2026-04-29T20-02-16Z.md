# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`
**Spec commit at check:** `6fa7e473` (HEAD)
**Branch:** `feat/agents-are-employees`
**Base:** `b1e5d29d` (merge-base with main)
**Scope:** Phases A, B, C only — per caller. Phases D and E NOT yet implemented and explicitly out of scope.
**Changed-code set:** 8 modified files since previous re-run log (`6fa7e473`), all uncommitted in working tree.
**Run at:** 2026-04-29T20:02:16Z
**Commit at finish:** `c47ed3b0`
**Previous logs:**
- Initial: `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T11-58-52Z.md` (18 directional gaps)
- First re-run: `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T12-45-59Z.md` (5 remaining: D11, D15, D17, D19, D20)

---

## Table of contents

1. Summary
2. Re-verification verdicts (D1–D20)
3. Mechanical fixes applied this run
4. Directional gaps still open (routed to tasks/todo.md)
5. Files modified by this run
6. Next step
7. Permanent record

---

## 1. Summary

This is a **second re-verification pass** focused on the items the caller said the main session has now addressed: D1/D13, D1/D18, D2 (across 4 route files + webhook), D3 (both adapters), D4, D5, D7/D8, D10, D12, D14. The caller did NOT assert fixes for D11, D15, D17, D19, D20 — those were checked again to confirm posture.

- Items previously fixed (verdict: PASS — no regression): 13 (D1, D2, D3, D4, D5, D6, D7, D8, D10, D12, D13, D14, D18)
- Items previously fixed-with-deviation (verdict: PASS-with-deviation, no fresh gap): 2 (D9 — `?tab=identity` instead of `?newlyOnboarded=1`; D16 — permission-key namespacing)
- Items still open (verdict: DIRECTIONAL — already in `tasks/todo.md`): 5 (D11, D15, D17, D19, D20)
- New gaps surfaced this run: 0
- Mechanical fixes applied this run: 0

**Verdict:** **NON_CONFORMANT** — 5 directional items remain. Identical to the previous re-run's residual set; no progress on D11/D15/D17/D19/D20 between the two re-runs because the caller did not assert fixes for those. Functional correctness in dev (BYPASSRLS connection, no live customers) is unaffected; D19 is the only production-blocking item for non-superuser DB rollout.

> **Note on Step 0 TodoWrite:** the playbook mandates emitting a per-subcomponent TodoWrite list before verification. The TodoWrite tool is not exposed in this session's tool list — the per-subcomponent verification is preserved in this log's §2 and in the scratch file at `tasks/review-logs/spec-conformance-scratch-agent-as-employee-2026-04-29T20-02-16Z.md`. Each REQ verification proceeded one-at-a-time; the parent session did not lose visibility into the per-item walk.

---

## 2. Re-verification verdicts (D1–D20)

### D1 — `workspaceEmailPipeline.send` org-scoped reads + tx-set RLS session var

**Status:** PASS (no regression)

**Evidence:** `server/services/workspace/workspaceEmailPipeline.ts:35` reads via `getOrgScopedDb('workspaceEmailPipeline.send')`; lines 71-87 (audit-anchor TX1) and 124-145 (canonical-mirror TX2) each open `db.transaction(async (tx) => { await tx.execute(sql\`SELECT set_config('app.organisation_id', ${orgId}, true)\`); … })` before issuing inserts. Outbound-send order matches plan invariant #1 (audit anchor committed before adapter call; canonical mirror committed in a separate tx after adapter success).

The stylistic deviation that was split out as D20 in the previous re-run (use `db.transaction` directly rather than `withOrgTx`) is unchanged — see D20 below.

### D1/D13 — `workspaceOnboardingService` getOrgScopedDb + identity.provisioned audit

**Status:** PASS (no regression)

**Evidence:** `server/services/workspace/workspaceOnboardingService.ts:48` opens `getOrgScopedDb('workspaceOnboardingService')`. The audit-event sequence at lines 93–123 emits three rows per onboarding in the spec-required order: `identity.provisioned` (line 93-100, before transition), then `transition('activate')` (line 103), then `actor.onboarded` + `identity.activated` (lines 106-123). Spec §9.1 step 8 is satisfied.

### D1/D18 — `rateLimitKey` field present in pipeline INFO log

**Status:** PASS (no regression)

**Evidence:** `workspaceEmailPipeline.ts:67` computes `const identityRateLimitKey = rateLimitKeys.workspaceEmailIdentity(identity.id)` before the audit-anchor TX; line 98 includes `rateLimitKey: identityRateLimitKey` in the structured INFO log. The `ingest()` path (line 201) emits `rateLimitKey: null` correctly — inbound has no rate-limit primitive.

### D2 — Routes use `getOrgScopedDb`, no raw `db` import

**Status:** PASS — confirmed across all four route files

**Evidence:**
- `server/routes/workspace.ts:5` — imports `getOrgScopedDb`; lines 21, 45, 287 use it for all three lookup helpers (`resolveAgentIdentity`, `resolveAgentSubaccountId`, revoke confirmName). No raw `db` import on the file.
- `server/routes/workspaceMail.ts:6,23,51,79,177` — every read via `getOrgScopedDb('workspaceMail.*')`.
- `server/routes/workspaceCalendar.ts:5,18,46,75` — every read via `getOrgScopedDb('workspaceCalendar.*')`.
- `server/routes/workspaceInboundWebhook.ts:189-196` — `ingest()` runs inside `db.transaction()` + `set_config('app.organisation_id', ...)` + `withOrgTx({tx, organisationId, source: 'inbound-webhook'}, ...)`.

D19 (the bootstrap email→identity lookup at line 171) is a separate concern — see below.

### D3 — Adapters use `getOrgScopedDb`, no raw `db` import

**Status:** PASS — confirmed across both adapters

**Evidence:**
- `server/adapters/workspace/nativeWorkspaceAdapter.ts:2` imports `getOrgScopedDb`; lines 27, 80, 103, 124, 145, 156, 180 use scoped DB for every read/write of `workspace_identities` and `workspace_calendar_events`. No raw `db` import on the file.
- `server/adapters/workspace/googleWorkspaceAdapter.ts:20` imports `getOrgScopedDb`; lines 93, 165, 207, 385, 407, 476, 505 use scoped DB. No raw `db` import on the file.

Mirror-write invariant from §7 is preserved — every external side-effect is paired with a canonical-row write inside the same scoped tx.

### D4 — iCal attachments delivered through transactional email provider

**Status:** PASS (no regression)

**Evidence:** `server/lib/transactionalEmailProvider.ts:32` (Resend), `:47` (SendGrid base64+disposition), `:66` (SMTP/nodemailer) — all three branches forward `opts.attachments` to provider SDKs. Native `createEvent` (`nativeWorkspaceAdapter.ts:122`) passes the iCal payload as `[{name: 'invite.ics', content: ical, contentType: 'text/calendar; method=REQUEST'}]`; native `respondToEvent` (`nativeWorkspaceAdapter.ts:167-175`) sends iCal REPLY with `method=REPLY`. RFC 5546 contract from spec §8.3 is met.

### D5 — Three-window rate limiting per spec §8.1 amended

**Status:** PASS (no regression)

**Evidence:** `server/services/workspace/workspaceEmailRateLimit.ts:4-14`. `IDENTITY_CAPS = [60/60s, 1000/3600s, 5000/86400s]`; `ORG_CAPS = [600/60s, 20000/3600s, 100000/86400s]`. Per-identity loop runs first; if all three pass, per-org loop runs. First-trip returns its scope + `windowResetAt`. Spec amended caps satisfied.

### D6 — `verify-pipeline-only-outbound.ts` allow-list extended

**Status:** PASS (no regression)

**Evidence:** `scripts/verify-pipeline-only-outbound.ts:3-6` — `allowed = ['server/services/workspace/workspaceEmailPipeline.ts', 'server/adapters/workspace/__tests__/']`. The contract test fixture's `adapter.sendEmail()` call matches the second allow-list entry; gate would pass on this branch.

### D7 — `AgentMailboxPage.tsx` Message shape aligned

**Status:** PASS (no regression)

**Evidence:** `client/src/pages/AgentMailboxPage.tsx:6-17` declares `Message { toAddresses: string[]; receivedAt: string | null; sentAt: string | null; ... }`. Field names match the canonical `workspace_messages` row shape returned by `workspaceMail.ts:79-98`.

### D8 — `AgentCalendarPage.tsx` event shape aligned

**Status:** PASS (no regression)

**Evidence:**
- `server/routes/workspaceCalendar.ts:75-87` reads canonical `workspaceCalendarEvents` rows directly (id, organiserEmail, startsAt, endsAt, attendeeEmails, responseStatus, etc.) instead of returning adapter-shaped DTOs.
- `client/src/pages/AgentCalendarPage.tsx:6-15` declares `CalendarEvent { id; title; startsAt; endsAt; attendeeEmails: string[]; organiserEmail: string | null; responseStatus: ...; metadata }`. Field names match the canonical row shape returned by the route.

### D9 — Onboard success deep-links to identity tab

**Status:** PASS-with-deviation (carried over — not a fresh gap)

**Evidence:** `client/src/pages/SubaccountAgentsPage.tsx:715-718`. `OnboardAgentModal.onSuccess` callback navigates to `/admin/subaccounts/${subaccountId}/agents/${onboardLink.id}/manage?tab=identity`. `SubaccountAgentEditPage` reads the `tab` URL param and renders the Identity tab.

**Deviation:** spec literally says `?newlyOnboarded=1`, with the page defaulting to `'identity'` when that sentinel is present. The implementation uses `?tab=identity` directly. Functional outcome (operator lands on the Identity tab post-onboarding) matches the spec's intent. As in the previous re-run, this is treated as a minor naming deviation, not a fresh gap.

### D10 — Per-row CTA gated on identity status

**Status:** PASS (no regression)

**Evidence:** `client/src/pages/SubaccountAgentsPage.tsx:457-471`. Conditional render: `link.workspaceIdentityStatus == null` → shows the "Onboard to workplace" button; else shows an "Identity" link to the manage page's identity tab. Server-side, `subaccountAgentService.listSubaccountAgents` is the contracted source of `workspaceIdentityStatus`.

### D11 — `WorkspaceTenantConfig` lookup unwired

**Status:** STILL OPEN — DIRECTIONAL (carried forward)

**Evidence:** `server/routes/workspaceMail.ts:122-134` still passes `signatureContext: { template: signatureTemplate, subaccountName: subaccountId, discloseAsAgent: false }` — `subaccountName` is the raw UUID, `discloseAsAgent` is hard-coded `false`, and `signatureTemplate` reads `identity.metadata.signature` rather than a subaccount-level config. `connectorConfigService.getWorkspaceTenantConfig` does not exist anywhere in `server/`.

**Already in `tasks/todo.md`** under "Deferred from spec-conformance review — agent-as-employee (re-run, 2026-04-29)" — not re-appended.

### D12 — DB trigger for `workspace_messages.actor_id` invariant

**Status:** PASS (no regression)

**Evidence:** `migrations/0258_workspace_message_actor_id_invariant.sql` — `BEFORE INSERT OR UPDATE OF actor_id, identity_id ON workspace_messages` calls `check_workspace_message_actor_id()` raising if `NEW.actor_id ≠ (SELECT actor_id FROM workspace_identities WHERE id = NEW.identity_id)`. Spec §6.3 hard data-integrity invariant is now DB-enforced. Mirrors the existing `workspace_identities_actor_same_subaccount` trigger from migration 0254.

### D13 — `identity.provisioned` audit event emitted

**Status:** PASS (covered above under D1/D13)

### D14 — Revoke confirmName accepts both display names

**Status:** PASS (no regression)

**Evidence:** `server/routes/workspace.ts:284-296`. After resolving `actorRow` and `agent`:

```ts
const displayName = actorRow?.displayName ?? agent.name;
if (confirmName !== displayName && confirmName !== agent.name) {
  res.status(400).json({ error: 'confirmName does not match agent display name', expected: displayName });
}
```

Accepts either the `workspace_actors.display_name` (operator may have edited during onboarding) OR the original `agents.name`. Mockup 13 works on both.

### D15 — `verify-workspace-actor-coverage.ts` CI wiring

**Status:** STILL OPEN — DIRECTIONAL (carried forward)

**Evidence:** `c:/Files/Projects/automation-v1-3rd/.github/` contains only `pull_request_template.md`; no `workflows/` subdirectory. Spec §16 acceptance criterion "verify-workspace-actor-coverage.ts passes in CI" cannot be evaluated. Same posture as both previous runs.

**Already in `tasks/todo.md`** — not re-appended.

### D16 — Permission key naming

**Status:** Docs-only divergence, no functional gap (carried forward)

Functionally equivalent — implementation uses `subaccount.<group>.<verb>` convention; spec lists `agents:onboard`-style examples. Routing remains a future `chatgpt-spec-review` cycle on the spec wording.

### D17 — Contract test fixture `signature: null`

**Status:** STILL OPEN — DIRECTIONAL (carried forward)

**Evidence:** `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts:25-26` still declares `signature: null, photoUrl: null`. Contract `ProvisionParams.signature: string` (required) and `photoUrl?: string` (optional, no `null`) — fixture values do not satisfy either type strictly. The mock adapters never read `signature`, so no runtime failure today.

**Why fail-closed:** the previous log explicitly tied this decision to D11 (signature template / disclosure design). Two valid mechanical fixes exist — widen contract type to `string | null` OR change fixture to `signature: ''` — and picking either commits to a semantic stance about whether "no signature" is `''` or `null`. Per Step 3 fail-closed posture, that semantic stance is a design choice the human should resolve alongside D11, not a surgical fix this agent should auto-apply.

**Already in `tasks/todo.md`** — not re-appended.

### D18 — `rateLimitKey` logged

**Status:** PASS (covered under D1/D18)

### D19 — Inbound webhook bootstrap raw `db` lookup

**Status:** STILL OPEN — DIRECTIONAL (carried forward)

**Evidence:** `server/routes/workspaceInboundWebhook.ts:171-175`:

```ts
const [identity] = await db
  .select()
  .from(workspaceIdentities)
  .where(eq(workspaceIdentities.emailAddress, emailLower))
  .limit(1);
```

This bootstrap lookup runs before any tx is opened and before `app.organisation_id` is set. `workspace_identities` is RLS-protected; under a non-BYPASSRLS connection, the policy's `current_setting('app.organisation_id', true) IS NOT NULL` clause fails closed and the lookup returns zero rows. Currently masked by dev's BYPASSRLS superuser connection. The post-resolution `ingest()` path correctly uses `withOrgTx` once the identity is known.

**Why fail-closed:** the fix requires `withAdminConnection({source, reason}, async (tx) => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); … })` — a multi-line architectural pattern that introduces an admin-bypass call site. The semantic question of whether webhook bootstrap should bypass RLS via admin role (vs an alternative architecture like embedding the org slug in the webhook URL) is a design decision worth the human's review. Per Step 3 fail-closed, DIRECTIONAL.

**Already in `tasks/todo.md`** — not re-appended.

### D20 — Pipeline `db.transaction()` not wrapped in `withOrgTx`

**Status:** STILL OPEN — DIRECTIONAL (carried forward)

**Evidence:** `server/services/workspace/workspaceEmailPipeline.ts:71` and `:124` both open `db.transaction(async (tx) => { await tx.execute(sql\`SELECT set_config('app.organisation_id', ${orgId}, true)\`); … })` directly. The RLS session var is set correctly (so writes are protected), but the AsyncLocalStorage org context from `withOrgTx` is not extended into the inner tx. Latent footgun: any callee inside the tx that calls `getOrgScopedDb()` would resolve to the OUTER tx, not this inner one.

**Why fail-closed:** the fix is to wrap each `db.transaction` block in `withOrgTx({tx, organisationId: orgId, source: 'workspaceEmailPipeline.send'}, ...)` mirroring the inbound-webhook pattern. While this is the documented `DEVELOPMENT_GUIDELINES.md` §1 pattern, it's a stylistic correction rather than a spec-named requirement, and the previous re-run explicitly classified it DIRECTIONAL. Maintaining the same classification for consistency.

**Already in `tasks/todo.md`** — not re-appended.

---

## 3. Mechanical fixes applied this run

None.

Per Step 3 fail-closed posture: all five remaining gaps require either a design decision (D11 — config schema, D17 — contract type widening), an out-of-band system change (D15 — CI workflow file does not yet exist), or a multi-file architectural pattern adjustment with semantic implications (D19, D20). None clear the bar for surgical in-session auto-fix.

The gates against auto-applying:
- **D11:** requires creating `connectorConfigService.getWorkspaceTenantConfig`, deciding the storage location of `discloseAsAgent` (`subaccounts.workspace_config_json` vs `connector_configs.config_json`), and plumbing through to the pipeline. Multi-file design.
- **D15:** the `.github/workflows/` directory does not exist; cannot mechanically write a CI workflow without knowing CI provider, runner config, and secret/env wiring.
- **D17:** changing `signature: null` to `signature: ''` is technically a one-line edit and the spec contract is unambiguous (`signature: string`), but the previous run explicitly tied this to D11. The `photoUrl: null` deviation is more substantive — the spec text at §12 says "photoUrl may be null" while the contract type says `photoUrl?: string` (no null). Pick one. Design decision.
- **D19:** requires admin-bypass wrapping (`withAdminConnection` + explicit `SET LOCAL ROLE admin_role`); architectural pattern with security implications worth human review.
- **D20:** stylistic deviation from established `withOrgTx` pattern; previous re-run kept it DIRECTIONAL for consistency, no functional bug today.

---

## 4. Directional gaps still open (routed to tasks/todo.md)

All five (D11, D15, D17, D19, D20) already exist in `tasks/todo.md` under the section "Deferred from spec-conformance review — agent-as-employee (re-run, 2026-04-29)" added by the previous re-run. Per CLAUDE.md "Deferred actions route to `tasks/todo.md` — single source of truth" and this agent's playbook §4b ("scan for existing entries, skip if already present"), these are NOT re-appended here.

The `tasks/todo.md` section remains the single source of truth for the open items. No edits to that section this run.

| Item | One-line | Where to find it |
|---|---|---|
| D11 | `WorkspaceTenantConfig` lookup unwired; signature uses raw subaccount UUID + hard-coded `discloseAsAgent: false` | `tasks/todo.md` §re-run-2026-04-29 |
| D15 | `verify-workspace-actor-coverage.ts` not wired into a CI workflow (`.github/workflows/` does not yet exist) | `tasks/todo.md` §re-run-2026-04-29 |
| D17 | Contract test fixture passes `signature: null` though contract types `signature: string` | `tasks/todo.md` §re-run-2026-04-29 |
| D19 | Inbound webhook bootstrap email-lookup uses raw `db` outside any tx; will fail closed under non-BYPASSRLS connection | `tasks/todo.md` §re-run-2026-04-29 |
| D20 | Pipeline `db.transaction()` not wrapped in `withOrgTx`; AsyncLocalStorage org context not extended to inner tx | `tasks/todo.md` §re-run-2026-04-29 |

---

## 5. Files modified by this run

- `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T20-02-16Z.md` — this log.

Source code unchanged. `tasks/todo.md` unchanged (no new deferrals; existing entries cover all 5 still-open items).

---

## 6. Next step

**NON_CONFORMANT** — 5 directional gaps remain. The set is unchanged from the previous re-run.

Recommended order (same as previous re-run):
1. **D19** first — multi-tenant safety; the only production-blocker for non-superuser DB rollout.
2. **D20** alongside D19 — same family of fix, completes the multi-tenant safety pattern.
3. **D11** as the next feature work — touches `connectorConfigService`, the mail route, and possibly the pipeline signature contract. Decide D17 fixture shape at the same time.
4. **D17** decided at the same time as D11.
5. **D15** when `.github/workflows/` is created.

After D19 + D20 land, the changed-code set will not change shape materially — this branch is ready for `pr-reviewer` once those two land. D11/D17 are feature-completeness gaps but do not block reviewer.

**Mechanical-fix follow-up:** since no mechanical fixes were applied this run, the changed-code set has not expanded beyond what the caller staged. **`pr-reviewer` does NOT need to be re-invoked specifically for this run**; the previous review of the working tree applies to the same surface area.

---

## 7. Permanent record

This log persists at `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T20-02-16Z.md`. Future sessions can grep on `agent-as-employee` for the prior review history. Previous logs:
- `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T11-58-52Z.md` (initial — 18 directional gaps).
- `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T12-45-59Z.md` (first re-run — 5 remaining).
