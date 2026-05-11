# Spec Conformance Log — pre-test-hardening — 2026-05-10T21-01-31Z

**Spec:** `tasks/builds/pre-test-hardening/spec.md`
**Spec commit at check:** 2b5e52faaac061c155b01fc7592ecc57e1e95d08 (HEAD)
**Branch:** claude/review-preprod-spec-CmHez
**Base (merge-base):** 2e6089ada40fa6a41557566fb47797d61d3d8f2c
**Scope:** All 14 items — W1, W2, W3, T1, T2, T3, S1, S2, V1, V2, O1, O2, O3, O4, O5 (full-spec verification per caller's invocation)
**Changed-code set:** ~50 files (committed in 2b5e52fa)
**Run at:** 2026-05-10T21:01:31Z
**Commit at finish:** 22061abc

---

## Summary

- Requirements extracted:     25
- PASS:                       22
- MECHANICAL_GAP → fixed:      2 (REQ #6a — DEC re-statement; REQ #11b — T1 grep-gate paste)
- DIRECTIONAL_GAP → deferred:  0
- AMBIGUOUS → deferred:        0
- OUT_OF_SCOPE → skipped:      1 (REQ #23 — O5 branch protection, operator action pending merge-ready phase)

## Verdict

**CONFORMANT_AFTER_FIXES** — all 14 implementation items conform to spec. Two mechanical documentation gaps in `progress.md` (DEC-1..4 re-statement and T1 grep-gate output) were filled in-session per spec §9 acceptance #6a and §3.1 acceptance "paste empty result into progress.md".

## Requirements extracted (full checklist)

| REQ | Item | Spec section | Category | Verdict |
|---|---|---|---|---|
| #1 | W1 — HMAC fail-closed in production, dev preserves skip + one-time warn | §2.1 | behavior | PASS |
| #2 | W2 (Slack) — recordIncident on 5xx, fingerprint `webhook:slack:handler_failed` | §2.2 | behavior | PASS |
| #3 | W2 (Teamwork) — recordIncident on 5xx, fingerprint `webhook:teamwork:handler_failed` | §2.2 | behavior | PASS |
| #4 | W3a — `/api/webhooks/teamwork/:orgWebhookToken` route + locked three-filter lookup | §2.3 ¶1 | contract | PASS |
| #5 | W3b — `webhook_replay_nonces` table + RLS + migration 0313 | §2.3 + §0.7 | schema+migration | PASS |
| #6 | W3c — `connector_configs.webhook_token uuid NULL` + partial UNIQUE + 0314 | §2.3 + §0.7 | schema+migration | PASS |
| #7 | W3d — Persistent replay protection (INSERT … ON CONFLICT DO NOTHING) + missing-deliveryId 400 | §2.3 ¶2 | behavior | PASS |
| #8 | W3e — Hourly TTL prune job, 10-minute retention | §2.3 ¶2 | behavior | PASS |
| #9 | T1a — Routes mounted under `/api/subaccounts/:subaccountId/support/...` + mergeParams | §3.1 | contract | PASS |
| #10 | T1b — Service-layer subaccount filter on every support_* read | §3.1 | behavior | PASS |
| #11a | T1c — Frontend rewrites; legacy unscoped paths removed | §3.1 acceptance | behavior | PASS |
| #11b | T1c — Grep-gate output pasted to `progress.md` | §3.1 acceptance | docs | MECHANICAL_GAP → FIXED |
| #12 | T2 — Cross-org scope-ID rejection on reference-doc promote/links + atomicity + audit row | §3.2 | behavior | PASS |
| #13 | T3 — `taskService.createTask(input, tx)` type-level enforcement + GHL TODO + transitional overload | §3.3 + §0.7 | contract+behavior | PASS |
| #14 | S1 — Preflight checks 4–7 added (status, collision, customer-match, supersession with tuple comparison) | §4.1 | behavior | PASS |
| #15 | S2 — Agent-run principal cannot set `overrideCollision=true`; 403 before any DB read | §4.2 | behavior | PASS |
| #16 | V1a — `connectionStatus` Zod enum + 400 `connection.status_invalid` | §5.1 | validation | PASS |
| #17 | V1b — Migration 0315 CHECK constraint with preflight + idempotent | §5.1 | schema+migration | PASS |
| #18 | V2 — `pg_advisory_xact_lock(hashtextextended($1::text, 0))` as first SQL in same tx | §5.2 + §0.7 | behavior | PASS |
| #19 | O1 — `RETURNING` removed from compact-job DELETE | §6.1 | behavior | PASS |
| #20 | O2 — `docs/runbooks/migration-0240-phased-swap.md` created | §6.2 | docs | PASS |
| #21 | O3 — Reseed env guard (primary `NODE_ENV` + secondary host denylist) in `prod-db-guard.ts` | §6.3 | behavior | PASS |
| #22 | O4 — Reseed restore body wrapped in transactional BEGIN/COMMIT/ROLLBACK | §6.4 | behavior | PASS |
| #23 | O5 — Branch protection on `main` (operator action) | §6.5 | docs/operator | OUT_OF_SCOPE (pending merge-ready) |
| #24 | rlsProtectedTables.ts — `webhook_replay_nonces` registered | §9 #4 + §2.3 | config | PASS |
| #25 | Sister-branch scope-out clean (no diff in §0.2 forbidden paths) | §9 #5 | behavior | PASS |
| #6a (impl) | DEC-1..4 resolutions re-stated in progress.md | §9 #6a | docs | MECHANICAL_GAP → FIXED |

## Per-REQ verdicts

(See checklist above. Detail on the two mechanical fixes below; all PASS items verified by direct file reads as documented in Evidence section.)

### Evidence per requirement (compact)

- **REQ #1** — `server/services/webhookService.ts:94-119` — production branch throws `webhook.signature_required`; dev branch returns true with one-time `logger.warn('webhook_secret_missing', …)` gated by module-level `webhookOpenModeWarned`.
- **REQ #2** — `server/routes/webhooks/slackWebhook.ts:84-92` — only `res.status(500)` path has `recordIncident({fingerprintOverride:'webhook:slack:db_lookup_failed', …})` before; async-after-ack catch at :188 also calls `recordIncident({fingerprintOverride:'webhook:slack:handler_failed', …})`.
- **REQ #3** — `server/routes/webhooks/teamworkWebhook.ts:38-45, 99-107, 158-166` — both `res.status(500)` paths have `recordIncident` before; async catch uses `webhook:teamwork:handler_failed` fingerprint.
- **REQ #4** — `server/routes/webhooks/teamworkWebhook.ts:26` declares `POST /api/webhooks/teamwork/:orgWebhookToken`. `server/services/connectorConfigService.ts:252-281` `findByWebhookToken` filters on `connector_type='teamwork' AND status='active' AND webhook_token=$1::uuid`.
- **REQ #5** — `migrations/0313_webhook_replay_nonces.sql:1-23` — table + UNIQUE + secondary index + RLS policy. `server/db/schema/webhookReplayNonces.ts` + index.ts:312 + `rlsProtectedTables.ts:1199-1203` registered.
- **REQ #6** — `migrations/0314_connector_configs_webhook_token.sql:1-8` — column + partial UNIQUE + Teamwork data step. `server/db/schema/connectorConfigs.ts:40` adds `webhookToken: uuid('webhook_token')`. No CREATE EXTENSION (per locked preflight).
- **REQ #7** — `server/lib/webhookReplayNonceStore.ts:33-56` — `INSERT … ON CONFLICT DO NOTHING RETURNING 1` returns `{inserted: rows.length === 1}`. `server/routes/webhooks/teamworkWebhook.ts:84-119` — missing/empty deliveryId → 400 `webhook.delivery_id_required`; replay → 200 + structured `webhook.teamwork.replay_deduped` event.
- **REQ #8** — `server/jobs/webhookReplayNoncePruneJob.ts` runs `DELETE FROM webhook_replay_nonces WHERE seen_at < now() - INTERVAL '10 minutes'`. `server/services/queueService.ts:973, 1190` registers + schedules cron `0 * * * *` (hourly).
- **REQ #9** — `server/index.ts:472-473` mounts `/api/subaccounts/:subaccountId/support`. All three sub-routers (`supportTicketsRoutes.ts`, `supportDraftsRoutes.ts`, `supportInboxesRoutes.ts`) declare `Router({ mergeParams: true })` and call `resolveSubaccount(req.params.subaccountId, req.orgId!)`.
- **REQ #10** — Subaccount filters present in `supportTicketService.ts:275-279, 370-372`; `supportDraftDispatchService.ts:223, 670-707, 744-768, 804-828, 922-933`; `supportInboxService.ts:81-84, 183-184`. Conditional on non-null but routes always set non-null at runtime.
- **REQ #11a** — Eleven client call sites all rewritten to `/api/subaccounts/${subaccountId}/support/...` (SupportDeskSetupPage, TicketsListPage, DraftReviewQueue, InboxConfigPage, TicketDetailPage). Grep on `/api/support/(tickets|drafts|inboxes)` returns only intentional 404-assertion tests under `__tests__/`.
- **REQ #11b** — Grep-gate output now pasted into `progress.md` § "T1 grep-gate output" (mechanical fix, this run).
- **REQ #12** — `server/services/documentDataSourceService.ts:25-93` `verifyScopeIdsBelongToOrg` runs four batched checks (atomicity), writes audit row with metadata exactly `{scopeKind, scopeId}`, returns `{ok:false, ...}` on any failure. Throws 403 `referenceDocument.scope_cross_org`. `documentPromotionService.ts:55-65` consumes the verifier before any insert.
- **REQ #13** — `server/services/taskService.ts:80-202` defines canonical `(input, tx)` overload + transitional 4-arg `@deprecated` overload that throws at runtime. Helpers `_validateStatus`, `_nextPosition` accept tx. GHL TODO at `server/jobs/ghlAutoStartOnboardingJob.ts:60`. T3 caller-audit checklist documented in progress.md (15 in-scope sites + 1 indirect wrap + 1 GHL TODO + 2 sister-branch).
- **REQ #14** — `server/services/supportDraftDispatchPreflightPure.ts:210-365` defines four pure check functions matching spec contracts. `supportDraftDispatchService.ts:283-386` wires them in spec order after checks 1-3. Tuple comparison `(created_at, id) > ($2, $3)` at line 371. isHumanOverride audit row written at line 388-407.
- **REQ #15** — `supportDraftDispatchService.ts:172-179` — S2 guard at function entry, before any DB read, throws 403 `support.draft.override_collision_human_only`.
- **REQ #16** — `server/routes/integrationConnections.ts:104-117` — `patchConnectionBodySchema` uses `z.enum(['active','revoked','error']).optional()`; rejects with 400 `connection.status_invalid`.
- **REQ #17** — `migrations/0315_connections_status_check.sql:1-28` — preflight `RAISE EXCEPTION` on bad existing data; CHECK constraint added idempotently via `DO $$ … IF NOT EXISTS … $$;`. Down migration drops the constraint.
- **REQ #18** — `server/services/knowledgeService.ts:784-791` — `tx = getOrgScopedDb('knowledgeService.overrideEntry')`; `pg_advisory_xact_lock(hashtextextended(${blockId}::text, 0))` as first SQL on tx; reads/inserts follow on same tx. Re-entrancy verified per progress.md C8 audit (instrumentation.ts:172-173 — orgTxStorage.run propagates outer tx).
- **REQ #19** — `server/jobs/workingTimeRollupCompactJob.ts:97-101` — DELETE has no RETURNING clause; `deleted` CTE is side-effect-only.
- **REQ #20** — `docs/runbooks/migration-0240-phased-swap.md` (149 lines) — sections: When to use, Background, Operator command sequence (3 steps with CONCURRENTLY), Rollback plan, Post-migration verification.
- **REQ #21** — `scripts/lib/prod-db-guard.ts:1-29` — primary `NODE_ENV==='production'` guard fail-closed; secondary host denylist with hardcoded fragments + `PROD_DB_HOST_DENYLIST` env-var union. `scripts/_reseed_drop_create.ts:6` calls `assertDevTargetOrThrow` as first executable line of `main()`.
- **REQ #22** — `scripts/_reseed_restore_users.ts:8, 30, 51-58` — `assertDevTargetOrThrow` first; restore body inside `BEGIN`/`COMMIT`/`ROLLBACK` with rollback-on-throw. Different shape from spec's literal `db.transaction(async (tx) => ...)` but behaviorally equivalent because the script uses raw `pg` Pool (no Drizzle context); transactional atomicity contract holds.
- **REQ #23** — Operator action; progress.md placeholder at line 162. Marked OUT_OF_SCOPE for code conformance — applies at merge-ready phase.
- **REQ #24** — `server/config/rlsProtectedTables.ts:1199-1203` — `webhook_replay_nonces` entry with `policyMigration: '0313_webhook_replay_nonces.sql'`.
- **REQ #25** — `git diff main...HEAD --name-only` shows zero matches in §0.2 forbidden paths (`server/middleware/*`, `workflowEngineService.ts`, `workflowRunService.ts`, `agentExecutionService.ts`, `agentRuns` schema).
- **REQ #6a (impl)** — DEC-1..4 resolutions now re-stated in progress.md § "DEC-1 through DEC-4 resolutions" (mechanical fix, this run).

## Mechanical fixes applied

### [FIXED] REQ #6a (impl) — DEC-1..4 resolutions re-stated in progress.md

- **File:** `tasks/builds/pre-test-hardening/progress.md`
- **Spec quote:** "progress.md only re-states the resolutions and notes any in-build deviations." (§9 acceptance #6a)
- **Change:** Appended `## DEC-1 through DEC-4 resolutions (spec §0.4 — re-stated for §9 acceptance #6a)` section listing the four locked decisions and noting "no in-build deviations" with citations to the implementation evidence.

### [FIXED] REQ #11b — T1 grep-gate output pasted to progress.md

- **File:** `tasks/builds/pre-test-hardening/progress.md`
- **Spec quote:** "Builder runs the grep and pastes the empty result into `progress.md`." (§3.1 acceptance — Route inventory check grep gate)
- **Change:** Appended `## T1 grep-gate output (spec §3.1 acceptance — route inventory check)` section with the four `rg` command invocations + their (effectively empty) outputs, plus the eleven client call-site verification list mapping each rewritten URL to the new `/api/subaccounts/${subaccountId}/support/...` shape.

Both changes are documentation-only additions in the build's own `progress.md`; no source code touched.

## Directional / ambiguous gaps (routed to tasks/todo.md)

None. All 14 implementation items conform to spec. The two gaps were mechanical documentation gaps in `progress.md` and were fixed in-session per the spec's literal instructions.

## Files modified by this run

- `tasks/builds/pre-test-hardening/progress.md` — appended three sections: DEC-1..4 re-statement, T1 grep-gate output, spec-conformance audit summary.

## Next step

**CONFORMANT_AFTER_FIXES** — mechanical documentation gaps closed in-session. Re-run `pr-reviewer` on the expanded changed-code set; the only post-audit modification is `tasks/builds/pre-test-hardening/progress.md` (documentation-only). No source code was changed by this audit.

For merge-readiness:
- Operator must apply branch protection on `main` and paste the `gh api repos/<owner>/<repo>/branches/main/protection` output into `progress.md` § "C10 — O5 — Branch protection" (replacing the `[operator pastes ... here]` placeholder). Per spec §6.5 + §9 #6c.
- After O5 lands, the build is merge-ready.
