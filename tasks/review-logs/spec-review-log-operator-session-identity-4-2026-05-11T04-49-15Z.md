# Spec Review — Iteration 4 — operator-session-identity

**Spec:** `docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md`
**Iteration:** 4 of 5
**Codex output:** `tasks/review-logs/_codex_operator-session-identity_iter4_2026-05-11T04-49-15Z.txt`
**Spec commit at iteration start:** e29d8377

---

## Codex findings (8 total — all mechanical)

### 4.1 — `operator_session.view` permission ambiguity (critical)
- **Sections:** §10.1 / §10.4 / §10.5 / §9.2
- **Issue:** Dedicated `operator_session.view` permission exists for the dedicated route, but the canonical list endpoint uses generic `connections.view` — either leaks metadata or makes the dedicated permission dead.
- **Fix:** Added a per-row permission bridge to `connectionsService.listConnections`: operator_session rows are filtered out when the principal lacks `operator_session.view`. Updated §10.5 with the bridge mechanism + §8.9 with the service-modification description.

### 4.2 — V1 connect simultaneously success and 501 (important)
- **Sections:** §7.4 / §11.1 / §17.5 / §18
- **Issue:** §7.4 said "EVERY V1 connect" produces a connected_unverified row, but the registry has `connectionMechanism: 'none_verified'` so connect actually 501s.
- **Fix:** Restructured §7.4 and §11.1 as two independent flag flips (mechanism verified, detection introspection). Documented the three regimes: pre-verification 501, post-verification self_declared, post-introspection verified. Updated §17.5 to include a pre-verification 501 test.

### 4.3 — Re-acceptance flow missing `granted` event (important)
- **Sections:** §11.1 re-acceptance / §9.6
- **Issue:** Re-acceptance writes a new consent row + a `superseded` event but no `granted` event — the §9.6 "latest event wins" SOT cannot evaluate the new consent.
- **Fix:** Expanded the re-acceptance block in §11.1 to a 5-step transactional sequence including the new consent's `granted` event.

### 4.4 — Chunk 2 vs §8 inconsistency on consent pure logic (important)
- **Section:** Chunk 2 vs §8.5
- **Issue:** §8 says Pure logic lives in `operatorSessionConsentServicePure.ts`; Chunk 2 said the pure validation goes in `operatorSessionConsentService.ts`.
- **Fix:** Updated Chunk 2 deliverables to name the Pure file. Also added explicit `credentialBrokerServicePure.ts` to Chunk 2.

### 4.5 — Retention guarantee without backing mechanism (important)
- **Sections:** §7.2 / §8
- **Issue:** Spec asserts org-deletion exclusion, PII minimisation, compliance-role access — all without naming the code path.
- **Fix:** Expanded §7.2 with explicit V1 enforcement mechanism (FK `ON DELETE RESTRICT` is the hard stop) and explicit stubs / deferrals for the missing parts. Added three Deferred items: PII minimisation hashing job, org-level deletion compliance flow, transfer-ownership flow.

### 4.6 — "Transfer ownership" referenced without verdict (important)
- **Sections:** §6 vocabulary, §18 Q4, mockup 06
- **Fix:** Added explicit Deferred item for transfer ownership in §13. Updated §18 Q4 to clarify V1 returns 422 `owner_mismatch_transfer_ownership_required` for identity-mismatch attempts (no silent re-attribution).

### 4.7 — Test files missing from §8 inventory (minor)
- **Section:** §8
- **Fix:** Added 4 test file rows to §8.5 with exact paths under `__tests__/`.

### 4.8 — §8.13 `routes.ts` nit (nit)
- **Section:** §8.13
- **Fix:** Clarified the row: routes.ts is informational, not edited; listed so the inventory-lock check confirms it was considered.

---

## Iteration 4 Summary

- Mechanical findings accepted:  8
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   130fd84b
