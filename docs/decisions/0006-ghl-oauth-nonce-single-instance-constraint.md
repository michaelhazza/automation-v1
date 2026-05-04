# ADR 0006: GHL OAuth CSRF nonce store — single-instance deployment constraint

**Date:** 2026-05-05
**Status:** Accepted
**Deciders:** Michael Hazza

---

## Context

`server/lib/ghlOAuthStateStore.ts` stores the CSRF nonce (OAuth state parameter) for GHL OAuth flows in an in-process `Map`. The OAuth initiation writes the nonce on the instance that handles the `/oauth/ghl/connect` request; the GHL callback must hit the same instance to find and consume the nonce.

Under a multi-instance deployment (horizontal scaling, blue-green, rolling restart) the callback can land on a different instance and `consumeGhlOAuthState` returns `undefined`, failing the flow with `invalid_state`. This is not just a UX failure — it could be exploited as a CSRF amplification if multiple instances run concurrently.

## Decision

Accept the in-process nonce store for now. The deployment is single-instance. This constraint is explicitly documented here so that any future scaling work is blocked on migrating to a Redis or DB-backed nonce store first.

## Consequences

- The OAuth connect flow works correctly and is CSRF-safe in the current deployment.
- **Before adding a second instance or enabling blue-green deploys:** replace `ghlOAuthStateStore` with a Redis `SET nx px` or a `oauth_states` DB table with a TTL column. The store interface (`storeGhlOAuthState` / `consumeGhlOAuthState`) is the only surface to swap.
- Any infra change that adds horizontal scale (Replit Autoscale, container orchestration, load balancer without sticky sessions) must treat this ADR as a blocker.
