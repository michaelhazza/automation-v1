import { Request, Response, NextFunction } from 'express';

/**
 * Enforces the `If-Match` precondition header for agent tab-scoped write endpoints.
 *
 * Returns HTTP 428 (Precondition Required) if the `If-Match` header is absent.
 * When present, the raw ETag value (stripped of surrounding quotes if provided)
 * is attached to `req.expectedEtag` for downstream use by service methods.
 */

declare global {
  // reason: Express module augmentation requires the `namespace` keyword.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      expectedEtag?: string;
    }
  }
}

export const agentEtagPrecondition = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const ifMatch = req.headers['if-match'];
  if (!ifMatch) {
    res.status(428).json({
      error: {
        code: 'PRECONDITION_REQUIRED',
        message: 'If-Match header is required for this operation. Fetch the current agent state and include its ETag.',
      },
    });
    return;
  }

  // Strip optional surrounding double quotes per RFC 7232 §3.1.
  req.expectedEtag = ifMatch.replace(/^"|"$/g, '');
  next();
};
