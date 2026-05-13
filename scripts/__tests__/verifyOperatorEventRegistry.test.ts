/**
 * verifyOperatorEventRegistry.test.ts
 *
 * Unit tests for the allow-list filter logic used by
 * scripts/gates/verify-operator-event-registry.sh.
 *
 * The gate greps for naked 'operator-session.' string literals in TS files
 * and pipes output through `grep -vE ALLOWLIST_PATTERN` to suppress
 * approved locations. These tests verify the allow-list regex is correct:
 * approved paths are suppressed; unapproved paths are surfaced.
 *
 * Run via: npx tsx scripts/__tests__/verifyOperatorEventRegistry.test.ts
 */

import { expect, test } from 'vitest';

// Mirror of the ALLOWLIST_PATTERN constant in the gate script.
const ALLOWLIST_PATTERN =
  /shared\/types\/operatorBackendEvents\.ts|__tests__\/|\.test\.ts|^docs\/|^tasks\/|scripts\/__tests__\/|\.sh:|\.md:/;

/**
 * Returns true when the grep output line refers to an APPROVED location
 * (i.e. the line should be suppressed by the allow-list filter).
 */
function isAllowed(relativePath: string): boolean {
  return ALLOWLIST_PATTERN.test(relativePath);
}

// --- Registry file itself ---

test('operatorBackendEvents.ts (registry) is allowed', () => {
  const path =
    "shared/types/operatorBackendEvents.ts:20:  'operator-session.dispatched'";
  expect(isAllowed(path), 'registry file must be in the allow-list').toBeTruthy();
});

// --- Test fixtures ---

test('file inside __tests__/ dir is allowed', () => {
  const path =
    "server/services/__tests__/operatorRuntimeErrors.test.ts:44:const event = 'operator-session.dispatched'";
  expect(isAllowed(path), '__tests__/ directory files must be in the allow-list').toBeTruthy();
});

test('.test.ts file is allowed', () => {
  const path = "server/services/someModule.test.ts:12:'operator-session.progressed'";
  expect(isAllowed(path), '.test.ts files must be in the allow-list').toBeTruthy();
});

test('scripts/__tests__/ file is allowed', () => {
  const path =
    "scripts/__tests__/verifyOperatorEventRegistry.test.ts:10:'operator-session.dispatched'";
  expect(isAllowed(path), 'scripts/__tests__/ must be in the allow-list').toBeTruthy();
});

// --- Documentation paths ---

test('docs/ path is allowed', () => {
  const path =
    "docs/superpowers/specs/2026-05-12-operator-backend-spec.md:400:'operator-session.dispatched'";
  expect(isAllowed(path), 'docs/ paths must be in the allow-list').toBeTruthy();
});

test('tasks/ path is allowed', () => {
  const path = "tasks/builds/operator-backend/plan.md:174:'operator-session.dispatched'";
  expect(isAllowed(path), 'tasks/ paths must be in the allow-list').toBeTruthy();
});

test('.sh script files are allowed (gate scripts themselves)', () => {
  const path =
    "scripts/gates/verify-operator-event-registry.sh:30:grep -rn 'operator-session\\.'";
  expect(isAllowed(path), 'gate .sh scripts must be in the allow-list').toBeTruthy();
});

test('.md files are allowed', () => {
  const path = "docs/runbooks/operator-session-account-suspension.md:5:operator-session.";
  expect(isAllowed(path), '.md files must be in the allow-list').toBeTruthy();
});

// --- Violations (must NOT be allowed) ---

test('adapter file hardcoding event literal is a violation', () => {
  const path =
    "server/services/executionBackends/operatorManagedBackend.ts:88:emitEvent('operator-session.dispatched', payload)";
  expect(
    isAllowed(path),
    'adapter files hardcoding event literals must NOT be allowed',
  ).toBeFalsy();
});

test('service file outside registry hardcoding event literal is a violation', () => {
  const path =
    "server/services/operatorChainSchedulerService.ts:42:'operator-session.task_paused_chain_failure'";
  expect(isAllowed(path), 'service files must NOT be allowed').toBeFalsy();
});

test('route handler hardcoding event literal is a violation', () => {
  const path =
    "server/routes/operatorTasks.ts:88:if (event === 'operator-session.chain_link_failed') {";
  expect(isAllowed(path), 'route files must NOT be allowed').toBeFalsy();
});

test('client file hardcoding event literal is a violation', () => {
  const path =
    "client/src/hooks/useOperatorTask.ts:30:socket.on('operator-session.progressed', ...)";
  expect(isAllowed(path), 'client/ files must NOT be allowed').toBeFalsy();
});
