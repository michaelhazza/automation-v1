// Best-effort observability, not reliable capture. Network failures are silently
// dropped. Do not use this as a completeness signal in monitoring.
//
// Severity model: `critical` = operator-actionable. Not `important`, not `frequent`.
// Overuse turns `/api/client-errors` into noise.
export function logAndSwallow(context: string, options?: { severity?: 'critical' | 'noisy' }): (err: unknown) => void {
  return (err: unknown) => {
    // Always emit at console.debug regardless of NODE_ENV so production browsers
    // can still surface swallowed errors when the console is opened. Swallow
    // semantics are unchanged — visibility is the only delta. ChatGPT-Round-1
    // Finding 5.
    const severity = options?.severity ?? 'noisy';
    console.debug(`[silent-catch] ${context}:`, err);
    if (severity === 'critical') {
      fetch('/api/client-errors', {
        method: 'POST',
        body: JSON.stringify({
          context,
          message: err instanceof Error ? err.message : String(err),
          componentStack: err instanceof Error ? err.stack : undefined,
        }),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => { /* swallow */ });
    }
  };
}

export function surfaceAndRethrow(toast: (msg: string) => void, message: string): (err: unknown) => never {
  return (err: unknown) => {
    toast(message);
    throw err;
  };
}
