import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ZodTypeAny } from 'zod';

/**
 * Safely parse a query string value as a positive integer.
 * Returns undefined if the value is absent, non-numeric, or not a positive integer.
 * Prevents Number("abc") → NaN from silently propagating into service layer.
 */
export function parsePositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : undefined;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB absolute ceiling; configurable limit enforced in file route
});

export const validateBody = <T extends ZodTypeAny>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
      return;
    }
    req.body = result.data;
    next();
  };
};

export const validateQuery = <T extends ZodTypeAny>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
      return;
    }
    req.query = result.data as Request['query'];
    next();
  };
};

export const validateMultipart = upload.any();
