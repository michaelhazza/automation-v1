# Implementation Plan — Operator Session Identity (Spec C)

**Build slug:** `operator-session-identity`
**Spec:** `docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md`
**Spec status:** LOCKED (5/5 spec-reviewer iterations applied; chatgpt-spec-review unavailable; 54 mechanical findings cleared)
**Plan status:** LOCKED — build-ready (2 rounds of operator review; 2 blockers + 6 tightenings applied)
**Branch:** `claude/evolve-session-identity-brief-17LO4`
**Scope class:** Major
**Plan author:** architect (Opus)
**Plan date:** 2026-05-11

> Builders read this plan in preference to the spec. Each chunk inlines the contracts, file lists, error codes, and acceptance hooks needed to ship that chunk without rereading §1-§17 of the spec. The spec remains authoritative if the plan and spec disagree; if a builder hits that, stop and escalate.

---

## Migration number assignment (CRITICAL)

The spec text (§7.1, §8.1, §12 Chunk 1) names migrations `0318` and `0319`. Those numbers are STALE. Main has already merged migrations through `0324`. This plan uses:

| Spec text says | Use this number instead | Filename |
|---|---|---|
| `0318_operator_session_consents.sql` | `0325` | `migrations/0325_operator_session_consents.sql` |
| `0319_operator_session_columns.sql` | `0326` | `migrations/0326_operator_session_columns.sql` |

Dependency order (0325 first, 0326 depends on it) is preserved exactly as the spec specifies, only the numeric prefixes change. Every reference to the old numbers across this plan, in code comments, in `rlsProtectedTables.ts` `policyMigration` entries, in `RAISE EXCEPTION` strings, in test files, and in build artefacts uses the new numbers. Source: `KNOWLEDGE.md` (Pattern: Migration-number collision after S2 sync requires renumbering forward). The 0321/0322 → 0325/0326 step in Phase 3 happened after a second S2 sync when main shipped the sandbox-isolation feature (migrations 0321-0324).

Pre-Chunk-1 verification (the builder must run this):

```powershell
git ls-tree -r origin/main migrations/ | Select-String "032[0-9]"
```

Confirm the migration files are present on main and the chosen numbers are absent before claiming them. Phase 3 (2026-05-12) re-renumbered from 0321/0322 → 0325/0326 after main shipped sandbox-isolation (migrations 0321-0324).

---

## Table of contents

1. Architecture Notes
2. Model-collapse check
3. Primitives reused vs introduced
4. Cross-chunk contracts (single source of truth)
5. Per-Chunk Implementation Plan
   - Chunk 1, Schema foundations
   - Chunk 2, Pure service layer
   - Chunk 3, Consent + lifecycle + connect skeleton
   - Chunk 4, Credential broker extension
   - Chunk 5, Permissions + API routes
   - Chunk 6, Token refresh job
   - Chunk 7, AI Subscriptions tab
   - Chunk 8, App Integrations tab
   - Chunk 9, Web Logins tab + CRUD consolidation
   - Chunk 10, ConnectionsPage wiring + Model Access
   - Chunk 11, Architecture doc sync
6. Risks & Mitigations
7. Open Questions Still in Flight
8. Executor notes

---

## 1. Architecture Notes

### 1.1 What this feature ships

The Credential Broker primitive gains a fourth credential mode: `operator_session`. Schema, services, RLS-protected consent ledger, token refresh job, UI surface, and permission gates ship complete and unused-but-correct. The first consumer is the OpenClaw adapter (Phase 3+); V1 has zero runtime consumers and that is the intended state.

A scope amendment ships in the same PR: the `/connections` Govern page becomes the single CRUD surface for all credential types, replacing the legacy `CredentialsTab` + `IntegrationsAndCredentialsPage` flows.

### 1.2 Key architectural decisions (and what was rejected)

**Decision A, Two-column credential state model.** `usability_state` is the broker gate (only `connected_usable` returns token material); `plan_verification_status` is the audit signal (verified / self_declared / failed). Considered + rejected: a single `state` column conflating broker gate with tier confirmation, which produced an unrecoverable `connected_unverified` hold state with no exit path under V1's self-declaration mechanism, dead-on-arrival. See `KNOWLEDGE.md` (Pattern: Separate usability_state from plan_verification_status).

**Decision B, Append-only consent ledger with one narrow exception.** `operator_session_consents` is fully immutable except for a single one-shot post-INSERT UPDATE that fills `connection_id` from NULL to the new connection UUID, scoped to the same transaction as the initial-connect INSERT. The exception exists because the FK is bidirectional: `integration_connections.consent_record_id` references the consent, and `operator_session_consents.connection_id` references the connection back. Considered + rejected: a separate `operator_session_consent_connections` join table, over-engineered for a 1:1 lifecycle relationship that only flips once.

**Decision C, Pure-helper extraction for broker invariants.** `credentialBrokerServicePure.ts` owns `assertCredentialUsableOrThrow(state, decryptHook)` AND `orderResolvedCredentials(rows)`. The non-pure broker delegates both. This makes the V1 acceptance criteria deterministically testable under the static-gates-primary posture (§15) without booting a DB. Considered + rejected: integration tests against a real DB, blocked by the testing posture; the pure helper is the contract under test.

**Decision D, Bring lifecycle state writes through ONE service method.** `operatorSessionLifecycleService.transition(connectionId, from, to)` is the sole owner of every `usability_state` write after the row exists. Initial state on INSERT is owned by `operatorSessionService.connect`. Considered + rejected: scattering state writes across multiple services, guaranteed drift between the §7.5 state machine and the actual UPDATE sites.

**Decision E, On-read disclosure-version-bump detection, not background sweep.** When `OPERATOR_SESSION_DISCLOSURE_VERSION` (exported constant in `operatorSessionProviders.ts`) increments, the read path detects the staleness and triggers a `connected_usable → connected_needs_consent` transition. Considered + rejected: a background sweep job, added complexity with no win at V1 scale; the comparison is a pure function and the transition reuses the existing lifecycle service.

**Decision F, JSONB allowlist on `integration_connections.config_json`, not a join table.** Per-subscription agent allowlist persists at `config_json -> 'operator_session' -> 'allowedAgentIds'` with `availabilityScope` sibling key. Considered + rejected: `operator_session_connection_agents` join table, over-engineered for V1 scale; migration to a join table is deferred to a post-Phase-3+ amendment if scale demands it.

**Decision G, Partial unique index for "one Default per subaccount."** `ic_subaccount_operator_session_default_unique` on `(subaccount_id) WHERE auth_type = 'operator_session' AND is_default = true` is the primary guard. Considered + rejected: a foreign-key column on `subaccounts` pointing to the default connection, circular FK, no win, and conflict-free under the partial unique index.

**Decision H, Build-time gate on provider mechanism via the registry.** `operatorSessionProviders.ts.openai.connectionMechanism: 'none_verified'` is the V1 commit state; the `connect` route returns `501 provider_mechanism_not_verified` until the flag flips. Schema, consent model, lifecycle service, and UI all ship and light up when the flag flips. Considered + rejected: feature-flag env var, the registry is already the seam for future providers, so adding a parallel feature-flag system is duplication.

### 1.3 Patterns explicitly reused

| Pattern | Where it lives | What this spec reuses |
|---|---|---|
| `asyncHandler` | `server/lib/asyncHandler.ts` | All new routes |
| `withOrgTx(orgId, fn)` | `server/instrumentation.ts` | All service-tier DB access (connect, consent, lifecycle, list) |

> **Hard invariant — `withOrgTx` callback signature.** `withOrgTx(ctx, fn)` passes **no arguments** to `fn`. The callback is always `async () => { ... }`, never `async (tx) => { ... }`. Inside the callback, obtain the transaction handle by calling `getOrgScopedDb(source)` (from `server/lib/orgScopedDb.ts`). Service methods that need the handle receive it explicitly via a parameter, or call `getOrgScopedDb()` themselves. Builder **MUST NOT** write `withOrgTx(orgId, async tx => …)` — this is a type error and a known anti-pattern; see `KNOWLEDGE.md` "2026-05-05 Gotcha — withOrgTx({ tx: db }) in unauthenticated callbacks".
| `withAdminConnection()` | `server/lib/adminDbConnection.ts` | Refresh-job iteration only (admin top-level + `withOrgTx` per tenant) |
| `resolveSubaccount(id, orgId)` | `server/lib/resolveSubaccount.ts` | Every route with `:subaccountId` |
| `requireSubaccountPermission(key)` | `server/middleware/permissions.ts` | All new permission gates |
| `authenticate` | `server/middleware/auth.ts` | All new routes (first in chain) |
| `RLS_PROTECTED_TABLES` manifest | `server/config/rlsProtectedTables.ts` | Two new entries (consents + consent_events) |
| Three-guard RLS policy template | `architecture.md` § Row-Level Security | Both new tables |
| Drizzle schema convention | `server/db/schema/**` | Two new schema files |
| pg-boss `singletonKey` idempotency | existing job patterns | Token refresh job |
| `*Pure.ts` naming + sibling unit tests | `verify-pure-helper-convention.sh` | Three new pure helpers |
| `isActive(table)` soft-delete filter | `server/lib/queryHelpers` | Read joins on `integration_connections` |

### 1.4 Patterns explicitly introduced (and justified)

- **`OperatorSessionEnvelope` branded return type.** New type, but a thin redacted wrapper around an existing `ResolvedCredential` shape. Justified because the `auth_token` / `refresh_token` columns must NEVER cross the broker boundary; the envelope is the type-system enforcement of that contract.
- **One-time NULL→UUID UPDATE invariant on `operator_session_consents.connection_id`.** A new service-layer invariant. Justified because the bidirectional FK constraint and append-only semantics conflict; the exception is the smallest possible relaxation and is enforced inside `operatorSessionConsentService` only.
- **`OPERATOR_SESSION_DISCLOSURE_VERSION` constant.** New module-level export from `operatorSessionProviders.ts`. Justified because the disclosure version bump is a code change that lands with the new disclosure text; externalising to a DB row or a config file adds complexity with no win.

### 1.5 What this plan does NOT change

- Existing adapters (`api`, `headless`, `claude-code`, `iee_*`) are not modified. CI gate `grep -r "operator_session" server/services/providers/ server/services/iee/` MUST return zero matches (§17.3).
- `subaccounts` table is not modified (Decision G rejected the FK-on-subaccount approach).
- Three-tier agent model is not modified.
- The existing `oauth2` / `api_key` / `web_login` / `service_account` / `github_app` auth types behave identically post-this-spec; only the new `'operator_session'` literal is added to the `authType` CHECK constraint and TypeScript union.

---

## 2. Model-collapse check

Per the architect playbook:

1. **Does this feature decompose into ingest → extract → transform → render?** No. The work is schema, services, RLS, lifecycle state machine, redacted envelope, and UI surface, none of those steps are LLM-shaped.
2. **Is each step doing something a frontier multimodal model could do in a single call?** No. Provider OAuth handshake, token decryption gating, FK-protected consent ledger, partial-unique-index Default invariant, and pg-boss refresh scheduling are all deterministic infrastructure concerns where determinism, audit trail, and tenant isolation are the point, not pattern-matching tasks where a model adds value.
3. **Can the whole pipeline collapse into one model call?** No. There is no LLM in this pipeline at all. The OpenClaw adapter (a future spec) will use the credentials this spec ships, but the OpenClaw model call itself is a separate boundary.

**Decision: collapse not applicable.** Rationale: no LLM call exists in the feature surface, the work is infrastructure (schema + RLS + lifecycle + redaction) that demands determinism and audit guarantees that a model call could not provide.

---

## 3. Primitives reused vs introduced

The §8.4 dev-discipline rule ("Prefer existing primitives over new abstractions") demands explicit justification for new primitives. The full table is in §1.3 + §1.4; the summary is:

- **6 existing primitives reused** without modification: `asyncHandler`, `withOrgTx`, `withAdminConnection`, `resolveSubaccount`, `requireSubaccountPermission`, RLS-manifest pattern.
- **1 existing primitive extended in place** (not duplicated): `credentialBrokerService` (existing) gains an `operator_session` branch and two pure-helper delegations.
- **3 new primitives introduced with explicit justification:**
  - `OperatorSessionEnvelope` (type-system enforcement of the redaction contract).
  - The one-time `connection_id` back-fill UPDATE (smallest possible relaxation of the append-only invariant; service-layer scoped).
  - `OPERATOR_SESSION_DISCLOSURE_VERSION` constant (smaller than a feature-flag system; lands with the disclosure-text update).

No new transaction wrapper, no new permission middleware, no new RLS policy template, all reused from existing patterns.

---

## 4. Cross-chunk contracts

These contracts are referenced by multiple chunks. Builders read this section once; per-chunk sections reference back to it.

### 4.1 TypeScript types (canonical declarations)

```typescript
// shared/types/govern.ts, extended for this spec

// New: discriminator literal added to the existing authMethod union
type AuthMethod = 'oauth' | 'api_key' | 'web_login' | 'ai_subscription'; // 'ai_subscription' maps internally to auth_type='operator_session'

// New: extended Connection variant for operator_session rows
interface AiSubscriptionConnection {
  id: string;
  authMethod: 'ai_subscription';
  provider: string;                       // 'openai' for V1
  planTier: 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown';
  planVerificationStatus: 'verified' | 'self_declared' | 'failed';
  planVerifiedAt: string | null;          // ISO 8601
  usabilityState: 'connected_usable' | 'connected_needs_consent' | 'connected_needs_reauth' | 'connected_unverified' | 'revoked' | 'disabled';
  disabledReason: 'owner_inactive' | 'admin_disabled' | 'permission_revoked' | null;  // populated only when usabilityState === 'disabled'
  pendingReason:  'needs_new_consent' | 'needs_reauth' | 'plan_unverified' | null;    // populated only when usabilityState ∈ {connected_needs_consent, connected_needs_reauth, connected_unverified}
  isDefault: boolean;
  availabilityScope: 'all_agents' | 'specific_agents';
  allowedAgentIds: string[] | null;        // null when scope = 'all_agents'
  label: string | null;
  user: {
    userId: string | null;                  // null only when the originating user has been deleted
    userIdNullified: boolean;               // true when user_id is NULL but the original user existed
    displayName: string | null;
  };
  lastRefreshedAt: string | null;
  createdAt: string;
  // Token material: NEVER present in this shape.
}
```

```typescript
// server/services/credentialBrokerService.ts, new return type for operator_session
interface OperatorSessionEnvelope {
  credentialId: string;                  // opaque reference, not the connection ID
  connectionId: string;
  authType: 'operator_session';
  provider: string;                      // 'openai'
  planTier: 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown';
  usabilityState: 'connected_usable';    // broker refuses to return any other state
  issuedAt: string;
  expiresAt: string | null;
}
```

```typescript
// server/services/operatorSessionConsentService.ts
interface OperatorSessionConsent {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  userId: string;
  connectionId: string | null;
  planTier: string;
  disclosureVersion: number;
  acceptedAt: string;
  disclosureTextSnapshot: string;
  consentTextSnapshot: string;
}

interface OperatorSessionConsentEvent {
  id: string;
  organisationId: string;
  consentId: string;
  eventType: 'granted' | 'revoked' | 'superseded';
  actorUserId: string | null;
  at: string;
  supersededByConsentId: string | null;
}
```

```typescript
// server/services/operatorSessionLifecycleServicePure.ts
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
  nextState: 'connected_usable' | 'connected_needs_reauth' | 'revoked' | null;
  shouldAlert: boolean;
}

type UsabilityState =
  | 'connected_usable' | 'connected_needs_consent' | 'connected_needs_reauth'
  | 'connected_unverified' | 'revoked' | 'disabled';
```

```typescript
// integration_connections.config_json shape extension (operator_session rows only)
interface OperatorSessionConfigJson {
  operator_session: {
    availabilityScope: 'all_agents' | 'specific_agents';
    allowedAgentIds: string[] | null;  // populated only when availabilityScope === 'specific_agents'; null otherwise
  };
}
```

### 4.2 Provider capability registry (canonical)

```typescript
// server/config/operatorSessionProviders.ts
export type ProviderCapabilityEntry = {
  displayName: string;
  connectionMechanism: 'oauth_pkce' | 'device_flow' | 'api_key' | 'none_verified';
  planDetectionMechanism: 'introspection_api' | 'probe' | 'self_declaration' | 'none';
  refreshSupport: boolean;
  revocationSignalSupport: 'push_event' | 'poll' | 'none';
  runtimeUseEnabled: boolean;
  sanctionedTiers: Array<'pro' | 'team' | 'enterprise'>;
  optInTiers: Array<'plus'>;
};

export const OPERATOR_SESSION_PROVIDERS: Record<string, ProviderCapabilityEntry> = {
  openai: {
    displayName: 'OpenAI / ChatGPT',
    connectionMechanism: 'none_verified',       // V1 commit value; flips when verified
    planDetectionMechanism: 'self_declaration',
    refreshSupport: true,
    revocationSignalSupport: 'none',
    runtimeUseEnabled: false,
    sanctionedTiers: ['pro', 'team', 'enterprise'],
    optInTiers: ['plus'],
  },
};

export const OPERATOR_SESSION_DISCLOSURE_VERSION = 1;
```

### 4.3 Permission keys (canonical)

```typescript
// server/lib/permissions.ts, add to SUBACCOUNT_PERMISSIONS:
OPERATOR_SESSION_CONNECT:          'subaccount.operator_session.connect',
OPERATOR_SESSION_VIEW:             'subaccount.operator_session.view',
OPERATOR_SESSION_DISCONNECT:       'subaccount.operator_session.disconnect',
OPERATOR_SESSION_REAUTH:           'subaccount.operator_session.reauth',
OPERATOR_SESSION_ALLOW_AGENT_USE:  'subaccount.operator_session.allow_agent_use',
```

All five enter `ALL_PERMISSIONS` with `groupName: 'AI Subscriptions'` and plain-English descriptions:

| Key | Description |
|---|---|
| `subaccount.operator_session.view` | View AI Subscription metadata (no token material) |
| `subaccount.operator_session.connect` | Connect a new AI Subscription and re-accept consent |
| `subaccount.operator_session.disconnect` | Disconnect an AI Subscription (terminal disable) |
| `subaccount.operator_session.reauth` | Trigger re-authentication when sign-in expired |
| `subaccount.operator_session.allow_agent_use` | Edit per-subscription agent allowlist |

Role bindings (spec §10.1): `view` at `subaccount_member`; `connect`/`disconnect`/`reauth` at `subaccount_admin`; `allow_agent_use` at `org_admin`.

### 4.4 HTTP error code catalogue

| HTTP | Error code | Where produced | Meaning |
|---|---|---|---|
| 501 | `provider_mechanism_not_verified` | POST connect | Registry's `connectionMechanism === 'none_verified'` |
| 422 | `disclosure_required` | POST connect | Disclosure-requirement gate active, body lacks `disclosureAcceptance` |
| 422 | `owner_mismatch_transfer_ownership_required` | POST reauth | Re-auth-ing identity differs from consent owner (§18 question 4) |
| 422 | `no_prior_consent_use_connect` | POST consent (re-acceptance) | Connection has no prior consent record; user must use initial connect |
| 409 | `concurrent_default_change` | POST make-default | Partial unique index rejected (23505) |
| 409 | `duplicate_subscription_label` | POST connect | Existing `ic_subaccount_provider_label_unique` index rejected (23505) |
| 404 | (default 404 body) | DELETE / make-default / PATCH | Connection not found or not operator_session |
| 200 | (idempotent hit) | POST consent (re-acceptance) | Pre-INSERT existence check OR 23505 caught; return existing consent |
| 200 | (idempotent hit) | DELETE | Already in terminal state (revoked/disabled) |

All service-tier errors throw the canonical shape `{ statusCode, message, errorCode? }`; `asyncHandler` maps them to JSON. The 501 case includes a body with `nextSteps: 'Provider mechanism pending verification; schema and UI are ready and will light up when the registry flips.'`

### 4.5 Single source of truth (data) — never inferred elsewhere

| Fact | SOT |
|---|---|
| `usability_state` | `integration_connections.usability_state` column |
| Default flag | `integration_connections.is_default` column (with partial unique index) |
| Connection's current consent | `integration_connections.consent_record_id` forward pointer |
| Consent status | Latest `operator_session_consent_events.event_type` per `consent_id` |
| Plan tier | `integration_connections.plan_tier` column |
| Failover order for a run | `credentialBrokerServicePure.orderResolvedCredentials(rows)` (pure helper) |
| Per-subscription agent allowlist | `integration_connections.config_json -> 'operator_session'` JSONB |

Never re-sort, never re-infer. Consumers MUST read from the SOT.

---

## 5. Per-Chunk Implementation Plan

Chunks are forward-only: no chunk references files created in a later chunk. Each chunk lists `spec_sections:` mapping to the spec sections it implements.

### Chunk 1, Schema foundations (migrations + Drizzle + registry + RLS manifest)

**`spec_sections:`** §7.1, §7.2, §7.3, §7.4, §8.1, §8.2, §8.3, §8.4, §10.2, §10.3, §12 Chunk 1

**Public interface this chunk exposes:**
- Drizzle exports for `operatorSessionConsents` and `operatorSessionConsentEvents` tables (queryable from any service)
- The new `usabilityState`, `planTier`, `planVerificationStatus`, `planVerifiedAt`, `consentRecordId`, `isDefault` fields on `integrationConnections` Drizzle schema (with `'operator_session'` added to the `authType` union)
- `OPERATOR_SESSION_PROVIDERS` map and `OPERATOR_SESSION_DISCLOSURE_VERSION` constant (read-only consumers)
- `ProviderCapabilityEntry` type

**What stays hidden behind it:**
- All migration DDL (CREATE TABLE, RLS policies, CHECK constraint additions, partial unique index definitions, FK constraints, ON DELETE RESTRICT / SET NULL clauses)
- The `RLS_PROTECTED_TABLES` manifest entries (consumed only by gate scripts)
- Provider-specific connection mechanism details (none verified in V1)

**Files to create:**

| Path | Purpose |
|---|---|
| `migrations/0325_operator_session_consents.sql` | Creates `operator_session_consents` + `operator_session_consent_events` tables with RLS, FORCE RLS, three-guard org-isolation policy, FK constraints, and `UNIQUE (connection_id, disclosure_version)` named `operator_session_consents_connection_disclosure_unique` |
| `migrations/0325_operator_session_consents.down.sql` | Drop both tables and policies |
| `migrations/0326_operator_session_columns.sql` | Adds 6 columns to `integration_connections`; partial unique index `ic_subaccount_operator_session_default_unique`; adds `'operator_session'` to `auth_type` CHECK constraint |
| `migrations/0326_operator_session_columns.down.sql` | Reverse |
| `server/db/schema/operatorSessionConsents.ts` | Drizzle schema for the consents table |
| `server/db/schema/operatorSessionConsentEvents.ts` | Drizzle schema for the consent events table |
| `server/config/operatorSessionProviders.ts` | Provider capability registry + `OPERATOR_SESSION_DISCLOSURE_VERSION` constant (canonical declaration in §4.2) |
| `server/config/__tests__/operatorSessionProviders.test.ts` | Vitest, registry shape invariants: every entry has all required fields; `sanctionedTiers ∩ optInTiers = ∅`; `connectionMechanism ∈ enum`; `OPERATOR_SESSION_DISCLOSURE_VERSION` is a positive integer |
| `scripts/verify-operator-session-consent-immutable.sh` | CI gate (R3 mitigation): greps for both SQL-style `UPDATE.*operator_session_consents` and Drizzle-style `update(operatorSessionConsents)` outside `server/services/operatorSessionConsentService.ts`; exits non-zero on any match. CI-only — not run locally during this plan. Wire by registering in the CI gate aggregator that runs `scripts/verify-*.sh` entries. |

**Files to modify:**

| Path | Change |
|---|---|
| `server/db/schema/integrationConnections.ts` | Add 6 new columns (`usabilityState`, `planTier`, `planVerificationStatus`, `planVerifiedAt`, `consentRecordId`, `isDefault`); add `'operator_session'` to the `authType` `$type<>` union (current union: `'oauth2' \| 'api_key' \| 'service_account' \| 'github_app' \| 'web_login'`, becomes `... \| 'operator_session'`); add Drizzle relation to `operatorSessionConsents.id` via `consentRecordId` |
| `server/db/schema/index.ts` | Re-export the two new schema files |
| `server/config/rlsProtectedTables.ts` | Add manifest entries for `operator_session_consents` and `operator_session_consent_events`; both with `policyMigration: '0325_operator_session_consents.sql'` |

**Migration 0325 (consents + consent_events) — key DDL contracts:**

- `operator_session_consents`:
  - PK `id uuid DEFAULT gen_random_uuid()`
  - FK `organisation_id` `REFERENCES organisations(id) ON DELETE RESTRICT` (retention policy)
  - FK `subaccount_id` `REFERENCES subaccounts(id) ON DELETE SET NULL`
  - FK `user_id` `REFERENCES users(id) ON DELETE SET NULL`
  - FK `connection_id` `REFERENCES integration_connections(id) ON DELETE SET NULL` (nullable, filled by post-INSERT UPDATE in connect flow)
  - `plan_tier text NOT NULL`, `disclosure_version int NOT NULL`, `accepted_at timestamptz NOT NULL DEFAULT now()`, `disclosure_text_snapshot text NOT NULL`, `consent_text_snapshot text NOT NULL`
  - Unique index `operator_session_consents_connection_disclosure_unique UNIQUE (connection_id, disclosure_version)`. Note that Postgres treats NULL `connection_id` values as distinct, so concurrent connect inserts before the one-time UPDATE do not collide.
  - RLS: `ENABLE`, `FORCE`, three-guard policy (IS NOT NULL, != '', uuid cast match) per architecture.md template

- `operator_session_consent_events`:
  - PK `id uuid DEFAULT gen_random_uuid()`
  - FK `organisation_id` `REFERENCES organisations(id) ON DELETE RESTRICT`
  - FK `consent_id` `REFERENCES operator_session_consents(id) ON DELETE RESTRICT`
  - `event_type text NOT NULL CHECK (event_type IN ('granted', 'revoked', 'superseded'))`
  - FK `actor_user_id` `REFERENCES users(id) ON DELETE SET NULL`
  - `at timestamptz NOT NULL DEFAULT now()`
  - FK `superseded_by_consent_id` `REFERENCES operator_session_consents(id) ON DELETE SET NULL` (NOT NULL only for 'superseded')
  - RLS: same three-guard pattern

**Migration 0326 (integration_connections columns) — key DDL contracts:**

- `ALTER TABLE integration_connections ADD COLUMN`:
  - `usability_state text` (nullable; existing rows undisturbed)
  - `plan_tier text` (nullable)
  - `plan_verification_status text` (nullable)
  - `plan_verified_at timestamptz` (nullable)
  - `consent_record_id uuid REFERENCES operator_session_consents(id) ON DELETE SET NULL` (nullable)
  - `is_default boolean NOT NULL DEFAULT false`
- `CREATE UNIQUE INDEX ic_subaccount_operator_session_default_unique ON integration_connections (subaccount_id) WHERE auth_type = 'operator_session' AND is_default = true`
- `ALTER TABLE integration_connections DROP CONSTRAINT integration_connections_auth_type_check; ALTER TABLE integration_connections ADD CONSTRAINT integration_connections_auth_type_check CHECK (auth_type IN ('oauth2', 'api_key', 'service_account', 'github_app', 'web_login', 'operator_session'))` (the original CHECK constraint name must be confirmed by reading the existing migration; if no CHECK constraint exists today, just add it with the full enum).

**Drizzle/migration consistency check (KNOWLEDGE.md correction 2):** every `.references(...)` on the Drizzle schema MUST mirror a `REFERENCES ... ON DELETE ...` clause on the migration column definition. The reverse is also required. Verify both sides before merging — the migration is the SQL source of truth.

**Error handling:** Migrations are atomic. If the migration runner fails partway, the existing `commit_and_revert` rollout policy applies (pre-production, no concurrency / migration safety drama). The builder runs `npm run db:generate` after authoring the Drizzle schema and confirms the generated SQL matches the hand-authored migration (commit both).

**Test considerations:**
- `operatorSessionProviders.test.ts` (Vitest): for every key in `OPERATOR_SESSION_PROVIDERS`, assert all 8 fields present; assert `sanctionedTiers.every(t => !optInTiers.includes(t))` (disjoint); assert `connectionMechanism` ∈ valid enum; assert `planDetectionMechanism` ∈ valid enum; assert `OPERATOR_SESSION_DISCLOSURE_VERSION` ≥ 1 and is integer.
- Migration verifies in CI: `verify-rls-coverage.sh` must pass (both new tables enrolled); `verify-rls-contract-compliance.sh` must pass.

**Dependencies on prior chunks:** None. This chunk is the foundation.

**Verification commands (this chunk only):**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` (verify generated migration matches hand-authored)
- `npx vitest run server/config/__tests__/operatorSessionProviders.test.ts`

**Acceptance criteria checked here (subset of spec §17):**
- §17.1 schema deliverables (all bullets)
- §17.9 token-material redaction: schema-level confirmation that `auth_token`/`refresh_token` columns exist on `integration_connections` (unchanged by this spec) and are NOT added to `AiSubscriptionConnection` shape

---

### Chunk 2, Pure service layer (no DB)

**`spec_sections:`** §7.4, §7.5, §9.1, §9.5, §9.7, §11.4, §12 Chunk 2, §15, §17.2, §17.4, §17.5b, §17.6

**Public interface this chunk exposes:**

```typescript
// server/services/operatorSessionLifecycleServicePure.ts
export function classifyRefreshFailure(error: unknown): RefreshFailureClassification;
export function isValidTransition(from: UsabilityState, to: UsabilityState): boolean;
export function isTerminalState(state: UsabilityState): boolean; // returns true for 'revoked' | 'disabled'
export class InvalidStateTransitionError extends Error {
  constructor(public readonly from: UsabilityState, public readonly to: UsabilityState);
}

// server/services/operatorSessionConsentServicePure.ts
export function compareDisclosureVersion(
  recorded: number, current: number
): 'valid' | 'needs_reaccept';
// recorded < current → 'needs_reaccept'; otherwise 'valid'

// server/services/credentialBrokerServicePure.ts
export function assertCredentialUsableOrThrow<T>(
  state: UsabilityState,
  decryptHook: () => T,
): T;
// throws CredentialNotUsableError when state !== 'connected_usable';
// invokes decryptHook exactly once when state === 'connected_usable'

export function orderResolvedCredentials<R extends {
  id: string; label: string | null; isDefault: boolean;
  usabilityState: UsabilityState; allowedAgentIds: string[] | null;
  availabilityScope: 'all_agents' | 'specific_agents';
  authType: 'oauth2' | 'api_key' | 'web_login' | 'operator_session' | string;
}>(rows: R[], agentId: string): R[];
// returns rows in the §9.7 order: Default-first (if usable + allowed),
// then non-Default operator_session rows in `label ASC NULLS LAST, id ASC`,
// then platform rows by existing order. Excludes non-usable + non-allowed rows.

export class CredentialNotUsableError extends Error {
  constructor(public readonly state: UsabilityState);
}
```

**What stays hidden behind it:**
- The state-transition validity table (encoded as a `Map<UsabilityState, Set<UsabilityState>>`)
- The error-shape pattern matching for `classifyRefreshFailure` (string contains 'rate_limit', HTTP status 401 vs 403, etc.)
- Tiebreaker rules in `orderResolvedCredentials` (NULL-last, lowercase comparison)
- The `terminalStates` set definition

**Files to create:**

| Path | Purpose |
|---|---|
| `server/services/operatorSessionLifecycleServicePure.ts` | Pure: classify refresh failure; validate state transitions; terminal-state check |
| `server/services/operatorSessionConsentServicePure.ts` | Pure: disclosure-version comparison; consent-state derivation |
| `server/services/credentialBrokerServicePure.ts` | Pure: broker retrieval invariant + failover ordering |
| `server/services/__tests__/operatorSessionLifecycleServicePure.test.ts` | Vitest, all 6 failure buckets + state transition table + terminal-state rejects + forbidden transitions |
| `server/services/__tests__/operatorSessionConsentServicePure.test.ts` | Vitest, < / == / > comparison for `disclosureVersion` |
| `server/services/__tests__/credentialBrokerServicePure.test.ts` | Vitest, `assertCredentialUsableOrThrow` invocation count per state; `orderResolvedCredentials` ordering with NULL labels, identical labels, exclusion of non-usable, default-first, allow-agent filter |

**State transition table (canonical, from §7.5):**

| From → To | Allowed? |
|---|---|
| `*` → `connected_usable` (with `from === connected_needs_consent / connected_needs_reauth / connected_unverified`) | Yes |
| `connected_usable` → any of `connected_needs_consent / connected_needs_reauth / revoked / disabled` | Yes |
| `connected_needs_consent` / `connected_needs_reauth` / `connected_unverified` → `disabled` | Yes |
| `revoked` → anything | NO (terminal) |
| `disabled` → anything | NO (terminal) |
| `connected_usable` → `connected_unverified` | NO |

The `isValidTransition` function returns `false` for everything not explicitly allowed. Encoding choice: a `Map<UsabilityState, Set<UsabilityState>>` keyed by `from` state with explicit allowed `to` set per key; terminal states have empty sets.

**Failure-classification rules (canonical, from §9.5):**

| Bucket | Pattern (in `classifyRefreshFailure`) | `marksUnusable` | `nextState` | `shouldAlert` |
|---|---|---|---|---|
| `expired_refresh_token` | HTTP 401 with `invalid_grant` / `expired_token` | true | `connected_needs_reauth` | false |
| `provider_revoked` | HTTP 401 with `revoked_token` / `access_denied` / `consent_required` | true | `revoked` | true |
| `insufficient_scope` | HTTP 403 with `insufficient_scope` / `scope` mention | true | `connected_needs_reauth` | false |
| `provider_unavailable` | HTTP 5xx / network timeout / DNS failure | false | `null` (stay) | false |
| `rate_limited` | HTTP 429 / `rate_limit` mention | false | `null` (stay) | false |
| `unknown` | Anything else | true | `connected_needs_reauth` | true |

**Failover ordering rules (canonical, from §9.7):**

1. Filter: only rows where `usabilityState === 'connected_usable'` AND (`availabilityScope === 'all_agents'` OR `allowedAgentIds.includes(agentId)`)
2. Default-first: `authType === 'operator_session'` AND `isDefault === true` → position 0
3. Non-default operator_session rows: sorted by `label ASC NULLS LAST, id ASC`
4. All other auth types: appended in their original input order (broker's SQL controls the input order for these; the pure helper preserves that order so the §9.7 contract holds)

**Error handling:** Pure helpers throw typed errors (`InvalidStateTransitionError`, `CredentialNotUsableError`); they never log or write. Callers (Chunk 3) catch and map to service-tier errors with HTTP status.

**Test considerations:**
- `assertCredentialUsableOrThrow`: 6 tests, one per state, all assert decryptHook invocation count (0 for non-usable, 1 for usable)
- `orderResolvedCredentials`: at minimum these scenarios — (a) one default + three non-default operator_session + two platform rows; (b) default not usable, so not first; (c) all labels NULL → id-tiebreaker; (d) identical labels → id-tiebreaker; (e) agent not in allowlist → excluded; (f) `availabilityScope === 'all_agents'` regardless of allowedAgentIds → included; (g) §8.21 determinism test, three input orderings produce identical output
- `classifyRefreshFailure`: one test per bucket, plus an "unknown" test for a totally unexpected error shape
- `isValidTransition`: enumerate all 6×6 = 36 pairs; assert allowed/forbidden per the table; terminal-state from-side always returns false

**Dependencies on prior chunks:** Chunk 1 (imports `UsabilityState` derived from the schema's `usabilityState` column's union type).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/__tests__/operatorSessionLifecycleServicePure.test.ts`
- `npx vitest run server/services/__tests__/operatorSessionConsentServicePure.test.ts`
- `npx vitest run server/services/__tests__/credentialBrokerServicePure.test.ts`

**Acceptance criteria checked here:**
- §17.2 broker retrieval invariant (pure helper portion)
- §17.4 state machine (transition validity table)
- §17.5b failover ordering contract (pure helper portion)
- §17.6 failure classification (all 6 buckets)

---

### Chunk 3, Consent + lifecycle + connect skeleton (DB writes)

**`spec_sections:`** §7.5, §7.2, §7.3, §9.3, §9.4, §11.1, §11.3, §11.4, §16.1, §16.3, §16.5, §16.6, §16.7, §17.5

**Public interface this chunk exposes:**

```typescript
// server/services/operatorSessionConsentService.ts
export const operatorSessionConsentService = {
  recordConsent(input: {
    organisationId: string; subaccountId: string | null; userId: string;
    connectionId: string | null;   // NULL during initial connect (back-fill follows); non-NULL on re-acceptance
    planTier: string; disclosureVersion: number;
    disclosureTextSnapshot: string; consentTextSnapshot: string;
    actorUserId: string; tx?: DBTransaction;  // re-uses caller's tx; throws if missing during initial connect
  }): Promise<OperatorSessionConsent>;

  backfillConnectionId(input: {
    consentId: string; connectionId: string;
  }): Promise<void>;
  // The ONLY UPDATE permitted on operator_session_consents.
  // Requires an active withOrgTx ALS context; obtains the scoped DB handle via
  // getOrgScopedDb('operatorSessionConsentService.backfillConnectionId').
  // Throws { statusCode: 500, errorCode: 'backfill_requires_org_tx_context' } if no context exists.
  // Pre-condition: existing row has connection_id IS NULL. Predicate-guarded UPDATE.

  recordEvent(input: {
    consentId: string; eventType: 'granted' | 'revoked' | 'superseded';
    actorUserId: string | null; supersededByConsentId?: string | null;
    tx?: DBTransaction;
  }): Promise<OperatorSessionConsentEvent>;

  checkConsentStatus(connectionId: string): Promise<{
    needsReaccept: boolean; currentConsentId: string | null; currentDisclosureVersion: number | null;
  }>;
  // Reads connection's consent_record_id, joins to consent row, compares disclosure_version
  // against OPERATOR_SESSION_DISCLOSURE_VERSION via the pure helper.

  minimisePiiForDeletedUser(userId: string): Promise<void>;
  // V1 stub: throws { statusCode: 501, errorCode: 'not_implemented' }. Logs a `feature.consent_pii_minimisation_called` event.
};

// server/services/operatorSessionLifecycleService.ts
export const operatorSessionLifecycleService = {
  transition(input: {
    connectionId: string; organisationId: string;
    from: UsabilityState; to: UsabilityState;
    cause?: 'token_refresh_failed' | 'admin_disabled' | 'disclosure_bumped' | 'user_reaccepted' | 'user_reauthed' | 'owner_inactive' | 'permission_revoked';
    actorUserId: string | null;
  }): Promise<{ transitioned: boolean }>;
  // 1) isValidTransition(from, to) — throw InvalidStateTransitionError if false
  // 2) UPDATE integration_connections SET usability_state = $to, updated_at = now()
  //    WHERE id = $connectionId AND organisation_id = $organisationId AND usability_state = $from
  // 3) If rowCount === 0 → already-transitioned race; return { transitioned: false } (caller decides whether 200 or 409)
  // 4) Emit audit event with the correct event_type per §7.5 (`operator_session.revoked`, `operator_session.disabled`, etc.)
};

// server/services/operatorSessionService.ts
export const operatorSessionService = {
  connect(input: {
    organisationId: string; subaccountId: string; userId: string;
    provider: string;  // 'openai'
    label: string;
    disclosureAcceptance?: {
      disclosureVersion: number;
      consentText: string;
      acceptanceTier: 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown';
    };
  }): Promise<AiSubscriptionConnection>;
  // 1) Registry guard: if connectionMechanism === 'none_verified' → throw { statusCode: 501, errorCode: 'provider_mechanism_not_verified' }
  // 2) Disclosure-requirement gate per §11.1
  // 3) Provider OAuth handshake (stub for V1; returns mocked token until mechanism verified)
  // 4) Plan-detection per §7.4
  // 5) Compute initial usability_state + plan_verification_status (no transition() call)
  // 6) BEGIN tx → INSERT consent (if Branch B) → INSERT connection → UPDATE consent.connection_id back-fill (Branch B only) → COMMIT
  // 7) Return AiSubscriptionConnection shape

  reaccept(input: {
    organisationId: string; subaccountId: string; connectionId: string; actorUserId: string;
    disclosureAcceptance: { disclosureVersion: number; consentText: string; acceptanceTier: string };
  }): Promise<{ consent: OperatorSessionConsent; newState: UsabilityState }>;
  // Distinct flow per §11.1 'Re-acceptance flow' — single tx:
  // 1) Load existing connection + current consent
  // 2) If no prior consent → throw { statusCode: 422, errorCode: 'no_prior_consent_use_connect' }
  // 3) INSERT new consent (with connection_id set at INSERT time — no back-fill needed)
  // 4) recordEvent('granted', newConsentId)
  // 5) recordEvent('superseded', oldConsentId, supersededByConsentId=newConsentId)
  // 6) UPDATE integration_connections SET consent_record_id = newConsentId
  // 7) transition(connectionId, 'connected_needs_consent' OR 'connected_unverified', 'connected_usable')

  listAllowedSubscriptionsForAgent(input: {
    organisationId: string; subaccountId: string; agentId: string;
  }): Promise<AiSubscriptionConnection[]>;
  // Per §10.4 read route: returns operator_session connections only, ordered by Default first then `label ASC NULLS LAST, id ASC`, filtered by allowlist.
  // Excludes platform-managed credentials (those remain in credentialBrokerService.resolveAvailableCredentials).
  // Uses the §11.4 on-read disclosure-version check; transitions stale rows to connected_needs_consent before returning.

  detectAndTransitionStaleDisclosure(input: {
    organisationId: string; connectionId: string;
  }): Promise<{ transitioned: boolean }>;
  // Called from list paths. Reads consent, compares via pure helper, if 'needs_reaccept' calls transition() to connected_needs_consent.
};
```

**What stays hidden behind it:**
- The exact SQL each service emits (UPDATEs predicate-guarded with `usability_state = $expectedFromState` per §16.7)
- Mock provider handshake behaviour (V1: returns fixed `{ accessToken: '<placeholder>', refreshToken: '<placeholder>', tokenExpiresAt: now() + 1h }` when registry's `connectionMechanism === 'none_verified'`; rejected by the 501 guard so it should never actually execute)
- Plan-detection branching logic (which calls the pure `compareDisclosureVersion` vs which derives the initial state)
- Audit event payload shapes for `operator_session.{connected,refreshed,revoked,disabled,needs_reauth,needs_consent}`

**Files to create:**

| Path | Purpose |
|---|---|
| `server/services/operatorSessionConsentService.ts` | Append-only consent writer + one-shot back-fill + event recorder + on-read version check + PII stub |
| `server/services/operatorSessionLifecycleService.ts` | State machine transitions (only code allowed to UPDATE `usability_state` after row exists) |
| `server/services/operatorSessionService.ts` | Connect flow + re-acceptance + listAllowedSubscriptionsForAgent + detectAndTransitionStaleDisclosure |

**Transaction discipline (CRITICAL):**

- All service methods rely on ALS context for DB access via `getOrgScopedDb()`. When the caller is `connect()` or `reaccept()`, the caller opens the transaction via `withOrgTx(ctx, async () => { ... })` and all service calls within share the same transaction context automatically. No explicit `tx` parameter is passed between methods.
- `backfillConnectionId` REQUIRES an active `withOrgTx` ALS context and throws `{ statusCode: 500, errorCode: 'backfill_requires_org_tx_context' }` if `getOrgScopedDb()` finds no active context. This is the load-bearing service-layer enforcement of Decision B — the method cannot be called outside a transaction boundary.
- `transition()` predicate-guards every UPDATE: `WHERE usability_state = $expectedFrom`. 0 rows = already-transitioned (idempotent), surfacing as `{ transitioned: false }` to the caller.

**Connect flow (canonical sequence, Branch B):**

```
// NOTE: withOrgTx callback receives NO tx argument — use getOrgScopedDb() inside.
withOrgTx(ctx, async () => {
  const db = getOrgScopedDb('operatorSessionService.connect');
  const initialState = derivePlanVerification(planDetectionMechanism, planTier);
  const consent = await operatorSessionConsentService.recordConsent({
    organisationId, subaccountId, userId, connectionId: null,
    planTier, disclosureVersion, disclosureTextSnapshot, consentTextSnapshot,
    actorUserId: userId,
    // recordConsent calls getOrgScopedDb() internally; no tx arg needed
  });
  await operatorSessionConsentService.recordEvent({
    consentId: consent.id, eventType: 'granted', actorUserId: userId,
  });
  const [connection] = await db.insert(integrationConnections).values({
    organisationId, subaccountId, userId,
    providerType: provider, authType: 'operator_session', label,
    accessToken: encryptToken(token.access), refreshToken: encryptToken(token.refresh),
    tokenExpiresAt: token.expiresAt,
    usabilityState: initialState.usabilityState,
    planTier, planVerificationStatus: initialState.planVerificationStatus,
    planVerifiedAt: initialState.planVerifiedAt,
    consentRecordId: consent.id,
    isDefault: false,
    configJson: { operator_session: { availabilityScope: 'all_agents', allowedAgentIds: null } },
  }).returning();
  await operatorSessionConsentService.backfillConnectionId({
    consentId: consent.id, connectionId: connection.id,
    // backfillConnectionId calls getOrgScopedDb() internally; tx guard is enforced
    // by requiring an active withOrgTx context rather than an explicit tx param
  });
  return { connection, consent };
});
```

Branch A (sanctioned + verified) skips the consent INSERT, recordEvent, and backfill calls.

**Error handling:**

| Error | HTTP / shape |
|---|---|
| Registry guard hit | `{ statusCode: 501, errorCode: 'provider_mechanism_not_verified' }` |
| Disclosure block missing on Branch B | `{ statusCode: 422, errorCode: 'disclosure_required' }` |
| Label conflict via `ic_subaccount_provider_label_unique` | `{ statusCode: 409, errorCode: 'duplicate_subscription_label' }` (catch 23505 from Postgres error code) |
| Re-acceptance with no prior consent | `{ statusCode: 422, errorCode: 'no_prior_consent_use_connect' }` |
| `transition()` invalid from→to | `InvalidStateTransitionError` (pure helper) → service maps to `{ statusCode: 409, errorCode: 'invalid_state_transition' }` for HTTP routes |
| Backfill UPDATE rejected (consent already has connection_id set) | `{ statusCode: 500, errorCode: 'consent_backfill_already_filled' }` (only reachable via service-layer bug) |

**Test considerations:** Service-level tests are PROHIBITED by §15 unless the test targets pure helpers via injected mocks. This chunk's tests live entirely in Chunk 2's pure-helper test files. The non-pure services are verified at integration-test time (Phase 2+). The static gate (Chunk 5's grep verification) confirms no unauthorised code path writes `usability_state` directly.

**Dependencies on prior chunks:** Chunks 1, 2.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- Pure-helper Vitest tests authored in Chunk 2 still pass (re-run is unnecessary; Chunk 2 owns them — DON'T re-run the suite here)

**Acceptance criteria checked here:**
- §17.5 consent lifecycle (all bullets; pre/post-verification flows; re-acceptance route; static check that this service is the ONLY UPDATE-er of `operator_session_consents.connection_id`)
- §17.4 state machine direct-UPDATE blocking (achieved via making `transition()` the only writer)

### Chunk 4, Credential broker extension

**`spec_sections:`** §9.1, §9.6, §9.7, §11.1 (broker invariant), §12 Chunk 4, §17.2, §17.3, §17.5b

**Public interface this chunk exposes:**

```typescript
// server/services/credentialBrokerService.ts, EXTENDED, new union member added:
type IssueCredentialResult = IssuedCredential | OperatorSessionEnvelope;

// issueCredential keeps its existing signature; the return shape switches on the
// connection's authType. For operator_session rows, it returns OperatorSessionEnvelope.
// For all other authTypes, it returns the existing IssuedCredential shape.

// New behaviour for operator_session:
// 1. Read connection row (NOT decrypting token)
// 2. Call assertCredentialUsableOrThrow(state, () => undefined) from credentialBrokerServicePure
//    → throws CredentialNotUsableError when state !== 'connected_usable'
// 3. On usable: build redacted OperatorSessionEnvelope; no token decryption in V1.
//    Token decryption is deferred to the future injectIntoEnvironment consumer path.
```

**What stays hidden behind it:**
- Future token-decryption mechanism, when `injectIntoEnvironment` gains a real consumer (Phase 3+, OpenClaw adapter); `connectionTokenService` is reused at that point with no changes needed now
- The SQL ORDER BY used by `resolveAvailableCredentials` as a performance hint (the pure helper authoritatively re-orders the result rows per §9.7)
- The internal mapping from DB row → `OperatorSessionEnvelope` shape

**Files to create:**

| Path | Purpose |
|---|---|
| `scripts/verify-operator-session-token-redaction.sh` | CI gate (§17.9 enforcement): greps for `accessToken` / `refreshToken` reads outside the two permitted files (`server/services/credentialBrokerService.ts` and `server/services/connectionTokenService.ts`); exits non-zero on any hit. CI-only — not run locally during this plan. Wire by registering in the CI gate aggregator. |

**Files to modify:**

| Path | Change |
|---|---|
| `server/services/credentialBrokerService.ts` | Add `operator_session` branch to `issueCredential`, `injectIntoEnvironment`, `resolveAvailableCredentials`; import + delegate to `credentialBrokerServicePure`. Add `'operator_session'` to the existing `IssuedCredential.authType` union (or add `OperatorSessionEnvelope` to the return union and discriminate by `authType` literal). |

**`issueCredential` operator_session branch (canonical sequence):**

```
const conn = await readConnection(connectionId);  // single SELECT, NO token decryption
if (conn.authType !== 'operator_session') return existingBehaviour(conn);

// V1: state gate only. Token decryption is deferred to the injection path (Phase 3+, OpenClaw adapter).
// The decryptHook is a no-op here; assertCredentialUsableOrThrow still invokes it once when usable
// (preserving the testable contract: hook call-count = 1 for 'connected_usable', 0 otherwise).
assertCredentialUsableOrThrow(conn.usabilityState, () => undefined);

return {
  credentialId: generateOpaqueId(),
  connectionId: conn.id,
  authType: 'operator_session',
  provider: conn.providerType,
  planTier: conn.planTier,
  usabilityState: 'connected_usable',
  issuedAt: new Date().toISOString(),
  expiresAt: conn.tokenExpiresAt?.toISOString() ?? null,
} satisfies OperatorSessionEnvelope;
// Token material NEVER appears in the returned envelope or in any closure.
// When injectIntoEnvironment gains a real consumer (Phase 3+), it will call
// connectionTokenService.decrypt() at injection time, not here.
```

**`injectIntoEnvironment` operator_session branch:** No-op for V1 (no consumer exists). The structure is in place so the OpenClaw adapter (Phase 3+) can plug in. The branch must log `operator_session.inject_no_consumer_v1` at debug level and return the env unchanged. Per §13, runtime consumption is deferred.

**`resolveAvailableCredentials` operator_session extension:**

```
// Existing SQL is extended to include auth_type = 'operator_session' rows.
// Pre-filter in SQL: WHERE usability_state = 'connected_usable' (for operator_session)
//                    AND (config_json -> 'operator_session' ->> 'availabilityScope' = 'all_agents'
//                         OR config_json -> 'operator_session' -> 'allowedAgentIds' ? $agentId::text)
// Then pass rows through orderResolvedCredentials(rows, agentId) — pure helper, single source of truth for §9.7 order.
// If SQL and pure helper disagree on order, the pure helper wins.
```

**Defence-in-depth: redaction static gate.** A new gate `scripts/verify-operator-session-token-redaction.sh` (authored as a sibling to existing redaction gates) greps for `accessToken` / `refreshToken` reads outside `server/services/credentialBrokerService.ts` and `server/services/connectionTokenService.ts`. Any hit fails CI. This is the §17.9 enforcement mechanism. The gate's allowlist explicitly enumerates the two permitted files.

**Error handling:**
- `CredentialNotUsableError` from the pure helper propagates up. The broker maps it to a service-layer throw with `{ statusCode: 409, errorCode: 'credential_not_usable', state: err.state }`. Callers (future OpenClaw adapter) decide whether to retry or fail-out.

**Test considerations:** This chunk's tests live in Chunk 2's pure-helper test files. The wiring is verified by:
- Static gate: no other file reads `accessToken` / `refreshToken` directly.
- Static gate: no file outside `credentialBrokerService.ts` references `OperatorSessionEnvelope`'s producer location.
- Mechanical check per §17.3: `grep -r "operator_session" server/services/providers/ server/services/iee/` returns zero matches.

**Dependencies on prior chunks:** Chunks 1 (schema), 2 (pure helpers), 3 (connect flow produces rows for the broker to read).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

**Acceptance criteria checked here:**
- §17.2 broker retrieval invariant (wired into the non-pure service)
- §17.3 no-consumer V1 (mechanical grep)
- §17.5b failover ordering (broker-level wiring to pure helper)
- §17.9 redaction (static gate)

---

### Chunk 5, Permissions + API routes

**`spec_sections:`** §5.5, §8.8, §8.9, §8.10, §8.11, §9.2, §10.1, §10.4, §10.5, §11.1, §11.5, §12 Chunk 5, §16.6, §17.1

**Public interface this chunk exposes:**

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/subaccounts/:id/operator-session-connections` | `operator_session.view` | List for the subaccount |
| POST | `/api/subaccounts/:id/operator-session-connections` | `operator_session.connect` | Initial connect; 501 gated by registry |
| GET | `/api/subaccounts/:id/operator-session-connections/:connId` | `operator_session.view` | Single connection detail |
| PATCH | `/api/subaccounts/:id/operator-session-connections/:connId` | `operator_session.connect` | Label/displayName only |
| DELETE | `/api/subaccounts/:id/operator-session-connections/:connId` | `operator_session.disconnect` | Transitions to `disabled` |
| POST | `/api/subaccounts/:id/operator-session-connections/:connId/consent` | `operator_session.connect` | Re-acceptance (distinct from initial connect) |
| POST | `/api/subaccounts/:id/operator-session-connections/:connId/make-default` | `operator_session.connect` | Two-UPDATE transaction; partial index 23505 → 409 |
| POST | `/api/subaccounts/:id/operator-session-connections/:connId/reauth` | `operator_session.reauth` | Lightweight re-auth; no fresh consent capture; owner-mismatch guard |
| PATCH | `/api/subaccounts/:id/operator-session-connections/:connId/allow-agent-use` | `operator_session.allow_agent_use` | Edit availability (JSONB write through service) |
| GET | `/api/subaccounts/:id/agents/:agentId/allowed-subscriptions` | `operator_session.view` | Read-only Model Access summary; calls `listAllowedSubscriptionsForAgent`. NOTE — although a peer of the agent edit page, this route lives in `operatorSessionConnections.ts` per §8.8 to keep the operator-session domain colocated. |

**Permission middleware chain (every route):** `authenticate → requireSubaccountPermission(X) → asyncHandler(fn)`. Inside `fn`: `const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!)`, then service calls with `subaccount.id`.

**What stays hidden behind it:**
- Zod request-body schemas for `connect`, `reaccept`, `update`, `makeDefault`, `editAvailability` (each route has its own schema; all enforce `acceptanceTier ∈ enum`, `disclosureVersion ≥ 1`, `label.length ≤ 64`, etc.)
- The two-UPDATE Make-Default transaction with `SELECT ... FOR UPDATE` lock + partial-unique-index catch
- The owner-mismatch identity check in `reauth` (compares `req.user.id` against the consent's `user_id`; 422 if mismatch)

**Files to create:**

| Path | Purpose |
|---|---|
| `server/routes/operatorSessionConnections.ts` | All routes in the table above |
| `server/routes/webLoginConnectionsGovern.ts` | Govern-surface Add/Edit/Test Web Login routes (consolidation per §5.5); reuses `webLoginConnectionService.ts` |
| `server/schemas/operatorSessionConnections.ts` | Zod schemas for the routes |

**Files to modify:**

| Path | Change |
|---|---|
| `server/lib/permissions.ts` | Add 5 new keys to `SUBACCOUNT_PERMISSIONS`; add to `ALL_PERMISSIONS` with `groupName: 'AI Subscriptions'` and descriptions; add to role-bindings table per §4.3 |
| `server/services/connectionsService.ts` | Extend `listConnections` to include `auth_type = 'operator_session'` rows. Inside the function: when iterating, filter out operator_session rows for principals who lack `OPERATOR_SESSION_VIEW`. Map operator_session rows to the `AiSubscriptionConnection` shape per §9.2. |
| `shared/types/govern.ts` | Add `'ai_subscription'` to `authMethod` union; add `AiSubscriptionConnection` interface per §4.1 |
| `server/index.ts` | Mount `operatorSessionConnections` + `webLoginConnectionsGovern` routers |

**Make-Default route (canonical SQL, §16.3):**

```
// NOTE: withOrgTx callback receives NO tx argument — use getOrgScopedDb() inside.
withOrgTx(ctx, async () => {
  const db = getOrgScopedDb('operatorSessionConnections.makeDefault');
  // 1) Optionally lock the current default for the subaccount
  await db.execute(sql`
    SELECT id FROM integration_connections
    WHERE subaccount_id = ${subaccountId}
      AND auth_type = 'operator_session'
      AND is_default = true
    FOR UPDATE`);
  // 2) Clear current default
  await db.update(integrationConnections)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(
      eq(integrationConnections.subaccountId, subaccountId),
      eq(integrationConnections.authType, 'operator_session'),
      eq(integrationConnections.isDefault, true),
    ));
  // 3) Promote target
  const promoted = await db.update(integrationConnections)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(and(
      eq(integrationConnections.id, connId),
      eq(integrationConnections.subaccountId, subaccountId),
      eq(integrationConnections.authType, 'operator_session'),
    ))
    .returning();
  if (promoted.length === 0) throw { statusCode: 404, message: 'Connection not found' };
}).catch(err => {
  // Map 23505 from partial unique index → 409 concurrent_default_change
  if (err?.code === '23505' && err?.constraint?.includes('ic_subaccount_operator_session_default_unique')) {
    throw { statusCode: 409, errorCode: 'concurrent_default_change', message: 'Another caller already promoted a different connection. Refetch and retry.' };
  }
  throw err;
});
```

**Re-auth route — owner-mismatch guard:**

```
const conn = await readConnection(connId);
const consent = await readConsent(conn.consentRecordId);
if (consent?.userId && consent.userId !== req.user!.id) {
  throw { statusCode: 422, errorCode: 'owner_mismatch_transfer_ownership_required',
          message: 'This subscription is owned by another user. Transfer ownership flow is not yet available — contact your administrator.' };
}
// otherwise: trigger lightweight re-auth flow (mock for V1; no provider call until mechanism verified)
```

**`webLoginConnectionsGovern.ts` routes:**

| Method | Path | Reused service method |
|---|---|---|
| POST | `/api/subaccounts/:subaccountId/web-login-connections` | `webLoginConnectionService.create` |
| PATCH | `/api/subaccounts/:subaccountId/web-login-connections/:id` | `webLoginConnectionService.update` (with leave-blank password handling) |
| POST | `/api/subaccounts/:subaccountId/web-login-connections/:id/test` | `webLoginConnectionService.test` (enqueues IEE `login_test`; returns 202 + progressUrl) |
| DELETE | `/api/subaccounts/:subaccountId/web-login-connections/:id` | `webLoginConnectionService.delete` |

All four use `subaccount.connections.manage` (per §10.5; matches legacy CredentialsTab routes — no permission gap from consolidation). The service layer is unchanged.

**connectionsService.listConnections bridge logic:**

```
// Inside listConnections, after fetching all rows:
const hasOperatorSessionView = await permissions.user.has(SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_VIEW);
return rows
  .filter(row => row.authType !== 'operator_session' || hasOperatorSessionView)
  .map(row => mapToConnection(row));  // mapToConnection produces AiSubscriptionConnection for operator_session rows
```

**Error handling:** Standard `{ statusCode, message, errorCode? }`. Per-route Zod failures map to 400 with `errorCode: 'validation_error'` and a `details` array. The 501 / 422 / 409 catalogue in §4.4 covers the rest.

**Test considerations:** Per §15, no API contract tests. Routes verified by integration testing at Phase 2+. This chunk's targeted verification is `npm run typecheck` clean and a manual route-mount sanity check (start `npm run dev`, hit `/api/health`, confirm no boot-time errors).

**Dependencies on prior chunks:** Chunks 1, 3, 4 (broker, services, schema must exist before routes call them).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server` (validates router mounting compiles)

**Acceptance criteria checked here:**
- §17.1 schema deliverables — `verify-rls-coverage.sh` confirms both new tables in route layer (no direct DB access)
- §17.5 consent lifecycle — 501 gate at the route level
- §17.7 UI consolidation — Govern-surface Web Login routes available

---

### Chunk 6, Token refresh job (pg-boss)

**`spec_sections:`** §11.2, §12 Chunk 6, §16.1, §16.2, §16.4

**Public interface this chunk exposes:**
- pg-boss queue name: `operator-session-refresh`
- Handler function: `processOperatorSessionRefresh(job: { connectionId: string })` — registered via `createWorker`
- Enqueuer helper: `enqueueOperatorSessionRefresh(connectionId: string, refreshBucketEpochSec: number)` — called by the per-org sweep job that this chunk creates and registers
- Per-org sweep job: created and registered in this chunk as a separate scheduled pg-boss job; iterates connections nightly and enqueues per-connection refresh jobs

**What stays hidden behind it:**
- The 6-bucket failure classification (delegated to `operatorSessionLifecycleServicePure.classifyRefreshFailure`)
- The exponential backoff math (uses pg-boss `retryLimit` + `retryDelay` config)
- The `refreshBucket` 5-minute floor calculation (DB-anchored — see idempotency key below)

**Files to create:**

| Path | Purpose |
|---|---|
| `server/jobs/operatorSessionRefreshJob.ts` | Handler + enqueuer + per-org sweep entry point |

**Files to modify:**

| Path | Change |
|---|---|
| `server/jobs/index.ts` | Register the new job's handler via `createWorker('operator-session-refresh', handler)` |
| `server/config/jobConfig.ts` | Add `operatorSessionRefresh` entry: `{ queue: 'operator-session-refresh', retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInHours: 2 }` |

**Handler flow (canonical):**

```
async function processOperatorSessionRefresh({ connectionId }: { connectionId: string }) {
  // 1) Admin top-level read to find connection's organisationId (single SELECT — `withAdminConnection`).
  const conn = await readConnectionWithOrgId(connectionId);
  if (!conn) return;  // soft-deleted or removed; drop silently.
  if (conn.usabilityState === 'revoked' || conn.usabilityState === 'disabled') return;  // post-terminal gate

  // 2) Per-tenant work inside withOrgTx(conn.organisationId, ...).
  // NOTE: withOrgTx callback receives NO tx argument — use getOrgScopedDb() inside.
  await withOrgTx(ctx, async () => {
    const db = getOrgScopedDb('operatorSessionRefreshJob.processRefresh');
    try {
      const newToken = await providerRefreshHandshake(conn);  // V1: mocked since registry mechanism unverified
      await db.update(integrationConnections)
        .set({
          accessToken: encryptToken(newToken.access),
          refreshToken: encryptToken(newToken.refresh),
          tokenExpiresAt: newToken.expiresAt,
          lastRefreshedAt: new Date(),
        })
        .where(eq(integrationConnections.id, connectionId));
      await emitAuditEvent({ type: 'operator_session.refreshed', status: 'success', connectionId });
    } catch (err) {
      const classification = classifyRefreshFailure(err);  // pure helper
      if (classification.marksUnusable && classification.nextState) {
        await operatorSessionLifecycleService.transition({
          connectionId, organisationId: conn.organisationId,
          from: 'connected_usable', to: classification.nextState,
          cause: 'token_refresh_failed', actorUserId: null,
        });
        await emitAuditEvent({
          type: classification.nextState === 'revoked' ? 'operator_session.revoked' : 'operator_session.needs_reauth',
          status: 'failed', connectionId, bucket: classification.bucket,
        });
      } else {
        await emitAuditEvent({ type: 'operator_session.refresh_retried', status: 'partial', connectionId, bucket: classification.bucket });
        throw err;  // pg-boss retries per jobConfig
      }
    }
  });
}
```

**Per-org sweep (registered as a separate scheduled job):**

```
// Triggered nightly + on-demand. Iterates orgs via withAdminConnection,
// for each org finds connections whose token_expires_at is within REFRESH_WINDOW_MINUTES (default 30)
// and enqueues a job per connection.
//
// Pattern: mirror `memoryDedupJob.ts` (admin for iteration, withOrgTx per tenant if writes are needed).
// This sweep only enqueues, so the per-tenant withOrgTx is not strictly needed here, but the enqueue
// must include the `refreshBucket` singletonKey to dedupe concurrent enqueues.
```

**Idempotency key (per §11.2):** `singletonKey = \`${connectionId}:\${refreshBucket}\`` where `refreshBucket` is derived from DB time to respect the repo's time-semantics discipline (this job handles token expiry, retries, and ordering — wall-clock skew could create ghost-duplicate jobs). Compute it in the enqueue query:

```sql
SELECT FLOOR(EXTRACT(EPOCH FROM transaction_timestamp()) / 300)::int AS refresh_bucket
```

pg-boss collapses duplicates within the same 5-minute bucket. Pass `refreshBucket` as a parameter to `enqueueOperatorSessionRefresh(connectionId, refreshBucket)`.

**Post-terminal enqueue guard:** The sweep MUST skip connections in `revoked` or `disabled` state. The handler also re-checks the state at execution time (defence-in-depth) — `if (conn.usabilityState in {revoked, disabled}) return` before doing any work.

**Durability:** Per §8.31, this is a durable job (pg-boss handles retries). No "fire and forget" comment required because the queue itself is the durability boundary.

**Error handling:**
- Retryable buckets (`provider_unavailable`, `rate_limited`): throw the original error so pg-boss reschedules; emit `partial` audit event.
- Unusable buckets (`expired_refresh_token`, `provider_revoked`, `insufficient_scope`, `unknown`): transition state, emit `failed` audit event, swallow the error so pg-boss does NOT retry.
- Connection vanished between sweep and execution: drop silently (log debug).

**Test considerations:** No live-DB test in V1 per §15. The pure helper (`classifyRefreshFailure`) has already been tested in Chunk 2. The handler's branching logic is verifiable at code review; an integration test lands in Phase 2+.

**Dependencies on prior chunks:** Chunks 1, 2, 3 (schema, classifier, lifecycle service).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria checked here:**
- §17.6 failure classification wired into the job (each bucket produces the right state transition or retry decision)

### Chunk 7, AI Subscriptions tab (client)

**`spec_sections:`** §5.3, §6 (mockups), §8.12, §8.13, §11.1, §11.4, §12 Chunk 7, §17.7, §17.8

**Mockup references (load before building each component):**

| Component | Mockup file |
|---|---|
| `AiSubscriptionsTab` | `prototypes/operator-session-identity/01-connections-list.html` |
| `ConnectAiSubscriptionModal` (wizard) | `prototypes/operator-session-identity/02-connect-wizard.html` |
| Plus-tier disclosure step inside `ConnectAiSubscriptionModal` | `prototypes/operator-session-identity/03-disclosure-plus.html` |
| `AiSubscriptionDetailModal` | `prototypes/operator-session-identity/04-subscription-detail.html`, `05-reauth-state.html`, `06-offboarding-state.html`, `19-revoked-by-openai-state.html` |
| `EditAvailabilityModal` | `prototypes/operator-session-identity/07-availability-edit.html` |
| `MakeDefaultConfirmModal` | `prototypes/operator-session-identity/17-make-default-confirm.html` (states A and B) |
| `SignInAgainModal` | `prototypes/operator-session-identity/20-sign-in-again-light.html` |
| `DisclosureVersionBumpModal` | `prototypes/operator-session-identity/18-disclosure-version-bump.html` |

**Public interface this chunk exposes:** React components consumed by `ConnectionsPage.tsx` (mounted in Chunk 10). No props leak the operator_session domain outside govern/.

**What stays hidden behind it:** All hooks/state-management internals; the React Query cache keys; copy strings (read from a per-component `copy.ts` constant for easy iteration); the per-pill colour scheme.

**Files to create:**

| Path | Purpose |
|---|---|
| `client/src/pages/govern/components/AiSubscriptionsTab.tsx` | Table with Default visual hierarchy, failover explainer banner, sort/filter, six `usability_state` pill variants |
| `client/src/pages/govern/components/ConnectAiSubscriptionModal.tsx` | Wizard (4-step bar, provider handshake, 501-gate state for unverified provider); includes Plus-disclosure step as a private sub-component |
| `client/src/pages/govern/components/AiSubscriptionDetailModal.tsx` | Metadata strip, Default section, Availability section, Currently-used-by, master switch, action buttons |
| `client/src/pages/govern/components/MakeDefaultConfirmModal.tsx` | State A (business) + State B (personal, with checkbox re-ack) |
| `client/src/pages/govern/components/SignInAgainModal.tsx` | Lightweight re-auth (single CTA, no plan detection, no consent capture) |
| `client/src/pages/govern/components/DisclosureVersionBumpModal.tsx` | Disclosure version bump re-acceptance (checkbox re-ack) |
| `client/src/pages/govern/components/EditAvailabilityModal.tsx` | Agent allowlist editor (All / Specific radio + multi-select agent picker) |

**Files to modify:**

| Path | Change |
|---|---|
| `client/src/api/governApi.ts` | Add API calls: `listAiSubscriptions(subaccountId)`, `getAiSubscription(subaccountId, id)`, `connectAiSubscription(subaccountId, payload)`, `updateAiSubscriptionLabel(subaccountId, id, label)`, `makeAiSubscriptionDefault(subaccountId, id)`, `editAiSubscriptionAvailability(subaccountId, id, payload)`, `disconnectAiSubscription(subaccountId, id)`, `reaccepConsent(subaccountId, id, payload)`, `triggerReauth(subaccountId, id)`. All calls return typed `AiSubscriptionConnection` from `shared/types/govern.ts`. |

**Six `usability_state` pill variants (exact labels from §6 vocabulary palette):**

| State | Pill label | Colour intent |
|---|---|---|
| `connected_usable` | "Connected" | success (green) |
| `connected_needs_consent` | "Needs consent" | warning (amber) |
| `connected_needs_reauth` | "Needs sign in" | warning (amber) |
| `connected_unverified` | "Plan not verified" | warning (amber) |
| `revoked` | "Revoked by OpenAI" | error (red) |
| `disabled` | "Disabled — [cause]" | neutral (grey) where cause is from `disabledReason` |

**Vocabulary palette (locked, §6):**

| Concept | Verb / label |
|---|---|
| Add new | "Connect" |
| Refresh expired auth | "Sign in again" |
| Remove | "Disconnect" |
| Pause | "Turn off agent use" |
| Hand over | "Transfer ownership" |
| Promote default | "Make default" |
| Edit allowlist | "Edit availability" |
| Phase 3+ UI label | "Available soon" |

NO emojis. NO em-dashes (—) in UI copy (per project user preferences) — note the pill label "Disabled — [cause]" already uses an em-dash in spec text; for the implementation, replace with comma or colon: "Disabled, [cause]" or "Disabled: [cause]". Builder picks one and applies consistently across the six pills.

**Confirmation pattern matrix (from §17.8):**

| Action | Confirmation type |
|---|---|
| Disconnect | type-to-confirm (paste the subscription label) |
| First-time Plus connect (inside `ConnectAiSubscriptionModal`) | typed phrase "I accept the risk" |
| Repeated consent (`DisclosureVersionBumpModal`) | checkbox re-ack |
| Make Default — business plan (State A) | impact preview, single confirm button |
| Make Default — personal plan (State B) | checkbox re-ack + disabled primary until checked |

**Empty / loading / error states (every component must render all three):**
- Loading: shimmer/skeleton; no copy beyond "Loading…" placeholder
- Empty (no subscriptions): centred copy "No AI Subscriptions yet" + primary "Connect" CTA
- Error (501 from API): banner "Provider verification pending. AI Subscriptions will become available soon." with no CTA enabled. This is the build-time gate surfacing in UI.
- Error (any other 4xx/5xx): inline error banner with `errorCode` and "Retry" button

**Error handling:** All API calls go through `governApi.ts`; errors surface as React Query errors with `error.code` matching the §4.4 catalogue. Components map error codes to the appropriate UX (banner / toast / inline state).

**Test considerations:** No frontend unit tests per §15. Visual review of each component against its mockup is the V1 verification. The `npm run build:client` step in this chunk's verification suffices to catch type / compile errors.

**Dependencies on prior chunks:** Chunk 5 (routes must exist so API calls work; types must be exported from `shared/types/govern.ts`).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Acceptance criteria checked here:**
- §17.7 UI consolidation, AI Subscriptions tab portion (six pill variants rendered)
- §17.8 confirmation modals (Make Default, Disconnect, Plus disclosure, re-auth, version bump)
- §17.9 redaction (UI payloads contain no `auth_token` / `refresh_token`)

---

### Chunk 8, App Integrations tab (client)

**`spec_sections:`** §5.4, §6, §8.12, §12 Chunk 8, §17.7

**Mockup references:**

| Component | Mockup file |
|---|---|
| `AppIntegrationsTab` | `prototypes/operator-session-identity/01b-app-integrations-tab.html` |
| `ConnectAppModal` (Gmail variant) | `prototypes/operator-session-identity/10-connect-app-gmail.html` |
| `ConnectAppModal` (HubSpot variant) | `prototypes/operator-session-identity/11-connect-app-hubspot.html` |
| `ManageMultiConnectDrawer` | `prototypes/operator-session-identity/16-manage-multi-connect.html` |
| `DisconnectConfirmDialog` (shared, also used by Chunks 7 and 9) | `prototypes/operator-session-identity/15-disconnect-confirm.html` |

**Public interface:** React components consumed by `ConnectionsPage.tsx` (Chunk 10).

**Files to create:**

| Path | Purpose |
|---|---|
| `client/src/pages/govern/components/AppIntegrationsTab.tsx` | Card grid, category filter chips, two sections (connected / available) |
| `client/src/pages/govern/components/ConnectAppModal.tsx` | Per-app modal; configurable per provider via a `<app>` prop. Built-in variants: Gmail (Continue to Google), HubSpot (Private App Token text field), Slack, GoHighLevel, Teamwork, Google Drive, Outlook, Google Calendar, Microsoft Calendar |
| `client/src/pages/govern/components/ManageMultiConnectDrawer.tsx` | Per-app multi-connect list drawer with per-connection actions and "+ Add another" CTA |
| `client/src/pages/govern/components/DisconnectConfirmDialog.tsx` | Shared type-to-confirm modal (also used by Chunks 7 and 9) |

**Card grid contract (§5.4):**
- Two sections only: "Your connected apps" (apps with ≥1 connection) AND "Apps you can connect" (apps with 0 connections). Mutually exclusive — no app appears in both. The frontend computes membership from the connection list returned by the existing `listConnections` endpoint (consumed via `connectionsService` and exposed in `governApi.ts`).
- Card content: icon (letter-form avatar V1; SVG system deferred per §13), name, category, connection status, CTA ("Connect" for available, "Manage" for connected).
- Category filter chips above the grid: derived from a static `APP_CATEGORIES` constant in the component file (e.g., "Communication", "CRM", "Calendar", "Files").
- NO "OAuth" / "API Key" / "MCP" / "Cookie" labels visible anywhere. Auth method is plumbing.

**Per-app variant configuration (extensibility seam):**

```typescript
// Inside ConnectAppModal.tsx — a typed map keyed by provider:
const APP_CONNECT_VARIANTS: Record<string, AppConnectVariant> = {
  gmail: { ctaLabel: 'Continue to Google', fields: [], oauthRedirect: '/api/auth/google/start' },
  hubspot: { ctaLabel: 'Connect HubSpot', fields: [{ key: 'apiKey', label: 'Private App Token', secret: true }] },
  // ... per spec §5.3 app list
};
```

Adding a new app variant in a future PR means adding one entry to the map.

**Multi-connect Manage drawer (§5.4):** When a card has ≥2 connections (same app), the "Manage" CTA opens this drawer instead of jumping to the existing single-connection detail. Drawer shows a list of connections with per-connection Test / Edit label / Disconnect actions, plus "+ Add another" at the bottom.

**Error handling:** Same as Chunk 7 — errors via `governApi.ts` map to UX surfaces by `errorCode`.

**Test considerations:** No frontend unit tests per §15.

**Dependencies on prior chunks:** Chunk 5 (uses `listConnections` endpoint). NO dependency on Chunks 6-7.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Acceptance criteria checked here:**
- §17.7 UI consolidation, App Integrations card grid + mutual-exclusivity of sections

---

### Chunk 9, Web Logins tab + CRUD consolidation

**`spec_sections:`** §5.1, §5.2, §5.5, §5.6, §6, §8.8, §8.12, §8.13, §8.14, §12 Chunk 9, §17.7

**Mockup references:**

| Component | Mockup file |
|---|---|
| `WebLoginsTab` | `prototypes/operator-session-identity/01c-web-logins-tab.html` |
| `AddWebLoginModal` | `prototypes/operator-session-identity/12-add-web-login.html` |
| `EditWebLoginModal` | `prototypes/operator-session-identity/13-edit-web-login.html` |
| `TestWebLoginModal` | `prototypes/operator-session-identity/14-test-web-login.html` |

**Public interface:** React components consumed by `ConnectionsPage.tsx` (Chunk 10).

**Files to create:**

| Path | Purpose |
|---|---|
| `client/src/pages/govern/components/WebLoginsTab.tsx` | Sortable / filterable table with test-status dots, 3-dot menus, Add CTA |
| `client/src/pages/govern/components/AddWebLoginModal.tsx` | 4 primary fields (label, URL, username, password) + collapsed Advanced section (6 schema fields). Migrated from `CredentialsTab.tsx` |
| `client/src/pages/govern/components/EditWebLoginModal.tsx` | Same as Add but with "leave blank to keep current password" behaviour |
| `client/src/pages/govern/components/TestWebLoginModal.tsx` | Agent attribution dropdown + running state UI; follows existing IEE pattern (202 + progressUrl) |

**Files to remove:**

| Path | Disposition |
|---|---|
| `client/src/components/CredentialsTab.tsx` | DELETED; functionality migrated to the new tabs |

**Files to convert:**

| Path | Change |
|---|---|
| `client/src/pages/IntegrationsAndCredentialsPage.tsx` | Replace its full body with a redirect to `/connections`. Use `useNavigate` from the existing router; mount a one-line `useEffect(() => navigate('/connections', { replace: true }), [navigate]);` and render nothing. The file is NOT deleted (per §5.2) so existing client routes / bookmarks resolve. The route entry stays in `client/src/config/routes.ts` unchanged. |

**Web Login table contract:**
- Columns: Label, URL, Username (masked), Last test result (dot: green/red/grey), Last test at, Actions (3-dot menu).
- Sort: Label (default), Last test at, Last test result.
- Filter: search (label / URL substring), test result (All / Connected / Test failed / Untested).

**Disconnect flow (shared with Chunk 8's DisconnectConfirmDialog):** Type-to-confirm with the subscription/connection label; disabled CTA until input matches.

**Test Web Login (existing IEE pattern):**
1. Client POST `/api/subaccounts/:subaccountId/web-login-connections/:id/test`
2. Server responds 202 with `{ agentRunId, ieeRunId, progressUrl }`
3. Client follows `progressUrl` via existing run-trace pattern; updates the row's test-status dot when the run completes.

**Cross-chunk edit coordination warning:** Both Chunk 8 and Chunk 9 add to `ConnectionsPage.tsx`. Chunk 10 mounts the tabs. To avoid merge conflicts, Chunk 9 runs AFTER Chunk 8 and ONLY edits `ConnectionsPage.tsx` to remove the legacy CredentialsTab import (if any) — full tab mounting is Chunk 10's job.

**Error handling:** As Chunks 7 and 8.

**Test considerations:** No frontend unit tests per §15. The conversion of `IntegrationsAndCredentialsPage.tsx` to a redirect requires a manual route-resolution sanity check (`npm run dev`, browse to the old URL, confirm redirect).

**Dependencies on prior chunks:** Chunk 5 (Web Login Govern routes must exist). Must run AFTER Chunk 8 (parallel-edit risk on `ConnectionsPage.tsx`).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Acceptance criteria checked here:**
- §17.7 UI consolidation: `CredentialsTab.tsx` removed; `IntegrationsAndCredentialsPage.tsx` redirects; no regression on Add/Edit/Test/Disconnect flows (manual verification)

### Chunk 10, ConnectionsPage wiring + Model Access

**`spec_sections:`** §5.3, §6, §8.13, §8.15, §10.4, §12 Chunk 10, §17.7

**Mockup reference:** `prototypes/operator-session-identity/08-agent-edit-model-access.html` (read-only Model Access section split: Standard runs / Autonomous runs).

**Public interface:**
- `ConnectionsPage.tsx` exposes the new 3-tab strip.
- `AgentEditPage.tsx` and `SubaccountAgentEditPage.tsx` each gain a Model Access section that reads from `getAgentAllowedSubscriptions`.

**Files to modify:**

| Path | Change |
|---|---|
| `client/src/pages/govern/ConnectionsPage.tsx` | Add 3-tab strip; mount `AppIntegrationsTab`, `WebLoginsTab`, `AiSubscriptionsTab` (tab order per spec: App Integrations / Web Logins / AI Subscriptions); per-tab subtitle copy; per-tab count chip derived from existing list endpoints |
| `client/src/pages/build/AgentEditPage.tsx` | Add read-only Model Access section (Standard runs locked to platform; Autonomous runs lists allowed AI Subscriptions). Read-only — no edit affordance. "Edit availability" link routes to the Connections page filtered to the relevant subscription |
| `client/src/pages/SubaccountAgentEditPage.tsx` | Same Model Access section as above; same backing API call |
| `client/src/api/governApi.ts` | Add `getAgentAllowedSubscriptions(agentId, subaccountId)` — calls `GET /api/subaccounts/:id/agents/:agentId/allowed-subscriptions` (already defined in Chunk 5 routes) |

**ConnectionsPage tab strip contract:**

```
Tabs (left to right): App Integrations | Web Logins | AI Subscriptions
Subtitles:
  - App Integrations: "Connect the apps your agents use to do work."
  - Web Logins: "Store logins for sites without an API."
  - AI Subscriptions: "Connect a ChatGPT plan for your autonomous agents."
Default tab: App Integrations
URL preservation: query param ?tab=app-integrations|web-logins|ai-subscriptions; default app-integrations
```

**Model Access section (read-only) contract:**

```
Section title: "Model Access"
Sub-sections:
  1. Standard runs
     Body: "Standard runs use platform-managed model providers. No configuration available."
  2. Autonomous runs
     Body: ordered list of allowed AI Subscriptions for this agent — Default-first, then alphabetical.
     Each item shows: label, plan tier, usability_state pill.
     Empty: "No AI Subscriptions are available to this agent. Edit availability in Connections."
     Link: "Edit availability →" routes to /connections?tab=ai-subscriptions
```

The Model Access list is read-only. Editing happens in `EditAvailabilityModal` from Chunk 7 (accessed via the AI Subscriptions tab on the Connections page).

**API contract for the Model Access route (defined in Chunk 5; consumed here):**

```
GET /api/subaccounts/:id/agents/:agentId/allowed-subscriptions
→ AiSubscriptionConnection[] (operator_session rows only; Default-first then label-sorted)

Permission: subaccount.operator_session.view
Excludes: platform-managed fallback rows (those remain inside credentialBrokerService.resolveAvailableCredentials)
No token material.
```

**Empty / loading / error states for the Model Access section:**
- Loading: skeleton placeholder
- Empty list returned: "No AI Subscriptions are available to this agent."
- Error: inline banner "Could not load Model Access — Retry"

**Error handling:** Standard React Query patterns from Chunks 7-9.

**Test considerations:** No frontend unit tests per §15.

**Dependencies on prior chunks:** Chunks 4, 5 (broker resolveAvailableCredentials + agent route), 7 (`AiSubscriptionsTab`), 8 (`AppIntegrationsTab`), 9 (`WebLoginsTab`).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Acceptance criteria checked here:**
- §17.7 final UI integration (3-tab strip live; agent edit Model Access wired; allowed-subscriptions route response excludes platform-managed credentials)

---

### Chunk 11, Architecture doc sync

**`spec_sections:`** §8.16, §11 (cross-references), §12 Chunk 11

**Public interface:** Documentation only. Read-by humans + future agent sessions.

**Files to modify:**

| Path | Change |
|---|---|
| `architecture.md` | Add a new section "Credential Broker — operator_session mode" under the existing service-layer area. Describe: §1.1-§1.4 architecture decisions, the `usability_state` state machine summary (link to spec §7.5), the two-column model (§Decision A), the broker retrieval invariant (§9.1), failover ordering (§9.7), the `/connections` CRUD consolidation. Add the new schema files to the "Key files per domain" index. Add a note about the on-read disclosure-version-bump pattern. Include anchor IDs for context-pack-loader slicing. |
| `docs/capabilities.md` | Add an "AI Subscriptions" capability entry per Editorial Rules (vendor-neutral, marketing-ready). Single paragraph; no auth-method labels; consumer-facing copy. |
| `KNOWLEDGE.md` | Append (do not edit existing entries) a single entry summarising the new `usability_state` vs `plan_verification_status` two-column pattern (cross-reference the existing entry that captured the same lesson during spec-review) |
| `docs/doc-sync.md` | If the new docs added in this chunk introduce a new doc category (e.g. credential broker patterns), add a row; otherwise no edit needed |

**Editorial Rules check (`docs/capabilities.md`):**
- No "ChatGPT" / "OpenAI" / "OAuth" / "API Key" mentions in the user-facing capability description
- Single paragraph; full sentences
- Frame the capability as: "Connect a subscription that your autonomous agents can use to run model-mediated work, in addition to the platform's managed model providers."

**Cross-reference check:** Every new section in `architecture.md` linked from the existing TOC or its parent section. No orphan headings.

**Error handling:** N/A (documentation only).

**Test considerations:** N/A.

**Dependencies on prior chunks:** All prior chunks (the docs describe what they shipped).

**Verification commands:**
- `npm run lint` (markdown linter if enabled)

**Acceptance criteria checked here:** Doc-sync rule (CLAUDE.md §11): "If a code change invalidates something described in a doc, update that doc in the same session and the same commit as the code change." This chunk satisfies that rule for the entire build.

---

## 6. Risks & Mitigations

### R1. Migration-number collision (HIGH likelihood / MEDIUM blast radius)

**Risk.** The spec text names migrations `0318`/`0319`, but `0318-0320` are already on main from PR #284 pre-test-hardening. If the builder copy-pastes the spec numbers without reading the header constraint in this plan, the migration sequence breaks at CI.

**Mitigation.** This plan's opening section ("Migration number assignment") sets the canonical numbers. Phase 2 originally claimed `0321`/`0322`; Phase 3 (2026-05-12) re-renumbered to `0325`/`0326` after main shipped sandbox-isolation (migrations 0321-0324). The pre-Chunk-1 verification command (`git ls-tree -r origin/main migrations/ | Select-String "032[0-9]"`) is mandatory before any future builder claims migration numbers. Source lesson: `KNOWLEDGE.md` (Pattern: Migration-number collision after S2 sync).

### R2. Build-time gate creates a "complete-but-dark" surface (MEDIUM likelihood / LOW blast radius)

**Risk.** The provider registry's `connectionMechanism: 'none_verified'` ships in V1 and the connect route returns 501. Every user-visible UI element shows "Connect" CTAs that resolve to 501. This is intended ("complete-but-dark") but creates a perception that the feature is broken.

**Mitigation.** The Chunk 7 `ConnectAiSubscriptionModal` renders a dedicated 501 state with copy "Provider verification pending. AI Subscriptions will become available soon." (per §6 vocabulary palette "Available soon"). The empty state of `AiSubscriptionsTab` similarly displays the verifying banner instead of the generic "no subscriptions" message. Acceptance criteria §17.5 explicitly checks the 501 path.

### R3. Bidirectional FK + append-only conflict creates a service-layer invariant burden (MEDIUM likelihood / HIGH blast radius if violated)

**Risk.** `operator_session_consents.connection_id` MUST be updated exactly once per row (NULL → UUID inside the connect transaction). If a future contributor adds a "fix-up consent" maintenance script, or if a hot patch bypasses the service, the append-only contract breaks silently.

**Mitigation.** Three layers:
1. Service-level: `operatorSessionConsentService.backfillConnectionId` is the ONLY method that issues the UPDATE; it requires an active `withOrgTx` ALS context and throws `backfill_requires_org_tx_context` if none exists.
2. Static gate: a new `scripts/verify-operator-session-consent-immutable.sh` (authored in Chunk 1 as part of the schema-foundation deliverables) greps for both SQL-style `UPDATE.*operator_session_consents` and Drizzle-style `update(operatorSessionConsents)` outside `server/services/operatorSessionConsentService.ts` and fails CI on any hit.
3. Acceptance criterion §17.5 final bullet: repo-grep verification test.

### R4. Disclosure version bump cascades multiple state transitions (LOW likelihood / MEDIUM blast radius)

**Risk.** When `OPERATOR_SESSION_DISCLOSURE_VERSION` increments, the first read after deploy across a subaccount with N Plus-tier subscriptions triggers N concurrent `connected_usable → connected_needs_consent` transitions. At V1 scale this is fine; at post-Phase-3+ scale it could thunder.

**Mitigation.** §13 already defers a background-sweep alternative. The on-read transition uses the predicate-guarded UPDATE (`WHERE usability_state = 'connected_usable'`), so a thundering-herd of N concurrent transitions all converge to a consistent state (each transition either succeeds or is a no-op when another already transitioned). Telemetry: `operatorSessionService.detectAndTransitionStaleDisclosure` emits a count metric so the team can monitor and decide when to flip to a background sweep.

### R5. Re-auth identity mismatch — Transfer Ownership not yet built (MEDIUM likelihood / LOW blast radius)

**Risk.** §18 question 4: if a user attempts re-auth on a subscription owned by a different (now-removed) user, the V1 flow returns 422 `owner_mismatch_transfer_ownership_required`. No Transfer Ownership UI exists. Users are stranded.

**Mitigation.** The screen 20 mockup (`20-sign-in-again-light.html`) includes an offramp note. The 422 response includes user-facing copy: "Contact your administrator to transfer ownership." Acceptance test in Chunk 5 verifies the 422 + error code. Transfer Ownership lands in a follow-up spec (§13).

### R6. RLS leakage risk on operator_session rows via the unified `listConnections` (MEDIUM likelihood / HIGH blast radius)

**Risk.** Decision (§10.5): operator_session rows flow through the existing `listConnections` endpoint, which already has `subaccount.connections.view` gating. A user with `connections.view` but NOT `operator_session.view` could see operator_session metadata if the bridge filter is missing or buggy.

**Mitigation.** The bridge logic lives inside `connectionsService.listConnections` (Chunk 5), not in route middleware (which would be too late). The implementation pattern: read `hasOperatorSessionView` from the caller's permission set BEFORE returning the list; filter operator_session rows when the bridge permission is absent. A static unit test or grep-gate confirms the bridge filter is present. Per §17.7 final acceptance: the agent allowed-subscriptions route returns only `AiSubscriptionConnection` rows — no leakage from a `listConnections` bug into the agent edit page.

### R7. Pure-helper-only test posture leaves the non-pure service path unverified (MEDIUM likelihood / MEDIUM blast radius)

**Risk.** Static-gates-primary posture (§15) prohibits integration tests in V1. The non-pure `operatorSessionService.connect` orchestrates 4-5 DB writes inside one transaction; a bug there (e.g. order swap, missing await, wrong FK column) won't be caught by the pure-helper tests until Phase 2+ integration testing exists.

**Mitigation.** Acceptance criteria §17.5 enumerates the post-verification behaviour exhaustively, so spec-conformance + pr-reviewer have a concrete checklist to grep for during the branch-level review. The static gate from R3 catches the most dangerous regression (consent table UPDATE outside the service). The Chunk-3 code review prompt explicitly directs the reviewer to walk the connect-flow transaction line-by-line against the canonical sequence in §11.1 Branch B + this plan.

### R8. JSONB allowlist scan performance at scale (LOW likelihood / HIGH blast radius)

**Risk.** §9.4b stores per-subscription allowlist in `config_json -> 'operator_session' -> 'allowedAgentIds'`. The `resolveAvailableCredentials` SQL does a JSONB containment check per call. At V1 scale (small subaccounts, few connections per subaccount, few agents per allowlist) this is fine; at post-Phase-3+ scale it could become a hotspot.

**Mitigation.** §18 question 2 already documents the deferred migration to a join table (`operator_session_connection_agents`) when scale demands it. The pure helper `orderResolvedCredentials` runs on the post-filtered row set, so its complexity is bounded by the row count returned. No mitigation needed for V1.

### R9. Drizzle / migration drift on FK constraints (MEDIUM likelihood / HIGH blast radius)

**Risk.** Per `KNOWLEDGE.md` correction 2 (2026-05-10): a previous build authored a Drizzle `.references(() => organisations.id)` but the matching migration did NOT include the SQL `REFERENCES` clause, causing introspection drift.

**Mitigation.** Chunk 1's checklist explicitly requires the Drizzle/migration cross-check before merging. Every `.references(...)` in the Drizzle schema must mirror a `REFERENCES ... ON DELETE ...` in the migration SQL, AND vice versa. Builder runs `npm run db:generate` after authoring Drizzle and confirms the generated SQL matches the hand-authored migration (commit both).

### R10. Em-dash leakage into UI copy (LOW likelihood / LOW blast radius)

**Risk.** Project user-preference rules ban em-dashes (—) in UI copy. The spec itself uses em-dashes liberally in prose (e.g. `Disabled — owner inactive`). A literal copy-paste into Chunk 7 pill labels would violate the rule.

**Mitigation.** Chunk 7's vocabulary section flags this explicitly and directs the builder to replace `Disabled — [cause]` with `Disabled, [cause]` or `Disabled: [cause]` and apply consistently. pr-reviewer should also grep for em-dashes in the new client files.

### R11. Cross-chunk parallel edit on `ConnectionsPage.tsx` (MEDIUM likelihood / LOW blast radius)

**Risk.** Chunks 7, 8, 9, and 10 all touch `ConnectionsPage.tsx`. Concurrent builders would create merge conflicts.

**Mitigation.** Chunks 7-9 author their tab components in isolation (no `ConnectionsPage.tsx` edits). Chunk 10 owns the single tab-mounting edit to `ConnectionsPage.tsx`. The chunk ordering enforces this: Chunk 10 runs only after 7, 8, and 9 are merged.

---

## 7. Open Questions Still in Flight

These map to spec §18; the resolution / Builder action is named for each.

| # | Question | Resolution / Builder action |
|---|---|---|
| 1 | Provider connection mechanism verification | OPEN GATE. Registry's `connectionMechanism: 'none_verified'` until OpenAI mechanism is confirmed. Builder ships the 501 gate; no code change beyond updating the registry once verified. |
| 2 | Agent allowlist persistence performance | RESOLVED §18b for V1: JSONB on `config_json`. Migration to join table deferred. Builder uses JSONB. |
| 3 | Subaccount vs org scope for Plus consent | RESOLVED §18b: per-credential consent only; no org-level umbrella. Builder uses the spec's design without further question. |
| 4 | Re-auth identity mismatch routing | PARTIAL — V1 returns 422 `owner_mismatch_transfer_ownership_required`. Transfer Ownership flow deferred to a follow-up spec. Builder implements the 422 guard in Chunk 5. |
| 5 | Re-auth identity mismatch detection — server-side check | RESOLVED HERE: Builder compares `req.user.id` against `operator_session_consents.user_id` (loaded via `connection.consent_record_id`) before any re-auth side effect. See Chunk 5 re-auth route specification. |
| 6 | Disclosure version bump scope | RESOLVED §18b: per-subaccount consent, not org-level umbrella. Builder uses the per-credential consent model. |

The handoff doc lists 6 open questions; this plan resolves or operationally pins each one.

---

## 8. Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

**`npm run build:server` and `npm run build:client` are locally allowed compile checks for this plan.** They appear in per-chunk verification commands as lightweight type-checking complements and are not "broader gates." Do NOT treat the CI-only restriction above as contradicting these per-chunk commands — the two are separate categories.

**Per-chunk Verification commands recap (the only locally-allowed checks):**

| Chunk | Lint | Typecheck | Build | Targeted tests |
|---|---|---|---|---|
| 1 | yes | yes | — | `npx vitest run server/config/__tests__/operatorSessionProviders.test.ts` + `npm run db:generate` |
| 2 | yes | yes | — | Three new Pure test files via `npx vitest run` per-file |
| 3 | yes | yes | — | none new this chunk; pure helpers from Chunk 2 already cover the logic |
| 4 | yes | yes | — | none new this chunk |
| 5 | yes | yes | `build:server` | none new this chunk |
| 6 | yes | yes | `build:server` | none new this chunk |
| 7 | yes | yes | `build:client` | none new this chunk |
| 8 | yes | yes | `build:client` | none new this chunk |
| 9 | yes | yes | `build:client` | none new this chunk |
| 10 | yes | yes | `build:client` | none new this chunk |
| 11 | yes (markdown only) | — | — | none |

**Migration number assignment is non-negotiable.** The opening section of this plan and the Chunk 1 detail both name `0325`/`0326` (re-renumbered from 0321/0322 in Phase 3 after sandbox-isolation shipped). Do NOT use the spec's `0318`/`0319` numbers. Do NOT pick a different pair without re-running `git ls-tree -r origin/main migrations/ | Select-String "032[0-9]"` and updating EVERY reference in this plan, the migration files, `rlsProtectedTables.ts` `policyMigration`, audit-event metadata, and any test file that quotes the migration number.

**Chunk ordering is forward-only.** No chunk references files created in a later chunk. The order of merge to the integration branch should be: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Chunks 7-9 may proceed in parallel after Chunk 5 ships (different files), but Chunk 10 must run after all three to coordinate the `ConnectionsPage.tsx` mount.

**Per-chunk commit cadence.** One commit per chunk, message format: `feat(operator-session-identity): chunk N — <chunk title>`. No auto-commits or auto-pushes per project preferences; the operator commits after reviewing each chunk's diff.

**Branch level review (after Chunk 10, before Chunk 11):** `feature-coordinator` invokes `spec-conformance` first (spec-driven build), then `pr-reviewer`. If Codex is available, `dual-reviewer` and `adversarial-reviewer` are auto-invoked per the security surface (the diff touches credential broker + RLS + permission gates, which matches the security surface heuristic).

**Doc-sync gate (Chunk 11) is part of branch completion, not a follow-up.** Per CLAUDE.md §11, doc updates land in the same commit as the code that invalidates the doc; Chunk 11 packages the architecture.md + capabilities.md + KNOWLEDGE.md updates into one commit at the end of the build.

**Mockup parity check.** Every UI component delivered in Chunks 7-10 must visually match its mockup (paths in §6 of the spec and in each chunk's "Mockup references" table). For non-verifiable UI polish (§ CLAUDE.md verifiability heuristic), the operator reviews the live UI against the mockup before marking the chunk complete; subagent-driven implementation does not self-verify visual fidelity.

**Stop conditions for the builder:**
- If `npm run typecheck` fails after 3 attempts on the same error class, STOP and escalate per CLAUDE.md "Stuck detection".
- If the migration cross-check (Drizzle vs SQL `REFERENCES`) shows drift after the chunk-1 self-check, STOP — do not proceed to Chunk 2 until both sides agree.
- If the registry constant `OPERATOR_SESSION_DISCLOSURE_VERSION` needs to be > 1 at build time (it shouldn't — V1 lands with version 1), STOP and ask the operator. A version bump should be a deliberate, separate change.
