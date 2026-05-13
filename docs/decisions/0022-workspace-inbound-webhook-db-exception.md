# ADR-0022: Direct DB access in workspaceInboundWebhook route

**Status:** accepted
**Date:** 2026-05-12
**Domain:** auth, routes
**Supersedes:** _(none)_
**Superseded by:** _(none)_

## Context

The `verify-no-db-in-routes` gate enforces that route files delegate all database access to service modules under `server/services/`. `server/routes/workspaceInboundWebhook.ts` is an inbound email webhook that must resolve the recipient `workspace_identities.email_address` before it can route the payload into the workspace email pipeline. The route is intentionally unauthenticated (the provider cannot supply a JWT), so the standard org-scoped DB helper is unavailable at the time of identity resolution.

## Decision

We will allow `server/routes/workspaceInboundWebhook.ts` to retain a direct `db` import for the identity-bootstrap lookup, suppressed via a T1 `guard-ignore` comment referencing this ADR. The lookup uses `withAdminConnection` and is limited to a read against `workspace_identities` by email address. Extraction to a service is tracked separately (see `tasks/todo.md` D19).

## Consequences

- **Positive:** No blocking refactor required before the gate becomes strict; the exception is documented, intentional, and revocable.
- **Negative:** One route retains a direct DB import; this is a deliberate, named exception rather than an oversight.
- **Neutral:** Future migration to a proper service lookup removes this ADR's justification; at that point the guard-ignore comment should be deleted.

## Alternatives considered

- **Extract to `workspaceIdentityService` immediately** — rejected because D19 tracks a broader identity-bootstrap redesign; a partial extraction here would be superseded by that work.
- **Use `getOrgScopedDb`** — rejected because org context is not available at unauthenticated webhook entry; the lookup precedes org resolution.

## When to revisit

When D19 lands (withAdminConnection wrap for the identity-bootstrap lookup is refactored into a service). At that point, delete the guard-ignore comment and close this ADR.

## References

- Spec: `tasks/builds/fleet-and-codebase-health/spec.md`
- Gate script: `scripts/verify-no-db-in-routes.sh`
- Route file: `server/routes/workspaceInboundWebhook.ts`
- Related: `tasks/todo.md` D19
