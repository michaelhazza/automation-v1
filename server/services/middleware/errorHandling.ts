// ---------------------------------------------------------------------------
// Error Handling — classifies and optionally retries tool execution errors
// ---------------------------------------------------------------------------

import { getActionDefinition, type RetryPolicy } from '../../config/actionRegistry.js';

// ---------------------------------------------------------------------------
// Error categories — mapped from retry policy strings in the action registry
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | 'timeout'
  | 'network_error'
  | 'rate_limit'
  | 'db_error'
  | 'execution_failure'
  | 'validation_error'
  | 'auth_error'
  | 'permission_failure'
  | 'not_found'
  | 'unknown';

interface ErrorClassification {
  type: 'transient' | 'permanent';
  category: ErrorCategory;
  message: string;
  retryable: boolean;
}

// Pattern → category mapping for automatic classification
const ERROR_PATTERNS: Array<{ pattern: RegExp; category: ErrorCategory }> = [
  { pattern: /timeout|ETIMEDOUT/i,             category: 'timeout' },
  { pattern: /ECONNREFUSED|ECONNRESET|network/i, category: 'network_error' },
  { pattern: /rate.?limit|429/,                category: 'rate_limit' },
  { pattern: /503|502/,                        category: 'network_error' },
  { pattern: /validation|invalid|missing.*required|is required/i, category: 'validation_error' },
  { pattern: /auth|unauthorized|forbidden|401|403/i, category: 'auth_error' },
  { pattern: /permission/i,                    category: 'permission_failure' },
  { pattern: /not.?found|404/i,               category: 'not_found' },
  { pattern: /database|db_error|pg|sql/i,     category: 'db_error' },
];

// Categories that are inherently transient (retryable by default)
const TRANSIENT_CATEGORIES = new Set<ErrorCategory>([
  'timeout',
  'network_error',
  'rate_limit',
  'db_error',
]);

/**
 * Classify an error into a category and determine if it's retryable.
 *
 * If an actionType is provided, the classification respects the action's
 * retryPolicy.retryOn / doNotRetryOn lists from the action registry.
 */
export function classifyError(err: unknown, actionType?: string): ErrorClassification {
  const message = err instanceof Error ? err.message : String(err);

  // Determine category from error message patterns
  let category: ErrorCategory = 'unknown';
  for (const { pattern, category: cat } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      category = cat;
      break;
    }
  }

  // Default retryable decision based on category
  let retryable = TRANSIENT_CATEGORIES.has(category);

  // If we know the action type, use its retry policy for precise classification
  if (actionType) {
    const def = getActionDefinition(actionType);
    if (def) {
      const { retryOn, doNotRetryOn } = def.retryPolicy;

      if (doNotRetryOn.includes(category)) {
        retryable = false;
      } else if (retryOn.includes(category)) {
        retryable = true;
      }
      // If category not in either list, keep the default
    }
  }

  return {
    type: retryable ? 'transient' : 'permanent',
    category,
    message,
    retryable,
  };
}

/**
 * Execute a function with retry logic, optionally using the action registry's
 * retry policy for the given action type.
 *
 * If actionType is provided, uses the registry's maxRetries and strategy.
 * Otherwise falls back to the provided defaults.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options?: {
    actionType?: string;
    maxRetries?: number;
    delayMs?: number;
  }
): Promise<{ result?: T; error?: ErrorClassification; retried: boolean }> {
  const actionType = options?.actionType;

  // Resolve retry config from action registry or fallback to defaults
  let maxRetries = options?.maxRetries ?? 1;
  let strategy: RetryPolicy['strategy'] = 'fixed';
  let baseDelay = options?.delayMs ?? 1000;

  if (actionType) {
    const def = getActionDefinition(actionType);
    if (def) {
      maxRetries = def.retryPolicy.maxRetries;
      strategy = def.retryPolicy.strategy;
    }
  }

  if (strategy === 'none') maxRetries = 0;

  let lastError: ErrorClassification | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retried: attempt > 0 };
    } catch (err) {
      lastError = classifyError(err, actionType);

      // Don't retry if the error is classified as non-retryable
      if (!lastError.retryable || attempt >= maxRetries) {
        return { error: lastError, retried: attempt > 0 };
      }

      // Calculate delay based on strategy
      const delay = strategy === 'exponential_backoff'
        ? baseDelay * Math.pow(2, attempt)
        : baseDelay;

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return { error: lastError, retried: maxRetries > 0 };
}
