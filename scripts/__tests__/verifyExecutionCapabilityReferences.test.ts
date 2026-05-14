/**
 * verifyExecutionCapabilityReferences.test.ts
 *
 * Unit tests for the allow-list filter logic used by
 * scripts/gates/verify-execution-capability-references.sh.
 *
 * The gate greps for 'long_running' | 'session_identity' literals in TS
 * files and pipes output through `grep -vE ALLOWLIST_PATTERN` to suppress
 * approved locations. These tests verify the allow-list regex is correct:
 * approved paths are suppressed; unapproved paths are surfaced.
 *
 * Run via: npx tsx scripts/__tests__/verifyExecutionCapabilityReferences.test.ts
 */

import { expect, test } from 'vitest';

// Mirror of the ALLOWLIST_PATTERN constant in the gate script.
const ALLOWLIST_PATTERN =
  /server\/services\/executionBackends\/|__tests__\/|\.test\.ts|^docs\/|^tasks\/|scripts\/__tests__\//;

/**
 * Returns true when the grep output line refers to an APPROVED location
 * (i.e. the line should be suppressed by the allow-list filter).
 */
function isAllowed(relativePath: string): boolean {
  return ALLOWLIST_PATTERN.test(relativePath);
}

// --- Canonical definition site ---

test('types.ts (canonical definition) is allowed', () => {
  const path = 'server/services/executionBackends/types.ts:95:  | \'long_running\'';
  expect(isAllowed(path), 'canonical types.ts must be in the allow-list').toBeTruthy();
});

// --- Adapter declaration files ---

test('adapter file in executionBackends/ is allowed', () => {
  const path = "server/services/executionBackends/operatorManagedBackend.ts:12:  capabilities: ['long_running', 'session_identity'],";
  expect(isAllowed(path), 'adapter declaration must be in the allow-list').toBeTruthy();
});

test('registry.ts in executionBackends/ is allowed', () => {
  const path = "server/services/executionBackends/registry.ts:50:// forward-compat 'long_running' note";
  expect(isAllowed(path), 'executionBackends/registry.ts must be in the allow-list').toBeTruthy();
});

// --- Test fixtures ---

test('file inside __tests__/ dir is allowed', () => {
  const path = "server/services/executionBackends/__tests__/operatorManagedBackendPure.test.ts:44:capabilities: ['long_running']";
  expect(isAllowed(path), '__tests__/ directory files must be in the allow-list').toBeTruthy();
});

test('.test.ts file is allowed', () => {
  const path = "server/services/someModule.test.ts:12:capabilities: ['session_identity']";
  expect(isAllowed(path), '.test.ts files must be in the allow-list').toBeTruthy();
});

test('scripts/__tests__/ file is allowed', () => {
  const path = "scripts/__tests__/verifyExecutionCapabilityReferences.test.ts:10:'long_running'";
  expect(isAllowed(path), 'scripts/__tests__/ must be in the allow-list').toBeTruthy();
});

// --- Documentation paths ---

test('docs/ path is allowed', () => {
  const path = "docs/superpowers/specs/2026-05-12-operator-backend-spec.md:400:'long_running'";
  expect(isAllowed(path), 'docs/ paths must be in the allow-list').toBeTruthy();
});

test('tasks/ path is allowed', () => {
  const path = "tasks/builds/operator-backend/plan.md:174:'long_running'";
  expect(isAllowed(path), 'tasks/ paths must be in the allow-list').toBeTruthy();
});

// --- Violations (must NOT be allowed) ---

test('route handler hardcoding capability literal is a violation', () => {
  const path = "server/routes/operatorTasks.ts:88:if (backend.capabilities.includes('long_running')) {";
  expect(isAllowed(path), 'route handler hardcoding capability literal must NOT be allowed').toBeFalsy();
});

test('service file outside executionBackends/ is a violation', () => {
  const path = "server/services/agentExecutionService.ts:120:capabilities: ['session_identity']";
  expect(isAllowed(path), 'service file outside executionBackends/ must NOT be allowed').toBeFalsy();
});

test('shared type file is a violation', () => {
  const path = "shared/types/operatorRuns.ts:45:'long_running'";
  expect(isAllowed(path), 'shared/ files must NOT be allowed').toBeFalsy();
});

test('client file is a violation', () => {
  const path = "client/src/hooks/useOperatorTask.ts:30:'session_identity'";
  expect(isAllowed(path), 'client/ files must NOT be allowed').toBeFalsy();
});
