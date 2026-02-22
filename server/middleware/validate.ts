import { Request, Response, NextFunction } from 'express';
import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

export const validateBody = (req: Request, res: Response, next: NextFunction): void => {
  next();
};

export const validateQuery = (req: Request, res: Response, next: NextFunction): void => {
  next();
};

export const validateMultipart = upload.any();
