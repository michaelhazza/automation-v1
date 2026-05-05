# Security Audit Event Namespace Convention

**Source of truth:** `shared/types/securityAuditEvents.ts` — the `auditEvent` factory const-object.

## The four namespaces

| Namespace | Purpose | Examples |
|-----------|---------|---------|
| `auth` | Authentication and authorisation events | `loginFailed`, `loginSucceeded`, `permissionDenied`, `tokenRevoked`, `crossOrgAccess` |
| `oauth` | OAuth lifecycle events (state management, enrolment) | `stateIssued`, `stateConsumed`, `stateExpired`, `enrolCompleted`, `enrolFailed` |
| `security` | Security boundary violations and abuse signals | `crossTenantAttempt`, `missingPrincipalContext`, `rateLimitTrip` |
| `audit` | Reserved for future audit-control events | (empty in Phase 3) |

## The factory IS the union rule

`SecurityAuditEventName` is derived from the factory via `typeof`:

```typescript
export type SecurityAuditEventName = EventNames; // inferred from auditEvent const-object
```

Adding a new event requires adding it to the factory — there is no separate string registry. The DB stores the string value from the factory entry verbatim (e.g. `'auth.login.failure'`).

## How to use

Always obtain event names via member access on the `auditEvent` factory:

```typescript
import { auditEvent } from '../../shared/types/securityAuditEvents.js';

void recordSecurityEvent({
  event:          auditEvent.auth.loginFailed,
  organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
  ip:             req.ip ?? null,
});
```

## Cast-bypass is a blocking finding

Using `as SecurityAuditEventName` to cast a raw string literal to the event-name type bypasses the factory-enforced closed set. Any PR containing this pattern is a blocking finding — no exceptions. The grep gate `scripts/verify-audit-event-namespace.sh` (Chunk B.4) enforces this at CI time.

## Severity is declared at the factory, not at the call site

For `auditEvent.security.*` events, severity is bound in the factory entry and MUST NOT be overridden by callers:

```typescript
security: {
  crossTenantAttempt: { name: 'security.cross_tenant_attempt', severity: 'security_boundary' },
  // ...
}
```

`recordSecurityEvent` reads severity from the factory entry and writes it into `meta.severity` in the DB row. Call sites cannot supply a different severity — the parameter does not exist on `SecurityEventInputV2`.

## Adding a new event

1. Add the entry to the relevant namespace in `shared/types/securityAuditEvents.ts`.
2. For `security.*` events, declare a severity value from `SecurityEventSeverity`.
3. Update this doc if the namespace or convention changes.
4. For `audit.*` events, this file requires a spec amendment.
