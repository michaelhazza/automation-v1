# Dev brief — fix integration CI test failures

**Date:** 2026-04-30
**Branch to create:** `claude/integration-tests-fix-2026-04-30` (off `main` after PR #239 merges)
**Source PR for context:** #239 (`claude/vitest-migration-2026-04-29`)
**Goal:** flip the `integration tests` CI job from `continue-on-error: true` → `false` by fixing every test that fails when run with `NODE_ENV=integration` against a real Postgres.

---

## Table of contents

1. Why this exists
2. Failure inventory — 24 failures across 14 files
   - Category A — Missing seed data (FK constraint violations)
   - Category B — Test isolation / state leak (`incidentIngestor` module)
   - Category C — Module-level lifecycle / file-load errors
3. Fix strategy
   - Phase 1 — Build the integration fixture seeder
   - Phase 2 — Fix Category B (incidentIngestor state isolation)
   - Phase 3 — Fix Category C (TI-005 lifecycle refactor)
   - Phase 4 — Fix Category A residue
   - Phase 5 — Flip the gate
4. Done criteria
5. Out of scope
6. Risk register
7. Estimated effort
8. Recommended execution

---

## 1. Why this exists

PR #239 added a second CI job (`integration tests`) that runs the full vitest suite with `NODE_ENV=integration`. This un-skips ~36 `*.integration.test.ts` cases gated on `process.env.NODE_ENV === 'integration'`. Without this work the job is purely informational — `continue-on-error: true` lets it fail without blocking merges. **This brief makes the integration job load-bearing.**

Latest failing run: https://github.com/michaelhazza/automation-v1/actions/runs/25145466996/job/73704235380

Result: `Test Files 14 failed | 267 passed (281)` / `Tests 24 failed | 4565 passed (4589)`.

---

## 2. Failure inventory — 24 failures across 14 files

### Category A — Missing seed data (FK constraint violations)

The integration job migrates a fresh DB (`automation_os_test`) but **does not seed the canonical fixture organisations / users / agents**. Tests reach for hardcoded UUIDs like `00000000-0000-0000-0000-000000000001` that don't exist.

Concrete error pattern:
```
PostgresError: insert or update on table "tasks" violates foreign key constraint
  "workspace_items_organisation_id_organisations_id_fk"
detail: Key (organisation_id)=(00000000-0000-0000-0000-000000000001)
        is not present in table "organisations"
```

Affected files (counts = test failures):

| File | Failures | Notes |
|---|---|---|
| [server/services/systemMonitor/triage/__tests__/triageDurability.integration.test.ts](../../../server/services/systemMonitor/triage/__tests__/triageDurability.integration.test.ts) | 5 | All 5 `step N` tests fail at `seedIncident()` — needs org/agent fixture |
| [server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts](../../../server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts) | 3 | `seedAutomationAndDefinition` → org FK violation |
| [server/services/__tests__/reviewServiceIdempotency.test.ts](../../../server/services/__tests__/reviewServiceIdempotency.test.ts) | 3 | `actions` insert → org/agent FK |
| [server/services/__tests__/workspaceMemoryService.test.ts](../../../server/services/__tests__/workspaceMemoryService.test.ts) | 3 | `TypeError: Cannot read properties of undefined (reading 'id')` — anchor org lookup returns undefined; ALSO has the `await client.end()` bug |
| [server/services/__tests__/llmRouterLaelIntegration.test.ts](../../../server/services/__tests__/llmRouterLaelIntegration.test.ts) | 2 | `agent_runs` insert; ALSO trips `agent_runs_scope_check` constraint |
| [server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts](../../../server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts) | 2 | seed |
| [server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts](../../../server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts) | 1 | `Test timed out in 30000ms` — likely waiting for a job that never arrives because the DB has no pg-boss job tables seeded |
| [server/routes/__tests__/briefsArtefactsPagination.integration.test.ts](../../../server/routes/__tests__/briefsArtefactsPagination.integration.test.ts) | 1 | tasks insert FK |
| [server/routes/__tests__/conversationsRouteFollowUp.integration.test.ts](../../../server/routes/__tests__/conversationsRouteFollowUp.integration.test.ts) | 1 | tasks insert FK |

### Category B — Test isolation / state leak (`incidentIngestor` module)

The unit and integration variants of `incidentIngestor*` share a singleton in-memory store. Under `NODE_ENV=integration` **both** variants run in the same vitest worker; the integration variant mutates the store and the unit tests' assertions break.

Concrete error pattern:
```
AssertionError: should have 2 hits: expected 3 to be 2
AssertionError: after reset, known key should be miss: expected true to be false
```

Affected files:

| File | Failures | Notes |
|---|---|---|
| [server/services/__tests__/incidentIngestorIdempotency.test.ts](../../../server/services/__tests__/incidentIngestorIdempotency.test.ts) | 2 | unit test breaks because integration variant pollutes shared module state |
| [server/services/__tests__/incidentIngestorThrottle.test.ts](../../../server/services/__tests__/incidentIngestorThrottle.test.ts) | 1 | same |
| [server/services/__tests__/incidentIngestorThrottle.integration.test.ts](../../../server/services/__tests__/incidentIngestorThrottle.integration.test.ts) | file-load error | needs same isolation fix |

### Category C — Module-level lifecycle / file-load errors

These files use the legacy `if (!SKIP) { ... await import + await test() at column 0 ... }` pattern. They load successfully under `NODE_ENV=test` (skip path) but fail at module-load under `NODE_ENV=integration`. Already documented as TI-005 in [tasks/todo.md](../../../tasks/todo.md).

| File | Failures | Notes |
|---|---|---|
| [server/services/__tests__/rls.context-propagation.test.ts](../../../server/services/__tests__/rls.context-propagation.test.ts) | file-load | `Error: Failed query:` — likely a `set_config('app.organisation_id', ...)` call before fixture exists |
| [server/services/crmQueryPlanner/__tests__/integration.test.ts](../../../server/services/crmQueryPlanner/__tests__/integration.test.ts) | file-load | `await setupFixtures()` at column 0 — needs `beforeAll` |

---

## 3. Fix strategy

### Phase 1 — Build the integration fixture seeder

Create [scripts/seed-integration-fixtures.ts](../../../scripts/seed-integration-fixtures.ts). Invoked from CI **after** `npm run migrate` and **before** `npx vitest run` under the `integration_tests` job. Idempotent — safe to re-run.

Seeds the canonical UUIDs that integration tests assume:

| Entity | UUID | Purpose |
|---|---|---|
| `organisations` | `00000000-0000-0000-0000-000000000001` | Default test org (most tests) |
| `organisations` | `00000000-0000-0000-0000-00000000c0a0` | crmQueryPlanner test org |
| `subaccounts` | `00000000-0000-0000-0000-000000000010` | Default subaccount |
| `users` | `00000000-0000-0000-0000-000000000020` | Default test user |
| `agents` (slug=`configuration-assistant`) | one per org | `configAgentGuidelinesInjection` |
| `agents` (slug=`triage-runner`) | one per org | triageDurability seed |

Add to [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) inside the `integration_tests` job, after `Run migrations`:
```yaml
- name: Seed integration fixtures
  run: npx tsx scripts/seed-integration-fixtures.ts
```

**Source of UUID list:** grep the failing test files for `00000000-0000-0000-0000-` and the `seedIncident`/`seedFixture`/`seed*` helper definitions inside each. Don't invent UUIDs — extract what's already hardcoded.

### Phase 2 — Fix Category B (incidentIngestor state isolation)

Two options, pick one per file:

1. **Reset the singleton in `beforeEach`** — call `__resetForTest()` before every test. Simplest. Works only if the module exposes a reset hook (it does, per `incidentIngestorIdempotency.test.ts:17` already imports `__resetForTest`).
2. **Use `vi.isolateModulesAsync()` per test** — heavier but truly isolated.

Recommend (1). Each affected file should have:
```typescript
import { beforeEach } from 'vitest';
import { __resetForTest } from '../incidentIngestor.js';

beforeEach(() => __resetForTest());
```

Then re-run integration. The 3 failures in Category B should clear.

### Phase 3 — Fix Category C (TI-005 lifecycle refactor)

Convert each legacy if/else file to the canonical `describe.skipIf` + `beforeAll/afterAll` pattern:

**Before:**
```typescript
const SKIP = !process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration';
if (SKIP) {
  test.skip('foo (requires integration env)', () => {});
} else {
  const { db } = await import('../../db/index.js');
  await setupFixtures();
  try {
    await test('case 1', async () => { ... });
    await test('case 2', async () => { ... });
  } finally {
    await cleanupFixtures();
  }
}
```

**After:**
```typescript
const SKIP = !process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration';

describe.skipIf(SKIP)('rls.context-propagation', () => {
  let db: Awaited<typeof import('../../db/index.js')>['db'];

  beforeAll(async () => {
    ({ db } = await import('../../db/index.js'));
    await setupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await db.$client.end();  // closes pool — fixes the workspaceMemoryService bug
  });

  test('case 1', async () => { ... });
  test('case 2', async () => { ... });
});
```

Files to convert:
- `server/services/__tests__/rls.context-propagation.test.ts`
- `server/services/crmQueryPlanner/__tests__/integration.test.ts`
- `server/services/__tests__/workspaceMemoryService.test.ts` — also delete the broken `await client.end()` at module level
- `server/services/systemMonitor/triage/__tests__/triageDurability.integration.test.ts`
- `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts`
- Remove the `// guard-ignore-file: test-quality reason="..."` directives from the 2 files that have them (TI-005 in todo.md tracked these — work is complete after this brief).

Verify after this phase: `bash scripts/verify-test-quality.sh` — should still report `0 violations` (the guard-ignore removals matter).

### Phase 4 — Fix Category A residue

After Phases 1–3, re-run `integration tests` CI. Most Category A failures should now pass because the fixtures exist and the modules load cleanly. Whatever still fails is genuinely a test-vs-current-schema mismatch:

- `llmRouterLaelIntegration.test.ts` `agent_runs_scope_check` — read the constraint definition (most recent migration that touches `agent_runs`); update the test's INSERT to satisfy it. Likely missing `subaccountId` or `principalType`/`principalId` field.
- `dlqMonitorRoundTrip.integration.test.ts` timeout — needs `pg-boss` schema tables initialised. Either run `pg-boss`'s install in the seeder, OR have the test set up its own scoped queue.

### Phase 5 — Flip the gate

In [.github/workflows/ci.yml](../../../.github/workflows/ci.yml):
```yaml
  integration_tests:
    # ...
-   continue-on-error: true
+   # continue-on-error removed — integration tests now block merges
```

Push, verify both jobs green on a labeled PR, merge.

---

## 4. Done criteria

- [ ] CI `integration tests` job: 0 failures, all 36 integration cases run (`Tests N passed | 0 failed | 0 skipped` for the integration cases).
- [ ] CI `unit tests` job: still green; no regressions.
- [ ] `verify-test-quality.sh`: still 0 violations.
- [ ] `continue-on-error: true` removed from the integration job.
- [ ] TI-005 in [tasks/todo.md](../../../tasks/todo.md) marked DONE.
- [ ] [tasks/builds/integration-tests-fix/progress.md](../../../tasks/builds/integration-tests-fix/progress.md) created with closeout summary.

---

## 5. Out of scope

- Adding new integration tests — this brief fixes existing ones only.
- Refactoring the unit-test suite — only touch the 14 files listed above.
- Changing the Postgres image, DB name, or environment variables in [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) (beyond adding the seed step).
- Introducing a new test framework or test-isolation library.
- Fixing TI-001 (`build-code-graph-watcher.test.ts` parallel safety) — separate concern.

---

## 6. Risk register

| Risk | Mitigation |
|---|---|
| The seeder's UUIDs collide with existing data on a developer's local DB | Use `INSERT ... ON CONFLICT DO NOTHING`; the seeder is idempotent. The CI DB is fresh per run so no collision there. |
| Schema check constraints (`agent_runs_scope_check`) change again, breaking the test fixtures | Tests that hit constraint failures get explicit fixture builders — a single point of update when schema evolves. |
| `pg-boss` initialisation adds 5+ seconds to integration job | Acceptable — integration job is concurrent with `unit tests`, doesn't extend total wall-clock. |
| Some `await import('...')` calls inside `beforeAll` raise zod env errors at first call | Already fixed in PR #239 (env.ts accepts `'integration'`). Verify on first phase 3 file. |

---

## 7. Estimated effort

| Phase | Work | Time |
|---|---|---|
| 1 | Seeder + CI wiring | 60–90 min |
| 2 | incidentIngestor isolation | 15 min |
| 3 | TI-005 lifecycle refactor (5 files) | 60–90 min |
| 4 | Category A residue (constraint + pg-boss) | 30–60 min |
| 5 | Flip gate, verify, document | 15 min |
| **Total** | | **3–4 hours** |

---

## 8. Recommended execution

This brief is suitable for a single-session execution by Claude Code. Use [`superpowers:executing-plans`](../../../.claude/skills/) or follow the phases manually. Each phase has a clear stop condition (CI run result, gate check, or done-criteria checkbox). Commit at the end of each phase for a clean rollback path.
