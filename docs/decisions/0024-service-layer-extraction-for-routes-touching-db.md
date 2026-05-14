# ADR-0024: Service-layer extraction for routes touching `db/schema/`

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-05-14 |
| Deciders | Operator (michaelhazza), Claude Code (main session) |
| Supersedes | — |

## Context

Routes occasionally need a row type from `server/db/schema/*.ts` for request/response shapes. The convention has been to import the schema module directly. The 2026-05-14 pre-v1-lockdown audit found that `server/routes/supportAgentRoutes.ts` had used this pattern as a pretext to also issue queries against the `canonicalInboxes` table from inside a route handler, a Route to DB layer breach. The `verify-no-db-in-routes.sh` baseline had the file pinned, which made the breach invisible to gate runs for an unknown duration.

The cause is the dual purpose of a `db/schema/*.ts` import. The import can mean "give me the type for my response shape" OR "give me the table object to build a query." Routes legitimately want the first; they MUST NOT want the second.

## Decision

1. **Routes that need a row type from a schema module MUST import via `shared/types/`**, not from `server/db/schema/*.ts`. If the type does not exist in `shared/types/`, the PR adds it there in the same commit.
2. **Routes that need to run a query MUST go through a service** in `server/services/`. No exceptions, including for "just a tiny SELECT". The existing `verify-no-db-in-routes.sh` gate enforces this.
3. **Tightening the existing gate (P2 of the audit-prevention-gates build):** the gate now skips `import type` lines (so legitimate type imports don't trip), AND refuses new baseline entries unless the commit body references an ADR. New layer breaches require deliberate sign-off; they cannot accumulate silently.

## Consequences

**Positive.**

- The "type import" path and the "query import" path are no longer the same statement. A route that needs a type imports from `shared/types/` and cannot accidentally also query.
- New baselines require ADR justification, so the failure mode that produced the `supportAgentRoutes.ts` finding (a baseline grew silently) is replaced by a deliberate sign-off.

**Negative.**

- `shared/types/` may grow as types that previously lived only in schema modules get extracted. The cost is small per type, but cumulative. Mitigation: type extraction is mechanical; do it as part of the PR that needs the type, not as a one-shot cleanup.
- Some routes will need a service wrapper for what is currently a one-line query. This is the intended pressure, services own ORM access. If a service file does not exist, create it. The `architecture.md` § "When to create a new service file" guidance applies.

## Alternatives considered

- **Allow `db/schema/*.ts` type imports in routes via a typed re-export.** Rejected: still creates the dual-purpose import statement; the gate would have to distinguish "imported the schema module for the type only" from "imported it for the table object", which is fragile.
- **Drop the gate entirely and rely on reviewer discipline.** Rejected: the `supportAgentRoutes.ts` finding is the proof that this fails. The gate exists because the discipline does not, at scale.

## Related

- Audit: `tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`
- Spec: `tasks/builds/audit-prevention-gates-2026-05-14/spec.md`
- Gate: `scripts/verify-no-db-in-routes.sh`
- KNOWLEDGE pattern: § "Gate baselines must expire, not just exist" (2026-05-14)
