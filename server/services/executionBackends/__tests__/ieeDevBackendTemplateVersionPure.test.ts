/**
 * ieeDevBackendTemplateVersionPure.test.ts
 *
 * Tests for resolveTemplateVersion() in ieeDevBackend.ts.
 * Mocks fs.readFileSync and the templateVersionParserPure module so the
 * function is exercised in isolation.
 *
 * Spec B §18, §7.2, Chunk 6.
 *
 * Runnable via:
 *   npx vitest run server/services/executionBackends/__tests__/ieeDevBackendTemplateVersionPure.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FailureError } from '../../../../shared/iee/failure.js';

export {};

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('../../sandbox/templateVersionParserPure.js', () => ({
  parseCurrentVersion: vi.fn(),
}));

// Stub out all the heavy imports pulled in transitively by ieeDevBackend.
vi.mock('../_ieeShared.js', () => ({
  ieeRunCompletedPayloadSchema: {},
  IEE_COMPLETED_QUEUE: 'iee-run-completed',
  IEE_TERMINAL_STATE_TABLE: 'iee_runs',
  ieeDispatch: vi.fn(),
  ieeLoadTerminalState: vi.fn(),
  ieeFinalise: vi.fn(),
  ieeReconcile: vi.fn(),
  ieeCancel: vi.fn(),
}));

vi.mock('../ieeDevBackendPure.js', () => ({
  classifyExecutionClass: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Dynamic imports
// ---------------------------------------------------------------------------

const { readFileSync } = await import('node:fs');
const { parseCurrentVersion } = await import('../../sandbox/templateVersionParserPure.js');
const { resolveTemplateVersion } = await import('../ieeDevBackend.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveTemplateVersion', () => {
  const TEMPLATE_NAME = 'synthetos-sandbox';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env var between tests.
    delete process.env['SANDBOX_TEMPLATE_VERSION'];
  });

  afterEach(() => {
    delete process.env['SANDBOX_TEMPLATE_VERSION'];
  });

  it('Test 4: rejects unknown versions with FailureError', () => {
    // File not readable → falls back to env var with an unknown version.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (readFileSync as any).mockImplementation(() => { throw new Error('ENOENT'); });
    process.env['SANDBOX_TEMPLATE_VERSION'] = 'v9.9.9';

    expect(() => resolveTemplateVersion(TEMPLATE_NAME)).toThrow(FailureError);

    let caught: unknown;
    try {
      resolveTemplateVersion(TEMPLATE_NAME);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FailureError);
    const fe = caught as FailureError;
    expect(fe.failure.failureReason).toBe('sandbox_input_rejected');
  });

  it('Test 5: valid version from CURRENT_VERSION file is returned', () => {
    const fileContent = 'version=v1.0.0\ntemplate_resource_class=cpu-small\nmax_cost_cents_per_second=0.0001\nbase_image_digest=sha256:abc\ndeps_lockfile_hash=sha256:def\n';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (readFileSync as any).mockReturnValue(fileContent);
    vi.mocked(parseCurrentVersion).mockReturnValue({
      version: 'v1.0.0',
      template_resource_class: 'cpu-small',
      max_cost_cents_per_second: 0.0001,
      base_image_digest: 'sha256:abc',
      deps_lockfile_hash: 'sha256:def',
    });

    const result = resolveTemplateVersion(TEMPLATE_NAME);
    expect(result).toBe('v1.0.0');
  });
});
