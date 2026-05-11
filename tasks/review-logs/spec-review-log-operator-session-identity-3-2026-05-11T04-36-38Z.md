# Spec Review — Iteration 3 — operator-session-identity

**Spec:** `docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md`
**Iteration:** 3 of 5
**Codex output:** `tasks/review-logs/_codex_operator-session-identity_iter3_2026-05-11T04-36-38Z.txt`
**Spec commit at iteration start:** 0b2b24f5

---

## Codex findings (10 total — all mechanical)

### 3.1 — V1 connect-state contradiction (critical)
- **Sections:** §7.4 vs §11.1, §17.5
- **Issue:** §7.4 says V1 self_declaration → every connect lands in `connected_unverified` + requires disclosure; §11.1 still framed disclosure as Plus-only and produced `connected_usable`.
- **Fix:** Rewrote §11.1 with an explicit disclosure-requirement gate driven by §7.4's per-detection-mechanism rule. V1 now uniformly produces `connected_unverified` + requires disclosureAcceptance. Updated §17.5 acceptance criteria to cover both V1 (self_declaration) and post-flip (introspection_api) outcomes.

### 3.2 — Consent UNIQUE constraint conflicts with multi-connection (critical)
- **Sections:** §7.2 DDL, §16.1, §16.6
- **Issue:** `UNIQUE (org, sub, user, disclosure_version)` blocked the same user connecting a second subscription at the same disclosure version.
- **Fix:** Changed the unique key to `UNIQUE (connection_id, disclosure_version)`. Postgres treats NULL connection_id values as distinct, so concurrent inserts during connect proceed; each consent row ends up with its own back-filled connection_id. Updated §16.1, §16.3, §16.6, §17.1, §8.1, Chunk 1 to reflect.

### 3.3 — Disclosure-supersession state machine contradiction (important)
- **Sections:** §7.5 vs §11.4 / §17.5
- **Issue:** §7.5 said disclosure supersession → `disabled`; §11.4 / §17.5 said → `connected_needs_consent`.
- **Fix:** Updated §7.5 to make `disabled` an admin/offboarding/permission cause only; cleaned `disabledReason` enum to drop `disclosure_superseded`.

### 3.4 — Router registration path wrong (important)
- **Sections:** §8.9, Chunk 5
- **Issue:** Spec said register in `server/routes/index.ts`; that file doesn't exist. Repo mounts routers in `server/index.ts`.
- **Fix:** Updated §8.9 + Chunk 5 to name `server/index.ts` as the mount surface.

### 3.5 — Web Login service name wrong (important)
- **Sections:** §8.8, Chunk 9
- **Issue:** Spec said reuse `webLoginConnections.ts` service layer; that's the route file. The service is `server/services/webLoginConnectionService.ts`.
- **Fix:** Corrected the service path in §8.8 + Chunk 9.

### 3.6 — Two list producers, no source-of-truth (important)
- **Sections:** §9.2 vs §10.5 vs §8.9
- **Issue:** `operatorSessionConnections.ts` and unified `listConnections` both listed as the AI Subscription producer; no winner declared.
- **Fix:** Updated §9.2 to declare `connectionsService.listConnections` (the unified Govern surface) as the canonical list producer; the operator-session router handles get-by-id and all mutations.

### 3.7 — `getAgentAllowedSubscriptions` missing server producer (important)
- **Sections:** Chunk 10, §8, §10.4
- **Issue:** Client added a `governApi.getAgentAllowedSubscriptions(...)` call with no corresponding server route/service.
- **Fix:** Added `GET /api/subaccounts/:id/agents/:agentId/allowed-subscriptions` to §10.4 + Chunk 10 deliverables (new service method `operatorSessionService.listAllowedSubscriptionsForAgent`, thin wrapper around `credentialBrokerService.resolveAvailableCredentials`).

### 3.8 — §15 "pure functions only" but lists non-pure tests (important)
- **Sections:** §15, §17.2
- **Issue:** §15 says runtime tests are pure-function only but lists service-level tests on `credentialBrokerService.test.ts` and `operatorSessionConsentService.test.ts`.
- **Fix:** Restructured §15 to require all runtime tests target pure functions in `*Pure.ts` modules. Added `credentialBrokerServicePure.ts` and `operatorSessionConsentServicePure.ts` to §8.5 inventory. Updated §17.2 to test the pure helper `assertCredentialUsableOrThrow`. Added §17.5b for failover ordering tests against `orderResolvedCredentials`. Updated Chunk 4 to introduce the new pure helper file.

### 3.9 — §8.3 "5 new columns" disagreement (minor)
- **Sections:** §8.3 vs §7.1 / §8.1 / Chunk 1
- **Issue:** Schema-file entry said 5; everything else now says 6.
- **Fix:** Updated to 6 with column names.

### 3.10 — §17.1 attributes new tables to wrong migration (minor)
- **Sections:** §17.1 vs §7.2 / §8.1
- **Issue:** §17.1 said migration 0319 contains the new tables; actually 0318 does (post-swap).
- **Fix:** Rewrote §17.1 with the correct attributions and migration descriptions.

---

## Iteration 3 Summary

- Mechanical findings accepted:  10
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   e29d8377
