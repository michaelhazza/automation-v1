# Spec Review — Iteration 2 — operator-session-identity

**Spec:** `docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md`
**Iteration:** 2 of 5
**Codex output:** `tasks/review-logs/_codex_operator-session-identity_iter2_2026-05-11T04-26-43Z.txt`
**Spec commit at iteration start:** 995a1389

---

## Codex findings (14 total)

### FINDING 2.1 — Migration order impossible (critical)
- **Section:** §7.1 / §7.2 / §8.1
- **Description:** Migration 0318 references `operator_session_consents(id)` but the table is created in migration 0319. 0318 cannot apply on a fresh DB.
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (swapped: 0318 now creates consent tables; 0319 adds columns to integration_connections with the FK; updated §7.1, §7.2, §7.3, §8.1, §10.2/§10.3, Chunk 1).

### FINDING 2.2 — Plus-consent flow contradiction (critical)
- **Section:** §11.1 / §11.3 / §17.5 / §10.4
- **Description:** §11.1 says consent is written during connect; §17.5 says Plus connect requires PRIOR consent; §10.4 has a separate `/consent` route requiring an existing connId.
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (rewrote §11.1 with a single transactional flow: disclosureAcceptance block in connect body for initial connect; separate `/consent` route reserved for post-bump re-acceptance; documented the one-time `connection_id` UPDATE exception with service-layer enforcement).

### FINDING 2.3 — consent.connection_id has no viable write mechanism
- **Section:** §7.2 / §9.6 / §11.3
- **Description:** Append-only rows + consent precedes connection + immutable back-pointer = unfillable.
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (covered by Fix 2.2 — documented one-time post-INSERT UPDATE inside connect transaction; updated §7.2 append-only language to name the narrow exception).

### FINDING 2.4 — `UPDATE ... FOR UPDATE` invalid Postgres SQL
- **Section:** §16.3
- **Description:** `FOR UPDATE` is a SELECT locking clause, invalid on UPDATE.
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (rewrote with `SELECT ... FOR UPDATE` lock-acquisition step, then two UPDATEs; clarified loss modes and 409 mapping).

### FINDING 2.5 — Goal says "five new columns" but six ship
- **Section:** Goal §2 line 52 vs §7.1, §8.1, Chunk 1
- **Description:** is_default was added in iteration 1 but the goal still says 5.
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (Goal updated to "six").

### FINDING 2.6 — "All are nullable" contradicts `is_default NOT NULL`
- **Section:** §7.1 prose vs DDL
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (folded into Fix 2.1 rewrite — prose now lists which columns are nullable and notes that is_default is NOT NULL with a safe default).

### FINDING 2.7 — Partial unique index has no HTTP mapping
- **Section:** §16.6
- **Description:** New `ic_subaccount_operator_session_default_unique` partial unique index has no entry in the unique-constraint-to-HTTP table.
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (added two new rows to §16.6: partial unique index → 409 `concurrent_default_change`; existing `ic_subaccount_provider_label_unique` reuse → 409 `duplicate_subscription_label`).

### FINDING 2.8 — `disabledReason: 'needs_new_consent'` inconsistent with state machine
- **Section:** §9.2
- **Description:** State machine puts disclosure-bump into `connected_needs_consent`, not `disabled`. The value is mislabelled.
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (split the field into `disabledReason` (for `disabled` state only) and `pendingReason` (for `connected_needs_*` states); aligned values to the state machine).

### FINDING 2.9 — Provider capability load-bearing but ambiguous
- **Section:** §7.4
- **Description:** `sanctionedTiers: pro/team/enterprise` + `connectionMechanism: none_verified` + `planDetectionMechanism: self_declaration` — no rule for what `plan_verification_status` a self-declared sanctioned tier lands in.
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (added a per-detection-mechanism outcome table to §7.4; V1 self_declaration always lands in `'self_declared'` + `'connected_unverified'` and requires disclosureAcceptance — even for nominally sanctioned tiers).

### FINDING 2.10 — Locked failover policy has no mechanism
- **Section:** Goal §2 item 14 vs §9, §11, §12, §17
- **Description:** "Default first; alphabetical thereafter; platform fallback" is asserted but no read path / sort rule / contract is named.
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (added §9.7 Failover ordering contract with concrete SQL ordering; added §9.6 row pointing to the broker as source of truth; added §17.5b unit-test acceptance criteria for the order).

### FINDING 2.11 — §16.6 self-contradicts on 500s
- **Section:** §16.6
- **Description:** UUID PK row says 500 + alert; next sentence says "No constraint violations should surface as 500".
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (rewrote: UUID PK collision is the SINGLE permitted 500 path, scoped narrowly; all other constraints must map to deterministic 4xx).

### FINDING 2.12 — §8.5 "Consent record CRUD" stale against append-only
- **Section:** §8.5
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (rephrased: "append-only consent row writer with the one-time `connection_id` back-fill exception; no UPDATE or DELETE primitives beyond the back-fill").

### FINDING 2.13 — Resolved item inside "Open questions" section
- **Section:** §18
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (moved Default subscription RESOLVED + Disclosure-bump RESOLVED to a new "§18b Resolved during spec-review" subsection; renumbered remaining open questions).

### FINDING 2.14 — `supersedConsent` typo
- **Section:** §9.4 + Chunk 3
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (renamed to `supersedeConsent` in both locations).

---

## Iteration 2 Summary

- Mechanical findings accepted:  14
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (pending Step 8b commit)
