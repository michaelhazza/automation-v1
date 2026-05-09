# ADR-0008: SSE auth via short-lived signed stream-token

**Status:** accepted
**Date:** 2026-05-09
**Domain:** auth

## Context

The Agent Workspace build (slug `agent-workspace`, branch `claude/add-agent-cloud-compute-Kb4ii`) introduces two SSE routes for live presence streaming: `GET /api/agent-presence/stream/:agentId` and `GET /api/agent-presence/stream/workspace/:subaccountId`. The codebase's standard `authenticate` middleware requires `Authorization: Bearer <jwt>` and reads the JWT from `localStorage` on the client. The browser's native `EventSource` API cannot set custom headers, so this scheme is fundamentally incompatible with a browser-initiated SSE handshake. Without a fix, every SSE connection from the browser receives 401, the Home presence widget never connects, and `useWorkspacePresence` infinite-reconnects.

This was caught by `pr-reviewer` round 0 (`tasks/review-logs/pr-review-log-agent-workspace-2026-05-08T22-41-57Z.md` finding B3) and required an architectural decision before the fix-loop could land.

## Decision

We will issue **short-lived signed stream-tokens** for SSE handshakes, distinct from the long-lived auth JWT.

**Implementation:**
- New endpoint `POST /api/agent-presence/stream-token` (in `server/routes/agentPresenceStream.ts`) accepts `{ scope: 'agent' | 'workspace', agentId?, subaccountId? }`, verifies that the caller has access to the requested scope (agent ownership / subaccount membership) using the long-lived JWT in the `Authorization` header, then issues a stream-token via `signStreamToken({ userId, orgId, scope }, ttlSeconds = 120)`.
- Stream-tokens are JWTs signed with `JWT_SECRET`, **audience-bound** to `agent-presence-stream` (so they cannot be used as auth tokens elsewhere), with a 120-second TTL.
- New middleware `authenticateStreamToken` (in `server/middleware/authenticateStreamToken.ts`) verifies `req.query.token`, populates `req.user` / `req.orgId` / `req.streamTokenScope`, and **strips the token from `req.url`** before any downstream logger sees it. Both SSE GET routes use this middleware (not the standard `authenticate`).
- Each GET route additionally enforces **scope-kind matching** between the token claim and the URL path: an agent-scope token cannot be used on the workspace SSE route and vice versa, and an agent-scope token bound to agent A cannot be used on `/stream/B`.
- Client side (`client/src/lib/agentPresenceStream.ts`): the browser fetches a stream-token via the new endpoint using its long-lived JWT, holds the stream-token **in memory only** (closure scope; never `localStorage`), and passes it as `?token=<stream-token>` on the SSE GET URL. On `EventSource` error or token expiry, the client refreshes the stream-token and reconnects.

## Consequences

- **Positive:**
  - The browser's `EventSource` works without polyfills or auth-scheme changes elsewhere in the codebase.
  - Stream-tokens have a tight blast radius: 120s TTL, audience-bound, narrow new surface.
  - Token rotates on each connect — leaked URLs in screenshots, share-sheets, or referrer headers become useless within 2 minutes.
  - Stripping the token from `req.url` before logging means access logs do not retain the credential.
  - Scope-kind enforcement at the route layer prevents token confusion attacks (workspace-scope token used on agent route, etc.).
- **Negative:**
  - Adds two new auth artefacts to maintain (`signStreamToken`, `authenticateStreamToken`).
  - Permission revocation has up to 120s lag on existing SSE connections (the token is bound to the permissions captured at issuance; live revocation requires either re-fetching permissions inside `authenticateStreamToken` or accepting the lag). Documented as a known trade-off.
  - Client must round-trip the long-lived JWT once per stream open (and on reconnect) to fetch the stream-token. Negligible cost for the SSE use case.
- **Neutral:**
  - The pattern is reusable for future SSE / WebSocket / long-poll surfaces that face the same `EventSource` constraint.

## Alternatives considered

- **HttpOnly auth cookie alongside JWT.** Rejected. Wider blast radius: changes the auth surface for every authenticated request, requires CSRF mitigation, requires cookie-domain configuration for cross-environment work, and would have forced every existing route to accept either header-or-cookie authentication for compatibility.
- **`@microsoft/fetch-event-source` polyfill on the client.** Rejected. Loses native browser SSE ergonomics (auto-reconnect handled in the runtime, native back-pressure, browser dev-tools support), adds a new client dependency, and shifts complexity to the consumer rather than centralising it server-side.
- **Long-lived JWT passed as `?token=<jwt>` query param** (the original `authenticateSSE` middleware in `server/middleware/auth.ts`). Rejected and the dead export removed in commit `58739da5`. Risks: long-lived credentials in URLs leak into access logs, browser histories, referrer headers, and shoulder-surfing screenshots. Even with log stripping, the credential lifetime (typically hours-to-days) is too long for a query-param surface.

## When to revisit

- When permission revocation latency on live SSE connections needs to be sub-second (the 120s TTL becomes the binding constraint). Either narrow the TTL further or add a live re-check inside `authenticateStreamToken`.
- When the SSE topology moves to multi-node fan-out (currently single-node per spec §13.1.1; deferred to spec §18). A multi-node broker may require a different token-binding model (e.g. binding to a specific publisher node).
- When a second SSE / streaming surface adopts this pattern and the duplication becomes expensive — promote `signStreamToken` / `authenticateStreamToken` to a generic streaming-auth primitive.

## References

- Spec: `tasks/builds/agent-workspace/spec.md` § 1027–1028 (cross-org leak guard, SSE auth)
- Plan: `tasks/builds/agent-workspace/plan.md` Rev 4 (Chunk 9; B3 fix-loop)
- Round 0 pr-review: `tasks/review-logs/pr-review-log-agent-workspace-2026-05-08T22-41-57Z.md` (finding B3)
- Round 1 pr-review: `tasks/review-logs/pr-review-log-agent-workspace-2026-05-09T00-23-16Z.md` (B-NEW-3 / B-NEW-4 doc-sync)
- Round 2 pr-review: `tasks/review-logs/pr-review-log-agent-workspace-2026-05-09T01-09-02Z.md` (S4 dead `authenticateSSE` export removed)
- Dual-reviewer log: `tasks/review-logs/dual-review-log-agent-workspace-2026-05-09T01-29-34Z.md` (scope-kind enforcement bug closed)
- Architecture: `architecture.md § Agent Workspace § Presence stream topology`
