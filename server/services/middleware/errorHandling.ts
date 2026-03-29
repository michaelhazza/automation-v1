// ---------------------------------------------------------------------------
// Error Handling — classifies and optionally retries tool execution errors
// ---------------------------------------------------------------------------

interface ErrorClassification {
  type: 'transient' | 'permanent';
  message: string;
  retryable: boolean;
}

const TRANSIENT_PATTERNS = [
  /timeout/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /rate.?limit/i,
  /503/,
  /502/,
  /429/,
  /network/i,
];

export function classifyError(err: unknown): ErrorClassification {
  const message = err instanceof Error ? err.message : String(err);

  const isTransient = TRANSIENT_PATTERNS.some(pattern => pattern.test(message));

  return {
    type: isTransient ? 'transient' : 'permanent',
    message,
    retryable: isTransient,
  };
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 1,
  delayMs: number = 1000
): Promise<{ result?: T; error?: ErrorClassification; retried: boolean }> {
  try {
    const result = await fn();
    return { result, retried: false };
  } catch (err) {
    const classification = classifyError(err);

    if (classification.retryable && maxRetries > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      try {
        const result = await fn();
        return { result, retried: true };
      } catch (retryErr) {
        const retryClassification = classifyError(retryErr);
        return { error: retryClassification, retried: true };
      }
    }

    return { error: classification, retried: false };
  }
}
