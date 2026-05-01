import { Request, Response, NextFunction } from 'express';
import { generateCorrelationId } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Correlation ID Middleware — attaches a unique correlationId to every request.
// Services can read req.correlationId to include in logs and error responses.
// Also sets X-Correlation-Id response header for client-side tracing.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-correlation-id'] as string) || generateCorrelationId();
  req.correlationId = id;
  res.setHeader('X-Correlation-Id', id);
  next();
}
