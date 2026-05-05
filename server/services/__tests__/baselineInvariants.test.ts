/**
 * baselineInvariants.test.ts
 *
 * §10 hard invariants for the F3 baseline capture feature.
 *
 * Two categories:
 *  - Static grep checks (Invariants 1, 3, 5, 6) — no DB required
 *  - Pure state-machine assertions (Invariant 7) — no DB required
 *
 * Run via:
 *   npx vitest run server/services/__tests__/baselineInvariants.test.ts
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  canTransition,
  isTerminal,
  isRunnable,
} from '../baselineStateMachinePure.js';

// execSync on Windows requires an explicit shell — use the SHELL env var
// which Vitest inherits from the Git Bash launcher (C:\Program Files\Git\usr\bin\bash.exe).
const SHELL = process.env.SHELL;

// ── Invariant 1: Exactly one active baseline per sub-account ─────────────────

describe('Invariant 1: Exactly one active baseline per sub-account', () => {
  it('partial UNIQUE index exists in migration 0280', () => {
    const indexLine = execSync(
      'grep -n "subaccount_baselines_active_uniq" migrations/0280_subaccount_baselines.sql 2>/dev/null || true',
      { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
    );
    assert.ok(indexLine.trim().length > 0, 'subaccount_baselines_active_uniq must be defined in migration 0280');

    // Confirm the WHERE clause is present in the migration file (may be on a different line from the index name).
    const whereClause = execSync(
      "grep -n \"WHERE status <> 'reset'\" migrations/0280_subaccount_baselines.sql 2>/dev/null || true",
      { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
    );
    assert.ok(
      whereClause.trim().length > 0,
      "partial index must filter status <> 'reset'",
    );
  });

  it('RLS policy exists for subaccount_baselines in migration 0282', () => {
    const rls = execSync(
      'grep -c "subaccount_baselines_org_isolation" migrations/0282_baseline_rls_and_dictionary.sql 2>/dev/null || echo 0',
      { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
    );
    assert.ok(parseInt(rls.trim(), 10) > 0, 'RLS policy must exist for subaccount_baselines');
  });
});

// ── Invariant 3: Single-writer rule ──────────────────────────────────────────

describe('Invariant 3: Single-writer rule', () => {
  const SINGLE_WRITER_ALLOWED = [
    'server/services/captureBaselineService.ts',
    'server/services/subaccountOnboardingService.ts',
  ];

  it('SQL-level writes to subaccount_baselines are in allowed files only', () => {
    const violations = execSync(
      'grep -rEn "(INSERT INTO subaccount_baselines|UPDATE subaccount_baselines)" server --include="*.ts" --exclude-dir=__tests__ 2>/dev/null || true',
      { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
    );
    const violationLines = violations
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .filter((l) => !SINGLE_WRITER_ALLOWED.some((p) => l.startsWith(p)));
    assert.equal(violationLines.length, 0, `Single-writer SQL violation:\n${violationLines.join('\n')}`);
  });

  it('Drizzle-level writes to subaccountBaselines are in allowed files only (catches chained multiline calls)', () => {
    // Matches both inline `tx.update(subaccountBaselines)` and multiline chained
    // calls where `.update(subaccountBaselines)` appears on its own line.
    const violations = execSync(
      'grep -rEn "\\.(insert|update|delete)\\(subaccountBaselines" server --include="*.ts" --exclude-dir=__tests__ 2>/dev/null || true',
      { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
    );
    const violationLines = violations
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .filter((l) => !SINGLE_WRITER_ALLOWED.some((p) => l.startsWith(p)));
    assert.equal(violationLines.length, 0, `Single-writer Drizzle violation:\n${violationLines.join('\n')}`);
  });
});

// ── Invariant 5: Admin reset preserves history ───────────────────────────────

describe('Invariant 5: Admin reset preserves history', () => {
  it('adminReset method exists on captureBaselineService (structural)', () => {
    // DB-level assertion (both rows persist + correct versions) is in
    // captureBaselineIntegration.test.ts. Here we verify the exported shape
    // has not been accidentally removed. Importing captureBaselineService
    // directly triggers env validation (DB dependency), so we use grep.
    const hit = execSync(
      'grep -n "async adminReset" server/services/captureBaselineService.ts 2>/dev/null || true',
      { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
    );
    assert.ok(hit.trim().length > 0, 'captureBaselineService must have an adminReset method');
  });
});

// ── Invariant 6: No Date.now() in F3 capture path ───────────────────────────

describe('Invariant 6: DB-time invariant — no Date.now() in F3 capture path', () => {
  it('F3 service files and metric readers contain no Date.now() calls', () => {
    // Spec §10 invariant names: captureBaselineService.ts, baselineMetricReaders/, baselineReadinessService.ts.
    // Check individual files + the entire baselineMetricReaders/ directory.
    const candidateFiles = [
      'server/services/captureBaselineService.ts',
      'server/services/baselineReadinessService.ts',
      'server/services/baselineReadinessPure.ts',
      'server/services/baselineSubscriberService.ts',
      'server/services/baselineSubscriberPure.ts',
      'server/jobs/captureBaselineJob.ts',
      'server/jobs/evaluateAllPendingBaselines.ts',
    ];

    const existingFiles = candidateFiles.filter((f) => {
      try {
        execSync(`ls ${JSON.stringify(f)} 2>/dev/null`, { encoding: 'utf8', cwd: process.cwd(), shell: SHELL });
        return true;
      } catch {
        return false;
      }
    });

    // Check individual files
    if (existingFiles.length > 0) {
      const fileHits = execSync(
        `grep -En "Date\\.now\\(\\)" ${existingFiles.map((f) => JSON.stringify(f)).join(' ')} 2>/dev/null || true`,
        { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
      );
      const fileLines = fileHits.split('\n').filter((l) => l.trim().length > 0);
      assert.equal(fileLines.length, 0, `Date.now() found in F3 service files:\n${fileLines.join('\n')}`);
    }

    // Check baselineMetricReaders/ directory (spec §10 explicitly names it)
    const readerHits = execSync(
      'grep -rEn "Date\\.now\\(\\)" server/services/baselineMetricReaders --include="*.ts" 2>/dev/null || true',
      { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
    );
    const readerLines = readerHits.split('\n').filter((l) => l.trim().length > 0);
    assert.equal(readerLines.length, 0, `Date.now() found in baselineMetricReaders/:\n${readerLines.join('\n')}`);
  });
});

// ── Invariant 8: Subscriber + helper select non-reset rows only ──────────────

describe('Invariant 8: Subscriber + helper queries exclude reset rows', () => {
  // After admin reset, two rows exist for the same subaccount: a status='reset'
  // row at baseline_version=N and a status='pending' row at baseline_version=N+1.
  // Without an explicit `status <> 'reset'` filter, Postgres returns rows in
  // non-deterministic storage order — the subscriber/helper may pick the reset
  // row and silently mis-route. Static check guards against regression.
  it("baselineSubscriberService.onSyncCompleteEvaluateReadiness query filters status <> 'reset'", () => {
    const out = execSync(
      "grep -A 12 'onSyncCompleteEvaluateReadiness' server/services/baselineSubscriberService.ts 2>/dev/null || true",
      { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
    );
    assert.ok(
      /status\s*<>\s*'reset'/.test(out),
      "subscriber query MUST include `status <> 'reset'` to disambiguate post-admin-reset state",
    );
  });

  it("getBaselineForSubaccount uses getOrgScopedDb and orders by baseline_version DESC LIMIT 1", () => {
    const orgScoped = execSync(
      'grep -n "getOrgScopedDb" server/services/reportingAgent/baselineHelper.ts 2>/dev/null || true',
      { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
    );
    assert.ok(orgScoped.trim().length > 0, 'baselineHelper must use getOrgScopedDb (FORCE-RLS GUC)');

    const ordered = execSync(
      'grep -nE "orderBy\\(desc\\(subaccountBaselines\\.baselineVersion\\)\\)" server/services/reportingAgent/baselineHelper.ts 2>/dev/null || true',
      { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
    );
    assert.ok(ordered.trim().length > 0, 'baselineHelper must order by baselineVersion DESC for determinism');

    const limited = execSync(
      'grep -n "\\.limit(1)" server/services/reportingAgent/baselineHelper.ts 2>/dev/null || true',
      { encoding: 'utf8', cwd: process.cwd(), shell: SHELL },
    );
    assert.ok(limited.trim().length > 0, 'baselineHelper must limit(1) so the post-reset state returns the new baseline');
  });
});

// ── Invariant 7: next_attempt_at IS NOT NULL ↔ status = 'ready' ─────────────

describe("Invariant 7: next_attempt_at IS NOT NULL ↔ status = 'ready'", () => {
  it('only "ready" status should have next_attempt_at set — transition table is consistent', () => {
    // The invariant: next_attempt_at is set on the retry transition (→ ready),
    // cleared on every terminal transition (→ captured/failed/manual/reset).
    //
    // Static check: 'ready' is the ONLY status reachable from 'capturing'
    // via a retryable failure. Terminal statuses must not be runnable.

    // capturing → ready is the retry path (sets next_attempt_at).
    assert.ok(canTransition('capturing', 'ready'), 'capturing → ready must be allowed (retry path)');

    // Terminal statuses are not runnable — they never have next_attempt_at set.
    const terminalStatuses = ['captured', 'failed', 'reset'] as const;
    for (const s of terminalStatuses) {
      assert.ok(isTerminal(s), `${s} must be terminal`);
      assert.ok(!isRunnable(s), `${s} must not be runnable`);
    }

    // 'manual' is not hard-terminal (it can be reset) but is not runnable.
    // Either the state machine allows manual → reset, or manual is not marked terminal.
    assert.ok(
      canTransition('manual', 'reset') || !isTerminal('manual'),
      'manual is not a hard-terminal status',
    );

    // 'ready' is runnable (awaiting retry) and not terminal.
    assert.ok(isRunnable('ready'), 'ready must be runnable');
    assert.ok(!isTerminal('ready'), 'ready is not terminal');
  });
});
