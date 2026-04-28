import type { LogLine } from '../services/systemMonitor/logBuffer.js';

interface LogEntryShape {
  timestamp?: string;
  level?: string;
  event?: string;
  correlationId?: string;
  [key: string]: unknown;
}

/**
 * Returns a LogLine ready for appendLogLine, or null if the entry has no
 * usable correlationId. Pure — no DB, no async, no logger import.
 */
export function buildLogLineForBuffer(entry: LogEntryShape): LogLine | null {
  const cid = entry.correlationId;
  if (typeof cid !== 'string' || cid.length === 0) return null;

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'timestamp' || key === 'level' || key === 'event' || key === 'correlationId') {
      continue;
    }
    meta[key] = value;
  }

  let ts: Date;
  try {
    ts = entry.timestamp ? new Date(entry.timestamp) : new Date();
    if (isNaN(ts.getTime())) ts = new Date();
  } catch {
    ts = new Date();
  }

  return {
    ts,
    level: typeof entry.level === 'string' ? entry.level : 'info',
    event: typeof entry.event === 'string' ? entry.event : 'unknown_event',
    correlationId: cid,
    meta,
  };
}
