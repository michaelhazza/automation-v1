import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Structured Logger — JSON-formatted logging with correlation IDs
//
// Provides consistent, parseable log output across all services.
// Each HTTP request gets a correlationId via middleware.
// Agent runs propagate their runId as the correlation context.
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  correlationId?: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function emit(entry: LogEntry): void {
  const output = JSON.stringify(entry);
  if (entry.level === 'error') {
    console.error(output);
  } else if (entry.level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug(event: string, data?: Record<string, unknown>): void {
    if (!shouldLog('debug')) return;
    emit({ timestamp: new Date().toISOString(), level: 'debug', event, ...data });
  },

  info(event: string, data?: Record<string, unknown>): void {
    if (!shouldLog('info')) return;
    emit({ timestamp: new Date().toISOString(), level: 'info', event, ...data });
  },

  warn(event: string, data?: Record<string, unknown>): void {
    if (!shouldLog('warn')) return;
    emit({ timestamp: new Date().toISOString(), level: 'warn', event, ...data });
  },

  error(event: string, data?: Record<string, unknown>): void {
    if (!shouldLog('error')) return;
    emit({ timestamp: new Date().toISOString(), level: 'error', event, ...data });
  },
};

// ---------------------------------------------------------------------------
// Correlation ID — unique per HTTP request, propagated to services
// ---------------------------------------------------------------------------

/** Generate a short correlation ID for request tracing */
export function generateCorrelationId(): string {
  return crypto.randomUUID().slice(0, 12);
}
