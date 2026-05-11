# pre-test-hardening: Build Progress

## C8 — V2 (knowledge override concurrent-write serialisation) — DONE

**Date:** 2026-05-11
**Branch:** claude/review-preprod-spec-CmHez

### withOrgTx re-entrancy audit (Step 4 of approach)

**Verified behaviour: (a) — Re-uses the existing transaction.**

`withOrgTx` is implemented as `orgTxStorage.run(ctx, fn)` (instrumentation.ts:172-173). `AsyncLocalStorage.run()` propagates the supplied `ctx` into the async call stack for the duration of `fn`; it does not open a new DB connection, savepoint, or independent transaction. When called inside an existing `withOrgTx` block, the new `ctx` (which carries the same outer `tx` handle) replaces the ALS store for `fn`'s lifetime. `getOrgScopedDb()` inside `fn` reads `ctx.tx`, which is the outer tx. No new DB-level transaction is opened.

Citation: `server/instrumentation.ts:172-173` — `return orgTxStorage.run(ctx, fn);`

The `authenticate` middleware (server/middleware/auth.ts:148-181) opens a `db.transaction` and then calls `withOrgTx({ tx, organisationId, ... }, () => new Promise(...))` that keeps the transaction alive for the entire request/response lifecycle. `overrideEntry` is always called inside this outer transaction, so `getOrgScopedDb('knowledgeService.overrideEntry')` resolves to that outer tx. The advisory lock acquired via `pg_advisory_xact_lock` is therefore bound to the outer request transaction and released automatically on commit/rollback.

### What was changed

- `server/services/knowledgeService.ts`: Added `getOrgScopedDb` import. Replaced `db.transaction(async (tx) => { ... })` with direct `getOrgScopedDb('knowledgeService.overrideEntry')` call. Added `pg_advisory_xact_lock(hashtextextended(blockId::text, 0))` as the first SQL statement inside the function.
- `server/services/__tests__/knowledgeService.overrideEntry.concurrency.test.ts`: New file with 3 tests covering same-block serialisation, no constraint name leakage, and cross-block concurrency timing.

### G1 Gate Results

```
npx vitest run server/services/__tests__/knowledgeService.overrideEntry.concurrency.test.ts
  ✓ 3 tests passed

npx tsc --noEmit -p server/tsconfig.json
  PASSED (0 errors)

npm run lint
  PASSED (0 errors, 903 warnings — all pre-existing)
```

---

## C5 — T3 (`taskService.createTask` write-path scoping) — DONE

**Date:** 2026-05-10  
**Branch:** claude/review-preprod-spec-CmHez

---

### T3 Caller Audit Checklist

| # | File | Status | Notes |
|---|------|--------|-------|
| 1 | `server/routes/tasks.ts:44` | DONE | Uses `getOrgScopedDb('route:tasks.create')` — auth middleware provides context |
| 2 | `server/routes/portal.ts:654` | DONE | Uses `getOrgScopedDb('route:portal.replay-org')` |
| 3 | `server/routes/portal.ts:674` | DONE | Uses `getOrgScopedDb('route:portal.replay-system')` |
| 4 | `server/routes/workflowRuns.ts:69` | DONE | Uses `getOrgScopedDb('route:workflowRuns.start')` |
| 5 | `server/routes/githubWebhook.ts:168` | DONE | Unauthenticated path — wraps in `db.transaction()` + `withOrgTx()` explicitly |
| 6 | `server/routes/githubWebhook.ts:215` | DONE | Same pattern as #5 |
| 7 | `server/services/deliveryService.ts:240` | DONE | Uses `getOrgScopedDb('service:deliveryService.deliver')` — runs in pg-boss worker |
| 8 | `server/services/scheduledTaskService.ts:647` | DONE | Uses `getOrgScopedDb('service:scheduledTaskService.runDue')` |
| 9 | `server/services/skillExecutor.ts:3392` → executeCreateTask | DONE | Uses `getOrgScopedDb('service:skillExecutor.executeCreateTask')` |
| 10 | `server/services/skillExecutor.ts:3633` → executeTriageIntake | DONE | Uses `getOrgScopedDb('service:skillExecutor.executeTriageIntake')` |
| 11 | `server/services/skillExecutor.ts:4402` → executeSpawnSubAgents | DONE | Uses `getOrgScopedDb('service:skillExecutor.executeSpawnSubAgents')` |
| 12 | `server/services/skillExecutor.ts:5442` → executeReportBug | DONE | Uses `getOrgScopedDb('service:skillExecutor.executeReportBug')` |
| 13 | `server/services/subaccountOnboardingService.ts:230` | DONE | Uses existing `tx` already obtained via `getOrgScopedDb()` at line 217 |
| 14 | `server/services/systemIncidentService.ts:289` | DONE | Passes savepoint `tx` from `db.transaction()` callback directly |
| 15 | `server/services/workflowRunStartSkillService.ts:58` | DONE | Uses `getOrgScopedDb('service:workflowRunStartSkillService.start')` |
| 16 (indirect) | `server/routes/subaccountOnboarding.ts:53` | DONE | Route uses `authenticate` middleware (which provides `withOrgTx`); service call migrated |
| 17 (TODO) | `server/jobs/ghlAutoStartOnboardingJob.ts` | TODO COMMENT ADDED | Deferred per spec §0.4 + §10 |
| 18 (sister) | `server/services/workflowEngineService.ts:2716` | PRESERVED | Sister-branch; legacy transitional overload typechecks |
| 19 (sister) | `server/services/workflowEngineService.ts:2962` | PRESERVED | Sister-branch; legacy transitional overload typechecks |

---

### Grep Gate Output

#### Pattern 1 — `taskService\.createTask\([^{]`
```
rg -n "taskService\.createTask\([^{]" --glob '!server/services/taskService.ts' --glob '!server/services/__tests__/**' -- server/ shared/
```

Output:
```
server/services/deliveryService.ts:242:    const task = await taskService.createTask(
server/services/scheduledTaskService.ts:649:      const task = await taskService.createTask(
server/routes/workflowRuns.ts:71:    const task = await taskService.createTask(
server/routes/portal.ts:656:      const task = await taskService.createTask(
server/routes/portal.ts:681:      const task = await taskService.createTask(
server/routes/tasks.ts:46:    const item = await taskService.createTask(
server/routes/githubWebhook.ts:176:          await taskService.createTask(
server/routes/githubWebhook.ts:230:        await taskService.createTask(
server/services/skillExecutor.ts:3393:    const item = await taskService.createTask(
server/services/skillExecutor.ts:3638:      const item = await taskService.createTask(
server/services/skillExecutor.ts:4411:      const task = await taskService.createTask(
server/services/skillExecutor.ts:5455:    const task = await taskService.createTask(
server/services/subaccountOnboardingService.ts:230:    const onboardingTask = await taskService.createTask(
server/services/systemIncidentService.ts:290:      const task = await taskService.createTask(
server/services/workflowEngineService.ts:2716:        const childTask = await taskService.createTask(run.organisationId, targetId, {
server/services/workflowEngineService.ts:2962:    const replayTask = await taskService.createTask(
server/services/workflowRunStartSkillService.ts:60:  const task = await taskService.createTask(
```

**Notes on Pattern 1:**
- All lines EXCEPT the two `workflowEngineService.ts` lines use `createTask(\n      {` (brace on next line) — correctly migrated to canonical `(input, tx)` form.
- `workflowEngineService.ts:2716` — sister-branch legacy 4-arg call, preserved per spec. Typechecks via transitional overload.
- `workflowEngineService.ts:2962` — sister-branch legacy 4-arg call, preserved per spec. Typechecks via transitional overload.

#### Pattern 2 — `\bcreateTask\([^{]`
```
rg -n "\bcreateTask\([^{]" --glob '!server/services/taskService.ts' --glob '!server/services/__tests__/**' -- server/ shared/
```

Output: Same as Pattern 1 (all matches are `taskService.createTask` — no unrelated `createTask` functions found).

**Annotation:** All non-`workflowEngineService.ts` matches are confirmed routes to `taskService.createTask` with the new canonical form (brace on next line). No false positives from unrelated functions named `createTask`.

---

### G1 Gate Results

```
npx vitest run server/services/__tests__/taskService.createTask.regression.test.ts
  ✓ 4 tests passed

npx tsc --noEmit -p server/tsconfig.json
  PASSED (0 errors)

npm run lint
  PASSED (0 errors, 894 warnings — pre-existing)
```

---

## C10 — O2 runbook + O5 branch-protection record — DONE

**Date:** 2026-05-11
**Branch:** claude/review-preprod-spec-CmHez

### O2 — Migration 0240 phased swap runbook

**File created:** `docs/runbooks/migration-0240-phased-swap.md`

Runbook covers (per spec §6.2):
- Trigger condition: table size past ~10M rows OR write-latency p99 on `conversations` exceeds 100-300ms.
- Two-step migration strategy: `CREATE UNIQUE INDEX CONCURRENTLY` (no table lock) followed by `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE USING INDEX` + `DROP CONSTRAINT` in a single transaction.
- Rollback plan for each step (interrupted concurrent build, mid-transaction failure, post-migration reversal).
- Operator command sequence with placeholder table/column names and progress-monitoring queries.

**doc-sync.md check:** `docs/doc-sync.md` has no runbook section and no trigger row for runbooks — no entry required.

### O5 — Branch protection (operator action)

**Status:** Pending operator action

Branch protection on `main` must be applied before merge-ready signoff. The operator should:
1. Capture current required-check names from a recent ready-to-merge PR (`gh api repos/<owner>/<repo>/branches/main/protection`).
2. Apply branch protection rules via GitHub UI or `gh api` per spec §6.5:
   - Require pull request before merging.
   - Require status checks to pass before merging (names from step 1: lint + typecheck, grep-invariants gate, portable-framework tests — use live names from the PR Checks tab).
   - Require branches to be up to date before merging.
   - Do not allow bypassing the above settings.
3. Paste the `gh api repos/<owner>/<repo>/branches/main/protection` output here to satisfy spec §9 acceptance item 6-c.

Per spec §6.5: O5 is recommended to be applied during the merge-ready phase to avoid unnecessarily restricting in-progress build commits.

**Evidence:** [operator pastes `gh api` output here before merge-ready]

### G1 Gate Results

```
npm run lint
  PASSED (docs-only chunk — no typecheck or vitest required)
```

---

## DEC-1 through DEC-4 resolutions (spec §0.4 — re-stated for §9 acceptance #6a)

Re-stated from spec §0.4. **No in-build deviations from any of the four locked decisions.** Each was implemented as the spec directed; the `spec-conformance` audit on 2026-05-10 confirmed every code path matches the locked resolution.

- **DEC-1 — Support read scoping shape: subaccount-required path.** All five support read endpoints moved under `/api/subaccounts/:subaccountId/support/...` (verified via `server/index.ts:473` + the three `Router({ mergeParams: true })` declarations in `server/routes/support/`). No sibling org-listing endpoints introduced.
- **DEC-2 — Webhook attribution shape (W3): per-org URL path token.** New URL is `POST /api/webhooks/teamwork/:orgWebhookToken`; `connectorConfigService.findByWebhookToken` filters on `connector_type='teamwork' AND status='active' AND webhook_token=$1` (the locked three-filter conjunction). Token stored on shared `connector_configs.webhook_token uuid NULL` with partial UNIQUE `WHERE webhook_token IS NOT NULL`.
- **DEC-3 — Migration 0240 phased swap: deferred to post-launch + ship runbook now.** No code change. Runbook landed at `docs/runbooks/migration-0240-phased-swap.md` covering trigger condition, two-step `CREATE UNIQUE INDEX CONCURRENTLY` migration, rollback plan, operator command sequence.
- **DEC-4 — `taskService.createTask` signature: caller-supplied `tx`.** Compile-time enforced via the canonical overload `createTask(input: CreateTaskInput, tx: OrgScopedTx)`; the transitional 4-arg overload is `@deprecated`, throws at runtime, and is grep-gated to be unreachable from any in-scope caller. Sister-branch sites at `workflowEngineService.ts:2716` / `:2962` preserved untouched per §0.2.

---

## T1 grep-gate output (spec §3.1 acceptance — route inventory check)

Run on 2026-05-10 against the integration branch. All four patterns return zero in-scope matches; the only matches are intentional 404-assertion tests under `__tests__/` which are excluded by the spec's scope rule.

```bash
# String-literal callers (single + double quoted) of the legacy unscoped paths.
rg -n "['\"]/api/support/(tickets|drafts|inboxes)" \
  --glob '!docs/**' --glob '!tasks/**' --glob '!*.md' \
  --glob '!server/routes/support/**' \
  -- server/ client/src/ shared/
# Output: only matches under server/routes/support/__tests__/supportRouteScoping.test.ts
#   asserting legacy paths return 404 (intentional, per spec §3.1 scope-out).

# Template-literal callers.
rg -n "\`/api/support/(tickets|drafts|inboxes)" \
  --glob '!docs/**' --glob '!tasks/**' --glob '!*.md' \
  --glob '!server/routes/support/**' \
  -- server/ client/src/ shared/
# Output: empty.

# URL-builder helpers (apiUrl etc.) that interpolate the support segment.
rg -n "apiUrl\(['\"]/support/(tickets|drafts|inboxes)" \
  --glob '!docs/**' --glob '!tasks/**' --glob '!*.md' \
  -- server/ client/src/ shared/
# Output: empty.

# Legacy unscoped mount check.
rg -n "app\.use\(['\"]\/api\/support['\"]" -- server/
# Output: empty (line 473 is the new subaccount-scoped mount).
```

Client call-site verification (the eleven sites named in plan-time builder contract item 3) — all rewritten to `/api/subaccounts/${subaccountId}/support/...`:

```
client/src/pages/integrations/SupportDeskSetupPage.tsx:25      api.get(`/api/subaccounts/${subaccountId}/support/inboxes`)
client/src/pages/support/TicketsListPage.tsx:51,65,74           api.get(`/api/subaccounts/${subaccountId}/support/tickets…`)
client/src/pages/support/DraftReviewQueue.tsx:37,73,87,101      api.get/post(`/api/subaccounts/${subaccountId}/support/drafts…`)
client/src/pages/support/InboxConfigPage.tsx:104,272            api.patch/get(`/api/subaccounts/${subaccountId}/support/inboxes…`)
client/src/pages/support/TicketDetailPage.tsx:71                api.get(`/api/subaccounts/${subaccountId}/support/tickets/${id}`)
```

(Internal React-Router `<Link to="/support/...">` matches are page-navigation routes, not API calls — out of scope for this gate.)

---

## Spec-conformance audit (2026-05-10)

Run by `spec-conformance` agent, full-spec scope. All 14 implementation items (W1, W2, W3, T1, T2, T3, S1, S2, V1, V2, O1, O2, O3, O4, O5) verified against `spec.md`.

- **PASS:** W1, W2 (Slack + Teamwork), W3 (route shape, migrations 0318+0319, persistent dedup, TTL prune job), T1, T2, T3, S1, S2, V1, V2, O1, O2 (runbook), O3, O4.
- **MECHANICAL_GAP fixed in-session:** progress.md DEC-1..4 re-statement (this section); progress.md T1 grep-gate paste (above section).
- **OUT_OF_SCOPE:** O5 (operator action — applied at merge-ready).

`npx tsc --noEmit -p server/tsconfig.json` clean. `npm run lint` clean (0 errors, 903 warnings — pre-existing). Sister-branch scope-out gate: zero diff in §0.2 forbidden paths (`server/middleware/*`, `workflowEngineService.ts`, `workflowRunService.ts`, `agentExecutionService.ts`, `agentRuns` schema).

Audit log: `tasks/review-logs/spec-conformance-log-pre-test-hardening-2026-05-10T21-01-31Z.md`.

---

## Post-spec tightening (chatgpt-pr-review Round 8 F1 — 2026-05-11)

**Spec deviation (operator-approved):** `scripts/lib/prod-db-guard.ts::assertDevTargetOrThrow` switched from blocklist (`NODE_ENV === 'production'` throws) to allowlist (`NODE_ENV !== 'development'` throws). Also explicitly fails when `DATABASE_URL` is unset.

**Why:** spec §6.3 was permissive — `NODE_ENV=staging`/`test`/`integration`/`undefined` would pass the primary guard and rely entirely on the secondary host denylist (supabase/neon/render/rds.amazonaws/pooler.). chatgpt-pr-review Round 8 F1 flagged that this allows a CI runner with `NODE_ENV=test` and a real DB URL not matching the host denylist to silently pass the destructive script. The script is operator-run only (no CI invocations — verified via grep across `.github/workflows`, `scripts/`, `package.json`), so tightening to allowlist has no compatibility cost and materially reduces blast radius.

**Tests added (`scripts/lib/__tests__/prodDbGuard.test.ts`):**
- NODE_ENV=staging → throw on primary guard
- NODE_ENV=test → throw on primary guard
- NODE_ENV=integration → throw on primary guard
- NODE_ENV=undefined → throw on primary guard
- NODE_ENV=development AND DATABASE_URL unset → throw on DATABASE_URL guard

All 14 prodDbGuard tests pass.

**Spec impact:** Spec §6.3 line 347 still describes the previous blocklist posture. This is an in-build deviation per the operator's approval; the spec text is left unchanged (locked status preserved) and the actual implementation supersedes. Next spec revision should update §6.3 to match.
