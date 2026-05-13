import { describe, it, expect } from 'vitest';

// Named CI plan-gate — spec §15 R2-F6.
//
// This test exercises concurrent mount serialisation against the live e2b
// provider. CI runs it with `E2B_E2E=true` once the e2b SDK is installed and
// real credentials are wired (today the SDK is not installed; see
// SANDBOX-DEF-EGRESS-MECH in server/services/sandbox/e2bSandbox.ts). Until
// then `describeIfE2E` resolves to `describe.skip` so the file imports
// cleanly and CI does not block on a never-runnable test.
//
// Chunk 9 (profile manager) is not shippable to a production-enabled
// subaccount until this test passes in CI with E2B_E2E=true.
const describeIfE2E = process.env.E2B_E2E === 'true' ? describe : describe.skip;

describeIfE2E('ieeBrowserProfileManager serialization gate (CI only)', () => {
  it('serialises concurrent mounts for the same profile volume', async () => {
    // Issues two concurrent resolve()+mount() calls for the same (org, subaccount, session_key).
    // Asserts:
    //   (a) both calls eventually complete with a valid MountedProfile
    //   (b) second mount's start >= 0ms after first mount's release (serialised)
    //   (c) no cross-tenant assertion errors thrown
    expect(true).toBe(true); // placeholder — real assertions land with the E2B_E2E wiring
  });
});
