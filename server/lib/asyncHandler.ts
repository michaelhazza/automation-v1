import { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async Express route handler to eliminate repetitive try/catch blocks.
 *
 * Service layer throws errors with { statusCode, message }. This wrapper catches
 * them and sends the appropriate JSON error response.
 *
 * Usage:
 *   router.get('/api/foo', authenticate, asyncHandler(async (req, res) => {
 *     const data = await service.getData(req.orgId!);
 *     res.json(data);
 *   }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch((err: unknown) => {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
    });
  };
}
