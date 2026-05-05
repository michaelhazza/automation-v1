// Process-local rolling log buffer for correlation-ID-scoped log retrieval.
// Populated by the logger adapter when a correlationId is present.
// Not persisted — cleared on process restart. Phase 2.0 scope.

const MAX_LINES = 1000;
const MAX_BYTES = 500_000; // ~500 KB rolling cap

export interface LogLine {
  ts: Date;
  level: string;
  event: string;
  correlationId: string;
  meta: Record<string, unknown>;
}

const buffer: LogLine[] = [];
let totalBytes = 0;

export function appendLogLine(line: LogLine): void {
  const lineBytes = JSON.stringify(line).length;
  buffer.push(line);
  totalBytes += lineBytes;

  // Evict oldest entries when either cap is exceeded.
  while (buffer.length > MAX_LINES || totalBytes > MAX_BYTES) {
    const evicted = buffer.shift();
    if (evicted) totalBytes -= JSON.stringify(evicted).length;
  }
}

/** Returns up to `limit` lines for a given correlationId. */
export function readLinesForCorrelationId(correlationId: string, limit: number): LogLine[] {
  const matched = buffer.filter(l => l.correlationId === correlationId);
  return matched.slice(-limit);
}

/** Resets buffer — for testing only. */
export function _resetBufferForTest(): void {
  buffer.length = 0;
  totalBytes = 0;
}
