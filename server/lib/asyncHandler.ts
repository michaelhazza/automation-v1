import { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

/**
 * Wraps an async Express route handler to eliminate repetitive try/catch blocks.
 *
 * Service layer throws errors with { statusCode, message }. This wrapper catches
 * them and sends a standardised JSON error response with correlation ID.
 *
 * Response format (error):
 *   { error: { code: string, message: string }, correlationId: string }
 *
 * Usage:
 *   router.get('/api/foo', authenticate, asyncHandler(async (req, res) => {
 *     const data = await service.getData(req.orgId!);
 *     res.json(data);
 *   }));
 */
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

      res.status(statusCode).json({
        error: { code: errorCode, message },
        correlationId,
      });
    });
  };
}
