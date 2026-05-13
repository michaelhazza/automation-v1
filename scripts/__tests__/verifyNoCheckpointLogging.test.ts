/**
 * verifyNoCheckpointLogging.test.ts
 *
 * Unit tests for the allow-list filter logic used by
 * scripts/gates/verify-no-checkpoint-logging.sh.
 *
 * The gate greps for `(logger.*|console.*)` calls that mention `checkpoint_payload`
 * in TS files and pipes output through `grep -vE ALLOWLIST_PATTERN` to suppress
 * approved locations. These tests verify the allow-list regex is correct:
 * approved paths are suppressed; unapproved paths are surfaced.
 *
 * Run via: npx vitest run scripts/__tests__/verifyNoCheckpointLogging.test.ts
 */

import { expect, test } from 'vitest';

// Mirror of the ALLOWLIST_PATTERN constant in the gate script.
const ALLOWLIST_PATTERN =
  /server\/db\/schema\/operatorRuns\.ts|server\/services\/agentRunPayloadEncryptionService\.ts|scripts\/gates\/verify-no-checkpoint-logging\.sh|__tests__\/|\.test\.ts|^docs\/|^tasks\/|scripts\/__tests__\/|\.sh:|\.md:/;

/**
 * Returns true when the grep output line refers to an APPROVED location
 * (i.e. the line should be suppressed by the allow-list filter).
 */
function isAllowed(relativePath: string): boolean {
  return ALLOWLIST_PATTERN.test(relativePath);
}

// --- Schema declaration (always allowed) ---

test('operatorRuns.ts (schema column declaration) is allowed', () => {
  const path =
    "server/db/schema/operatorRuns.ts:80:  checkpoint_payload: jsonb('checkpoint_payload')";
  expect(isAllowed(path), 'schema declaration must be in the allow-list').toBeTruthy();
});

// --- Encryption helper docstring (always allowed) ---

test('agentRunPayloadEncryptionService.ts (encryption helper) is allowed', () => {
  const path =
    "server/services/agentRunPayloadEncryptionService.ts:5: * Encrypts and decrypts checkpoint_payload contents at rest.";
  expect(
    isAllowed(path),
    'encryption helper docstring must be in the allow-list',
  ).toBeTruthy();
});

// --- The gate script itself ---

test('the gate script file is allowed', () => {
  const path =
    "scripts/gates/verify-no-checkpoint-logging.sh:47:    -E '(logger\\.[a-z]+|console\\.[a-z]+).*checkpoint_payload'";
  expect(isAllowed(path), 'gate script must be in the allow-list').toBeTruthy();
});

// --- Test fixtures ---

test('file inside __tests__/ dir is allowed', () => {
  const path =
    "server/services/__tests__/operatorCostWriter.test.ts:42:logger.info('checkpoint_payload size: ...')";
  expect(isAllowed(path), '__tests__/ directories must be in the allow-list').toBeTruthy();
});

test('.test.ts file is allowed', () => {
  const path = "server/services/someModule.test.ts:12:console.log('checkpoint_payload')";
  expect(isAllowed(path), '.test.ts files must be in the allow-list').toBeTruthy();
});

test('scripts/__tests__/ file is allowed', () => {
  const path =
    "scripts/__tests__/verifyNoCheckpointLogging.test.ts:35:logger.error('checkpoint_payload')";
  expect(isAllowed(path), 'scripts/__tests__/ must be in the allow-list').toBeTruthy();
});

// --- Documentation paths ---

test('docs/ path is allowed', () => {
  const path =
    "docs/superpowers/specs/2026-05-12-operator-backend-spec.md:400:logger.info(checkpoint_payload)";
  expect(isAllowed(path), 'docs/ paths must be in the allow-list').toBeTruthy();
});

test('tasks/ path is allowed', () => {
  const path =
    "tasks/builds/operator-backend/plan.md:870:logger.debug('checkpoint_payload')";
  expect(isAllowed(path), 'tasks/ paths must be in the allow-list').toBeTruthy();
});

// --- File-extension allow-list ---

test('.sh file (gate script) is allowed via .sh: marker', () => {
  const path =
    "scripts/gates/some-other-gate.sh:10:    -E '(logger\\.[a-z]+).*checkpoint_payload'";
  expect(isAllowed(path), '.sh files must be in the allow-list').toBeTruthy();
});

test('.md file (documentation) is allowed via .md: marker', () => {
  const path =
    "docs/runbooks/some-runbook.md:5:console.log(checkpoint_payload)";
  expect(isAllowed(path), '.md files must be in the allow-list').toBeTruthy();
});

// --- Unapproved locations (must NOT be allowed) ---

test('server/services/ regular .ts file is NOT allowed', () => {
  const path =
    "server/services/operatorCostWriter.ts:55:logger.info('writing checkpoint_payload')";
  expect(
    isAllowed(path),
    'production service file logger calls must NOT be in the allow-list',
  ).toBeFalsy();
});

test('server/jobs/ handler is NOT allowed', () => {
  const path =
    "server/jobs/operatorSessionProgressedHandler.ts:120:console.error('checkpoint_payload error', err)";
  expect(
    isAllowed(path),
    'production handler file console calls must NOT be in the allow-list',
  ).toBeFalsy();
});

test('client/src/ file is NOT allowed', () => {
  const path =
    "client/src/pages/operate/RunTracePage.tsx:42:console.log('checkpoint_payload', payload)";
  expect(
    isAllowed(path),
    'client production code console calls must NOT be in the allow-list',
  ).toBeFalsy();
});

test('shared/types/ file is NOT allowed', () => {
  const path =
    "shared/types/operatorBackendEvents.ts:55:logger.warn('checkpoint_payload mismatch')";
  expect(
    isAllowed(path),
    'shared types file logger calls must NOT be in the allow-list',
  ).toBeFalsy();
});
