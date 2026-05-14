# PR Review Log — operator-session-identity (branch-level)

**Branch:** claude/evolve-session-identity-brief-17LO4
**Build slug:** operator-session-identity
**Spec:** docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md
**Plan:** tasks/builds/operator-session-identity/plan.md
**Reviewer:** pr-reviewer (Opus 4.7 1M)
**Review date:** 2026-05-11T12:18:00Z
**Scope:** full branch diff (121 files) — feature-coordinator Step 8.3 branch-level pass

**Verdict:** CHANGES_REQUESTED (0 blocking, 4 strong, 4 non-blocking)

> Update on re-read: see Blocking review below — after walking the call sites the only candidate is demoted from BLOCKING to STRONG. Branch is functionally correct under V1 posture; the issues that remain are durability / future-safety improvements, not pre-merge gates. If the four Strong items are accepted as V1 deferrals (matching the existing deferred-items posture in `tasks/todo.md` § operator-session-identity), the verdict is APPROVED.

## Files reviewed (high-signal subset)

Schema / migrations:
- migrations/0321_operator_session_consents.sql (+down)
- migrations/0322_operator_session_columns.sql (+down)
- server/db/schema/operatorSessionConsents.ts
- server/db/schema/operatorSessionConsentEvents.ts
- server/db/schema/integrationConnections.ts (delta)
- server/config/rlsProtectedTables.ts (2 new entries)

Services:
- server/services/operatorSessionService.ts
- server/services/operatorSessionServicePure.ts
- server/services/operatorSessionConsentService.ts
- server/services/operatorSessionConsentServicePure.ts
- server/services/operatorSessionLifecycleService.ts
- server/services/operatorSessionLifecycleServicePure.ts
- server/services/credentialBrokerService.ts
- server/services/credentialBrokerServicePure.ts
- server/services/connectionsService.ts

Routes / jobs / config:
- server/routes/operatorSessionConnections.ts
- server/routes/integrationConnections.ts (delta)
- server/jobs/operatorSessionRefreshJob.ts
- server/schemas/operatorSessionConnections.ts
- server/config/operatorSessionProviders.ts
- server/lib/permissions.ts (5 new keys)
- scripts/verify-operator-session-token-redaction.sh
- scripts/verify-operator-session-consent-immutable.sh
- scripts/.token-read-allowlist.txt

Client:
- client/src/pages/govern/ConnectionsPage.tsx
- client/src/pages/govern/components/* (11 files)
- client/src/pages/IntegrationsAndCredentialsPage.tsx (redirect)
- client/src/pages/SubaccountAgentEditPage.tsx
- client/src/pages/build/AgentEditPage.tsx
- shared/types/govern.ts

Tests:
- server/services/__tests__/operatorSessionConsentServicePure.test.ts
- server/services/__tests__/operatorSessionLifecycleServicePure.test.ts
- server/services/__tests__/credentialBrokerServicePure.test.ts
- server/services/__tests__/credentialBrokerService.test.ts
- server/config/__tests__/operatorSessionProviders.test.ts

## Blocking Issues

None.

Items considered for this tier and demoted to Strong:

1. The `connect()` happy path stores `mockToken.access` / `mockToken.refresh` as plain strings (server/services/operatorSessionService.ts:287-289). Path is currently unreachable (501 gate at line 204 + 500 defence-in-depth at line 246). Residual risk is future foot-gun when registry flips. → S1.
2. `operatorSessionService.reaccept` UPDATE at 424-427 omits explicit `organisationId` predicate. RLS enforces isolation via GUC under `getOrgScopedDb`; preceding SELECT pins org + subaccount + authType. Per DEVELOPMENT_GUIDELINES §1 still required as defence-in-depth. → S2.
3. Two `AiSubscriptionConnection` type declarations coexist (shared/types/govern.ts:194 and server/services/operatorSessionService.ts:38). Type-level duplication. → S3.

## Strong Recommendations

### S1 — Defence-in-depth token encryption on the unreachable `connect()` happy path

**Where:** server/services/operatorSessionService.ts:225-303

The `connect()` mock branch stores `mockToken.access` / `mockToken.refresh` as plain strings. Two guards above it (501 registry gate at line 204; "token_encryption_required" 500 at line 246) make the INSERT unreachable in V1, but the unencrypted-INSERT line outlives both — when the registry flips, a future operator must remember to (a) remove the line-246 guard and (b) wire encryption around the values in the same change. Inverting the order — `accessToken: connectionTokenService.encryptToken(mockToken.access)` even in the mock — makes the encryption contract self-executing the moment the registry flips. Cost: one helper call on a path that already throws before reaching it. Benefit: removes a foot-gun for the OpenClaw adapter activation.

### S2 — Add explicit `organisationId` filter to the `reaccept` connection-pointer UPDATE

**Where:** server/services/operatorSessionService.ts:424-427

```ts
await db
  .update(integrationConnections)
  .set({ consentRecordId: newConsent.id, updatedAt: new Date() })
  .where(eq(integrationConnections.id, input.connectionId));
```

Currently relies on `getOrgScopedDb()` + RLS for tenant isolation. DEVELOPMENT_GUIDELINES §1 ("Always filter by `organisationId` in application code, even with RLS. Reads and writes by ID must include an explicit `eq(items.organisationId, organisationId)`") asks for the explicit filter as defence-in-depth. Tighten to:

```ts
.where(and(
  eq(integrationConnections.id, input.connectionId),
  eq(integrationConnections.organisationId, input.organisationId),
  eq(integrationConnections.authType, 'operator_session'),
))
```

Same posture as the pinned SELECT immediately above this UPDATE. `detectAndTransitionStaleDisclosure` (line 604) has the same pattern — it SELECTs by id only, no org filter. Apply the fix in both places.

### S3 — Consolidate the `AiSubscriptionConnection` type to a single source of truth

**Where:** server/services/operatorSessionService.ts:38-59 (and shared/types/govern.ts:194)

Two structurally identical declarations: one in the service file, one in `shared/types/govern.ts`. `connectionsService.ts` already imports from the shared module; the service file declares its own. This is the exact drift pattern §3 schema-layer rules and §8.8 cross-spec consistency call out. Fix: delete the service-local interface and `import type { AiSubscriptionConnection } from '../../shared/types/govern.js'`. One-line change, prevents silent shape divergence between the service contract and the client contract.

### S4 — Coalesce the N+1 stale-disclosure pass in the list endpoints

**Where:** server/services/operatorSessionService.ts:458-576 (`listAllowedSubscriptionsForAgent`, `listForSubaccount`)

Each list call runs: (a) full SELECT of matching connections, (b) per-row `detectAndTransitionStaleDisclosure` which itself does 1-3 SELECTs and an optional UPDATE, (c) a second full SELECT of the same WHERE clause to re-read after possible transitions. For N rows this is `2 + ~3N` queries.

Two ways to flatten:
- Compute the version mismatch in SQL (`disclosure_version < OPERATOR_SESSION_DISCLOSURE_VERSION`) as part of a `LEFT JOIN operator_session_consents`, batch-UPDATE the stale rows in one statement, then return the first SELECT result directly with the new state values projected (no re-read).
- Or, since `OPERATOR_SESSION_DISCLOSURE_VERSION` is a module constant, embed it in the first SELECT projection and mutate the response in memory while issuing a single batch UPDATE for the affected ids.

Either approach drops the second SELECT, replaces per-row UPDATEs with a single UPDATE, and removes the sequential `await` inside the `for` loop. Not a correctness issue at V1 scale (5-10 rows per subaccount) but it's load-bearing the moment the registry flips and subscriptions become real.

## Non-Blocking Improvements

### N1 — `<button>` elements missing `type="button"` across the new Govern modals

**Where:** client/src/pages/govern/components/*.tsx (~36 occurrences)

Per `DEVELOPMENT_GUIDELINES.md` §8.25: every `<button>` that does not intentionally submit a form must declare `type="button"`. The form-bearing modals (AddWebLoginModal, EditWebLoginModal) get this right. The remaining buttons sit inside `<Modal>` wrappers with no `<form>` ancestor, so the silent-submit risk is theoretical, but §8.25 is a class-level rule and a future refactor that introduces a form inside any of these modals would silently regress. Single-line fix per button.

### N2 — Tab buttons in ConnectionsPage.tsx

**Where:** client/src/pages/govern/ConnectionsPage.tsx:67-77

Same class as N1. PageShell does not render a `<form>`, so functionally fine; per §8.25 still wants `type="button"`.

### N3 — `detectAndTransitionStaleDisclosure` lookup not pinned to org + authType

**Where:** server/services/operatorSessionService.ts:603-605

Already covered by RLS via `getOrgScopedDb`, but for parity with the rest of the service file the SELECT should also pin `authType = 'operator_session'`. Without it, a logic regression that pointed a non-operator-session connection's id at this method would still execute the lifecycle transition (which would fail validly on the `from = 'connected_usable'` predicate, but the failure mode is murky). Tightening the WHERE clause is two extra `eq()` calls and makes the contract self-describing.

### N4 — Down-migration ordering documented but not enforced

**Where:** migrations/0322_operator_session_columns.down.sql:3, migrations/0321_operator_session_consents.down.sql:7

Both down files carry "run me before/after X" comments. Drizzle's runner orders down migrations by descending number, so 0322.down runs first as expected. The comments are correct but rely on convention.

## Things checked that look good

- Migration 0321: FORCE RLS + canonical three-guard org-isolation policy on both new tables. Drizzle schema present. Manifest entries updated with correct `policyMigration` pointers.
- Migration 0322: append-only column additions; partial unique index correctly scoped; auth_type CHECK added idempotently.
- `integration_connections` has no `deleted_at` column — no soft-delete filter required.
- Route file: every handler runs `authenticate` → `requireSubaccountPermission` → `resolveSubaccount` → handler. All 10 routes covered. `asyncHandler` wraps every async handler.
- `make-default` uses `FOR UPDATE` + partial unique index + 23505→409 mapping.
- `operatorSessionLifecycleService.transition` uses the §8.18 concurrency-guard predicate; 0-row update treated as idempotent.
- `operatorSessionConsentService.backfillConnectionId` enforces single-shot semantics via `WHERE connection_id IS NULL`.
- `OperatorSessionEnvelope` keeps `accessToken` / `refreshToken` out of the broker return type; `assertCredentialUsableOrThrow` gate runs before decryption.
- `scripts/verify-operator-session-consent-immutable.sh` correctly scoped to allow `operatorSessionConsentService.ts` only.
- `scripts/verify-operator-session-token-redaction.sh` is a baseline-snapshot gate matching §17.9.
- Token refresh job follows the admin-read + per-tenant `withOrgTx` pattern. Post-terminal gate at line 98. Singleton key on `${connectionId}:${refreshBucketEpochSec}`.
- `connectionsService.ts` gates the `ai_subscription` rows on `OPERATOR_SESSION_VIEW`, preserving the B4 fix.
- Pure helpers carry Vitest coverage including the `assertCredentialUsableOrThrow` hook-count contract and `orderResolvedCredentials` determinism — matches §8.21.
- Five new permission keys land in `subaccount.operator_session.*` namespace, wired through `SUBACCOUNT_PERMISSIONS` and the role-permission seed list.
- Frontend: ConnectionsPage uses `lazy()` + Suspense. `IntegrationsAndCredentialsPage.tsx` is now a redirect-only shim. `SubaccountIntegrationsRoute` preserves the workspace context via `?workspace=<uuid>`.
- ModelAccessSection mounted on `SubaccountAgentEditPage`. `AgentEditPage.tsx` shows the workspace-pointer explainer.

## Cross-reference to existing deferred items

`tasks/todo.md` § operator-session-identity already records 4 deferred V1 items (chunk 8 REQ #5a/#5b, chunk 8/9 shared DisconnectConfirmDialog gating, chunk 9 REQ #4 / #7, chunk 10 REQ #13). None of the Strong recommendations above overlap with that list — they are net-new branch-level observations.
