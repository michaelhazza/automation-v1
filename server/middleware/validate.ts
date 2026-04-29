import { Request, Response, NextFunction } from 'express';
import * as fs from 'node:fs';
import * as os from 'node:os';
import multer from 'multer';
import { ZodTypeAny } from 'zod';
import { logger } from '../lib/logger.js';

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
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB hard cap (spec §6.1)
});

type ValidationMode = 'enforce' | 'warn';

export const validateBody = <T extends ZodTypeAny>(schema: T, mode: ValidationMode = 'enforce') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      if (mode === 'warn') {
        logger.warn('validation_warn', {
          path: req.path,
          method: req.method,
          errors: result.error.flatten(),
        });
        next(); // pass through — log only, don't reject
        return;
      }
      res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    // Always assign parsed data — even in warn mode, valid input gets coerced types
    req.body = result.data;
    next();
  };
};

export const validateQuery = <T extends ZodTypeAny>(schema: T, mode: ValidationMode = 'enforce') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      if (mode === 'warn') {
        logger.warn('validation_warn', {
          path: req.path,
          method: req.method,
          errors: result.error.flatten(),
        });
        next();
        return;
      }
      res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.query = result.data as Request['query'];
    next();
  };
};

const multerAny = upload.any();

export const validateMultipart = (req: Request, res: Response, next: NextFunction): void => {
  multerAny(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    res.on('close', () => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      for (const file of files) {
        fs.unlink(file.path, (unlinkErr) => {
          if (!unlinkErr || unlinkErr.code === 'ENOENT') return;
          logger.warn('multer.cleanup_failed', {
            path: file.path,
            code: unlinkErr.code,
            err: unlinkErr.message,
          });
        });
      }
    });
    next();
  });
};
