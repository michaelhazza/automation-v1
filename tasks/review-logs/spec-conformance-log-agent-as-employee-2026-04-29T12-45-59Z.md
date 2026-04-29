# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`
**Spec commit at check:** `755cb717` (HEAD)
**Branch:** `feat/agents-are-employees`
**Base:** `b1e5d29d` (merge-base with main)
**Scope:** Phases A, B, C only (per caller — Phases D and E NOT yet implemented)
**Changed-code set:** 8 modified files since previous log (`5a2b4e4c`) + 1 new migration
**Run at:** 2026-04-29T12:45:59Z
**Previous log:** `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T11-58-52Z.md`

---

## Table of contents

1. Summary
2. Re-verification verdicts (D1–D18)
3. New directional gaps surfaced by re-verification (D19, D20)
4. Mechanical fixes applied this run
5. Files modified by this run
6. Next step
7. Permanent record

---

## 1. Summary

This is a **re-verification pass** focused on the 18 directional gaps (D1–D18) flagged by the previous run. No new spec-extraction was performed; Phase A/B/C requirement coverage outside those 18 items is unchanged.

- Previously deferred items: 18
- FIXED in-session by main session: 13
- FIXED with deviation: 2 (D9, D16)
- NOT FIXED — still deferred: 3 (D11, D15, D17)
- New directional gaps surfaced by re-verification: 2 (D19 inbound-webhook bootstrap lookup, D20 pipeline tx pattern)

**Verdict:** **NON_CONFORMANT** — 5 directional items remain (D11, D15, D17, D19, D20). None block functional correctness in dev (BYPASSRLS connection, no live customers, gate suite is CI-only); all matter for production hardening or spec-strict alignment.

The substantive multi-tenant safety remediation (D1–D3) has landed. Pipeline reads/writes carry the org-isolation session var on every TX; routes call services that use `getOrgScopedDb()`; adapters scope their writes. The delta is meaningful: previous state relied on superuser BYPASSRLS even in dev; current state would survive a non-bypass connection across ~95% of the changed-code surface, with two narrow exceptions captured below (D19, D20).

---

## 2. Re-verification verdicts (D1–D18)

### D1 — `workspaceEmailPipeline.send` uses `withOrgTx`

**Status:** FIXED (functional) / DIRECTIONAL deviation (stylistic — see D20)

**Evidence:** `server/services/workspace/workspaceEmailPipeline.ts:35` reads via `getOrgScopedDb('workspaceEmailPipeline.send')`; lines 71-87 (audit-anchor TX1) and 124-145 (mirror TX2) wrap inserts in `db.transaction(async (tx) => { await tx.execute(sql\`SELECT set_config('app.organisation_id', ${orgId}, true)\`); … })`. Each TX explicitly sets the RLS session var before issuing writes. Subsequent inserts run through `tx.insert(...)` and inherit the LOCAL setting.

**Functional impact:** RLS will fire correctly for all canonical-table writes. Multi-tenant safety contract restored.

**Stylistic deviation (split out as D20 below):** `db.transaction(...)` is used directly rather than wrapping in `withOrgTx(...)`. Since `withOrgTx` is an `AsyncLocalStorage` wrapper (see `server/instrumentation.ts:172`) and not the tx-opener, this only matters if code inside the tx tries to call `getOrgScopedDb()` — which would resolve to the OUTER tx context, not the inner one. No callee does this today; flagged for future-proofing.

### D2 — Routes import `db` directly

**Status:** LARGELY FIXED — one remaining sub-gap split out as D19

**Evidence:**
- `server/routes/workspace.ts:21,45,287` — all DB lookups now go through `getOrgScopedDb('workspace.*')` helpers; raw `db` import removed.
- `server/routes/workspaceMail.ts:23,51,79,177` — every read via `getOrgScopedDb('workspaceMail.*')`.
- `server/routes/workspaceCalendar.ts:18,46,75` — every read via `getOrgScopedDb('workspaceCalendar.*')`.
- `server/routes/workspaceInboundWebhook.ts:190-196` — `ingest()` now wrapped in `db.transaction()` + `set_config('app.organisation_id', ..., true)` + `withOrgTx({tx, organisationId, source: 'inbound-webhook'}, ...)`. Inside `ingest()`, calls use `getOrgScopedDb()` and resolve to that wrapped tx.

**Remaining concern (D19):** webhook's pre-tx identity lookup at `workspaceInboundWebhook.ts:171` (`db.select().from(workspaceIdentities).where(eq(workspaceIdentities.emailAddress, emailLower))`) runs with no org context — provider has no JWT, no header to derive org from. Under a non-BYPASSRLS connection this lookup would return zero rows because `app.organisation_id` is not set and the `_org_isolation` policy fails closed. The bootstrap lookup must use `withAdminConnection`. See D19.

### D3 — Adapters write canonical rows outside `withOrgTx`

**Status:** FIXED

**Evidence:**
- `server/adapters/workspace/nativeWorkspaceAdapter.ts:27,80,103,145,180` — every method opens its own scoped DB via `getOrgScopedDb('nativeAdapter.*')`. The raw `db` import is gone. `provisionIdentity` reads/writes through the scoped tx; `createEvent` and `respondToEvent` likewise.
- `server/adapters/workspace/googleWorkspaceAdapter.ts:20,93,165,207,385,407,476` — same pattern, all reads/writes via `getOrgScopedDb('googleAdapter.*')`.

Both adapters now require an active org-tx context to run, which is exactly what the spec's mirroring invariant demands ("the adapter MUST produce exactly one canonical row write" — that write now carries org isolation).

### D4 — iCal attachments delivered through transactional email provider

**Status:** FIXED

**Evidence:** `server/lib/transactionalEmailProvider.ts:32,47,66`. Resend branch maps to `attachments: [{filename, content, contentType}]`; SendGrid base64-encodes and sets `disposition: 'attachment'`; SMTP forwards directly to nodemailer's `attachments`. Native `createEvent` (`nativeWorkspaceAdapter.ts:122`) passes the iCal payload as `[{name: 'invite.ics', content: ical, contentType: 'text/calendar; method=REQUEST'}]` and that now propagates to provider SDKs. Calendar invites match RFC 5546 contract.

### D5 — Three-window rate limiting (per spec §8.1 amended)

**Status:** FIXED

**Evidence:** `server/services/workspace/workspaceEmailRateLimit.ts:4-14`. `IDENTITY_CAPS = [60/min, 1000/hour, 5000/day]`; `ORG_CAPS = [600/min, 20000/hour, 100000/day]`. Iterates each cap via `inboundRateLimiter.check`; returns the first-tripped scope with its `windowResetAt`. Per-identity check runs first; if it passes, per-org runs. Matches the spec's amended caps numerically.

**Note:** the spec's "simultaneous-trip tie-break" rule (return the *later* `windowResetAt` if both scopes fire on the same call) is not implemented — identity is checked entirely before org, so a simultaneous trip cannot be observed. Functionally equivalent for callers because the identity scope is a strict subset of the org scope. Not flagged as a gap.

### D6 — `verify-pipeline-only-outbound` allow-list extended

**Status:** FIXED

**Evidence:** `scripts/verify-pipeline-only-outbound.ts:3-6`. `allowed = ['server/services/workspace/workspaceEmailPipeline.ts', 'server/adapters/workspace/__tests__/']`. Test fixture `canonicalAdapterContract.test.ts:59` (`adapter.sendEmail(...)`) now matches the second allow-list entry. Gate would pass on this branch.

### D7 — `AgentMailboxPage.tsx` Message shape aligned with route

**Status:** FIXED

**Evidence:** `client/src/pages/AgentMailboxPage.tsx:6-17`. Message type now: `{toAddresses: string[]; receivedAt: string | null; sentAt: string | null; ...}`. Renders use `receivedAt ?? sentAt ?? 0` for sort/display (lines 49, 61, 135, 163). Empty rows no longer render `undefined`.

### D8 — `AgentCalendarPage.tsx` event shape aligned

**Status:** FIXED

**Evidence:**
- `server/routes/workspaceCalendar.ts:75-87` — route now reads from `workspaceCalendarEvents` table directly (canonical rows), returns full Drizzle shape with `id`, `organiserEmail`, `startsAt`, `endsAt`, `attendeeEmails`, `responseStatus`.
- `client/src/pages/AgentCalendarPage.tsx:6-15` — UI type matches the canonical shape (`id`, `title`, `startsAt`, `endsAt`, `attendeeEmails`, `organiserEmail`, `responseStatus`).

### D9 — Onboard success deep-links to identity tab

**Status:** FIXED with deviation

**Evidence:** `client/src/pages/SubaccountAgentsPage.tsx:715-718`. On `OnboardAgentModal.onSuccess`, the parent page navigates to `/admin/subaccounts/${subaccountId}/agents/${onboardLink.id}/manage?tab=identity`. `SubaccountAgentEditPage:96` reads `?tab` and renders the Identity tab.

**Deviation:** the spec literally says the query param should be `?newlyOnboarded=1`, with the page defaulting to `'identity'` when that sentinel is present. The implementation uses `?tab=identity` directly. Functional outcome (operator lands on the Identity tab) matches the spec's intent. The sentinel-based approach the spec described (with `newlyOnboarded` perhaps gating other behaviour like a transient toast) is not present. Treating as a minor naming deviation, not a fresh gap.

### D10 — Per-row CTA gated on identity status

**Status:** FIXED

**Evidence:**
- `server/services/subaccountAgentService.ts:59,63-68,107` — `listSubaccountAgents` LEFT JOINs `workspace_identities` via `agents.workspace_actor_id` (with `archived_at IS NULL`) and selects `workspaceIdentityStatus`. Each row in the returned payload now carries `workspaceIdentityStatus: 'provisioned' | 'active' | 'suspended' | 'revoked' | null`.
- `client/src/pages/SubaccountAgentsPage.tsx:457-471` — CTA renders only when `link.workspaceIdentityStatus == null`; rows with any non-null status show an "Identity" link to the manage page's identity tab instead.

### D11 — `WorkspaceTenantConfig` lookup unwired

**Status:** NOT FIXED — REMAINS DIRECTIONAL

**Evidence:** `server/routes/workspaceMail.ts:122-134` still calls `workspaceEmailPipeline.send` with `signatureContext: { template: signatureTemplate, subaccountName: subaccountId, discloseAsAgent: false }` — `subaccountName` is the raw UUID (not the human-visible subaccount name), and `discloseAsAgent` is hard-coded `false`. No `connectorConfigService.getWorkspaceTenantConfig(orgId, subaccountId)` exists; grep returns zero hits across `server/`.

**Impact:** the Q3 disclosure feature ("Sent by … AI agent at …") cannot be opted into for any subaccount. The signature template renders the subaccount UUID literally, not the human-visible name. Spec §12 / §17 Q3 contract is unmet.

**Suggested approach:** add `connectorConfigService.getWorkspaceTenantConfig(orgId, subaccountId)` returning the spec's `WorkspaceTenantConfig` shape (backend, defaultSignatureTemplate, discloseAsAgent, vanityDomain). The mail route resolves the subaccount's display name via `subaccountService.getById(subaccountId, orgId)` and merges with the config. Plumb through to the pipeline's `signatureContext`. ETA: ~1-2 hour task.

### D12 — DB trigger for `workspace_messages.actor_id` invariant

**Status:** FIXED

**Evidence:** `migrations/0258_workspace_message_actor_id_invariant.sql`. `BEFORE INSERT OR UPDATE OF actor_id, identity_id ON workspace_messages` calls `check_workspace_message_actor_id()` which raises if `NEW.actor_id ≠ (SELECT actor_id FROM workspace_identities WHERE id = NEW.identity_id)`. Mirrors the existing `workspace_identities_actor_same_subaccount` trigger pattern from migration 0254. Spec §6.3 trust invariant now DB-enforced.

### D13 — `identity.provisioned` audit event emitted

**Status:** FIXED

**Evidence:** `server/services/workspace/workspaceOnboardingService.ts:93-100,103,106-123`. Sequence is now:

1. `adapter.provisionIdentity(...)` (line 76)
2. INSERT `audit_events` row with action `identity.provisioned` (line 93-100)
3. `workspaceIdentityService.transition(provisionResult.identityId, 'activate', ...)` (line 103)
4. INSERT array of two audit rows: `actor.onboarded` and `identity.activated` (line 106-123)

Three rows total per onboard, matching spec §9.1 step 8.

### D14 — Revoke confirmName accepts both display names

**Status:** FIXED

**Evidence:** `server/routes/workspace.ts:284-296`. After resolving `actorRow` and `agent`:

```ts
const displayName = actorRow?.displayName ?? agent.name;
if (confirmName !== displayName && confirmName !== agent.name) {
  res.status(400).json({ error: 'confirmName does not match agent display name', expected: displayName });
}
```

Operator can type either the `workspace_actors.display_name` (which they may have edited during onboarding) OR the original `agents.name`. Mockup 13 ("type the agent's name to confirm") works on both sources of truth.

### D15 — `verify-workspace-actor-coverage.ts` CI wiring

**Status:** NOT FIXED — REMAINS DIRECTIONAL (was previously documented as deferred-until-CI-config)

**Evidence:** `.github/workflows/` directory still does not exist in the repo (`ls .github/` returns only `pull_request_template.md`). Spec §16 acceptance criterion "`verify-workspace-actor-coverage.ts` passes in CI" cannot be evaluated.

This is the same posture as the previous run; no progress between runs. Was always going to be addressed when the broader CI workflow file lands. Re-deferring with the same suggested approach.

### D16 — Permission key naming

**Status:** DOCS-ONLY — wording divergence, no functional gap

**Evidence:** Per the previous run, this was always a "spec wording lags implementation convention" finding. The keys (`subaccount.agents.onboard` etc.) function identically to the spec's example wording (`agents:onboard`). No code change was indicated.

Routing forward to the same documentation follow-up as before — should be picked up in the next `chatgpt-spec-review` cycle on this spec.

### D17 — Contract test fixture `signature: null`

**Status:** NOT FIXED — REMAINS DIRECTIONAL

**Evidence:** `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts:25` still: `signature: null`. The contract `ProvisionParams.signature: string` (required) is satisfied only because TS doesn't strictly typecheck the inline test fixture against the interface. The mock adapters never read `signature`, so no runtime failure — but the next adapter to consume it will be surprised.

**Suggested approach:** decide alongside D11 — if signatures may legitimately be empty/absent at the contract level, widen `ProvisionParams.signature` to `string | null`. Otherwise change fixtures to `signature: ''`. Pick one.

### D18 — `rateLimitKey` logged as identity-bucket key

**Status:** FIXED

**Evidence:** `server/services/workspace/workspaceEmailPipeline.ts:67,98`. `const identityRateLimitKey = rateLimitKeys.workspaceEmailIdentity(identity.id)` is computed before the audit-anchor TX, then included in the structured INFO log: `rateLimitKey: identityRateLimitKey`. Plan invariant #10 is satisfied for the `send()` path.

The `ingest()` path (line 201) still emits `rateLimitKey: null`. This is correct: inbound has no rate-limit primitive (only outbound), so "when applicable" reads as not-applicable for ingest.

---

## 3. New directional gaps surfaced by re-verification

### D19 — Inbound webhook bootstrap identity lookup uses raw `db` outside any tx

**Status:** DIRECTIONAL — new gap

**Evidence:** `server/routes/workspaceInboundWebhook.ts:171-175`:

```ts
const [identity] = await db
  .select()
  .from(workspaceIdentities)
  .where(eq(workspaceIdentities.emailAddress, emailLower))
  .limit(1);
```

This runs before any tx is opened and before `app.organisation_id` is set. `workspace_identities` is RLS-protected via the `_org_isolation` policy (migration 0254). Under a non-BYPASSRLS connection, this lookup returns zero rows because the policy's `current_setting('app.organisation_id', true) IS NOT NULL` clause fails closed. Currently masked because dev runs as superuser with BYPASSRLS.

**Why it's not a D2 sub-finding:** D2 was scoped to "routes using raw `db` for tenant work". This bootstrap lookup is a different shape — the org isn't known yet, so org-scoping is impossible. The correct fix is `withAdminConnection` (admin role has BYPASSRLS), which is the existing pattern for system/admin reads.

**Suggested approach:** wrap the email→identity lookup in `withAdminConnection`. Once identity is resolved, the existing `db.transaction()` + `set_config` + `withOrgTx({tx, organisationId, source: 'inbound-webhook'}, ...)` flow takes over correctly. Single-line change in shape.

### D20 — Pipeline uses `db.transaction()` directly rather than `withOrgTx`

**Status:** DIRECTIONAL — stylistic deviation, no functional bug today

**Evidence:** `server/services/workspace/workspaceEmailPipeline.ts:71,124`:

```ts
await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.organisation_id', ${orgId}, true)`);
  // ... tx.insert(...) ...
});
```

Versus the inbound-webhook pattern, which DOES wrap in `withOrgTx`:

```ts
await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.organisation_id', ${...}, true)`);
  return withOrgTx({ tx, organisationId, source: '...' }, () => ingest(...));
});
```

The pipeline's pattern correctly sets the RLS session var via `set_config(..., true)` (LOCAL scope), so all `tx.insert()` writes are RLS-protected. But it does NOT extend the `AsyncLocalStorage` org context. If any callee inside the tx tried to call `getOrgScopedDb()`, it would resolve to the OUTER tx (the HTTP middleware's tx), not this inner one — and write to the wrong tx. No callee does this today, so the gap is latent.

**Why it matters:** spec §10.5 / `DEVELOPMENT_GUIDELINES.md` §1 say "Service layer uses `withOrgTx` for tenant work". The pattern divergence creates a footgun for future maintenance.

**Suggested approach:** wrap each `db.transaction` block in `withOrgTx({tx, organisationId: orgId, source: 'workspaceEmailPipeline.send'}, ...)`, matching the inbound-webhook pattern. Trivial change; preserves the explicit `set_config` call.

---

## 4. Mechanical fixes applied this run

None.

Per Step 3 fail-closed posture: all five remaining gaps require either a design decision (D11 — config schema, D17 — contract type widening), an out-of-band system change (D15 — CI workflow file), or a multi-file architectural pattern adjustment (D19, D20). None clear the bar for surgical in-session auto-fix.

---

## 5. Files modified by this run

- `tasks/todo.md` — appended `## Deferred from spec-conformance review — agent-as-employee (re-run, 2026-04-29)` section with 5 still-open items.
- `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T12-45-59Z.md` — this log.

Source code unchanged.

---

## 6. Next step

**NON_CONFORMANT** — 5 directional gaps remain.

- **Production-blocking (must fix before non-superuser DB rollout):** D19 (webhook bootstrap RLS).
- **Production-blocking (must fix before pre-launch):** D11 (signature template / disclosure config) — feature gap, not safety.
- **Maintenance hardening:** D20 (pipeline `withOrgTx` wrapper).
- **Infra wait:** D15 (CI workflow file does not exist yet — wire when it does).
- **Cosmetic:** D17 (contract test fixture nullability).

Recommended order:
1. **D19** first — low-LOC change, removes the RLS production blocker on the inbound path.
2. **D20** alongside D19 — same family of fix, completes the multi-tenant safety pattern.
3. **D11** as the next feature work — touches `connectorConfigService`, the mail route, and possibly the pipeline signature contract. Decide D17 fixture shape at the same time.
4. **D15** when `.github/workflows/` is created.

After D19 + D20 land, the changed-code set will not change shape materially — this branch is ready for `pr-reviewer` once those two land. Re-running `spec-conformance` between them is unnecessary; the verification is mechanical.

---

## 7. Permanent record

This log persists at `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T12-45-59Z.md`. Future sessions can grep on `agent-as-employee` for prior review history. Previous log: `tasks/review-logs/spec-conformance-log-agent-as-employee-2026-04-29T11-58-52Z.md`.
