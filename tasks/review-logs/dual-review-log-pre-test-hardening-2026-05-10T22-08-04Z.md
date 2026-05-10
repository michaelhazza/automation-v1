# Dual Review Log — pre-test-hardening

**Files reviewed:** 60 changed files across the pre-test-hardening branch vs `main`. Focus surfaces (per caller brief):
- `server/services/taskService.ts` — T3 caller-supplied tx contract + 4-arg transitional shim
- `server/services/connectorConfigService.ts` — Teamwork webhook_token lookup
- `server/lib/webhookReplayNonceStore.ts` — replay-nonce dedup
- `server/routes/webhooks/teamworkWebhook.ts` — tokenised Teamwork webhook route
- `server/services/scheduledTaskService.ts` — fireOccurrence taskService.createTask migration
- `server/services/knowledgeService.ts` — pg_advisory_xact_lock override path
- `server/services/referenceDocumentService.ts` — atomic cross-org verify-then-insert
- `scripts/lib/prod-db-guard.ts` — reseed prod-DB primary + secondary guards
- `migrations/0313_webhook_replay_nonces.sql`, `0314_connector_configs_webhook_token.sql`, `0315_connections_status_check.sql`

**Iterations run:** 4/3 (one extra confirmation pass)
**Timestamp:** 2026-05-10T22:08:04Z
**Commit at finish:** bde109c95a540628f31f509d027f47a64b5156e1

---

## Iteration 1 — `_codex_dual_iter1_pre-test-hardening_2026-05-10T21-40-40Z.txt`

Codex returned three prioritised findings.

### [REJECT] `scripts/lib/prod-db-guard.ts:8` — Primary guard only blocks `NODE_ENV === 'production'`, not "anything other than development"

**Codex argument:** Previous inline guard rejected every value except `development`; new guard allows undefined / staging / test values to proceed unless the host happens to match the denylist.

**Decision:** Reject. The spec §6.3 line 347 explicitly specifies the literal `process.env.NODE_ENV === 'production'` check. Acceptance criterion line 410 tests `NODE_ENV=production → throw` and `NODE_ENV=development → proceed` — Codex's suggestion (`!== 'development'`) would invert the explicit spec contract. The denylist defence-in-depth (Supabase, Neon, Render, RDS, pooler) catches every major cloud provider that would constitute a "production" environment by URL. The spec author made a deliberate trade-off in favour of dev-environment ergonomics (developers don't always set `NODE_ENV=development` explicitly on Windows/Mac). Tightening to `!== 'development'` would be a spec-divergent change requiring its own spec amendment, not a dual-review fix.

### [REJECT after iter2/iter3 deep-dive] `server/services/scheduledTaskService.ts:648` — `getOrgScopedDb` breaks the `enqueueRunNow → setImmediate → fireOccurrence` path

**Codex argument:** `setImmediate` detaches from the ALS context. `getOrgScopedDb()` throws `missing_org_context`; `enqueueRunNow`'s catch swallows it to stderr; the path silently breaks.

**Decision:** Reject after investigation. The `setImmediate→fireOccurrence` path was already broken on `main` pre-PR. `scheduled_tasks` has FORCE RLS; the first read at line 611 uses module-level `db` with no `app.organisation_id` GUC set. Pre-PR (4-arg legacy `createTask`): the FORCE-RLS read returns 0 rows → early return at line 616 → `createTask` is never reached. Post-PR (`getOrgScopedDb` createTask): the FORCE-RLS read returns 0 rows → early return at line 616 → `createTask` is never reached either way. **No regression introduced.** I initially attempted a fix in iteration 2; Codex iteration 3 correctly identified that my fix was architecturally wrong (see below). Reverted to the as-committed state. A correct fix requires architectural redesign of `enqueueRunNow` (move off `setImmediate`, use pg-boss or a job queue with proper org-scoped context propagation) — that is a separate spec item, not a dual-review item.

### [ACCEPT] `server/services/connectorConfigService.ts:140-181` — New Teamwork configs missing `webhook_token`

**Codex argument:** Migration 0314 backfills existing Teamwork rows with `gen_random_uuid()`. But `connectorConfigService.create` and `createForSubaccount` have no auto-generation, so any Teamwork connector created post-migration has `webhook_token=NULL`. The new tokenised webhook route `/api/webhooks/teamwork/:orgWebhookToken` resolves connectors by `webhook_token` only, so deliveries to NULL-token connectors get silent 401 'webhook.token_unknown'.

**Decision:** Accept. Verified via reading the route (`teamworkWebhook.ts:33` calls `findByWebhookToken`), the lookup query (`connectorConfigService.ts:252-281`), and both create paths (lines 140-181 have no `webhookToken` value). Fix: auto-generate UUID via `randomUUID()` when `data.connectorType === 'teamwork'` in both `create` and `createForSubaccount`.

---

## Iteration 2 — `_codex_dual_iter2_pre-test-hardening_2026-05-10T21-55-09Z.txt`

After applying iter1's accepted fix (connectorConfigService webhook_token auto-gen) and an attempted fix for the scheduledTaskService finding (wrapped `taskService.createTask` call in a self-contained `db.transaction` + `set_config` + `withOrgTx`), Codex re-reviewed.

### [PARTIALLY VALID] `server/services/scheduledTaskService.ts:653-654` — Partial wrap doesn't help because `scheduledTasks` reads run before the wrap

**Codex argument:** `fireOccurrence` reads `scheduledTasks` (FORCE RLS) at line 611 BEFORE my new tx block at line 653. Those reads use module-level `db` with no GUC and return 0 rows → early return → my wrap never executes.

**Decision:** Codex is correct. My iter2 partial-wrap fix was incorrect. Attempted to escalate the fix to wrap the entire `fireOccurrence` body.

---

## Iteration 3 — `_codex_dual_iter3_pre-test-hardening_2026-05-10T22-01-53Z.txt`

After wrapping the whole `fireOccurrence` body in a `db.transaction` + `set_config` + `withOrgTx`, Codex re-reviewed.

### [VALID — fix architecturally broken] Two findings on my full-wrap

**Codex P1 argument:** `set_config('app.organisation_id', ..., true)` only scopes the GUC to the transaction's connection. `_fireOccurrenceBody`'s subsequent `db.select(...)` calls use the module-level `db` pool, which picks any connection — likely a different one without the GUC. So FORCE RLS still returns zero rows and the run-now path remains broken.

**Codex P2 argument:** My fix starts a transaction before calling `_fireOccurrenceBody` and only commits after the whole body returns, including `agentExecutionService.executeRun` which can take minutes (LLM calls + multi-step agent execution). This holds a DB connection in an open transaction for the entire agent run, exhausts the pool, and risks idle-in-transaction timeouts.

**Decision:** Both points are correct architectural concerns. My fix is fundamentally wrong on connection-pool grounds (P1) and resource grounds (P2). The right fix requires re-architecting `enqueueRunNow` to not use `setImmediate` (e.g. enqueue to pg-boss with its proper org-context wrapper), which is out of scope for dual-review. **Reverted the scheduledTaskService change.** The pre-existing setImmediate breakage is unchanged from `main`.

---

## Iteration 4 — `_codex_dual_iter4_pre-test-hardening_2026-05-10T22-06-18Z.txt`

After reverting the scheduledTaskService changes (leaving the connectorConfigService change in place), Codex re-reviewed the uncommitted diff.

**Codex verdict:** "The connector creation paths now generate Teamwork webhook tokens consistently, and the change aligns with the existing schema and token lookup contract. I did not identify any correctness, security, or maintainability issues that warrant a prioritized finding."

Clean convergence on the accepted fix.

---

## Changes Made

- `server/services/connectorConfigService.ts` — added `import { randomUUID } from 'crypto'`; auto-generate `webhookToken` in `create` and `createForSubaccount` when `connectorType === 'teamwork'`. Added comment block explaining the linkage to migration 0314 and the tokenised webhook route.

## Rejected Recommendations

- **`scripts/lib/prod-db-guard.ts:8` — Codex wanted primary guard to be `nodeEnv !== 'development'` instead of `nodeEnv === 'production'`.** Rejected because spec §6.3 line 347 explicitly mandates the literal `=== 'production'` check, and the denylist defence-in-depth catches all relevant cloud-provider DB hosts. Tightening would be a spec-divergent change.
- **`server/services/scheduledTaskService.ts:648` — Codex flagged a "regression" in the `enqueueRunNow → setImmediate` path.** Rejected after investigation: this path was already broken on `main` pre-PR because `scheduled_tasks` has FORCE RLS and `fireOccurrence`'s first read at line 611 uses module-level `db` with no GUC. The pre-PR 4-arg `createTask` shape and post-PR `getOrgScopedDb` shape produce identical observable behaviour for this path (silent early-return at line 616). No regression. Attempted fixes in iter2 and iter3 were each invalidated by Codex's correct follow-up criticisms (different-connection problem, long-lived-tx problem). The correct architectural fix (move `enqueueRunNow` off `setImmediate` to a queue with proper org-context wrapping) is outside the scope of this dual-review. Reverted both attempts.

## Notes

- The W3 test suite (`server/routes/webhooks/__tests__/teamworkWebhook.W3.test.ts` — 10 tests) was re-run after the connectorConfigService fix and passes.
- `npm run typecheck` and `npm run lint` (0 errors) confirmed clean after the accepted fix.
- Test gates not run locally per `CLAUDE.md § Test gates are CI-only — never run locally`.

---

**Verdict:** APPROVED (4 iterations, 1 fix applied, 2 findings rejected with detailed rationale)
