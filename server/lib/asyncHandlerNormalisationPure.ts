/**
 * asyncHandlerNormalisationPure — pure normalisation logic extracted from asyncHandler
 * for testability without pulling in env/db/logger side effects.
 *
 * asyncHandler delegates to this module for the error-normalisation step.
 */

import { AppError } from './errors.js';
import type { AppErrorCode } from '../../shared/errorCodes.js';

export type NormalisedRouteError =
  | { kind: 'appError'; error: AppError }
  | { kind: 'legacy'; error: AppError }
  | { kind: 'unknown'; statusCode: 500; code: 'LEGACY_ERROR'; message: string };

/**
 * Normalise any thrown value into a known shape.
 *
 * - AppError instances pass through as-is.
 * - Duck-typed { statusCode, message?, errorCode? } objects are wrapped in a
 *   synthetic AppError with code = errorCode ?? 'LEGACY_ERROR'.
 * - True unknowns (strings, null, bare Error instances without statusCode, etc.)
 *   return kind:'unknown' for the 500 fallback path.
 */
export function normaliseRouteError(err: unknown): NormalisedRouteError {
  if (err instanceof AppError) {
    return { kind: 'appError', error: err };
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number'
  ) {
    const e = err as { statusCode: number; message?: string; errorCode?: string };
    const wrapped = new AppError({
      code: (e.errorCode as AppErrorCode) ?? 'LEGACY_ERROR',
      statusCode: e.statusCode,
      message: e.message ?? 'Unknown error',
      context: { legacy: true },
    });
    return { kind: 'legacy', error: wrapped };
  }

  const message =
    err instanceof Error ? err.message :
    typeof err === 'string' ? err :
    'Internal server error';

  return { kind: 'unknown', statusCode: 500, code: 'LEGACY_ERROR', message };
}
