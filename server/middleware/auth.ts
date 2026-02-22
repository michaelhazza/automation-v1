import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { env } from '../lib/env.js';

export interface JwtPayload {
  id: string;
  organisationId: string;
  role: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Authentication required' });
  }
};

const ROLE_HIERARCHY: Record<string, number> = {
  system_admin: 5,
  org_admin: 4,
  manager: 3,
  user: 2,
  client_user: 1,
};

export const requireRole = (requiredRole: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // system_admin can access system_admin-only endpoints, but org_admin cannot
    if (requiredRole === 'system_admin') {
      if (req.user.role !== 'system_admin') {
        res.status(403).json({ error: 'system_admin role required' });
        return;
      }
    } else {
      const userLevel = ROLE_HIERARCHY[req.user.role] ?? 0;
      const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
      if (userLevel < requiredLevel) {
        res.status(403).json({ error: `${requiredRole} role required` });
        return;
      }
    }

    next();
  };
};
