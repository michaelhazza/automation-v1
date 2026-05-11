# Spec Review — Iteration 1 — operator-session-identity

**Spec:** `docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md`
**Iteration:** 1 of 5
**Codex output:** `tasks/review-logs/_codex_operator-session-identity_iter1_2026-05-11T04-14-54Z.txt`
**Spec commit at iteration start:** 267433f2 (spec was untracked)
**Spec-context hash:** 267433f2 (last_reviewed_at 2026-05-10; GREEN under staleness gate)

---

## Codex findings (12 total)

### FINDING 1 — DDL FK contradiction
- **Source:** Codex (Critical)
- **Section:** §7.2 lines 256-258 vs 282
- **Description:** DDL says `organisation_id`/`user_id` are `NOT NULL ON DELETE RESTRICT`; prose says these FKs "may be nulled (via `ON DELETE SET NULL` where applicable)". Mechanically impossible.
- **Codex's suggested fix:** Reconcile the DDL with the retention path.
- **Classification:** mechanical
- **Reasoning:** Internal contradiction between DDL and prose; intent in brief is `SET NULL`.
- **Disposition:** ACCEPT — applied.

### FINDING 2 — Default subscription pattern undecided but treated as settled
- **Source:** Codex (Critical)
- **Section:** §9.6 line 664, §16.3 lines 999-1021, §18 Q1 line 1147; §7.1 migration missing `is_default` column
- **Description:** §18 Q1 says spec author picks in Chunk 1; §9.6 and §16.3 already commit to `is_default` flag; §7.1 migration does NOT add the column.
- **Codex's suggested fix:** Settle the open question; align all sections.
- **Classification:** mechanical
- **Reasoning:** Missing per-item verdict on a load-bearing schema choice; sequencing bug (downstream chunks depend on the decision).
- **Disposition:** ACCEPT — applied (commit to Option A; add `is_default` column + partial unique index to §7.1; close §18 Q1 as RESOLVED; tighten §9.6).

### FINDING 3 — Disclosure-version-bump model internally contradictory
- **Source:** Codex (Important)
- **Section:** §11.4 lines 785-788 vs §13 line 941 vs §18 Q2
- **Description:** §11.4 says "Spec author picks one in implementation"; §13 and §18 say "Spec picks Option A".
- **Codex's suggested fix:** Commit to Option A in §11.4.
- **Classification:** mechanical
- **Reasoning:** Internal contradiction; downstream sections already treat it as settled.
- **Disposition:** ACCEPT — applied (rewrite §11.4 as a single commitment to on-read detection).

### FINDING 4 — Connect idempotency predicate blocks multi-subscription
- **Source:** Codex (Important)
- **Section:** §16.1 line 996 vs Goal §2 item 14 (failover)
- **Description:** Idempotency check `(organisation_id, subaccount_id, provider_type = 'openai')` prevents multiple simultaneously usable OpenAI operator_session rows in one subaccount — directly conflicts with failover.
- **Codex's suggested fix:** Loosen the predicate to support multi-row.
- **Classification:** mechanical
- **Reasoning:** Invariant in goals violated by implementation detail elsewhere; existing `ic_subaccount_provider_label_unique` index already supports multi-row via label.
- **Disposition:** ACCEPT — applied (use `(organisation_id, subaccount_id, provider_type, label)` aligned with the existing index).

### FINDING 5 — Connection↔consent dual link with no source-of-truth
- **Source:** Codex (Important)
- **Section:** §7.1 line 218 + §7.2 line 259, §9.6 lines 657-665
- **Description:** Both `integration_connections.consent_record_id` and `operator_session_consents.connection_id` exist; no declared winner when they diverge.
- **Codex's suggested fix:** Declare source-of-truth precedence.
- **Classification:** mechanical
- **Reasoning:** Schema overlap; spec-authoring checklist §3 requires explicit source-of-truth precedence when same fact is represented multiply.
- **Disposition:** ACCEPT — applied (added row to §9.6 declaring forward `consent_record_id` is canonical; reverse `connection_id` is historical/audit-only).

### FINDING 6 — Migration paths wrong
- **Source:** Codex (Important)
- **Section:** §8.1 lines 404-405
- **Description:** Spec uses `server/db/migrations/0318...sql`; actual location is project-root `migrations/`. No `server/db/migrations` directory exists.
- **Codex's suggested fix:** Correct the paths.
- **Classification:** mechanical
- **Reasoning:** Concrete path accuracy bug; verified against repo structure.
- **Disposition:** ACCEPT — applied (paths corrected; also expanded `0318` description to reflect 6 columns + partial unique index).

### FINDING 7 — Refresh-job dedup mechanism inconsistent + unbacked
- **Source:** Codex (Important)
- **Section:** §11.2 line 774, §16.1 line 998, §16.6 line 1054
- **Description:** Column name drift `refresh_attempt_at_bucket` vs `refresh_bucket`; "unique constraint" claimed but no migration adds it.
- **Codex's suggested fix:** Pick one name; name the actual mechanism (DB constraint vs pg-boss singleton).
- **Classification:** mechanical
- **Reasoning:** Load-bearing idempotency claim without a backing mechanism + column-name drift.
- **Disposition:** ACCEPT — applied (unified to `refresh_bucket`; mechanism is pg-boss singletonKey, no DB constraint; updated all three sections).

### FINDING 8 — Route/permission overlap on PATCH
- **Source:** Codex (Important)
- **Section:** §10.4 lines 735 and 740
- **Description:** Generic PATCH listed for "availability/default changes"; dedicated `/allow-agent-use` also handles availability. Two routes, two guards, one capability.
- **Codex's suggested fix:** Split cleanly — generic PATCH only handles non-availability mutations.
- **Classification:** mechanical
- **Reasoning:** Permission overlap is a mechanical wiring bug, not a posture call.
- **Disposition:** ACCEPT — applied (generic PATCH limited to label/display-name; availability stays on `/allow-agent-use`; Make Default uses `/make-default`).

### FINDING 9 — /connections CRUD consolidation backend route file not locked
- **Source:** Codex (Important)
- **Section:** §5.5 + §8.9 + Chunk 9 (line 900)
- **Description:** Spec says "new server routes" but never locks the route file. Chunk 9 says "either `connections.ts` or new `webLoginConnectionsGovern.ts`".
- **Codex's suggested fix:** Lock the file in §8.
- **Classification:** mechanical
- **Reasoning:** File inventory drift against the spec's own single-source-of-truth rule.
- **Disposition:** ACCEPT — applied (added `server/routes/webLoginConnectionsGovern.ts` to §8.8 as new file; updated §8.9 to remove the OR; updated Chunk 9 to lock).

### FINDING 10 — DisclosurePlusStep.tsx referenced but not inventoried
- **Source:** Codex (Minor)
- **Section:** Chunk 7 line 873 vs §8.12
- **Description:** Wizard sub-component referenced as if it were a separate file; not listed in inventory.
- **Codex's suggested fix:** Add to inventory or remove the reference.
- **Classification:** mechanical
- **Reasoning:** Inventory drift, low-impact.
- **Disposition:** ACCEPT — applied (rephrased as a private internal step component of `ConnectAiSubscriptionModal.tsx`, not a separate file).

### FINDING 11 — "blocked-behind-provider flag" stale language
- **Source:** Codex (Minor)
- **Section:** §2 goal item 4 (line 54)
- **Description:** "Flag" wording is stale given the actual mechanism is a 501 gate.
- **Codex's suggested fix:** Rewrite without "flag".
- **Classification:** mechanical
- **Reasoning:** Stale language; the codebase posture rejects feature flags anyway, so "flag" is doubly wrong here.
- **Disposition:** ACCEPT — applied (rewrote as "returns 501 provider_mechanism_not_verified").

### FINDING 12 — Terminal-event `status` field not declared
- **Source:** Codex (Minor)
- **Section:** §16.4 lines 1035-1037
- **Description:** Terminal paths named but no `status: success | partial | failed` field per spec-authoring-checklist §10.4.
- **Codex's suggested fix:** Add the `status` field declaration.
- **Classification:** mechanical
- **Reasoning:** Direct checklist compliance gap.
- **Disposition:** ACCEPT — applied (expanded §16.4 and §16.5 to declare `status` per terminal path; partial reserved for refresh retryable bucket only).

---

## Rubric findings (1 not already covered by Codex)

### RUBRIC R11 — UNIQUE constraint missing from operator_session_consents DDL
- **Source:** Rubric — file-inventory / load-bearing-claim drift
- **Section:** §7.2 DDL vs §16.1 + §16.6 + §17.1 references
- **Description:** Multiple sections reference `UNIQUE (organisation_id, subaccount_id, user_id, disclosure_version)` on `operator_session_consents`, but the §7.2 DDL doesn't include it.
- **Classification:** mechanical
- **Disposition:** ACCEPT — applied (added as `CONSTRAINT operator_session_consents_user_disclosure_unique UNIQUE (...)` in the DDL).

---

## Iteration 1 Summary

- Mechanical findings accepted:  13 (12 Codex + 1 rubric; FINDING 2 also absorbed rubric R6's `is_default` column gap)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (pending Step 8b commit)
