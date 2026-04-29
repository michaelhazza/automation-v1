/**
 * Pure tests for AutomationStepError shape (REQ §1.2 Gap B / spec
 * 2026-04-28-pre-test-integration-harness-spec.md §1.6).
 *
 * Round-trips the missing-connection error path and asserts:
 *   1. type='configuration', status='missing_connection',
 *      context.automationId / context.missingKeys populated
 *   2. existing non-configuration errors keep status/context undefined
 *   3. type-narrowing on `type === 'configuration'` compiles
 *   4. status-vocabulary discipline — production status values are listed in
 *      KNOWN_AUTOMATION_STEP_ERROR_STATUSES
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/invokeAutomationStepErrorShapePure.test.ts
 */

import { expect, test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  KNOWN_AUTOMATION_STEP_ERROR_STATUSES,
  type AutomationStepError,
} from '../../lib/workflow/types.js';

console.log('');
console.log('AutomationStepError shape (§1.6):');

// ─── Case 1: missing-connection path populates structured fields ────────────
test('case 1: missing-connection error has type=configuration + status + context', () => {
  // Mirrors the error construction in invokeAutomationStepService.ts when
  // resolveRequiredConnections returns { ok: false, missing: [...] }.
  const automationId = 'aut-test-123';
  const missingKeys = ['ghl_v2', 'slack_token'];
  const err: AutomationStepError = {
    code: 'automation_missing_connection',
    type: 'configuration',
    message: `Automation '${automationId}' is missing required connections: ${missingKeys.join(', ')}`,
    retryable: false,
    status: 'missing_connection',
    context: { automationId, missingKeys },
  };

  assert.equal(err.type, 'configuration');
  assert.equal(err.status, 'missing_connection');
  assert.equal((err.context as { automationId: string }).automationId, automationId);
  assert.deepStrictEqual(
    (err.context as { missingKeys: string[] }).missingKeys,
    missingKeys,
  );
});

// ─── Case 2: existing non-configuration errors keep status/context absent ───
test('case 2: existing execution-class error has no status/context fields', () => {
  // A pre-existing call site that constructs an `'execution'` error keeps the
  // legacy shape — adding the optional fields must not change behaviour for
  // non-configuration errors.
  const err: AutomationStepError = {
    code: 'automation_not_found',
    type: 'execution',
    message: `Automation 'aut-missing' not found.`,
    retryable: false,
  };
  assert.equal(err.status, undefined);
  assert.equal(err.context, undefined);
});

// ─── Case 3: TypeScript narrowing on type==='configuration' compiles ────────
test('case 3: type-narrowing on configuration variant compiles', () => {
  // This case exists as a compile-time check — if the union widening regresses,
  // tsc fails before this file even runs. The runtime assertion is incidental.
  const err: AutomationStepError = {
    code: 'automation_missing_connection',
    type: 'configuration',
    message: 'm',
    retryable: false,
    status: 'missing_connection',
    context: { automationId: 'a', missingKeys: ['k'] },
  };
  if (err.type === 'configuration') {
    // Within this branch, err is still AutomationStepError (no narrowing
    // beyond the discriminant). context access is allowed because it is
    // optional on the parent shape.
    assert.ok(err.context);
  }
});

// ─── Case 4: vocabulary discipline — production status values are tracked ───
test('case 4: every status string written by production code is listed in KNOWN_AUTOMATION_STEP_ERROR_STATUSES', () => {
  // The protection: scan the production service file as TEXT (defeating
  // every form of type narrowing — TS literals, type-cast assertions, and
  // implicit literal-type inference) and extract every literal `status: '...'`
  // value the file constructs. Each captured string MUST appear in the
  // closed vocabulary. If a future PR adds a new status to the service path
  // without updating `KNOWN_AUTOMATION_STEP_ERROR_STATUSES`, this assertion
  // catches it — even if a contributor casts `as string` to bypass the type
  // narrowing the production type currently provides.
  //
  // Why source-file scanning rather than calling the real service path:
  // the production path is async and requires DB + connection-mapping
  // service; this test is intentionally pure (no DB). Source-file scanning
  // is brittle by nature, but the patterns the regex matches are the
  // narrowly-scoped construction shape the service uses. A future refactor
  // that moves the literal into a constant should update this regex
  // (treat the test as test infra, not test logic).
  const here = dirname(fileURLToPath(import.meta.url));
  const serviceText = readFileSync(
    resolve(here, '../invokeAutomationStepService.ts'),
    'utf8',
  );
  // Two-step extraction: first isolate `const VAR: AutomationStepError = { ... };`
  // blocks, then scan each block for `status: '...'`. This avoids over-capture of
  // unrelated `status:` values in the same file (e.g. function-return shapes like
  // `{ status: 'ok' }`, `{ status: 'error' }`) that would generate false failures.
  // The outer regex relies on `};` being the FIRST `};` after the opening `{` —
  // safe because nested objects inside AutomationStepError literals close with `},`
  // (comma, not semicolon).
  const errorBlockRe = /\bconst\s+\w+\s*:\s*AutomationStepError\s*=\s*\{([\s\S]*?)\};/g;
  const statusRe = /\bstatus:\s*'([^']+)'/g;
  const capturedStatuses: string[] = [];
  for (const blockMatch of serviceText.matchAll(errorBlockRe)) {
    const blockContent = blockMatch[1];
    for (const statusMatch of blockContent.matchAll(statusRe)) {
      capturedStatuses.push(statusMatch[1]);
    }
  }
  assert.ok(
    capturedStatuses.length > 0,
    'expected at least one status: \'...\' construction in the service file (regex drifted?)',
  );
  for (const value of capturedStatuses) {
    // Cast to readonly string[] so the .includes() check is a runtime,
    // not a type-narrowed, comparison. A bare-string status that escapes
    // the type system (via a future `as string` cast or a type loosening
    // back to `status?: string`) would surface here.
    assert.ok(
      (KNOWN_AUTOMATION_STEP_ERROR_STATUSES as readonly string[]).includes(value),
      `production status '${value}' (captured from invokeAutomationStepService.ts) is not listed in KNOWN_AUTOMATION_STEP_ERROR_STATUSES`,
    );
  }
});

console.log('');
console.log('');
