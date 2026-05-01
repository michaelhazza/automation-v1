// ---------------------------------------------------------------------------
// Caller-assertion — runtime guard invoked at the top of every provider
// adapter's `call()` method to enforce spec §8.5:
//
//   Provider adapters may only be invoked from `llmRouter.routeCall()`.
//   Direct adapter calls from job/service code bypass the ledger and create
//   the "dark LLM call" pattern this spec is designed to eliminate.
//
// The static gate `scripts/gates/verify-no-direct-adapter-calls.sh`
// prevents the pattern from being introduced at build time. This assert
// closes the remaining hole — code paths reached via dynamic imports,
// generated code, or mis-configured test harnesses fail LOUD at runtime
// instead of silently producing dark calls.
//
// Exempt callers:
//   - `server/services/llmRouter.ts`        — the router itself
//   - `server/services/providers/*.ts`      — intra-provider fallback
//   - `*.test.ts` / `*.test.tsx`            — unit tests legitimately stub
//                                             adapter calls (NODE_ENV='test')
// ---------------------------------------------------------------------------

const ROUTER_FRAME_PATTERN = /server[/\\]services[/\\]llmRouter\./;

export function assertCalledFromRouter(): void {
  // In test mode, adapters are legitimately called directly — every adapter
  // test harness stubs fetch and pokes `adapter.call()` directly. The static
  // gate's whitelist already permits `*.test.ts`, so we mirror it here.
  if (process.env.NODE_ENV === 'test') return;

  const stack = new Error().stack ?? '';
  const frames = stack.split('\n');

  // Only the router may call provider adapters. All provider-to-provider
  // fallback is orchestrated by the router's own providerLoop — there is no
  // intra-provider path that bypasses the router. Checking only for the router
  // frame avoids the previous bug where the adapter's own frame (always present
  // in the stack) matched PROVIDER_FRAME_PATTERN, making the guard a no-op.
  const hasRouterFrame = frames.some((f) => ROUTER_FRAME_PATTERN.test(f));

  if (!hasRouterFrame) {
    throw {
      statusCode: 500,
      code: 'ADAPTER_DIRECT_CALL',
      message:
        'Provider adapters may only be called from llmRouter.routeCall(). ' +
        'Use the router so the call shows up in llm_requests and cost_aggregates.',
    };
  }
}
