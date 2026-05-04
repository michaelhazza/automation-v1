# Test fixtures inventory

Shared test utilities used by ≥2 test files in the unit layer. Generated
during Phase 1 of the Vitest migration; updated whenever a new shared
fixture is introduced.

## server/services/__tests__/fixtures/loadFixtures.ts

Returns a stable `Fixtures` object: 1 org, 2 subaccounts, 1 agent, 2 links,
1 task, 1 user, 3 review-code methodology output samples.

Importers:
- server/services/__tests__/agentExecution.smoke.test.ts
- server/services/__tests__/llmRouterLaelIntegration.test.ts
- server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts

## server/services/__tests__/fixtures/fakeWebhookReceiver.ts

Boots a localhost HTTP server on an OS-assigned port (parallel-safe by
construction). Records every request. Supports overrides for status,
latency, drop-connection.

Importers:
- server/services/__tests__/fixtures/__tests__/fakeWebhookReceiver.test.ts

## server/services/__tests__/fixtures/fakeProviderAdapter.ts

Produces an LLM provider adapter with response / error / latency overrides.
Registers via `registerProviderAdapter` with a `restore()`-in-finally
contract. R-M1 suspect: global registry mutation.

Importers:
- server/services/__tests__/fixtures/__tests__/fakeProviderAdapter.test.ts
