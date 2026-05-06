export interface ServiceError {
  statusCode: number;
  message: string;
  errorCode?: string;
  details?: unknown;
}

export function isServiceError(err: unknown): err is ServiceError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return typeof e.statusCode === 'number' && typeof e.message === 'string';
}

export function toServiceError(err: unknown, fallbackStatus = 500): ServiceError {
  if (isServiceError(err)) return err;
  if (err instanceof Error) return { statusCode: fallbackStatus, message: err.message };
  return { statusCode: fallbackStatus, message: String(err) };
}
