**Status:** reviewing
**Spec date:** 2026-05-11
**Last updated:** 2026-05-11 (spec-reviewer iteration 2 mechanical pass applied)
**Author:** claude-opus-4-7
**Build slug:** operator-session-identity
**Source branch:** claude/evolve-session-identity-brief-17LO4
**Scope class:** Major
**Predecessor:** Spec A — `tasks/builds/execution-backend-adapter-contract/spec.md` (shipped PR #281)
**Sibling (concurrent):** Spec B — `tasks/builds/sandbox-isolation/brief.md`
**Parent strategy:** `tasks/builds/sandbox-and-executionbackend-strategy/brief.md` (Decision 3)

---

# Spec C — Operator Session Identity

## Table of Contents

1. [Overview](#1-overview)
2. [Goals](#2-goals)
3. [Non-goals](#3-non-goals)
4. [Framing assumptions](#4-framing-assumptions)
5. [Scope amendment — /connections CRUD consolidation](#5-scope-amendment)
6. [Design source of truth — mockup paths](#6-design-source-of-truth)
7. [Data model](#7-data-model)
8. [File inventory lock](#8-file-inventory-lock)
9. [Contracts](#9-contracts)
10. [Permissions and RLS checklist](#10-permissions-and-rls-checklist)
11. [Execution model](#11-execution-model)
12. [Implementation chunk plan](#12-implementation-chunk-plan)
13. [Deferred items](#13-deferred-items)
14. [Self-consistency pass](#14-self-consistency-pass)
15. [Testing posture](#15-testing-posture)
16. [Execution-safety contracts](#16-execution-safety-contracts)
17. [Acceptance criteria](#17-acceptance-criteria)
18. [Open questions](#18-open-questions)

---

## 1. Overview

Spec C ships the **Credential Broker primitive** that lets customers connect a ChatGPT subscription as a model identity — `auth_type: 'operator_session'` — rather than using platform-managed per-API-token billing. Spec A (PR #281) reserved the `'session_identity'` capability slot on the adapter contract; Spec C fills that slot end-to-end: schema, connection flow, plan-tier detection, disclosure UX, consent records, token lifecycle, and the UI surface on the `/connections` page.

**Important framing:** Spec C ships infrastructure that goes unused-but-correct until the OpenClaw adapter lands (Phase 3+). No existing adapter (`api`, `headless`, `claude-code`, `iee_*`) is rewired to consume `operator_session` credentials in V1. The first real consumer is the OpenClaw adapter, which uses the verified operator-session mechanism plus the sandbox primitive (Spec B) to run long-form autonomous tasks at subscription-mediated cost.

This spec also absorbs a **scope amendment** (Section 5): the `/connections` Govern surface is refactored from read-only to full CRUD, consolidating the legacy `CredentialsTab` / `IntegrationsAndCredentialsPage` flows and introducing the new three-tab App Integrations / Web Logins / AI Subscriptions UX designed in the mockup loop (rounds 1-13, 22 screens, paths in Section 6).

---

## 2. Goals

1. Add `auth_type: 'operator_session'` to the Credential Broker (`credentialBrokerService.ts`) and `integration_connections` schema.
2. Ship six new columns on `integration_connections`: `usability_state`, `plan_tier`, `plan_verification_status`, `plan_verified_at`, `consent_record_id`, `is_default` (the last enforces the single-Default invariant per subaccount via partial unique index — see §7.1).
3. Create two new append-only, RLS-protected tables: `operator_session_consents` and `operator_session_consent_events`.
4. Implement the provider connection flow (conditioned on verified OpenAI provider support; if not verified at time of build, the connect route returns `501 provider_mechanism_not_verified` per §11.1 — the rest of the schema, consent model, and UI ship and light up when the mechanism is confirmed).
5. Implement plan-tier detection (self-declaration fallback per §7.4).
6. Implement the Plus-tier disclosure UX: consent capture, 7-year retention, re-acceptance on disclosure version bump.
7. Implement token-lifecycle service: background refresh ahead of TTL, failure classification into six buckets, `usability_state` transitions on failure.
8. Implement broker retrieval invariant: `usability_state` check precedes decryption; only `connected_usable` state returns token material.
9. Implement the redacted envelope pattern: consumers receive a branded envelope, never raw token material.
10. Implement all five permission gates: connect, view metadata, disconnect, sign in again, allow agent use.
11. Ship the `/connections` UI refactor: three-tab structure (App Integrations / Web Logins / AI Subscriptions), App Integrations grid with per-app connect flows, full Add/Edit/Test/Disconnect CRUD surface consolidating `CredentialsTab` into `ConnectionsPage`.
12. Implement the subaccount-default concept: one AI Subscription per subaccount marked Default; Make Default confirmation modal with Plus-tier re-acknowledgement.
13. Implement the per-subscription agent allowlist: Edit availability modal, agent-side read-only Model Access summary on agent edit page.
14. Ship the locked failover policy: Default first; other allowed subscriptions in alphabetical order on failure; platform-managed providers as final fallback.
15. Implement the provider capability registry (V1: `openai` entry only, future providers slot in without schema changes).
16. Implement audit events for all consent lifecycle actions and provider-side revocation.

---

## 3. Non-goals

- **Actual runtime consumption by any existing adapter.** No existing adapter (`api`, `headless`, `claude-code`, `iee_*`) is rewired. Adapter consumption is the OpenClaw adapter spec (Phase 3+).
- **Operator-session → API-key fallback path during an active run.** The broker may expose a `getNextFallback()` seam; OpenClaw spec decides whether and how to call it mid-run.
- **BYO API keys (platform model provider selection UX).** Parked; gets its own spec when scoped.
- **Customer billing dashboards showing subscription-mediated zero-cost runs.** Phase 3.5+.
- **Customer-self-service tier switching UI.** Phase 3.5+.
- **Cost calculator / "should I be on Pro?" recommender.** Phase 3.5+.
- **Multi-provider posture framework** beyond schema-level forward compat. V1 targets OpenAI only; the schema is the seam for future providers.
- **CS runbook for "OpenAI suspended my account."** Deferred to OpenClaw adapter scope (`tasks/builds/openclaw-adapter/scope.md` §3.5).
- **Mobile-responsive `/connections` UI.** Deferred — flagged for future roadmap.
- **SVG icon system for app integration cards.** Deferred — letter-form avatars ship in V1; icon system is a separate visual pass.
- **MCP server and Cookie auth-type UI surfaces.** These auth types remain schema-level only; no user-facing management UI ships in this spec (system-admin tool, future scope).

---

## 4. Framing assumptions

- **Pre-production, rapid evolution.** Per `docs/spec-context.md`: no live users, breaking changes expected, `commit_and_revert` rollout model. Migration safety tests deferred until live data exists.
- **No legal / product review blocking the spec.** Disclosure wording and SaaS contract clauses are placeholders marked `[Legal will add link]` / `[Legal placeholder]`; architecture is the deliverable. Legal / product can review at any point and we update placeholders in a follow-up commit.
- **Quarterly review of OpenAI posture** is a calendared meeting, not a code feature.
- **Credential Broker is the seam.** Operator-session auth is one credential mode among several. Adapters consume credentials via the broker and never inspect `auth_type` themselves. This is already the architecture for `oauth2`, `api_key`, and `web_login`; `operator_session` is the fourth mode.
- **Provider connection mechanism is subject to verification.** The spec defines the flow assuming an OpenAI-supported mechanism exists. If verification fails at build time, the schema, consent model, and UI ship with the Connect CTA disabled and a "Verifying provider support" banner. The provider connection wiring activates when the mechanism is confirmed.
- **Provider-agnostic schema.** Even though V1 targets OpenAI / ChatGPT only, all column names, enum values, and service interfaces use provider-agnostic vocabulary (`provider`, `plan_tier`, `auth_token` etc.) so future providers (Anthropic Claude.ai, Google Gemini) slot in without schema changes.
- **Testing posture.** Static gates primary; runtime tests for pure functions only. No E2E, no frontend unit tests, no API contract tests. Per `docs/spec-context.md`.
- **Hard ban on unsafe auth mechanisms.** This spec MUST NOT implement credential scraping, browser-cookie capture, password collection, session hijacking, headless-browser login automation, or any non-provider-sanctioned account extraction. Only provider-supported authentication flows are permitted.

---

## 5. Scope amendment — /connections CRUD consolidation

**Operator-authorised addition, 2026-05-11** (surfaced during the mockup loop).

### 5.1 Problem

Today, credential add/edit/test lives in two separate surfaces:

| Surface | File | CRUD capability |
|---|---|---|
| Legacy `CredentialsTab` | `client/src/components/CredentialsTab.tsx` inside `client/src/pages/IntegrationsAndCredentialsPage.tsx` | Full: Add, Edit, Test, Disconnect modals for OAuth + Web Login |
| Govern `ConnectionsPage` | `client/src/pages/govern/ConnectionsPage.tsx` | Read-only: Test + Disconnect only; no Add or Edit |

This split is a codebase debt that Spec C surfaced. Adding the new AI Subscriptions tab to the Govern surface without closing the split would triple the problem (three surfaces for one concept: legacy tab, Govern page, and AI Subscriptions).

### 5.2 Decision

The `/connections` route (`ConnectionsPage.tsx`) becomes the **single CRUD surface** for all connection types. The legacy `IntegrationsAndCredentialsPage` and `CredentialsTab` are deprecated and removed as part of this spec.

### 5.3 Three-tab structure

The `/connections` page gains a tab strip with three intent-oriented tabs. **Auth-method labels (OAuth, API Key, MCP, Cookie) are NOT user-facing.** Users see app names and purposes; auth plumbing is abstracted.

| Tab | What it shows | User intent |
|---|---|---|
| **App Integrations** | Grid of supported apps (Gmail, Slack, HubSpot, GoHighLevel, Teamwork, Google Drive, Outlook, Google Calendar, Microsoft Calendar). Card = icon + name + category + connection status + CTA. | "Connect an app my agents use to do work." |
| **Web Logins** | Sortable/filterable table of username-password portal logins. | "Store a login for a site without an API." |
| **AI Subscriptions** | Sortable/filterable table of operator_session credentials (this spec's primary feature). | "Connect a ChatGPT plan for my autonomous agents." |

MCP and Cookie rows remain schema-accessible but are not surfaced in user-facing tabs (system-admin tooling, future scope).

### 5.4 App Integrations UX

- **Card grid**, not a table. No auth-method column.
- **Two sections:** "Your connected apps" (apps with ≥1 connection) + "Apps you can connect" (apps with 0 connections). Sections are mutually exclusive — no duplication.
- **Category filter chips** above the grid.
- **Per-app connect modals** replace the generic "Add Connection" chooser. Each app's modal uses that app's own vocabulary ("Connect Gmail" with "Continue to Google"; "Connect HubSpot" with "HubSpot Private App Token").
- **Multi-connect:** "Manage" on a connected card opens a drawer listing individual connections with per-connection Test / Edit label / Disconnect actions and a "+ Add another" CTA.

### 5.5 New Govern-surface routes

New server routes expose all Add/Edit/Test operations from the Govern surface, replacing the legacy `IntegrationsAndCredentialsPage` API calls. These routes live under the existing `/api/subaccounts/:subaccountId/` namespace.

### 5.6 Deprecated files

As part of this spec:
- `client/src/components/CredentialsTab.tsx` — deprecated, removed
- `client/src/pages/IntegrationsAndCredentialsPage.tsx` — deprecated, removed (or converted to a redirect to `/connections`)

All existing functionality (OAuth connect, web login Add/Edit/Test, API key management) migrates to the consolidated `ConnectionsPage` surface.

---

## 6. Design source of truth — mockup paths

All UI surfaces in this spec were designed across 13 mockup rounds. These files are the design source of truth for the builder. Spec prose supersedes mockups where they conflict; mockups win over prose where the spec is silent on visual detail.

**Root:** `prototypes/operator-session-identity/`

| Screen | File | What it shows |
|---|---|---|
| 01 | `01-connections-list.html` | AI Subscriptions tab — full list with Default hierarchy, failover explainer, `connected_unverified` row, gated-connect state, empty state |
| 01b | `01b-app-integrations-tab.html` | App Integrations tab — card grid, category filters, two sections |
| 01c | `01c-web-logins-tab.html` | Web Logins tab — sortable/filterable table with test-status dots |
| 02 | `02-connect-wizard.html` | Connect AI Subscription wizard — 4-step bar, provider handshake, happy path |
| 03 | `03-disclosure-plus.html` | Plus-tier disclosure — type-to-confirm first-time consent |
| 04 | `04-subscription-detail.html` | AI Subscription detail — metadata strip, Default, Availability, Currently used by, master switch, actions |
| 05 | `05-reauth-state.html` | Needs sign in banner state on detail page |
| 06 | `06-offboarding-state.html` | Disabled — owner inactive, platform-side banner |
| 07 | `07-availability-edit.html` | Edit availability modal — agent allowlist (All / Specific) |
| 08 | `08-agent-edit-model-access.html` | Agent edit page — read-only Model Access section (Standard runs / Autonomous runs split) |
| 10 | `10-connect-app-gmail.html` | Per-app connect modal — Gmail OAuth-style, no "OAuth" vocabulary |
| 11 | `11-connect-app-hubspot.html` | Per-app connect modal — HubSpot API key, uses "Private App Token" |
| 12 | `12-add-web-login.html` | Add Web Login modal — 4 primary fields + collapsed Advanced (6 schema fields) |
| 13 | `13-edit-web-login.html` | Edit Web Login modal — leave-blank password treatment |
| 14 | `14-test-web-login.html` | Test Web Login — agent attribution + running state |
| 15 | `15-disconnect-confirm.html` | Disconnect Confirm — shared shape, type-to-confirm, allowlist warning |
| 16 | `16-manage-multi-connect.html` | Multi-connect Manage drawer — per-connection actions, Add another |
| 17 | `17-make-default-confirm.html` | Make Default confirmation — business plan (State A) + personal plan + re-acknowledgement (State B) |
| 18 | `18-disclosure-version-bump.html` | Disclosure version bump re-acceptance modal |
| 19 | `19-revoked-by-openai-state.html` | Revoked by OpenAI state — provider-side, distinct from platform-side Disabled |
| 20 | `20-sign-in-again-light.html` | Lightweight re-auth flow — single CTA, no plan detection |

**Vocabulary palette** (locked in round 13, applies to all implementation copy):

| Concept | Locked verb / label |
|---|---|
| Add a new subscription | Connect |
| Refresh expired auth | Sign in again |
| Remove the subscription | Disconnect |
| Pause without removing | Turn off agent use |
| Hand to a new owner | Transfer ownership |
| Promote to default | Make default |
| Restrict to specific agents | Edit availability |
| `connected_usable` | Connected |
| `connected_needs_consent` | Needs consent |
| `connected_needs_reauth` | Needs sign in |
| `connected_unverified` | Plan not verified |
| `revoked` | Revoked by OpenAI |
| `disabled` | Disabled (+ cause sub-label) |
| Operator Controller runs | Autonomous runs |
| Phase 3+ (UI-facing) | Available soon |

---

## 7. Data model

### 7.1 Modified table — integration_connections

**Migrations ship in dependency order:**
- `0318_operator_session_consents.sql` (this section: §7.2 + §7.3 — creates the two new consent tables FIRST so the FK target exists)
- `0319_operator_session_columns.sql` (this section: adds 6 columns + partial unique index on `integration_connections`, including the `consent_record_id` FK pointing at the table created in 0318)

The migration ordering is critical: `integration_connections.consent_record_id` references `operator_session_consents.id`, so the referenced table must be created first. Migration 0319 also adds `'operator_session'` to the `auth_type` CHECK constraint.

```sql
-- Migration 0319_operator_session_columns.sql
ALTER TABLE integration_connections
  ADD COLUMN usability_state          text,
  ADD COLUMN plan_tier                text,
  ADD COLUMN plan_verification_status text,
  ADD COLUMN plan_verified_at         timestamptz,
  ADD COLUMN consent_record_id        uuid REFERENCES operator_session_consents(id) ON DELETE SET NULL,
  ADD COLUMN is_default               boolean NOT NULL DEFAULT false;
-- Partial unique index: at most one Default operator_session row per subaccount.
CREATE UNIQUE INDEX ic_subaccount_operator_session_default_unique
  ON integration_connections (subaccount_id)
  WHERE auth_type = 'operator_session' AND is_default = true;
```

Nullability: `usability_state`, `plan_tier`, `plan_verification_status`, `plan_verified_at`, and `consent_record_id` are nullable so existing non-operator_session rows are unaffected. `is_default` is `NOT NULL DEFAULT false` so existing rows are populated automatically with the safe default and the partial unique index applies only to operator_session rows.

Add `'operator_session'` to the `auth_type` enum. Because Drizzle uses text with runtime enum, this is a CHECK constraint addition on the column — no Postgres ENUM DDL required.

**Drizzle schema additions** (`server/db/schema/integrationConnections.ts`):

```typescript
// New columns (operator_session only; null/default for other auth types)
usabilityState: text('usability_state'),          // 'connected_usable' | 'connected_needs_consent' | 'connected_needs_reauth' | 'connected_unverified' | 'revoked' | 'disabled'
planTier: text('plan_tier'),                        // 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown'
planVerificationStatus: text('plan_verification_status'), // 'verified' | 'self_declared' | 'unverified' | 'failed'
planVerifiedAt: timestamp('plan_verified_at', { withTimezone: true }),
consentRecordId: uuid('consent_record_id').references(() => operatorSessionConsents.id),
isDefault: boolean('is_default').notNull().default(false),  // partial unique index enforces ≤1 default per subaccount for operator_session
```

**Existing column mapping** (operator_session re-uses existing columns):

| Brief field | Existing integration_connections column |
|---|---|
| `auth_token` | `accessToken` |
| `refresh_token` | `refreshToken` |
| `token_expires_at` | `tokenExpiresAt` |
| `provider` | `providerType` (set to `'openai'` for V1) |

**Auth type extension:** Add `'operator_session'` to the `authType` field's TypeScript union and any Zod schema that validates the field.

---

### 7.2 New table — operator_session_consents

**Migration:** `0318_operator_session_consents.sql`

Append-only with one narrow, service-enforced exception. Rows are NEVER deleted. The only UPDATE permitted on this table is a one-time write that fills `connection_id` from NULL to a non-NULL UUID, performed inside the same transaction as the corresponding initial-connect INSERT (see §11.1 step 4). This exception exists because the FK target for `integration_connections.consent_record_id` must be created before the connection row, but the consent row's reverse pointer `connection_id` is itself a FK that needs the connection UUID — a circular dependency that the spec resolves with a single-shot post-INSERT UPDATE inside the connect transaction. The `operatorSessionConsentService` layer is the only code path permitted to perform this UPDATE; direct DB access is rejected by the service contract. After commit, the row is fully immutable for the rest of its 7-year retention window. Revocation, supersession, and re-acceptance are modelled as events in `operator_session_consent_events`; no consent row is ever updated to reflect them.

```sql
CREATE TABLE operator_session_consents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id           uuid REFERENCES subaccounts(id) ON DELETE SET NULL,
  user_id                 uuid REFERENCES users(id) ON DELETE SET NULL,
  connection_id           uuid REFERENCES integration_connections(id) ON DELETE SET NULL,
  plan_tier               text NOT NULL,           -- 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown'
  disclosure_version      integer NOT NULL,
  accepted_at             timestamptz NOT NULL DEFAULT now(),
  disclosure_text_snapshot text NOT NULL,          -- full text of disclosure at time of consent
  consent_text_snapshot   text NOT NULL,           -- full text of consent language at time of consent
  CONSTRAINT operator_session_consents_user_disclosure_unique
    UNIQUE (organisation_id, subaccount_id, user_id, disclosure_version)
);

ALTER TABLE operator_session_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_session_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY operator_session_consents_org_isolation ON operator_session_consents
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

**7-year retention invariant:** Rows MUST be excluded from all org-deletion and subaccount-deletion cleanup paths. When the originating user or subaccount is deleted: PII in `disclosure_text_snapshot` / `consent_text_snapshot` may be minimised (stripped to hash) where legally permissible; `user_id` and `subaccount_id` are nulled automatically via `ON DELETE SET NULL`; the row itself is retained. The `organisation_id` FK uses `ON DELETE RESTRICT` because it is the RLS partitioning key — orphaned consent rows would leak across tenants. Org-level deletion goes through a separate compliance-reviewed path that explicitly handles or archives consent rows before the org row is dropped. Access to retained rows is compliance-role restricted post-deletion.

---

### 7.3 New table — operator_session_consent_events

**Migration:** `0318_operator_session_consents.sql` (same migration)

Append-only event log for consent lifecycle. Supersession lives here; consent rows are immutable.

```sql
CREATE TABLE operator_session_consent_events (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  consent_id                uuid NOT NULL REFERENCES operator_session_consents(id) ON DELETE RESTRICT,
  event_type                text NOT NULL CHECK (event_type IN ('granted', 'revoked', 'superseded')),
  actor_user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  at                        timestamptz NOT NULL DEFAULT now(),
  superseded_by_consent_id  uuid REFERENCES operator_session_consents(id) ON DELETE SET NULL -- non-null only for 'superseded'
);

ALTER TABLE operator_session_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_session_consent_events FORCE ROW LEVEL SECURITY;
CREATE POLICY operator_session_consent_events_org_isolation ON operator_session_consent_events
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

---

### 7.4 Provider capability registry

A TypeScript `const` map in `server/config/operatorSessionProviders.ts`. V1 contains one entry.

```typescript
export type ProviderCapabilityEntry = {
  displayName: string;
  connectionMechanism: 'oauth_pkce' | 'device_flow' | 'api_key' | 'none_verified';
  planDetectionMechanism: 'introspection_api' | 'probe' | 'self_declaration' | 'none';
  refreshSupport: boolean;
  revocationSignalSupport: 'push_event' | 'poll' | 'none';
  runtimeUseEnabled: boolean;  // false = no adapter consumes yet
  sanctionedTiers: Array<'pro' | 'team' | 'enterprise'>;
  optInTiers: Array<'plus'>;   // require consent flow
};

export const OPERATOR_SESSION_PROVIDERS: Record<string, ProviderCapabilityEntry> = {
  openai: {
    displayName: 'OpenAI / ChatGPT',
    connectionMechanism: 'none_verified',  // UPDATE when mechanism is confirmed
    planDetectionMechanism: 'self_declaration',
    refreshSupport: true,
    revocationSignalSupport: 'none',
    runtimeUseEnabled: false,
    sanctionedTiers: ['pro', 'team', 'enterprise'],
    optInTiers: ['plus'],
  },
};
```

**Update rule:** When the OpenAI connection mechanism is confirmed, `connectionMechanism` is updated to the correct value (e.g., `'oauth_pkce'`) and `runtimeUseEnabled` remains `false` until the OpenClaw adapter ships. Future providers add a new entry without schema or service changes.

**Plan verification outcome by detection mechanism.** A given provider's `planDetectionMechanism` determines the `plan_verification_status` written when a connection is created:

| `planDetectionMechanism` | Plan classified as sanctioned (pro/team/enterprise) | Plan classified as Plus | Plan ambiguous or unparseable |
|---|---|---|---|
| `introspection_api` | `'verified'` — usability_state = `'connected_usable'` directly | `'verified'` — usability_state = `'connected_usable'` after disclosure | `'failed'` — usability_state = `'connected_unverified'`, treat as Plus-equivalent (consent required to proceed) |
| `probe` | `'verified'` if probe signal is unambiguous; `'self_declared'` otherwise | `'verified'` if probe + user input agree; `'self_declared'` otherwise | `'failed'` — `'connected_unverified'` |
| `self_declaration` | `'self_declared'` always — `usability_state = 'connected_unverified'` per §11.1; the connection requires a disclosure acceptance even for nominally-sanctioned tiers, because we cannot independently verify the user's tier claim | `'self_declared'` — `'connected_unverified'`, identical to sanctioned tiers under self-declaration | `'failed'` — `'connected_unverified'` |
| `none` | (this branch is unreachable — if no detection mechanism is available, the spec MUST mark `runtimeUseEnabled: false` and gate the connect route) | (same) | (same) |

The V1 OpenAI entry uses `self_declaration`, so EVERY new operator_session connection in V1 lands in `usability_state = 'connected_unverified'` with `plan_verification_status = 'self_declared'`, and EVERY connect attempt requires a `disclosureAcceptance` block per §11.1. When the OpenAI introspection mechanism is verified, the registry entry flips to `'introspection_api'`, and the verification branch in `operatorSessionService` will start producing `'verified'` + `'connected_usable'` rows automatically — no schema change needed.

---

### 7.5 usability_state state machine

The six `usability_state` values form a closed set. Transitions:

```
                    Connect + plan verified (sanctioned tier)
(none) ──────────────────────────────────────────────────────► connected_usable
                    Connect + plan = plus + consent accepted
(none) ──────────────────────────────────────────────────────► connected_usable

connected_usable ──── plan = plus, disclosure_version bumped ──► connected_needs_consent
connected_usable ──── token refresh failed (auth/scope error) ──► connected_needs_reauth
connected_usable ──── provider revoked session ──────────────────► revoked
connected_usable ──── admin/offboarding disable ─────────────────► disabled

connected_needs_consent ──── user re-accepts ────────────────────► connected_usable
connected_needs_consent ──── admin disable ──────────────────────► disabled

connected_needs_reauth ──── user signs in again ─────────────────► connected_usable
connected_needs_reauth ──── admin disable ───────────────────────► disabled

connected_unverified ──── plan verification succeeds ────────────► connected_usable
connected_unverified ──── treat as plus-equivalent, consent OK ──► connected_usable
connected_unverified ──── admin disable ─────────────────────────► disabled

revoked ─── (terminal; re-connect creates a NEW row; this row stays revoked)
disabled ── (terminal; re-connect creates a NEW row; this row stays disabled)
```

**Forbidden transitions:**
- `revoked → connected_usable` (revoke is provider-side, immutable on this row)
- `disabled → connected_usable` (disable is platform-side, immutable on this row)
- Any state → any state by updating a field without going through the lifecycle service

State transitions are written only by `operatorSessionLifecycleService` (new, §8). Direct column updates outside the service are prohibited.

**Distinct semantics:**
- `revoked` = provider-side fact. OpenAI invalidated the session. Audit event type: `operator_session.revoked`.
- `disabled` = platform-side fact. Admin action, offboarding, disclosure version supersession, or permission loss. Audit event type: `operator_session.disabled`. These are orthogonal: a credential can be `disabled` while still provider-valid, or `revoked` while platform policy would have allowed it.

---

## 8. File inventory lock

Every file this spec touches. If any file listed here is not created/modified, the build is incomplete.

### 8.1 New migrations

| Migration | Purpose |
|---|---|
| `migrations/0318_operator_session_consents.sql` | Create `operator_session_consents` (with `UNIQUE (organisation_id, subaccount_id, user_id, disclosure_version)`) + `operator_session_consent_events`, both with RLS. Ships FIRST so the FK target exists before migration 0319. |
| `migrations/0319_operator_session_columns.sql` | Add 6 columns to `integration_connections` (usability_state, plan_tier, plan_verification_status, plan_verified_at, consent_record_id, is_default) + partial unique index `ic_subaccount_operator_session_default_unique`; add `'operator_session'` to auth_type. Depends on 0318. |

### 8.2 New schema files

| File | Purpose |
|---|---|
| `server/db/schema/operatorSessionConsents.ts` | Drizzle schema for `operator_session_consents` |
| `server/db/schema/operatorSessionConsentEvents.ts` | Drizzle schema for `operator_session_consent_events` |

### 8.3 Modified schema files

| File | Change |
|---|---|
| `server/db/schema/integrationConnections.ts` | Add 5 new columns; add `'operator_session'` to authType union |
| `server/db/schema/index.ts` | Export new schema files |

### 8.4 New config files

| File | Purpose |
|---|---|
| `server/config/operatorSessionProviders.ts` | Provider capability registry (§7.4) |
| `server/config/rlsProtectedTables.ts` | ADD entries for two new tables |

### 8.5 New services

| File | Purpose |
|---|---|
| `server/services/operatorSessionService.ts` | Connect flow, plan detection, `usability_state` management |
| `server/services/operatorSessionConsentService.ts` | Append-only consent row writer (with the one-time `connection_id` back-fill exception per §7.2 / §11.1), consent-event recording, disclosure-version-bump detection (on-read per §11.4), retention enforcement. No UPDATE or DELETE primitives beyond the back-fill — historical changes are recorded as new event rows. |
| `server/services/operatorSessionLifecycleService.ts` | State machine transitions (the only code allowed to write `usability_state`) |
| `server/services/operatorSessionLifecycleServicePure.ts` | Pure functions for failure classification, state-transition logic (testable) |

### 8.6 Modified services

| File | Change |
|---|---|
| `server/services/credentialBrokerService.ts` | Add `'operator_session'` branch to `issueCredential`, `injectIntoEnvironment`, `resolveAvailableCredentials`; implement broker retrieval invariant + redacted envelope |

### 8.7 New jobs

| File | Purpose |
|---|---|
| `server/jobs/operatorSessionRefreshJob.ts` | pg-boss job: token refresh ahead of TTL, failure classification, state transitions |
| `server/jobs/index.ts` | Register the new job |
| `server/config/jobConfig.ts` | Add job entry for `operatorSessionRefresh` |

### 8.8 New routes

| File | Purpose |
|---|---|
| `server/routes/operatorSessionConnections.ts` | Full CRUD: connect, list, get, update (label/display-name), make-default, edit availability (allow-agent-use), disconnect, consent, re-auth trigger. Permission gates per §10.4. |
| `server/routes/webLoginConnectionsGovern.ts` | Govern-surface Add/Edit/Test Web Login routes migrated from the legacy `IntegrationsAndCredentialsPage` API. Mounts under `/api/subaccounts/:subaccountId/web-login-connections/...`. Reuses existing `webLoginConnections.ts` service layer; only the HTTP surface is new. Permission guards match the legacy routes (`subaccount.connections.manage`). |

### 8.9 Modified routes

| File | Change |
|---|---|
| `server/services/connectionsService.ts` | Extend `listConnections` to include `auth_type = 'operator_session'` rows in the Govern surface response |
| `server/routes/index.ts` | Register `operatorSessionConnections` + `webLoginConnectionsGovern` routers |

### 8.10 Shared types

| File | Change |
|---|---|
| `shared/types/govern.ts` | Add `'ai_subscription'` to `authMethod` union on `Connection`; add `usabilityState`, `planTier`, `isDefault`, `availabilityScope` fields to a new `AiSubscriptionConnection` extended type |

### 8.11 New permissions

| File | Change |
|---|---|
| `server/lib/permissions.ts` | Add 5 new permission keys (§10.1); add to `ALL_PERMISSIONS` catalogue |

### 8.12 Client — new pages / components

| File | Purpose |
|---|---|
| `client/src/pages/govern/components/AiSubscriptionsTab.tsx` | AI Subscriptions tab — table with Default hierarchy, failover copy, sort/filter |
| `client/src/pages/govern/components/AppIntegrationsTab.tsx` | App Integrations tab — card grid, category filters, two sections |
| `client/src/pages/govern/components/WebLoginsTab.tsx` | Web Logins tab — sortable/filterable table with test-status dots |
| `client/src/pages/govern/components/ConnectAiSubscriptionModal.tsx` | Connect wizard + Plus disclosure flow |
| `client/src/pages/govern/components/AiSubscriptionDetailModal.tsx` | Subscription detail: metadata, default, availability, lifecycle actions |
| `client/src/pages/govern/components/EditAvailabilityModal.tsx` | Agent allowlist editor |
| `client/src/pages/govern/components/MakeDefaultConfirmModal.tsx` | Make Default confirm — business plan (State A) + personal plan re-ack (State B) |
| `client/src/pages/govern/components/SignInAgainModal.tsx` | Lightweight re-auth modal (screen 20) |
| `client/src/pages/govern/components/DisclosureVersionBumpModal.tsx` | Disclosure version bump re-acceptance (screen 18) |
| `client/src/pages/govern/components/AddWebLoginModal.tsx` | Add Web Login form (migrated from CredentialsTab) |
| `client/src/pages/govern/components/EditWebLoginModal.tsx` | Edit Web Login form |
| `client/src/pages/govern/components/TestWebLoginModal.tsx` | Test Web Login — agent attribution + running state |
| `client/src/pages/govern/components/ConnectAppModal.tsx` | Per-app connect modal (configurable per provider; renders Gmail, HubSpot variants) |
| `client/src/pages/govern/components/ManageMultiConnectDrawer.tsx` | Multi-connect Manage drawer |
| `client/src/pages/govern/components/DisconnectConfirmDialog.tsx` | Disconnect Confirm (replaces existing component from consolidation-govern) |

### 8.13 Client — modified files

| File | Change |
|---|---|
| `client/src/pages/govern/ConnectionsPage.tsx` | Add 3-tab strip; mount AiSubscriptionsTab, AppIntegrationsTab, WebLoginsTab |
| `client/src/api/governApi.ts` | Add API calls for AI Subscription CRUD, consent, availability |
| `client/src/config/routes.ts` | No new routes (all surfaces live under `/connections`) |

### 8.14 Deprecated / removed client files

| File | Disposition |
|---|---|
| `client/src/components/CredentialsTab.tsx` | Removed (functionality migrated) |
| `client/src/pages/IntegrationsAndCredentialsPage.tsx` | Removed or converted to redirect to `/connections` |

### 8.15 Agent edit page

| File | Change |
|---|---|
| `client/src/pages/build/AgentEditPage.tsx` | Add read-only Model Access section (Standard runs / Autonomous runs split) |
| `client/src/pages/SubaccountAgentEditPage.tsx` | Same addition |

### 8.16 Architecture documentation

| File | Change |
|---|---|
| `architecture.md` | Add Credential Broker section for operator_session; update Key files per domain; add /connections CRUD consolidation note |
| `docs/capabilities.md` | Add AI Subscriptions capability entry per Editorial Rules |

---

## 9. Contracts

### 9.1 Broker retrieval envelope (redacted)

The only data shape returned by `credentialBrokerService.issueCredential` for an `operator_session` credential. Raw token material (`auth_token`, `refresh_token`) is NEVER included. The broker unwraps it internally for injection only.

```typescript
// Produced by: credentialBrokerService.issueCredential (when authType = 'operator_session')
// Consumed by: future adapters (OpenClaw, Phase 3+)
interface OperatorSessionEnvelope {
  credentialId: string;          // opaque reference, not the connection ID
  connectionId: string;
  authType: 'operator_session';
  provider: string;              // 'openai'
  planTier: 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown';
  usabilityState: 'connected_usable'; // broker refuses to return any other state
  issuedAt: string;              // ISO 8601
  expiresAt: string | null;      // ISO 8601 or null
}
// Redaction applies to: logs, audit context, run traces, prompts, tool inputs,
// UI payloads, error objects, telemetry, test snapshots. Never raw token.
```

**Broker retrieval invariant** (brief §2.15 + §2.10):
```typescript
// Inside credentialBrokerService.issueCredential for operator_session:
// 1. Read connection row (NOT decrypting token yet)
// 2. Check usability_state === 'connected_usable'
//    If not: throw CredentialNotUsableError(state) — no decryption attempted
// 3. Only if state === 'connected_usable': decrypt and inject token material
// 4. Return OperatorSessionEnvelope (token material excluded)
```

**Acceptance test:** A unit test proves that calling `issueCredential` for any state other than `connected_usable` throws before any decryption step, using a mock that asserts `connectionTokenService.decryptToken` is never called.

---

### 9.2 AI Subscription connection shape (Connections API)

Extended `Connection` type for `operator_session` rows returned by `listConnections`:

```typescript
// Producer: server/routes/operatorSessionConnections.ts
// Consumer: client/src/pages/govern/components/AiSubscriptionsTab.tsx
interface AiSubscriptionConnection {
  id: string;
  authMethod: 'ai_subscription';          // maps to auth_type = 'operator_session' internally
  provider: string;                        // 'openai'
  planTier: 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown';
  planVerificationStatus: 'verified' | 'self_declared' | 'unverified' | 'failed';
  planVerifiedAt: string | null;           // ISO 8601
  usabilityState: 'connected_usable' | 'connected_needs_consent' | 'connected_needs_reauth' | 'connected_unverified' | 'revoked' | 'disabled';
  /**
   * Sub-label for the visible state pill — populated only when usabilityState !== 'connected_usable'.
   * The values align with the state machine in §7.5: `disabled` states emit a `disabledReason`,
   * `connected_needs_consent`/`connected_needs_reauth`/`connected_unverified` emit a `pendingReason`,
   * `revoked` carries no sub-label (the source is always the provider, surfaced via the audit event type).
   */
  disabledReason: 'owner_inactive' | 'admin_disabled' | 'disclosure_superseded' | null;  // populated only when usabilityState === 'disabled'
  pendingReason:  'needs_new_consent' | 'needs_reauth' | 'plan_unverified' | null;       // populated only when usabilityState ∈ {connected_needs_consent, connected_needs_reauth, connected_unverified}
  isDefault: boolean;
  availabilityScope: 'all_agents' | 'specific_agents';
  allowedAgentIds: string[] | null;       // null when scope = 'all_agents'
  label: string | null;
  owner: { kind: 'workspace'; id: string; name: string };
  lastRefreshedAt: string | null;          // ISO 8601
  createdAt: string;
  // Token material: NEVER present. Raw auth_token/refresh_token never leave the server.
}
```

---

### 9.3 Consent record shape

```typescript
// Produced by: operatorSessionConsentService.recordConsent
// Consumed by: compliance views (future); consent version-bump check
interface OperatorSessionConsent {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  userId: string;
  connectionId: string | null;
  planTier: string;
  disclosureVersion: number;
  acceptedAt: string;         // ISO 8601
  disclosureTextSnapshot: string;
  consentTextSnapshot: string;
}
```

---

### 9.4 Consent event shape

```typescript
// Produced by: operatorSessionConsentService.{recordConsent | revokeConsent | supersedeConsent}
interface OperatorSessionConsentEvent {
  id: string;
  organisationId: string;
  consentId: string;
  eventType: 'granted' | 'revoked' | 'superseded';
  actorUserId: string | null;
  at: string;                           // ISO 8601
  supersededByConsentId: string | null; // non-null only for 'superseded'
}
```

---

### 9.5 Failure classification shape

Returned by `operatorSessionLifecycleServicePure.classifyRefreshFailure`:

```typescript
type RefreshFailureBucket =
  | 'expired_refresh_token'   // marks unusable → connected_needs_reauth
  | 'provider_revoked'        // marks unusable → revoked
  | 'insufficient_scope'      // marks unusable → connected_needs_reauth
  | 'provider_unavailable'    // retryable → stay usable, exponential backoff
  | 'rate_limited'            // retryable → stay usable, exponential backoff
  | 'unknown';                // marks unusable → connected_needs_reauth + alert

interface RefreshFailureClassification {
  bucket: RefreshFailureBucket;
  marksUnusable: boolean;
  nextState: 'connected_usable' | 'connected_needs_reauth' | 'revoked' | null; // null = stay in current
  shouldAlert: boolean;
}
```

Producer: `operatorSessionLifecycleServicePure.classifyRefreshFailure(error)`.
Consumer: `operatorSessionRefreshJob` — applies state transition based on `nextState`.

---

### 9.6 Source-of-truth precedence

When the same fact appears in multiple representations:

| Fact | Source of truth | Read path |
|---|---|---|
| `usability_state` | `integration_connections.usability_state` column | Always read from DB; never inferred from token TTL alone |
| Whether a subscription is Default | `integration_connections.is_default` column (operator_session rows only); partial unique index `ic_subaccount_operator_session_default_unique` guarantees at most one Default per subaccount | DB query; never client-side |
| Consent status | Latest `operator_session_consent_events.event_type` for the consent's `consent_id` | Event table; consent row is immutable |
| Connection's current consent | `integration_connections.consent_record_id` (forward pointer on the connection row) is canonical. `operator_session_consents.connection_id` is a historical reverse pointer for compliance lookups and audit only — it MUST NOT be used to determine which consent currently authorises a connection. When the two diverge (e.g. consent superseded), the connection's `consent_record_id` wins; the consent row's `connection_id` stays at the original value forever (immutable). | Read `consent_record_id` from the connection; never traverse from consent → connection for "which consent authorises this credential". |
| Plan tier | `integration_connections.plan_tier` column | DB; never inferred from token at runtime |
| Token expiry | `integration_connections.token_expires_at` | DB; compared to `now()` by the lifecycle service before injecting |
| Failover order for an agent run | `credentialBrokerService.resolveAvailableCredentials` returns the ordered list per the rule below; the agent run loop reads positions left-to-right and never re-sorts | Broker is single source of truth for ordering; consumers MUST NOT reorder |

### 9.7 Failover ordering contract (locked, Goal §2 item 14)

`credentialBrokerService.resolveAvailableCredentials` for an operator_session-capable agent run returns a deterministic ordered array of resolved credentials. The ordering rule is:

1. The subaccount's Default operator_session connection (the row with `is_default = true`), if it is in `usability_state = 'connected_usable'` AND the agent is in its `allowedAgentIds` allowlist (or the connection's `availabilityScope = 'all_agents'`).
2. All other operator_session connections in the same subaccount that are in `usability_state = 'connected_usable'` AND allow the agent, sorted by `label ASC NULLS LAST, id ASC` (label-driven alphabetical order; `id` tiebreaker for determinism when labels are identical or NULL).
3. Platform-managed providers (existing `oauth2` / `api_key` connection rows that previously served the agent's model needs) sorted by their existing resolution rule (unchanged by this spec).

The agent run loop consumes the array in order: try position 0, on retryable failure proceed to position 1, etc. Connections that move out of `connected_usable` mid-run are excluded from re-resolution but already-consumed positions are not re-evaluated within the same run.

`label ASC NULLS LAST` ordering uses Postgres `ORDER BY label ASC NULLS LAST, id ASC` and is implemented in the broker's SQL — not in JavaScript — so the order is deterministic regardless of caller. The acceptance criteria in §17 add a test that confirms (a) Default-first, (b) alphabetical-by-label thereafter, (c) NULLS LAST, (d) `id` tiebreaker.

---

## 10. Permissions and RLS checklist

### 10.1 New permission keys

Five permission gates per brief §2.14, mapped to the existing `server/lib/permissions.ts` pattern:

```typescript
// Add to SUBACCOUNT_PERMISSIONS:
OPERATOR_SESSION_CONNECT:          'subaccount.operator_session.connect',
OPERATOR_SESSION_VIEW:             'subaccount.operator_session.view',
OPERATOR_SESSION_DISCONNECT:       'subaccount.operator_session.disconnect',
OPERATOR_SESSION_REAUTH:           'subaccount.operator_session.reauth',
OPERATOR_SESSION_ALLOW_AGENT_USE:  'subaccount.operator_session.allow_agent_use',
```

Add all five to `ALL_PERMISSIONS` with `groupName: 'AI Subscriptions'` and plain-English descriptions.

**Role bindings** (using existing RBAC):

| Permission key | Minimum role |
|---|---|
| `subaccount.operator_session.view` | `subaccount_member` |
| `subaccount.operator_session.connect` | `subaccount_admin` |
| `subaccount.operator_session.disconnect` | `subaccount_admin` |
| `subaccount.operator_session.reauth` | `subaccount_admin` |
| `subaccount.operator_session.allow_agent_use` | `org_admin` |

Raw token material is broker-internal at all permission levels — never accessible to any user-facing role.

---

### 10.2 RLS — operator_session_consents

- RLS enabled: YES (`ENABLE ROW LEVEL SECURITY`)
- FORCE RLS: YES (fail-closed when GUC unset)
- Policy: org-isolation (standard three-guard pattern, §7.2)
- Manifest entry: add to `server/config/rlsProtectedTables.ts`
- Migration: `0318_operator_session_consents.sql`
- Route guard: all reads/writes go through `operatorSessionConsentService` which sets GUC via `withOrgTx`
- Principal-scoped context: not accessed from agent execution paths in V1; no P3B principal context needed yet

---

### 10.3 RLS — operator_session_consent_events

Same as §10.2. Same migration. Add a separate entry to `rlsProtectedTables.ts`.

---

### 10.4 Route guards

All new routes in `server/routes/operatorSessionConnections.ts` must apply guards in this order:

```
authenticate → requireSubaccountPermission(OPERATOR_SESSION_X) → asyncHandler
```

Specific mappings:

| Route | Permission required |
|---|---|
| `GET /api/subaccounts/:id/operator-session-connections` | `operator_session.view` |
| `POST /api/subaccounts/:id/operator-session-connections` | `operator_session.connect` |
| `GET /api/subaccounts/:id/operator-session-connections/:connId` | `operator_session.view` |
| `PATCH /api/subaccounts/:id/operator-session-connections/:connId` | `operator_session.connect` (for label/display-name changes only; Make Default uses the dedicated `/make-default` route; availability uses the dedicated `/allow-agent-use` route) |
| `DELETE /api/subaccounts/:id/operator-session-connections/:connId` | `operator_session.disconnect` |
| `POST /api/subaccounts/:id/operator-session-connections/:connId/consent` | `operator_session.connect` |
| `POST /api/subaccounts/:id/operator-session-connections/:connId/make-default` | `operator_session.connect` |
| `POST /api/subaccounts/:id/operator-session-connections/:connId/reauth` | `operator_session.reauth` |
| `PATCH /api/subaccounts/:id/operator-session-connections/:connId/allow-agent-use` | `operator_session.allow_agent_use` |

---

### 10.5 /connections page consolidation — existing guards

The existing `GET /api/subaccounts/:id/connections` (and web-login routes migrated into `ConnectionsPage`) already use `subaccount.connections.view` / `subaccount.connections.manage`. These are unchanged.

New Add/Edit/Test routes exposed via the Govern surface MUST use the same guards as their legacy equivalents — no permission gap should be introduced by the consolidation.

---

## 11. Execution model

### 11.1 Connection flow (sync, inline)

The provider connection handshake is inline / synchronous from the client's perspective. All DB writes for a single connect attempt happen inside ONE transaction so partial-success is impossible.

1. Client POST to `connect` route. For Plus tier, the client UI has already gathered the typed-confirmation disclosure acceptance; the `connect` POST body includes a `disclosureAcceptance: { disclosureVersion, consentText }` block. Pre-flight validation rejects a Plus connect without this block (422 `plus_consent_required`) before any provider call.
2. Server calls provider OAuth endpoint (or equivalent verified mechanism).
3. Server receives token, validates plan tier.
4. BEGIN transaction:
   - For Plus tier: INSERT the `operator_session_consents` row using the `disclosureAcceptance` block from the request. Also INSERT a `granted` event into `operator_session_consent_events`. Capture the new `consent_id`.
   - INSERT the `integration_connections` row with `usability_state = 'connected_usable'` (or `connected_unverified` if plan verification could not classify the plan as sanctioned), `consent_record_id = <consent_id or NULL for sanctioned tiers without disclosure>`, and the encrypted token material.
   - For Plus tier: UPDATE the consent row to set `connection_id = <new connection id>` (the only mutation ever permitted on a consent row, because the FK target did not exist when the row was first inserted). This is the documented exception to the "append-only" rule and is enforced at the service layer (no other code path may UPDATE a consent row).
   - COMMIT.
5. Server responds 201 with the `AiSubscriptionConnection` shape (no token material).

**Why the back-pointer is mutable exactly once:** `operator_session_consents.connection_id` is a historical reverse pointer captured at the moment of consent. The connect transaction is the only point where the connection's UUID is generated *after* the consent row exists (because the consent must be persisted first to satisfy the FK from `integration_connections.consent_record_id`). The service layer enforces a strict invariant: the only UPDATE permitted on `operator_session_consents` is a one-time write that fills `connection_id` from NULL to a non-NULL UUID within the same connect transaction. After commit, the row is fully immutable. The `consent_record_id` forward pointer on the connection (§9.6) remains the canonical link.

**Re-acceptance flow (distinct from initial connect):** The separate `POST /api/subaccounts/:id/operator-session-connections/:connId/consent` route (§10.4) is used ONLY when an EXISTING connection's `usability_state` is `connected_needs_consent` after a disclosure-version bump. That route writes a NEW consent row (linked to the existing `connId` from the start, so no UPDATE-of-connection_id is needed), writes a `superseded` event linking the prior consent, updates `integration_connections.consent_record_id` to the new consent, and transitions `usability_state` back to `connected_usable`. The route returns 422 if no prior consent record exists for the connection — that case must go through the initial `connect` flow instead.

**Unverified plan-tier branch:** When `plan_verification_status` cannot resolve the plan to a sanctioned tier (provider self-declaration unverified or returns ambiguous data), the connection lands in `usability_state = 'connected_unverified'`. The spec treats this as Plus-equivalent: the connect request MUST include a `disclosureAcceptance` block, and the consent row is recorded the same way as for explicit Plus tier (the disclosure_text_snapshot reflects the unverified-tier wording). The credential is NOT usable by adapters until verification succeeds or the user explicitly re-confirms it as Plus-tier via the detail page.

**If provider mechanism is unverified at build time:** Step 2 and 3 are gated. The `connect` route returns `501 provider_mechanism_not_verified` with a body explaining the gate. Schema and consent model are deployed; connection wiring activates when the mechanism is confirmed.

### 11.2 Token lifecycle refresh (queued, pg-boss)

**NOT inline.** Refresh happens in a background pg-boss job:

- Queue: `operator-session-refresh`
- Trigger: scheduled per-org sweep, plus on-demand trigger when `token_expires_at` is within a configurable TTL window (default: 30 minutes)
- Handler: `operatorSessionRefreshJob.ts` via `createWorker`
- Idempotency: pg-boss `singletonKey = ${connection_id}:${refresh_bucket}` where `refresh_bucket` is the 5-minute floor of `now()` at enqueue time. pg-boss collapses duplicate enqueues with the same singletonKey to a single queued job. No DB-level unique constraint is added — the dedup mechanism is pg-boss-internal, consistent with how other refresh jobs in this codebase scope their singletons.
- Failure handling: classify failure into 6 buckets (§9.5); retry with bounded exponential backoff for retriable buckets; transition `usability_state` for terminal buckets

### 11.3 Consent recording (sync, inline)

Consent is recorded synchronously inside the same DB transaction that creates the connection (see §11.1 step 4). The consent INSERT is the first statement in the transaction so the FK from `integration_connections.consent_record_id` is satisfiable; the one-time UPDATE of `operator_session_consents.connection_id` happens later in the same transaction once the connection's UUID is available. If any write in this transaction fails, the entire transaction rolls back — neither the consent nor the credential is persisted. The `connect` route returns 422 with the specific failure reason.

Re-acceptance after a disclosure-version bump uses the dedicated `/consent` route (§10.4) which writes a new consent row (with `connection_id` set at INSERT time, since the connection already exists), a `superseded` event, and updates the connection's `consent_record_id` forward pointer.

### 11.4 Disclosure version bump detection

When `OPERATOR_SESSION_DISCLOSURE_VERSION` config increments:

**On-read detection (V1 commitment).** The read path for AI Subscriptions checks whether the credential's consent record `disclosure_version` < current version. If so, the lifecycle service transitions `usability_state` to `connected_needs_consent` on first read after the version bump. The check itself is a pure function, testable; the transition write goes through `operatorSessionLifecycleService.transition` per §7.5.

A background-sweep alternative is deferred — see §13 Deferred Items — and would replace this on-read pattern only if scale demands it post-Phase 3+.

### 11.5 Connections page CRUD (sync, inline)

All Add/Edit/Test/Disconnect operations initiated from the `/connections` page are synchronous request-response. The exception is `Test Web Login`, which follows the existing IEE pattern:

1. POST to test route.
2. Server enqueues IEE `login_test` task (existing queue).
3. Server responds 202 with `{ agentRunId, ieeRunId, progressUrl }`.
4. Client follows `progressUrl` for status (existing run-trace pattern).

---

## 12. Implementation chunk plan

Dependencies must be strictly respected. No chunk may reference a schema, service, or file created in a later chunk.

### Chunk 1 — Schema foundations (migrations + Drizzle)

**Deliverables (ship in migration order — 0318 first, 0319 depends on it):**
- Migration 0318 (`0318_operator_session_consents.sql`): `operator_session_consents` + `operator_session_consent_events` tables with RLS, FORCE RLS, org-isolation policy, and the `UNIQUE (organisation_id, subaccount_id, user_id, disclosure_version)` constraint
- Migration 0319 (`0319_operator_session_columns.sql`): 6 new columns on `integration_connections` (`usability_state`, `plan_tier`, `plan_verification_status`, `plan_verified_at`, `consent_record_id`, `is_default`); partial unique index `ic_subaccount_operator_session_default_unique`; add `'operator_session'` to the `auth_type` CHECK constraint
- Drizzle schema files for both new tables
- Update `server/db/schema/index.ts`
- Add both new tables to `server/config/rlsProtectedTables.ts`
- `server/config/operatorSessionProviders.ts` (provider capability registry)

**No backward dependencies.** All other chunks depend on this one.

### Chunk 2 — Pure service layer (no DB writes)

**Deliverables:**
- `operatorSessionLifecycleServicePure.ts`: failure classification, state-transition decision logic
- Unit tests (vitest): `classifyRefreshFailure` for all 6 buckets; state-transition pure functions
- `operatorSessionConsentService.ts`: pure validation logic (disclosure version check, consent exists check)

**Depends on:** Chunk 1 (types from schema).

### Chunk 3 — Consent service + lifecycle service (DB writes)

**Deliverables:**
- `operatorSessionConsentService.ts` full implementation: `recordConsent`, `revokeConsent`, `supersedeConsent`, `checkConsentStatus`
- `operatorSessionLifecycleService.ts`: state transition writes (the only code that writes `usability_state`)
- `operatorSessionService.ts`: connect flow skeleton (plan-tier detection, consent check, initial usability_state assignment)

**Depends on:** Chunks 1, 2.

### Chunk 4 — Credential broker extension

**Deliverables:**
- Extend `credentialBrokerService.ts`:
  - `issueCredential` branch for `operator_session`
  - State-check-before-decrypt enforcement (broker retrieval invariant)
  - Redacted envelope return shape (`OperatorSessionEnvelope`)
  - `injectIntoEnvironment` branch (no-op for V1; structure for Phase 3+)
  - `resolveAvailableCredentials` includes operator_session rows
- Unit test: `issueCredential` for non-`connected_usable` states never calls `decryptToken`

**Depends on:** Chunks 1, 3.

### Chunk 5 — New permissions + API routes

**Deliverables:**
- Add 5 permission keys to `server/lib/permissions.ts` + `ALL_PERMISSIONS`
- `server/routes/operatorSessionConnections.ts`: full CRUD routes (list, get, connect, update, disconnect, consent, make-default, reauth, allow-agent-use)
- Mount new router in `server/routes/index.ts`
- Extend `listConnections` to include `operator_session` rows in the Govern API response
- Extend `shared/types/govern.ts` with `AiSubscriptionConnection` type

**Depends on:** Chunks 1, 3, 4.

### Chunk 6 — Token refresh job

**Deliverables:**
- `server/jobs/operatorSessionRefreshJob.ts`: pg-boss worker, failure classification, state transition calls
- Register in `server/jobs/index.ts` and `server/config/jobConfig.ts`
- `operatorSessionRefreshJob` entries in `jobConfig`

**Depends on:** Chunks 1, 2, 3.

### Chunk 7 — AI Subscriptions tab (client)

**Deliverables:**
- `AiSubscriptionsTab.tsx`: full list with Default visual hierarchy, failover explainer banner, sort/filter, all 6 `usability_state` pill variants (Connected, Needs consent, Needs sign in, Plan not verified, Revoked by OpenAI, Disabled + sub-label)
- `ConnectAiSubscriptionModal.tsx`: wizard (4-step bar, provider handshake, 501-gate state for unverified provider). Internally includes a Plus-tier disclosure step (mockup `03-disclosure-plus.html`) implemented as a private step component inside the modal — not a separate file in the §8.12 inventory.
- `AiSubscriptionDetailModal.tsx`: metadata strip, Default section, Availability section, "Currently used by" section, master switch, action buttons
- `MakeDefaultConfirmModal.tsx`: State A (business plan) + State B (personal plan + checkbox re-ack)
- `SignInAgainModal.tsx`: lightweight re-auth (screen 20)
- `DisclosureVersionBumpModal.tsx`: disclosure version bump (screen 18)
- `EditAvailabilityModal.tsx`: agent allowlist editor
- `governApi.ts` additions for all new API calls

**Depends on:** Chunk 5 (routes must exist for API calls).

### Chunk 8 — App Integrations tab (client)

**Deliverables:**
- `AppIntegrationsTab.tsx`: card grid, category filter chips, "Your connected apps" + "Apps you can connect" sections (mutually exclusive)
- `ConnectAppModal.tsx`: per-app configurable modal (Gmail variant: Continue to Google; HubSpot variant: Private App Token field)
- `ManageMultiConnectDrawer.tsx`: per-app multi-connect list drawer

**Depends on:** Chunk 5 (listConnections endpoint used for connected-apps section). No dependency on Chunks 6-7.

### Chunk 9 — Web Logins tab + connections CRUD consolidation (client)

**Deliverables:**
- `WebLoginsTab.tsx`: table with sort/filter, test-status dots, 3-dot menus
- `AddWebLoginModal.tsx`: 4 primary fields + collapsed Advanced (6 schema fields); migrate from `CredentialsTab`
- `EditWebLoginModal.tsx`: leave-blank-password treatment; migrate from `CredentialsTab`
- `TestWebLoginModal.tsx`: agent attribution + running state; migrate from `CredentialsTab`
- `DisconnectConfirmDialog.tsx`: shared type-to-confirm modal
- New server route file `server/routes/webLoginConnectionsGovern.ts` exposes Web Login Add/Edit/Test under `/api/subaccounts/:subaccountId/web-login-connections/...` for the Govern surface (was previously only reachable from the legacy `IntegrationsAndCredentialsPage`); reuses the existing service layer in `webLoginConnections.ts`
- Remove `CredentialsTab.tsx` and `IntegrationsAndCredentialsPage.tsx` (or convert the latter to a redirect)

**Depends on:** Chunk 5. Must run after Chunk 8 (both modify `ConnectionsPage`; parallel edit risk).

### Chunk 10 — ConnectionsPage tab wiring + agent edit Model Access

**Deliverables:**
- `ConnectionsPage.tsx`: add 3-tab strip, mount all three tab components, tab subtitles, tab count chips
- Agent edit pages (`AgentEditPage.tsx`, `SubaccountAgentEditPage.tsx`): read-only Model Access section (Standard runs / Autonomous runs split, links to Connections)
- `governApi.ts`: `getAgentAllowedSubscriptions(agentId, subaccountId)` for the agent-side Model Access summary

**Depends on:** Chunks 7, 8, 9 (all three tabs must exist before wiring).

### Chunk 11 — Architecture doc sync

**Deliverables:**
- `architecture.md`: add Credential Broker section for operator_session; update Key files per domain; add /connections CRUD consolidation note
- `docs/capabilities.md`: add AI Subscriptions capability entry

**Depends on:** All prior chunks (accurate only once implementation is complete).

---

## 13. Deferred items

- **Adapter runtime consumption.** No existing adapter consumes `operator_session` in V1. OpenClaw adapter spec (Phase 3+) is the first consumer. Deferred to `tasks/builds/openclaw-adapter/scope.md`.
- **Operator-session → API-key fallback path during an active run.** The broker may expose a `getNextFallback(agentId, currentConnectionId)` seam; OpenClaw spec decides whether and how to use it. Spec C may stub this method but not implement it.
- **BYO API keys (platform model provider selection UX).** Parked. Future spec.
- **Customer billing dashboards showing subscription-mediated zero-cost runs.** Phase 3.5+.
- **Customer-self-service tier switching UI.** Phase 3.5+.
- **CS runbook for "OpenAI suspended my account."** Deferred to OpenClaw adapter scope.
- **CS runbook for "temporarily degraded but recovering" (provider_unavailable / rate_limited state).** Provider-side temporary states remain `connected_usable`; no dedicated UI chip. Future scope.
- **Compliance-officer view of consent table.** 7-year retention is enforced; no user-facing audit view for compliance officers ships in V1. Deferred to a dedicated compliance tools spec.
- **Mobile-responsive `/connections` UI.** Deferred — letter-form cards and table layout require a separate responsive pass.
- **SVG icon system for app integration cards.** Letter-form avatars (GM, HS, SL etc.) ship in V1. Real app icons are a separate visual round when an icon system is adopted.
- **MCP server and Cookie auth-type UI surfaces.** Schema-level only in V1.
- **Multi-provider posture framework.** Schema seam exists. Anthropic Claude.ai / Google Gemini slot in via new registry entries without schema changes; but the provider-specific UI, connection flows, and plan-tier vocabularies for those providers are future scope.
- **Revocation signal support / webhook push.** V1 detects revocation via token refresh failure (classified as `provider_revoked`); proactive push events from OpenAI are not implemented. Registry entry marks `revocationSignalSupport: 'none'` until supported.
- **Failure classification UX for `provider_unavailable` / `rate_limited`.** These buckets keep the credential usable with exponential backoff retry. No UI indicator for "temporarily degraded." Deferred to a future observability pass.
- **Disclosure version bump via background sweep.** Spec picks "on-read" detection (§11.4 Option A) for V1. Option B (background sweep job) deferred.

---

## 14. Self-consistency pass

Cross-checks performed before submitting to spec-reviewer:

| Check | Result |
|---|---|
| Goals (§2) vs File inventory (§8): every goal has ≥1 file | Pass — 16 goals, all covered by chunks 1-11 |
| Non-goals (§3) do not appear in chunk deliverables | Pass — no adapter wiring, no billing dashboard, no BYO keys in any chunk |
| State machine (§7.5) transitions are complete and closed | Pass — 6 states, all transitions named, terminal states correct, forbidden transitions listed |
| Contracts (§9) cover all service-boundary crossings | Pass — broker envelope, AI Subscription shape, consent shape, event shape, failure classification all defined with examples |
| Every new table has RLS policy + manifest entry + route guard (§10) | Pass — 2 new tables, both in §10.2/10.3 + manifest + guarded routes |
| Execution model (§11) consistent with chunk plan (§12): no sync→async contradiction | Pass — lifecycle refresh is queued (Chunk 6); connect flow is inline (Chunk 3/5); consent recording is inline (Chunk 3) |
| Deferred items (§13) do not appear in chunk deliverables | Pass — OpenClaw adapter, billing, BYO keys, compliance view all absent from Chunks 1-11 |
| Brief §2 items 1-17 all addressed in spec | Pass — checked individually: item 1 (schema) §7.1; item 2 (connection flow) §11.1; item 3 (plan detection) §7.4; item 4 (consent table) §7.2-7.3; item 5 (retention) §7.2 + §13; item 6 (token lifecycle) §11.2 + Chunk 6; item 7 (provider-agnostic) §7.1; item 8 (connection UI) §5 + §12 Chunk 7; item 9 (audit) §9 + §17; item 10 (redaction envelope) §9.1; item 11 (no-consumer V1) §17; item 12 (sanctioned-tier definitions) §7.4 registry; item 13 (offboarding) §7.5 state machine + §12 Chunk 7; item 14 (permission gates) §10; item 15 (broker invariant) §9.1; item 16 (capability registry) §7.4; item 17 (revoked vs disabled) §7.5 |
| `/connections` consolidation non-goals (CredentialsTab deprecated, no new MCP/Cookie UI) | Pass — §5.6 names deprecated files; §3 lists MCP/Cookie as non-goals |
| Vocabulary palette (§6) applied across all spec copy | Partial — spec uses some architecture-internal terms (usability_state, operator_session) where appropriate; no "sanctioned", no "Operator Controller" in prose |

---

## 15. Testing posture

Per `docs/spec-context.md`:
- `testing_posture: static_gates_primary`
- `runtime_tests: pure_function_only`
- `frontend_tests: none_for_now`
- `api_contract_tests: none_for_now`

**Allowed tests in this spec (pure functions only):**

| Test target | File | What it tests |
|---|---|---|
| Failure classification | `operatorSessionLifecycleServicePure.test.ts` | All 6 failure buckets; `marksUnusable` and `nextState` for each |
| State transition logic | same | Valid transitions; forbidden transitions throw; terminal states reject all transitions |
| Broker retrieval invariant | `credentialBrokerService.test.ts` | `issueCredential` for each non-`connected_usable` state never calls `decryptToken` |
| Consent version check | `operatorSessionConsentService.test.ts` | `disclosureVersion < current` → returns `needs_reaccept`; `==` → returns `valid` |
| Provider capability registry | `operatorSessionProviders.test.ts` | All required fields present on each entry; `sanctionedTiers` and `optInTiers` are disjoint |

**Forbidden in this spec:**
- No supertest / API contract tests
- No E2E tests
- No React Testing Library / frontend unit tests
- No integration tests against live DB (wait for Phase 2 trigger)

---

## 16. Execution-safety contracts

### 16.1 Idempotency posture

| Operation | Idempotency type | Key / predicate |
|---|---|---|
| Connect (initial consent write + connection insert) | `state-based` | Multi-row by design: one operator_session connection per `(subaccount_id, provider_type, label)` per the existing `ic_subaccount_provider_label_unique` index. Before insert, check for an existing `connected_usable` row matching `(organisation_id, subaccount_id, provider_type, label)`; if found, return existing. If a row exists at the same label but is NOT usable (`revoked`, `disabled`, etc.), the new connect MUST use a distinct label (UI-enforced) — the unique index will reject a duplicate. Goal §2 line 64 failover (Default first, then alphabetical) requires multiple simultaneously usable rows per subaccount — this predicate preserves that contract. |
| Record consent | `key-based` | `UNIQUE (organisation_id, subaccount_id, user_id, disclosure_version)` on `operator_session_consents`. A duplicate consent by the same user at the same version is idempotent — DB unique constraint catches it, route returns 200 with existing record. |
| Token refresh (pg-boss job) | `key-based` | pg-boss `singletonKey = ${connection_id}:${refresh_bucket}` where `refresh_bucket` is a 5-minute floor of `now()`. Duplicate enqueue within the same bucket is collapsed by pg-boss to a single queued job, not a second execution. No DB-level unique constraint. |
| Make default | `state-based` | `UPDATE integration_connections SET is_default = true WHERE id = ? AND organisation_id = ?` plus `UPDATE ... SET is_default = false WHERE organisation_id = ? AND subaccount_id = ? AND id != ?`. Two-step; idempotent by predicate. |
| Disconnect (state transition to disabled) | `state-based` | `UPDATE ... WHERE id = ? AND usability_state NOT IN ('revoked', 'disabled')`. If 0 rows updated: already terminal, return 200. |

### 16.2 Retry classification

| Operation | Classification | Boundary |
|---|---|---|
| Provider OAuth / mechanism handshake | `guarded` | Retry safe after idempotency check on the connect route |
| Consent write | `guarded` | DB unique constraint acts as idempotency guard |
| Token refresh job | `guarded` | pg-boss handles retry via `retryLimit` in jobConfig; bucket-window key prevents duplicate execution |
| `usability_state` transition writes | `guarded` | Optimistic predicate `WHERE usability_state = expected_pre_state` — 0 rows = already transitioned, no retry needed |
| Disconnect | `guarded` | State-based predicate prevents double-disable |

### 16.3 Concurrency guards

**Make default race:** Two concurrent `make-default` requests for different subscriptions in the same subaccount could attempt to produce two Default rows. The partial unique index `ic_subaccount_operator_session_default_unique` is the primary guard — at most one row per subaccount can have `is_default = true` for `auth_type = 'operator_session'`. The two-UPDATE pattern below runs inside a single transaction so Postgres acquires row locks on the UPDATEd rows automatically; the optional `SELECT ... FOR UPDATE` first acquires the lock on the current default explicitly, preventing the lost-update race even before the partial index has to reject a duplicate.

```sql
-- Inside a transaction (BEGIN; ...; COMMIT;):
-- 1. Lock the current default row (if any) so the other concurrent caller blocks here.
SELECT id FROM integration_connections
  WHERE subaccount_id = $1
    AND auth_type = 'operator_session'
    AND is_default = true
  FOR UPDATE;
-- 2. Clear it.
UPDATE integration_connections SET is_default = false, updated_at = now()
  WHERE subaccount_id = $1
    AND auth_type = 'operator_session'
    AND is_default = true;
-- 3. Promote the new default.
UPDATE integration_connections SET is_default = true, updated_at = now()
  WHERE id = $2
    AND subaccount_id = $1
    AND auth_type = 'operator_session';
```

Failure modes for the losing caller:
- The `SELECT ... FOR UPDATE` blocks until the winner's transaction commits, then proceeds and sees its own UPDATEs work — both transactions complete; the *last* committed promotion wins. This is the desired idempotent behaviour for two callers concurrently pressing Make Default on different rows.
- If the partial unique index rejects an insert (e.g. a race against a brand-new operator_session row inserted with `is_default = true`), the caller receives a DB `23505 unique_violation`, mapped to 409 with `{ error: 'concurrent_default_change' }` per §16.6.
- If the third UPDATE matches zero rows (target connection deleted or no longer operator_session), the route returns 404 and the first two writes are rolled back with the transaction.

**Token refresh race:** Multiple refresh job instances for the same connection could write conflicting `usability_state` values. Guard: refresh job uses `UPDATE ... WHERE usability_state = 'connected_usable' AND id = $connId`. If 0 rows: another instance already transitioned — discard this result, do not retry.

**Plus disclosure connect race:** Two concurrent connect requests for the same user + disclosure version could write duplicate consent rows. Guard: unique constraint on `(organisation_id, subaccount_id, user_id, disclosure_version)`. The losing request receives a DB 23505 unique violation — mapped to 200 (idempotent hit) since the consent exists and is valid.

### 16.4 Terminal event guarantee

The `operatorSessionRefreshJob` is the primary event-emitting cross-flow chain. Every terminal audit event carries an explicit `status` field (`success | partial | failed`) per the spec-authoring-checklist §10.4 convention. The three mutually exclusive terminal paths are:

- **Success path:** job completes; token refreshed and stored → audit event `operator_session.refreshed` with `status: 'success'` → terminal
- **Unusable path:** job classifies failure as marking unusable → `usability_state` transition → audit event `operator_session.needs_reauth` (for `expired_refresh_token` / `insufficient_scope` / `unknown` buckets) or `operator_session.revoked` (for `provider_revoked` bucket), both with `status: 'failed'` → terminal
- **Retryable path:** job classifies failure as retryable → no state transition → audit event `operator_session.refresh_retried` with `status: 'partial'` → pg-boss reschedules → NOT terminal yet

`partial` is reserved for the retryable bucket — it signals "this chain is not finished; another job will resolve it." A retried chain ultimately lands on exactly one of `success` or `failed` once the underlying provider state settles or the retry budget is exhausted (`failed`).

Post-terminal prohibition: once `usability_state` is `revoked` or `disabled`, no further refresh jobs are enqueued for that connection_id. Guard: job enqueue gate checks `usability_state` before scheduling.

### 16.5 No-silent-partial-success

**Connect flow:** Consent write + connection insert are in a single transaction. If consent fails: connection is NOT stored, route returns 422 with the specific failure reason (terminal `status: 'failed'` from the caller's perspective). If connection insert fails after consent succeeded: the FK from connection → consent (`consent_record_id`) is the forward pointer and is rolled back with the connection insert; orphan consent rows do not occur because the consent insert + connection insert share the same transaction (consent row is rolled back as well). Route returns 422.

**Make default:** Two-UPDATE transaction. If the second UPDATE fails (connection no longer exists): the first UPDATE (clearing old default) is rolled back. Route returns 404. There is no partial-success path on this chain — either both UPDATEs commit (terminal `status: 'success'`) or neither commits (terminal `status: 'failed'`).

**Disconnect:** Single UPDATE. If the connection was already in a terminal state, route returns 200 (idempotent) — not 4xx — because the desired end state (not usable) is achieved (terminal `status: 'success'`). If the UPDATE fails (e.g. concurrent modification on the row), the route returns 409 (terminal `status: 'failed'`).

**Refresh job:** The only chain in this spec that legitimately emits a `partial` terminal event, per §16.4. All other chains are binary success/failed.

### 16.6 Unique-constraint-to-HTTP mapping

| Constraint | Table | HTTP response on violation |
|---|---|---|
| `UNIQUE (organisation_id, subaccount_id, user_id, disclosure_version)` (named `operator_session_consents_user_disclosure_unique`) | `operator_session_consents` | 200 — idempotent consent already exists; return existing record |
| `ic_subaccount_operator_session_default_unique` partial unique index on `(subaccount_id) WHERE auth_type = 'operator_session' AND is_default = true` | `integration_connections` | 409 with `{ error: 'concurrent_default_change' }` — a competing Make Default already promoted a different row; the caller should refetch and retry |
| `ic_subaccount_provider_label_unique` (existing index, reused for operator_session multi-row support) on `(subaccount_id, provider_type, label)` | `integration_connections` | 409 with `{ error: 'duplicate_subscription_label' }` — the user must choose a different label or reuse the existing label's connection |
| pg-boss `singletonKey = ${connection_id}:${refresh_bucket}` | (not a DB constraint) — pg-boss queue table | Not user-facing; pg-boss collapses the duplicate enqueue internally |
| `PRIMARY KEY` on `id` (uuid) | both new tables | UUID collisions are astronomically unlikely with `gen_random_uuid()`; this row exists only for completeness. If it occurs, treat as an infrastructure incident: log + alert + return 500. This is the single permitted 500 path on a constraint violation, scoped narrowly to UUID PK collisions only. |

All other constraint violations MUST map to a deterministic 4xx (200, 409, 422, etc.) — no other 500 path is acceptable.

### 16.7 State machine closure

The `usability_state` value set is **closed**. The six valid values are:
`connected_usable | connected_needs_consent | connected_needs_reauth | connected_unverified | revoked | disabled`

**Adding a new state value requires a spec amendment.** No ad-hoc column update. The transition table in §7.5 is the specification; any implementation that performs a transition not listed there is a bug.

**Pre-terminal preconditions:** Before any terminal state (`revoked` or `disabled`) is written, the following must exist:
- The connection row itself (non-null id)
- The audit event for the transition (written atomically in the same transaction or immediately after, with the connection update as the first write)

**Forbidden transitions enforcement:** The `operatorSessionLifecycleService.transition(connectionId, from, to)` method verifies the `from` state matches the current DB value. If `from != current`, it throws `InvalidStateTransitionError` and makes no write. This prevents the revoked→connected_usable and disabled→connected_usable forbidden transitions even under concurrent conditions.

---

## 17. Acceptance criteria

All criteria must pass before the build is marked complete.

### 17.1 Schema

- [ ] Migration 0318 applies cleanly on a fresh DB and idempotently with `IF NOT EXISTS` / `IF EXISTS` guards on down-scripts.
- [ ] Migration 0319 applies cleanly; both new tables exist with ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY.
- [ ] Both new tables are present in `server/config/rlsProtectedTables.ts`.
- [ ] The `operator_session_consents` table has a UNIQUE constraint on `(organisation_id, subaccount_id, user_id, disclosure_version)`.
- [ ] `verify-rls-coverage.sh` CI gate: green (both new tables covered).
- [ ] `verify-rls-contract-compliance.sh` CI gate: green (no direct DB access outside service layer for new tables).

### 17.2 Credential Broker — broker retrieval invariant

- [ ] Unit test (vitest): calling `credentialBrokerService.issueCredential` with a connection in any state other than `connected_usable` (`connected_needs_consent`, `connected_needs_reauth`, `connected_unverified`, `revoked`, `disabled`) NEVER calls `connectionTokenService.decryptToken` and throws `CredentialNotUsableError` with the specific state in the error payload.
- [ ] Unit test: calling `issueCredential` with `connected_usable` state returns an `OperatorSessionEnvelope` without any `auth_token` or `refresh_token` field.

### 17.3 No-consumer V1

- [ ] Mechanical check: `grep -r "operator_session" server/services/providers/ server/services/iee/` returns zero matches (no existing adapter reads or consumes `operator_session` credentials).
- [ ] All existing adapters (`api`, `headless`, `claude-code`, `iee_*`) continue to request and receive only their previous auth paths — no regression in their credential resolution.

### 17.4 State machine

- [ ] Unit tests for all listed valid transitions (§7.5) pass.
- [ ] Unit tests for all forbidden transitions (`revoked → connected_usable`, `disabled → connected_usable`, any state → `revoked` outside the lifecycle service) throw `InvalidStateTransitionError`.
- [ ] Direct column update to `usability_state` outside `operatorSessionLifecycleService` is blocked by the service layer (no direct Drizzle write to this column outside the service).

### 17.5 Consent lifecycle

- [ ] A Plus-tier connect attempt without a `disclosureAcceptance` block in the POST body: route returns 422 `plus_consent_required` — no consent row, no credential row written.
- [ ] A Plus-tier connect attempt WITH a valid `disclosureAcceptance` block: single transaction writes the consent row, the credential row (with `consent_record_id` set), and the one-time UPDATE that fills `consent.connection_id`. Final state: `usability_state = 'connected_usable'`.
- [ ] Duplicate consent write at same user + disclosure version (concurrent connect race): DB UNIQUE constraint rejects the second; route returns 200 with the existing consent record, no new row.
- [ ] Disclosure version bump: existing Plus-tier credential transitions to `connected_needs_consent` on first read after the version bump (§11.4). Agent-use blocked. `/consent` route handles re-acceptance: writes a new consent row (with `connection_id` set at INSERT time, no UPDATE needed), writes a `superseded` event linking the prior consent, updates the connection's `consent_record_id` forward pointer, transitions usability back to `connected_usable`.
- [ ] Static check: `operatorSessionConsentService` is the ONLY code path that performs the one-time UPDATE on `operator_session_consents.connection_id`. A repo-grep test verifies no other file UPDATEs this table.

### 17.5b Failover ordering contract

- [ ] Unit test on `credentialBrokerService.resolveAvailableCredentials` (operator_session branch): given a subaccount with one Default and three non-Default `connected_usable` operator_session rows + two other-auth-type rows, returns an array in the order specified by §9.7 (Default first; non-Default sorted by `label ASC NULLS LAST, id ASC`; other-auth-type after).
- [ ] Unit test: rows with `usability_state !== 'connected_usable'` are excluded from the array entirely (not just deprioritised).
- [ ] Unit test: rows where the requesting agent is NOT in `allowedAgentIds` are excluded (when `availabilityScope = 'specific_agents'`).

### 17.6 Failure classification

- [ ] Unit tests for `classifyRefreshFailure`: all 6 buckets correctly classified.
- [ ] `expired_refresh_token`, `provider_revoked`, `insufficient_scope`, `unknown` → `marksUnusable: true`.
- [ ] `provider_unavailable`, `rate_limited` → `marksUnusable: false`.

### 17.7 UI — /connections consolidation

- [ ] The `/connections` page renders three tabs: App Integrations, Web Logins, AI Subscriptions.
- [ ] App Integrations tab: card grid, "Your connected apps" and "Apps you can connect" sections are mutually exclusive (no app appears in both).
- [ ] Web Logins tab: sortable/filterable table with test-status dots (Connected, Test failed, Untested).
- [ ] AI Subscriptions tab: all six `usability_state` pills rendered with correct labels (Connected / Needs consent / Needs sign in / Plan not verified / Revoked by OpenAI / Disabled).
- [ ] `CredentialsTab.tsx` and `IntegrationsAndCredentialsPage.tsx` are removed (or the latter is a redirect).
- [ ] No regression: existing OAuth + Web Login Add/Edit/Test/Disconnect flows continue to function from the consolidated `/connections` surface.

### 17.8 UI — AI Subscription flows

- [ ] Make Default confirmation modal: State A (business plan) has impact preview; State B (personal plan) has re-acknowledgement checkbox and disabled primary action until checked.
- [ ] Disconnect confirmation: type-to-confirm gate; disabled CTA until input matches label.
- [ ] Plus connect disclosure: type-to-confirm "I accept the risk" gate; 4-step wizard bar with Accept-terms step muted on happy path.
- [ ] Re-auth flow (Screen 20): single CTA, no plan detection, no fresh consent capture.
- [ ] Disclosure version bump (Screen 18): checkbox re-ack; primary disabled until checked.

### 17.9 Redaction

- [ ] Raw token material (`auth_token`, `refresh_token`) never appears in:
  - API response bodies
  - Audit event `metadata` fields
  - Run trace / execution event payloads
  - Error response bodies
  - Frontend log output
- [ ] The `OperatorSessionEnvelope` shape contains no token fields.

---

## 18. Open questions

1. **Provider connection mechanism verification.** The brief mandates verifying the OpenAI-supported mechanism before shipping the connect wiring. At spec-review time (2026-05-11), the mechanism is `none_verified` in the registry. When verification completes, the builder updates `connectionMechanism` in `operatorSessionProviders.ts` and activates the connect route (removes the 501 gate). This is an open runtime gate, not a spec change.

2. **Agent allowlist persistence.** The per-subscription agent allowlist (§9.2 `allowedAgentIds`) is stored in `configJson` on the `integration_connections` row. If the allowlist grows large (100+ agents), JSONB scanning may be slow. For V1 (small subaccounts), this is fine. Post-Phase 3+ if scale demands it, a join table `operator_session_connection_agents` replaces the JSONB list.

3. **Subaccount vs. org scope for Plus consent.** The brief §2.4 default posture is subaccount-scoped storage, user-attributed consent. If an org has 50 subaccounts and each has a Plus subscription, each user signs a separate disclosure. There is no org-level "umbrella consent." Confirm this is intentional before implementation.

4. **Re-auth identity mismatch.** §11.1 and Screen 20 assume the re-auth-ing user is the same identity as the original consent owner. If the identity differs (e.g., original owner departed), the flow should detect the mismatch and route to Transfer Ownership instead of Sign in again. The spec currently handles this via an offramp note on Screen 20 but does not define the server-side identity-comparison check. Builder should clarify before implementation of Chunk 7.

## 18b. Resolved during spec-review

- **Default subscription storage pattern.** Option (a) chosen: a boolean `is_default` column on `integration_connections` with a partial unique index `ic_subaccount_operator_session_default_unique` enforcing at most one Default operator_session row per subaccount (see §7.1). Option (b) — a `default_operator_session_connection_id` FK on `subaccounts` — was rejected because it requires a circular FK and provides no win at current scale. The two-UPDATE concurrency guard in §16.3 is the canonical Make-Default code path.
- **Disclosure version bump detection: on-read.** §11.4 commits to on-read detection. If the subaccount has hundreds of Plus-tier connections and the disclosure version bumps, the first read after the bump triggers multiple state transitions simultaneously. This is fine at current scale (pre-production); a background-sweep alternative is deferred (see §13).
