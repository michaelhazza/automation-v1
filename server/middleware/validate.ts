import { Request, Response, NextFunction } from 'express';
import multer from 'multer';

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

export const validateBody = (req: Request, res: Response, next: NextFunction): void => {
  next();
};

export const validateQuery = (req: Request, res: Response, next: NextFunction): void => {
  next();
};

export const validateMultipart = upload.any();
