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
      // Resolved org context: for system_admin this may differ from user.organisationId
      // when the X-Organisation-Id header is provided.
      orgId?: string;
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

    // Resolve active org context.
    // system_admin can pass X-Organisation-Id to operate within a specific org.
    // All other roles are always scoped to their own organisation.
    if (payload.role === 'system_admin') {
      const headerOrgId = req.headers['x-organisation-id'] as string | undefined;
      req.orgId = headerOrgId || payload.organisationId;
    } else {
      req.orgId = payload.organisationId;
    }

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

    // system_admin-only endpoints: only system_admin may access
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
