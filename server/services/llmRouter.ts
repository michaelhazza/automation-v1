import { TASK_TYPES, SOURCE_TYPES, EXECUTION_PHASES, ROUTING_MODES } from '../db/schema/index.js';
import type { TaskType, SourceType, ExecutionPhase, RoutingMode } from '../db/schema/index.js';
export { shouldEmitLaelLifecycle } from './llmRouterLaelPure.js';
export type { LLMCallContext, RouterCallParams } from './llmRouter/types.js';

// ---------------------------------------------------------------------------
// LLM Router — the financial chokepoint for every LLM call in the platform.
//
// Every callAnthropic() becomes routeCall() with a context object.
// The router owns: attribution, cost, budget enforcement, idempotency, audit.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Idempotency key — pure derivation lives in `llmRouterIdempotencyPure.ts`
// so the v1:-prefixed contract (deferred-items brief §2) can be pinned by
// a pure test without booting the env-dependent router module.
// Includes provider + model: different provider/model = distinct financial event
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Provider timeout guard — pure implementation lives in llmRouterTimeoutPure
// so tests can exercise it without booting the env-dependent router module.
// Imported AND re-exported: the router uses it locally on every call and
// callers of routeCall may need the typed error for their own classification.
// ---------------------------------------------------------------------------

export { ProviderTimeoutError, callWithTimeout } from './llmRouterTimeoutPure.js';

// ---------------------------------------------------------------------------
// Main router — drop-in replacement for callAnthropic()
// ---------------------------------------------------------------------------

export { routeCall } from './llmRouter/routeCall.js';

// ---------------------------------------------------------------------------
// Re-export types for callers
// ---------------------------------------------------------------------------
export type { TaskType, SourceType, ExecutionPhase, RoutingMode };
export { TASK_TYPES, SOURCE_TYPES, EXECUTION_PHASES, ROUTING_MODES };

// ---------------------------------------------------------------------------
// Token counting — re-exported from anthropicAdapter so callers import from
// one place (llmRouter) instead of reaching into the provider layer directly.
// ---------------------------------------------------------------------------
export { countTokens, SUPPORTED_MODEL_FAMILIES } from './providers/anthropicAdapter.js';
export type { SupportedModelFamily } from './providers/anthropicAdapter.js';
