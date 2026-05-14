# ADR-0010: SandboxExecutionService — vendor-adapter pattern, interface boundary, and no-silent-fallback posture

**Status:** accepted
**Date:** 2026-05-11
**Domain:** sandbox execution, security, provider isolation
**Supersedes:** _(none)_
**Superseded by:** _(none)_

## Context

Spec B (`tasks/builds/sandbox-isolation/spec.md`) introduces Tier 4 untrusted code execution to the platform. Customer-uploaded data parsing, LLM-emitted scripts over customer data, and customer-derived transformation logic previously ran in the IEE worker process — a direct security gap (brief §2.2 invariant). Multiple adapters (`iee_dev`, future OpenClaw) need untrusted execution capability; the provider (e2b, local Docker, in-process) needed to be swappable without touching adapter code.

Three specific decisions hardened during Phase 1 spec review (4 iterations, 3 ChatGPT rounds, 30 findings):

1. **What interface shape?** Extend `ExecutionBackend`, or introduce a new `SandboxExecutionService` primitive?
2. **How to swap providers?** Feature flag, DI container, env-var resolver?
3. **What happens when no provider is configured or inline is requested outside test?** Silent fallback to in-process execution, or fail-fast?

## Decision

**We will introduce `SandboxExecutionService` as a distinct interface below the `ExecutionBackend` adapter contract, resolved from a single `SANDBOX_PROVIDER` env var, with no silent fallback to in-process execution.**

Concretely:

- `server/services/sandboxExecutionService.ts` is the single entry point. Adapters call `sandboxExecutionService.runTask(input)` — they never call provider SDKs, `child_process`, or any in-process execution primitive directly.
- `server/services/sandbox/sandboxProviderResolver.ts` reads `SANDBOX_PROVIDER` at construction time and fails fast if the env var is misconfigured, if `local_docker` is requested in `NODE_ENV=production`, or if `inline` is requested outside `NODE_ENV=test` + `SANDBOX_ALLOW_INLINE=1`. The service never starts in an ambiguous state.
- Three concrete providers implement the interface: `e2bSandbox` (production), `localDockerSandbox` (local dev), `inlineSandbox` (test-only). All share one interface; swapping providers is a config change with no adapter-code impact.
- `inlineSandbox` is test-only by hard guard — the provider resolver throws if it is selected outside the test harness, closing the "silent fallback to in-process execution" hole that brief §2.2 / §6 invariants forbid.

## Consequences

- **Positive:**
  - Multiple adapters (`iee_dev`, future OpenClaw) share one sandbox primitive — no per-adapter re-implementation of the execution, harvest, cost-ledger, or observability contracts.
  - Swapping the external compute vendor requires a single env-var change; no adapter code changes.
  - The `verify-sandbox-classification` CI gate can enforce the "all untrusted code goes through `SandboxExecutionService.runTask`" invariant with a single grep target per adapter.
  - Fail-fast at boot surfaces misconfigurations (wrong provider for the environment, missing API key) before the first request, not at runtime under a user's request.
  - The test-only `inlineSandbox` gives the harvest pipeline and pure-function tests a calleable primitive without spinning up Docker or an external API.
- **Negative:**
  - Adapters that previously executed directly must be explicitly rewired (C13 chunk — `iee_dev` hard-cut migration).
  - The `inline` provider's hard guard means test environments that forget `SANDBOX_ALLOW_INLINE=1` will fail to boot rather than fall through silently. This is a setup cost, not a recurring cost.
- **Neutral:**
  - `SandboxExecutionService` does not replace `ExecutionBackend` — they are parallel contracts at different layers. The separation is a cost on first understanding but a gain on long-term extension.

## Alternatives considered

- **Extend `ExecutionBackend` with a `runSandboxedTask()` method** — rejected. Would force every adapter to implement or stub the method, couple provider-swap to adapter-swap, and grow the `ExecutionBackend` surface with a concern that only sandbox-consuming adapters need.
- **DI container for provider injection** — rejected. Adds a framework dependency and indirection for a single env-var decision. The env-var resolver is three `if/else` branches and a `throw`; it is simple enough to read in seconds.
- **Feature flag for "run sandboxed sometimes, worker other times"** — rejected. Brief §2.16 explicitly forbids this: "there is no 'small script' exception that lets customer-derived code back into the worker." The `commit_and_revert` rollout model backs the hard-cut instead.
- **Silent fallback to in-process execution when no provider is configured** — rejected. This is the exact behaviour brief §2.2 and §6 invariant 2 forbid. A silent fallback would pass tests but ship an isolation gap to production.

## When to revisit

- When a second external compute vendor is evaluated (new provider → new concrete implementation behind the same interface, no contract change needed).
- If `SandboxExecutionService.runTask` becomes a bottleneck for long-lived sessions (OpenClaw adapter may need a session-pooling variant — that would be a new method on the interface, not a replacement of the current shape).
- If the `inline` provider guard causes persistent DX friction and a lightweight integration-test provider (e.g., a network-isolated Docker image) proves cheaper to maintain than `SANDBOX_ALLOW_INLINE` bookkeeping.

## References

- Spec: `tasks/builds/sandbox-isolation/spec.md` (§8.1, §8.2, §8.2.3, §18.2, §18.3, §25.2)
- Brief: `tasks/builds/sandbox-isolation/brief.md` (§2.2, §2.16, invariant 2)
- Related ADR: `0005-risk-class-split-rollout-pattern.md` (commit-and-revert rollout precedent)
- Gate: `scripts/gates/verify-sandbox-classification.sh`
- Gate: `scripts/gates/verify-no-inline-sandbox-outside-test.sh`
