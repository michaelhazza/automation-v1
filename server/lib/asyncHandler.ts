import { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

/**
 * Wraps an async Express route handler to eliminate repetitive try/catch blocks.
 *
 * Service layer throws errors with { statusCode, message }. This wrapper catches
 * them and sends a standardised JSON error response with correlation ID.
 *
 * Response format (error):
 *   { error: { code: string, message: string }, correlationId: string, ...extras }
 *
 * For client-side error decisions (e.g., rendering a blocking-reason list on a
 * 409), callers can attach structured fields to the thrown object and they will
 * be forwarded at the top level of the JSON body for any non-5xx response.
 * Whitelisted fields only, to avoid leaking unexpected context from 500s.
 *
 * Usage:
 *   router.get('/api/foo', authenticate, asyncHandler(async (req, res) => {
 *     const data = await service.getData(req.orgId!);
 *     res.json(data);
 *   }));
 */

/** Fields allowed to flow through from a thrown service error to the JSON
 *  response body. Added to support structured approval-gate responses
 *  (reasons[], resultId, field) on 409s. Kept minimal on purpose — extend
 *  only when a new contract genuinely needs it. */
const FORWARDED_ERROR_FIELDS = ['reasons', 'resultId', 'field'] as const;

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch((err: unknown) => {
      const e = err as { statusCode?: number; message?: string; errorCode?: string };
      const statusCode = e.statusCode ?? 500;
      const message = e.message ?? 'Internal server error';
      const errorCode = e.errorCode ?? (statusCode >= 500 ? 'internal_error' : 'request_error');
      const correlationId = req.correlationId;

      if (statusCode >= 500) {
        logger.error('unhandled_route_error', {
          correlationId,
          path: req.path,
          method: req.method,
          statusCode,
          message,
        });
      }

      const body: Record<string, unknown> = {
        error: { code: errorCode, message },
        correlationId,
      };
      if (statusCode < 500 && typeof err === 'object' && err !== null) {
        const record = err as Record<string, unknown>;
        for (const key of FORWARDED_ERROR_FIELDS) {
          if (record[key] !== undefined) body[key] = record[key];
        }
      }
      res.status(statusCode).json(body);
    });
  };
}
