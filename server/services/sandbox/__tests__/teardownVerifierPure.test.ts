import { describe, it, expect } from 'vitest';
import { verifyTeardown } from '../teardownVerifierPure.js';

describe('verifyTeardown', () => {
  it('returns verified:true when health-check returns false (sandbox not alive)', async () => {
    const result = await verifyTeardown({
      providerSandboxId: 'sbx-test-1',
      postTerminateHealthCheck: async () => false,
    });
    expect(result.verified).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns verified:false with health_check_returned_true when sandbox still alive', async () => {
    const result = await verifyTeardown({
      providerSandboxId: 'sbx-test-2',
      postTerminateHealthCheck: async () => true,
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('health_check_returned_true');
  });

  it('returns verified:false with health_check_threw when health-check throws', async () => {
    const result = await verifyTeardown({
      providerSandboxId: 'sbx-test-3',
      postTerminateHealthCheck: async () => {
        throw new Error('network error');
      },
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('health_check_threw');
  });
});
