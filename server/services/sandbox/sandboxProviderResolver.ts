/**
 * sandboxProviderResolver.ts — Provider resolver for the sandbox execution primitive.
 *
 * Spec B §8.2: Reads SANDBOX_PROVIDER env var, applies environment-specific hard
 * guards, and resolves to the registered constructor. Exposes a registration seam
 * consumed by C9 (e2bSandbox) and C10 (localDockerSandbox) at their module-init
 * time. The inline provider is wired directly here (§8.2.3).
 *
 * Hard guards:
 *  - `inline`       — requires NODE_ENV=test AND SANDBOX_ALLOW_INLINE=1
 *  - `local_docker` — rejected when NODE_ENV=production
 *  - `e2b`          — accepted in any environment
 *
 * If a provider name is not registered in the in-memory registry, a fail-fast
 * FailureError is thrown to convert a missing-import bootstrap bug into a
 * boot-time crash rather than a silent latent failure.
 */

import { FailureError } from '../../../shared/iee/failure.js';
import { InlineSandbox } from './inlineSandbox.js';
import type { SandboxProviderName, SandboxRunTaskInput, SandboxRunTaskOutput } from '../../../shared/types/sandbox.js';

export interface SandboxExecutionService {
  runTask(input: SandboxRunTaskInput): Promise<SandboxRunTaskOutput>;
  terminate(providerSandboxId: string): Promise<void>;
}

type ProviderConstructor = () => SandboxExecutionService;

const registry = new Map<SandboxProviderName, ProviderConstructor>();

/**
 * Register a provider constructor under the given name. Called at module-init
 * time by C9 (e2bSandbox) and C10 (localDockerSandbox). The inline provider is
 * wired directly by this module and does not use this seam.
 */
export function registerSandboxProvider(
  name: SandboxProviderName,
  constructor: ProviderConstructor,
): void {
  registry.set(name, constructor);
}

/**
 * Resolve and instantiate the configured sandbox provider.
 *
 * Reads SANDBOX_PROVIDER and NODE_ENV from process.env. Throws FailureError at
 * construction time for any mis-configuration so a mis-deployed service never starts.
 */
export function resolveSandboxProvider(): SandboxExecutionService {
  const rawProvider = process.env['SANDBOX_PROVIDER'];
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';

  if (!rawProvider) {
    throw new FailureError({
      failureReason: 'sandbox_provider_unavailable',
      failureDetail: 'SANDBOX_PROVIDER env var is not set',
    });
  }

  const VALID_PROVIDERS: SandboxProviderName[] = ['e2b', 'local_docker', 'inline'];
  if (!VALID_PROVIDERS.includes(rawProvider as SandboxProviderName)) {
    throw new FailureError({
      failureReason: 'sandbox_provider_unavailable',
      failureDetail: `SANDBOX_PROVIDER="${rawProvider}" is not a valid provider — must be one of: e2b, local_docker, inline`,
    });
  }

  const providerName = rawProvider as SandboxProviderName;

  // Hard guard: local_docker is rejected in production
  if (providerName === 'local_docker' && nodeEnv === 'production') {
    throw new FailureError({
      failureReason: 'sandbox_provider_unavailable',
      failureDetail:
        'SANDBOX_PROVIDER=local_docker is not permitted when NODE_ENV=production — use e2b for production deployments',
    });
  }

  // Hard guard: inline is only permitted in test with SANDBOX_ALLOW_INLINE=1
  if (providerName === 'inline') {
    const allowInline = process.env['SANDBOX_ALLOW_INLINE'];
    if (nodeEnv !== 'test' || allowInline !== '1') {
      throw new FailureError({
        failureReason: 'sandbox_provider_unavailable',
        failureDetail:
          'inlineSandbox is test-only — set NODE_ENV=test and SANDBOX_ALLOW_INLINE=1 to use',
      });
    }
    return new InlineSandbox();
  }

  const constructor = registry.get(providerName);
  if (!constructor) {
    throw new FailureError({
      failureReason: 'sandbox_provider_unavailable',
      failureDetail: `sandbox provider ${providerName} not registered — application bootstrap must import the provider module before resolveSandboxProvider() runs`,
    });
  }

  return constructor();
}
