# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md`
**Spec commit at start:** untracked (created in this branch)
**Spec commit at finish:** f056b524
**Spec-context commit:** 267433f2 (last_reviewed_at 2026-05-10; 1 day old; GREEN under staleness gate)
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap
**Verdict:** NEEDS_REVISION (5 iterations, 54 mechanical fixes applied, lifetime cap hit before Codex converged)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 12 | 1 | 13 | 0 | 0 | 0 | 0 |
| 2 | 14 | 0 | 14 | 0 | 0 | 0 | 0 |
| 3 | 10 | 0 | 10 | 0 | 0 | 0 | 0 |
| 4 | 8 | 0 | 8 | 0 | 0 | 0 | 0 |
| 5 | 9 | 0 | 9 | 0 | 0 | 0 | 0 |
| **Total** | **53** | **1** | **54** | **0** | **0** | **0** | **0** |

Every finding across all five iterations was mechanical. Every finding was accepted and applied.

---

## Mechanical changes applied

Grouped by spec section. Each item shipped in one of the five iteration commits; see `tasks/review-logs/spec-review-log-operator-session-identity-<N>-*.md` for the per-finding mapping.

### Framing (§1 — §6)
- Goal 4 rewritten to drop "blocked-behind-provider flag" stale language → "returns 501 provider_mechanism_not_verified"
- Goal 2 column count corrected from 5 to 6 (is_default added)
- §5.2 / §5.6 / §8.14 / Chunk 9 / §17.7 unified on a single deprecation verdict (CredentialsTab REMOVED, IntegrationsAndCredentialsPage REDIRECT)

### Schema (§7)
- Migration order swapped: 0318 now creates consent tables first; 0319 alters integration_connections with FK to the table created in 0318
- Migration paths corrected from `server/db/migrations/` (non-existent) to `migrations/` (actual repo location)
- `is_default` column added to migration 0319 + Drizzle schema; partial unique index `ic_subaccount_operator_session_default_unique` added; closes §18 Q1
- `operator_session_consents` DDL FKs reconciled with retention prose (`user_id` / `subaccount_id` → SET NULL + nullable; `organisation_id` stays RESTRICT due to RLS)
- `operator_session_consents` UNIQUE constraint changed from `(org, sub, user, disclosure_version)` to `(connection_id, disclosure_version)` to support multi-connection per user per disclosure version
- §7.4 expanded with per-detection-mechanism outcome table and two-flag-flip regime (pre-verification 501 / post-verification self_declared / post-introspection verified)
- §7.5 cleaned: `disabled` semantics no longer include "disclosure_superseded" (state machine uses `connected_needs_consent`)
- §7.5 added explicit write-ownership rule: `operatorSessionService.connect` owns INITIAL state; `operatorSessionLifecycleService.transition` owns transitions
- §7.2 retention enforcement mechanism documented (FK constraints as hard stop; PII hashing / org-deletion / compliance-view deferred with explicit stubs)

### File inventory (§8)
- All migration paths corrected
- `webLoginConnectionsGovern.ts` added (was a Chunk-9 OR clause)
- `credentialBrokerServicePure.ts` and `operatorSessionConsentServicePure.ts` added
- Four test files added with concrete paths under `__tests__/`
- `server/index.ts` named as router mount (no `server/routes/index.ts` exists)
- `webLoginConnectionService.ts` correctly named (service, not route)
- Allowed-subscriptions route + service method reflected in §8.5/§8.8
- `DisclosurePlusStep.tsx` removed (folded into modal as internal step component)

### Contracts (§9)
- §9.1 acceptance test note aligned with pure-helper testing
- §9.2 producer-of-record clarified (canonical list via connectionsService.listConnections; mutations via dedicated router)
- §9.2 owner shape replaced with user-bound shape (`user: { userId, userIdNullified, displayName }`)
- §9.2 disabledReason / pendingReason split aligned with §7.5 state machine
- §9.4 typo fix `supersedConsent` → `supersedeConsent`
- §9.4b NEW — Availability scope shape (config_json JSONB contract)
- §9.6 expanded with: connection's current consent SOT (forward pointer wins); failover order SOT (broker); allowlist SOT (config_json)
- §9.7 NEW — Failover ordering contract (pure helper canonical; SQL advisory)

### Permissions / RLS (§10)
- §10.4 PATCH route split: generic PATCH limited to label/display-name; availability stays on `/allow-agent-use`
- §10.4 added `GET /agents/:agentId/allowed-subscriptions` route
- §10.5 added permission bridge (operator_session.view filter inside connectionsService)

### Execution model (§11)
- §11.1 rewritten as two-branch flow (Branch A sanctioned-verified, Branch B disclosure-required)
- §11.1 documents single-transaction integrity for both branches
- §11.1 documents one-time `connection_id` back-fill exception with service-layer enforcement (Branch B only)
- §11.1 re-acceptance flow rewritten as 5-step transaction (consent INSERT + `granted` event + `superseded` event + `consent_record_id` update + state transition)
- §11.1 owner-mismatch behaviour documented (422 `owner_mismatch_transfer_ownership_required`)
- §11.2 refresh-job dedup unified on pg-boss singletonKey (no DB constraint, no column-name drift)
- §11.3 consent recording aligned with the transactional flow in §11.1
- §11.4 committed to on-read detection; `OPERATOR_SESSION_DISCLOSURE_VERSION` pinned to `operatorSessionProviders.ts`

### Chunks (§12)
- Chunk 1 deliverables aligned with the migration order swap
- Chunk 2 deliverables now name the three Pure files (lifecycle / consent / broker)
- Chunk 4 deliverables call out the pure-helper extraction explicitly
- Chunk 5 mount target corrected to `server/index.ts`
- Chunk 9 service path corrected to `webLoginConnectionService.ts`; single verdict on legacy-page redirect
- Chunk 10 deliverables include the new allowed-subscriptions route + service method

### Deferred items (§13)
- Added: PII minimisation hashing job, Org-level deletion compliance flow, Transfer ownership flow
- §18b ("Resolved during spec-review") section added; Default storage + Disclosure-bump method moved there

### Testing posture (§15)
- All runtime tests now target pure functions in `*Pure.ts` files
- Test inventory in §15 calls out the pure-extraction for broker + consent service

### Execution-safety (§16)
- §16.1 idempotency rules rewritten to reflect the (connection_id, disclosure_version) UNIQUE constraint
- §16.3 Make Default rewritten with valid Postgres `SELECT ... FOR UPDATE` lock + two-UPDATE pattern
- §16.4 terminal-event `status` field declared (success | partial | failed)
- §16.5 no-silent-partial-success expanded with the transactional integrity from §11.1
- §16.6 HTTP-mapping table expanded with partial unique index, label index, pg-boss key; UUID PK 500 path scoped as the single narrow exception

### Acceptance (§17)
- §17.1 schema acceptance attribution corrected to migration 0318 (creates tables) / 0319 (alters)
- §17.2 broker invariant acceptance rewritten against the pure helper
- §17.5 consent lifecycle expanded with pre/post-verification regimes + static-gate test for the one-time UPDATE
- §17.5b NEW — Failover ordering acceptance criteria
- §17.7 single verdict on legacy page

---

## Rejected findings

None. Every finding across iterations 1-5 was accepted and applied.

---

## Directional and ambiguous findings (autonomously decided)

None. Codex returned no directional findings across the five iterations.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against five rounds of Codex review. Every directional concern that surfaced (zero, in fact) was framing-compliant. However:

- The review did NOT re-verify the framing assumptions. If pre-production status, rapid evolution, or the testing posture has shifted since 2026-05-10, the spec's `connected_unverified` defaults, `commit_and_revert` rollout posture, and pure-function-only testing strategy need re-reading.
- **The five-iteration cap was hit before convergence.** Codex was still producing 8-9 valid mechanical findings on iteration 5. The cause is likely the spec's complexity (11 chunks, two migrations, three new tables, two ServicePure files added during review, a complex multi-branch connect flow with re-acceptance / disclosure-bump variants) — each round of changes opened new internal-consistency gaps. A sixth iteration would likely surface more.

**Recommended next step before build:** run a human conformance pass on the spec's contracts and state-machine sections (§9, §7.5, §11.1, §16). Specifically:
- Verify the two-branch connect flow in §11.1 matches how the team wants the V1 builder to behave when the registry flips mid-build.
- Confirm the `user: { userId, userIdNullified, displayName }` ownership shape (§9.2) matches what the UI mockups actually consume.
- Confirm the `connectionsService.listConnections` permission bridge (§10.5) is implementable without breaking existing callers of the unified list endpoint.
- Confirm the JSONB allowlist shape (§9.4b) doesn't collide with any existing `config_json` content other auth types store.

The verdict NEEDS_REVISION is set because the spec did not converge inside the lifetime cap and Codex was still producing valid mechanical findings on iteration 5. The build can still start from this state — the unresolved findings are not blockers, just expected late-stage tidy-up items — but a human read of the spec before kick-off is the recommended cost-effective next step rather than burning a 6th review iteration.
