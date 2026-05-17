/**
 * teardownVerifierPure.ts — post-terminate health-check verifier (§7.7 REQ #55).
 *
 * Pure: no SDK imports, no DB access. The health-check callback is injected by
 * the caller so this file has zero provider dependencies.
 *
 * §8.31 residual risk: operator paging is via logger.error at the caller site,
 * not a durable queue. If the logger sink is down at teardown time, the
 * unverified signal is lost. Accepted: durable paging is out of scope for V1.
 */

export interface TeardownVerificationInput {
  providerSandboxId: string;
  postTerminateHealthCheck: () => Promise<boolean>; // returns true if sandbox still alive
}

export interface TeardownVerificationResult {
  verified: boolean;
  reason?: 'health_check_returned_true' | 'health_check_threw';
}

export async function verifyTeardown(
  input: TeardownVerificationInput,
): Promise<TeardownVerificationResult> {
  try {
    const stillAlive = await input.postTerminateHealthCheck();
    if (stillAlive) {
      return { verified: false, reason: 'health_check_returned_true' };
    }
    return { verified: true };
  } catch {
    return { verified: false, reason: 'health_check_threw' };
  }
}
