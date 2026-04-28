import type { LLMProviderAdapter } from './types.js';
import anthropicAdapter from './anthropicAdapter.js';
import openaiAdapter from './openaiAdapter.js';
import geminiAdapter from './geminiAdapter.js';
import openrouterAdapter from './openrouterAdapter.js';

// ---------------------------------------------------------------------------
// Provider registry — the single source of truth for available adapters.
// To add a new provider: implement LLMProviderAdapter, import it, register it.
// ---------------------------------------------------------------------------

const registry: Record<string, LLMProviderAdapter> = {
  anthropic:   anthropicAdapter,
  openai:      openaiAdapter,
  gemini:      geminiAdapter,
  openrouter:  openrouterAdapter,
};

export function getProviderAdapter(provider: string): LLMProviderAdapter {
  const adapter = registry[provider];
  if (!adapter) {
    throw {
      statusCode: 400,
      code: 'PROVIDER_NOT_SUPPORTED',
      provider,
      message: `Provider '${provider}' is not supported. Supported: ${Object.keys(registry).join(', ')}`,
    };
  }
  return adapter;
}

export function getSupportedProviders(): string[] {
  return Object.keys(registry);
}

/**
 * Test-only register/restore API. Registers `adapter` at `key`, captures the
 * pre-registration state at that key on the FIRST register, and returns a
 * `restore()` function that puts the registry back to the original
 * (pre-test) state once the LAST active registration restores. `restore()`
 * is idempotent (calling it twice is a no-op the second time) AND
 * order-independent: parallel tests can restore in any order without
 * stomping each other's state.
 *
 * Spec: docs/superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md
 * §1.2. The contract — order-independent restore via per-key registration
 * stack — is what makes same-key sequential AND parallel test registrations
 * non-interfering. Tests MUST always call `restore()` in `finally`, never
 * just on the happy path.
 *
 * **Why stack semantics, not closure-captured prior state.** A closure that
 * captures the prior adapter at register time only works under strict LIFO
 * restore order. Parallel tests can interleave so that an inner restore
 * fires AFTER the outer restore — at which point a "restore my prior" reads
 * the wrong prior. The per-key registration stack (and `originalStates[key]`
 * snapshot taken on the first register) makes the final state deterministic
 * regardless of restore order: the last active restore reads the original
 * snapshot; intermediate restores remove their entry from the stack and
 * re-install whichever entry is now on top.
 *
 * Production code MUST NOT call this — it exists for the fake provider
 * adapter harness under `__tests__/fixtures/`.
 */
interface RegistrationEntry {
  token: symbol;
  adapter: LLMProviderAdapter;
}
interface OriginalState {
  wasPresent: boolean;
  adapter?: LLMProviderAdapter;
}
const activeRegistrations: Map<string, RegistrationEntry[]> = new Map();
const originalStates: Map<string, OriginalState> = new Map();

export function registerProviderAdapter(
  key: string,
  adapter: LLMProviderAdapter,
): () => void {
  // First register at this key captures the original state (the registry
  // shape before any test touched it). Subsequent registers append to the
  // stack without re-capturing.
  if (!activeRegistrations.has(key)) {
    const wasPresent = Object.prototype.hasOwnProperty.call(registry, key);
    originalStates.set(key, {
      wasPresent,
      adapter: wasPresent ? registry[key] : undefined,
    });
    activeRegistrations.set(key, []);
  }

  const token = Symbol(`provider-registration-${key}`);
  const stack = activeRegistrations.get(key)!;
  stack.push({ token, adapter });
  registry[key] = adapter;

  let restored = false;
  return function restore() {
    if (restored) return; // idempotent — second call is a no-op
    restored = true;

    const currentStack = activeRegistrations.get(key);
    if (!currentStack) return; // defensive — already cleared

    // Remove THIS registration's entry from the stack by token (NOT by
    // position — a parallel restore may have removed an entry deeper in
    // the stack first).
    const idx = currentStack.findIndex((entry) => entry.token === token);
    if (idx === -1) return;
    currentStack.splice(idx, 1);

    if (currentStack.length === 0) {
      // Last active registration — restore the captured original state.
      const original = originalStates.get(key);
      activeRegistrations.delete(key);
      originalStates.delete(key);
      if (original?.wasPresent && original.adapter !== undefined) {
        registry[key] = original.adapter;
      } else {
        delete registry[key];
      }
    } else {
      // Other registrations are still active — re-install whichever entry
      // is now on top of the stack as the currently-active adapter.
      registry[key] = currentStack[currentStack.length - 1].adapter;
    }
  };
}
