// ---------------------------------------------------------------------------
// Structured worker logger. JSON one line per event.
// Spec §8.3 / §13.6.1.c — never logs secrets, full HTML, or full DATABASE_URL.
// ---------------------------------------------------------------------------

export interface LogContext {
  correlationId?: string;
  ieeRunId?: string;
  organisationId?: string;
  agentRunId?: string;
  workerInstanceId?: string;
}

let baseContext: LogContext = {};

export function setBaseLogContext(ctx: LogContext): void {
  baseContext = { ...baseContext, ...ctx };
}

function emit(level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...baseContext,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info:  (msg: string, fields?: Record<string, unknown>) => emit('info',  msg, fields),
  warn:  (msg: string, fields?: Record<string, unknown>) => emit('warn',  msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};

/** Centre-truncate a string to maxLen, preserving start and tail. Spec §5.3 / §8.3. */
export function truncateMiddle(s: string, maxLen: number): string {
  if (!s || s.length <= maxLen) return s;
  const half = Math.floor((maxLen - 5) / 2);
  return `${s.slice(0, half)}…(${s.length - 2 * half} chars)…${s.slice(-half)}`;
}

/** Truncate to maxLen with a single trailing marker. */
export function truncate(s: string, maxLen: number): string {
  if (!s || s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…[truncated]`;
}
