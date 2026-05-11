# Spec Review — Iteration 5 — operator-session-identity

**Spec:** `docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md`
**Iteration:** 5 of 5 (lifetime cap — final iteration)
**Codex output:** `tasks/review-logs/_codex_operator-session-identity_iter5_2026-05-11T04-57-19Z.txt`
**Spec commit at iteration start:** 130fd84b

---

## Codex findings (9 total — all mechanical)

### 5.1 — §11.1 connect flow contradicts sanctioned-tier path (critical)
- **Issue:** Sanctioned-verified connects don't need disclosure, but the §11.1 canonical sequence hard-codes a `disclosureAcceptance` INSERT path.
- **Fix:** Split §11.1 into Branch A (sanctioned-verified, no consent row) and Branch B (disclosure-required). Both single-transaction; consent INSERT + back-fill UPDATE only happens in Branch B.

### 5.2 — Failover ordering source-of-truth split (important)
- **Issue:** §9.7 said SQL; §8.5/§12/§15 said pure helper.
- **Fix:** Declared `credentialBrokerServicePure.orderResolvedCredentials` as the canonical implementation; SQL `ORDER BY` is an advisory perf optimisation; pure helper wins if they disagree.

### 5.3 — Broker retrieval invariant verification target mismatch (important)
- **Issue:** §9.1 said test on `issueCredential`; §15/§17.2 said test on pure helper.
- **Fix:** Updated §9.1 acceptance-test note to align with the pure-helper testing in §17.2; integration test on `issueCredential` deferred to Phase 2+.

### 5.4 — `usability_state` ownership boundary contradictory (important)
- **Issue:** §7.5/§8.5 said lifecycleService is the only writer, but operatorSessionService also writes initial state.
- **Fix:** Made the boundary explicit: `operatorSessionService.connect` owns INITIAL state on INSERT; `operatorSessionLifecycleService.transition` owns all subsequent transitions. Updated §7.5 and §8.5.

### 5.5 — Allowlist storage shape unpinned (important)
- **Issue:** §9.2 exposes `availabilityScope` + `allowedAgentIds`; §9.7 depends on them; storage lived only in Open Question 2.
- **Fix:** Added §9.4b "Availability scope shape" with concrete JSONB contract under `integration_connections.config_json -> 'operator_session'`. Added §9.6 SOT row. Moved Open Question 2 to RESOLVED.

### 5.6 — `owner: { kind: 'workspace' }` stale framing (important)
- **Issue:** Final framing is user-attributed consent; owner shape returned workspace ownership.
- **Fix:** Replaced `owner: { kind: 'workspace'; ... }` with `user: { userId | null, userIdNullified, displayName | null }`.

### 5.7 — Allowed-subscriptions route/method missing from §8 inventory (important)
- **Issue:** Chunk 10 introduced GET /agents/:agentId/allowed-subscriptions + `listAllowedSubscriptionsForAgent`; §8.8/§8.5 didn't reflect.
- **Fix:** Updated §8.8 description of operatorSessionConnections.ts; updated §8.5 description of operatorSessionService.ts.

### 5.8 — Legacy page deprecation verdict inconsistent (minor)
- **Issue:** Mixed "removed" / "removed or redirect" across §5.2, §5.6, §8.14, Chunk 9, §17.7.
- **Fix:** Single verdict: `CredentialsTab.tsx` REMOVED; `IntegrationsAndCredentialsPage.tsx` CONVERTED to a redirect to `/connections`. Applied across all five references.

### 5.9 — `OPERATOR_SESSION_DISCLOSURE_VERSION` config without owning file (minor)
- **Fix:** Pinned to `server/config/operatorSessionProviders.ts` (same file as the provider capability registry). No new config file introduced; the existing §8.4 entry covers it.

---

## Iteration 5 Summary

- Mechanical findings accepted:  9
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (pending Step 8b commit)

## Loop exit

This was iteration 5 of 5 — the lifetime cap. The loop exits regardless of whether further mechanical findings would have surfaced. Codex did continue producing valid mechanical findings each iteration, so the spec did NOT converge before the cap; the verdict reflects that.

Iterations 1-5 each surfaced 8-14 distinct mechanical findings — every iteration produced material changes. The pattern suggests this spec, while large and complex (2 migrations, 10 chunks, 11 sections including 2 contract sections), would benefit from a human-led conformance pass before build because Codex was still finding real consistency gaps at iteration 5. None of the gaps are directional / scope / posture; all are mechanical.
