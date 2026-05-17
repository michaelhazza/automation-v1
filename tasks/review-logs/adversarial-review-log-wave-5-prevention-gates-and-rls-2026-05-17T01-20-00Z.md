# Adversarial Review Log — wave-5-prevention-gates-and-rls

**Branch:** `claude/wave-5-prevention-gates-and-rls`
**Slug:** `wave-5-prevention-gates-and-rls`
**Timestamp:** 2026-05-17T01:20:00Z
**Reviewer:** adversarial-reviewer (Phase 1 advisory)

**Verdict:** HOLES_FOUND (2 confirmed-holes, 1 likely-hole, 3 worth-confirming)

All confirmed-holes addressed in fix-loop commit `8b1011ff` (see updates below).

---

## Threat Model Findings

### confirmed-hole [1] — Bare guard-ignore directives (RESOLVED in fix-loop)
File: `server/services/computeBudgetService.ts:395,408`
Pattern: `// guard-ignore-next-line: with-org-tx-or-scoped-db` (no `reason=` or `ADR-<id>`)

Two callsites suppressed the P2 gate analyser using the bare form. The spec (§4) enumerates three accepted forms; the bare form is none of them. Attack scenario: a future Tier 2 callsite could suppress the gate with a bare annotation that carries no rationale.

**Resolution:** Fix-loop added rationale strings to both directives. ADDRESSED.

### confirmed-hole [2] — Cross-tenant financial data reads without scoping (RESOLVED in fix-loop)
File: `server/services/llmUsageService.ts:655,664,682,691`

Four bare guard-ignores suppressed the gate on reads of RLS-protected `cost_aggregates` and `org_margin_configs`. `getAdminUsageOverview` and `getMarginConfigs` returned all-org financial data via raw `db` with no per-tenant filter. Attack scenario: a future non-admin route calling these functions would silently leak all-org financial data.

**Resolution:** Fix-loop migrated `getAdminUsageOverview`, `getLlmPricing`, `getMarginConfigs` to `withAdminConnection({source, reason}, async tx => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })`. ADDRESSED.

### likely-hole [3] — JSDoc claims audit_events logging that doesn't exist (PARTIALLY RESOLVED)
File: `server/lib/adminDbConnection.ts:22`

JSDoc header stated "Every invocation logs a row to `audit_events`". Implementation logs to stderr via `console.warn`. With `skipAudit: true` at most call sites, admin-bypass operations produce no durable audit record. Incident responders grepping `audit_events` find nothing.

**Resolution:** Fix-loop corrected the block JSDoc. R2 pr-reviewer noted the field-level JSDoc on `AdminConnectionOptions.reason` (line 44) was missed — addressed in subsequent doc-sync fix.

### worth-confirming [4] — Manual `db.transaction + withOrgTx` third entrypoint
File: `server/services/githubWebhookService.ts:38-58` (pre-existing)

`githubWebhookService` opens `db.transaction()` manually and calls `withOrgTx` directly — without going through `authenticate` middleware or `createWorker` wrapper. Spec's two-entrypoint criterion would misclassify downstream callsites as "blocked" when org context IS established (just inside the service). Suggested fix: the spec's entrypoint definition should recognise this as a third valid pattern. Routed to `tasks/todo.md` for spec evolution.

### worth-confirming [5] — GHL location-scoped webhook conditional HMAC
File: `server/routes/webhooks/ghlWebhook.ts:178-194` (pre-existing)

GHL location-scoped webhook skips HMAC verification when `config.webhookSecret` is null. An attacker who knows a target org's locationId could inject events. Pre-existing, not introduced by this PR. Routed to `tasks/todo.md`.

### worth-confirming [6] — `X-Organisation-Id` validation
File: `server/middleware/auth.ts:111-113` (pre-existing)

system_admin JWT holders can scope into any org via `X-Organisation-Id` without validating the org exists. Could be used to probe org-ID existence. Pre-existing design choice, low immediate risk. Routed to `tasks/todo.md`.

---

## STRIDE Sweep Summary

- **Spoofing:** No new risks.
- **Tampering:** confirmed-holes 1+2 — RESOLVED in fix-loop.
- **Repudiation:** likely-hole 3 — RESOLVED (JSDoc corrected).
- **Information Disclosure:** confirmed-hole 2 — RESOLVED (admin financial reads scoped via withAdminConnection).
- **Denial of Service:** No risks identified.
- **Elevation of Privilege:** worth-confirming 5 — routed to todo.md (pre-existing).

---

## Trust Boundary Assessment

| Boundary | Enforcement | Status |
|---|---|---|
| client → route (HTTP) | `authenticate` middleware | Correctly enforced |
| background job → tenant data | `createWorker` pg-boss wrapper | Correctly enforced |
| Stripe webhook → server | HMAC-SHA256 | Correctly enforced |
| GHL webhook (lifecycle) → server | `x-ghl-signature` HMAC, fail-closed in prod | Correctly enforced |
| GHL webhook (location-scoped) → server | conditional HMAC on webhookSecret | **Partially enforced** (worth-confirming [5]) |
| OAuth callback → session | Signed state JWT, 10-min TTL, single-use | Correctly enforced |
| user → system_admin | `requireSystemAdmin` middleware | Correctly enforced |
| Tier 2 admin path → tenant data | `withAdminConnection + SET LOCAL ROLE admin_role` | Now correctly enforced after fix-loop |

---

## Post-Fix Verification

After commit `8b1011ff`:
- P2 gate exits 0 (1178 files scanned, 0 violations)
- Numeric baseline ratcheted to 0 — ratchet enforced
- Per-file baseline pruned (header-only)
- All confirmed-holes resolved
- 3 worth-confirming items routed to tasks/todo.md for future work
