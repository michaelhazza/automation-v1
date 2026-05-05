import { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';
import { recordIncident } from '../services/incidentIngestor.js';
import { normaliseRouteError } from './asyncHandlerNormalisationPure.js';

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
 * Error normalisation:
 *   - `AppError` instances are used directly.
 *   - Duck-typed `{statusCode, message, errorCode}` objects are normalised into
 *     a synthetic `AppError` with `code: errorCode ?? 'LEGACY_ERROR'` so that
 *     downstream observers (logger, response writer) always see a single shape.
 *   - True unknowns fall through to the existing 500 path.
 *
 * Usage:
 *   router.get('/api/foo', authenticate, asyncHandler(async (req, res) => {
 *     const data = await service.getData(req.orgId!);
 *     res.json(data);
 *   }));
 */

/** Fields allowed to flow through from a thrown service error to the JSON
 *  response body. Added to support structured approval-gate responses
 *  (reasons[], resultId, field) on 409s. `details` carries zod flatten()
 *  output on 400s. Kept minimal on purpose — extend only when a new
 *  contract genuinely needs it. */
const FORWARDED_ERROR_FIELDS = ['reasons', 'resultId', 'field', 'details'] as const;

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch((err: unknown) => {
      const normalised = normaliseRouteError(err);
      const correlationId = req.correlationId;

      if (normalised.kind === 'unknown') {
        // True unknown — 500 path
        const { statusCode, code: errorCode, message } = normalised;
        logger.error('unhandled_route_error', {
          correlationId,
          path: req.path,
          method: req.method,
          statusCode,
          message,
        });
        const rec = err as Record<string, unknown> & { __incidentRecorded?: boolean };
        if (!rec?.__incidentRecorded) {
          if (rec) rec.__incidentRecorded = true;
          recordIncident({
            source: 'route',
            summary: message,
            errorCode,
            stack: err instanceof Error ? err.stack : undefined,
            correlationId,
          });
        }
        res.status(statusCode).json({ error: { code: errorCode, message }, correlationId });
        return;
      }

      // AppError or legacy-normalised AppError
      const { error } = normalised;
      const statusCode = error.statusCode;
      const message = error.message;
      const errorCode = error.code;

      if (statusCode >= 500) {
        logger.error('unhandled_route_error', {
          correlationId,
          path: req.path,
          method: req.method,
          statusCode,
          message,
          errorCode,
        });
        const rec = err as Record<string, unknown> & { __incidentRecorded?: boolean };
        if (!rec.__incidentRecorded) {
          rec.__incidentRecorded = true;
          recordIncident({
            source: 'route',
            summary: message,
            errorCode,
            stack: err instanceof Error ? err.stack : undefined,
            correlationId,
          });
        }
      }

      const body: Record<string, unknown> = {
        error: { code: errorCode, message },
        correlationId,
      };

      // Forward structured fields for non-5xx responses only, to avoid leaking internals.
      // For AppErrors: read from error.context (excluding the legacy sentinel).
      // For legacy duck-shape errors: read from the raw err object.
      if (statusCode < 500) {
        if (normalised.kind === 'appError' && error.context) {
          for (const key of FORWARDED_ERROR_FIELDS) {
            if (error.context[key] !== undefined) body[key] = error.context[key];
          }
        } else if (typeof err === 'object' && err !== null) {
          const record = err as Record<string, unknown>;
          for (const key of FORWARDED_ERROR_FIELDS) {
            if (record[key] !== undefined) body[key] = record[key];
          }
        }
      }

      res.status(statusCode).json(body);
    });
  };
}
