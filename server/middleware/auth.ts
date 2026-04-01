import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { orgUserRoles, subaccountUserAssignments, permissionSetItems } from '../db/schema/index.js';
import { env } from '../lib/env.js';
import { auditService } from '../services/auditService.js';

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
      /** Resolved org context. For system_admin this may differ from user.organisationId
       *  when the X-Organisation-Id header is provided. */
      orgId?: string;
      /** Cached set of org-level permission keys for the current user+org. */
      _orgPermissionCache?: Set<string> | null;
    }
  }
}

// ─── authenticate ──────────────────────────────────────────────────────────────

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

    // system_admin can pass X-Organisation-Id to scope into any org.
    if (payload.role === 'system_admin') {
      const headerOrgId = req.headers['x-organisation-id'] as string | undefined;
      req.orgId = headerOrgId || payload.organisationId;

      if (headerOrgId && headerOrgId !== payload.organisationId) {
        auditService.log({
          organisationId: headerOrgId,
          actorId: payload.id,
          actorType: 'user',
          action: 'cross_org_access',
          metadata: {
            targetOrganisationId: headerOrgId,
            originalOrganisationId: payload.organisationId,
            method: req.method,
            path: req.path,
          },
          ipAddress: req.ip,
        });
      }
    } else {
      req.orgId = payload.organisationId;
    }

    next();
  } catch {
    res.status(401).json({ error: 'Authentication required' });
  }
};

// ─── requireSystemAdmin ────────────────────────────────────────────────────────

/** Allows only users with role = 'system_admin'. */
export const requireSystemAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.role !== 'system_admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};

// ─── Internal helpers ──────────────────────────────────────────────────────────

async function loadOrgPermissions(userId: string, organisationId: string): Promise<Set<string>> {
  const rows = await db
    .select({ permissionKey: permissionSetItems.permissionKey })
    .from(orgUserRoles)
    .innerJoin(
      permissionSetItems,
      eq(permissionSetItems.permissionSetId, orgUserRoles.permissionSetId)
    )
    .where(
      and(
        eq(orgUserRoles.userId, userId),
        eq(orgUserRoles.organisationId, organisationId)
      )
    );

  return new Set(rows.map((r) => r.permissionKey));
}

async function loadSubaccountPermissions(userId: string, subaccountId: string): Promise<Set<string>> {
  const rows = await db
    .select({ permissionKey: permissionSetItems.permissionKey })
    .from(subaccountUserAssignments)
    .innerJoin(
      permissionSetItems,
      eq(permissionSetItems.permissionSetId, subaccountUserAssignments.permissionSetId)
    )
    .where(
      and(
        eq(subaccountUserAssignments.userId, userId),
        eq(subaccountUserAssignments.subaccountId, subaccountId)
      )
    );

  return new Set(rows.map((r) => r.permissionKey));
}

// ─── requireOrgPermission ──────────────────────────────────────────────────────

/**
 * Middleware that checks the user has the given permission key in their
 * org-level permission set (via org_user_roles).
 *
 * system_admin users bypass this check unconditionally.
 */
export const requireOrgPermission = (permissionKey: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // system_admin bypasses all permission checks
    if (req.user.role === 'system_admin') {
      return next();
    }

    const organisationId = req.orgId ?? req.user.organisationId;

    try {
      // Use request-scoped cache to avoid redundant DB lookups within the same request
      if (!req._orgPermissionCache) {
        req._orgPermissionCache = await loadOrgPermissions(req.user.id, organisationId);
      }

      if (!req._orgPermissionCache.has(permissionKey)) {
        res.status(403).json({ error: 'You do not have permission to perform this action. Contact your organisation administrator if you believe this is a mistake.' });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

// ─── requireSubaccountPermission ──────────────────────────────────────────────

/**
 * Middleware that checks the user has the given permission key in their
 * subaccount-level permission set (via subaccount_user_assignments).
 *
 * The subaccount ID is read from req.params.subaccountId.
 * system_admin users bypass this check unconditionally.
 * Org-level users who also have org access to the subaccount are granted access
 * if they hold the matching org permission via requireOrgPermission.
 */
export const requireSubaccountPermission = (permissionKey: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // system_admin bypasses all permission checks
    if (req.user.role === 'system_admin') {
      return next();
    }

    const subaccountId = req.params.subaccountId;
    if (!subaccountId) {
      res.status(400).json({ error: 'Subaccount context required' });
      return;
    }

    try {
      const subaccountPerms = await loadSubaccountPermissions(req.user.id, subaccountId);

      if (!subaccountPerms.has(permissionKey)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

// ─── checkOrgPermission utility ───────────────────────────────────────────────

/**
 * Programmatic permission check for use inside service/route handlers.
 * Returns true if the user has the given permission key in their org-level
 * permission set, or if they are system_admin.
 */
export async function checkOrgPermission(
  userId: string,
  organisationId: string,
  role: string | null | undefined,
  permissionKey: string
): Promise<boolean> {
  if (role === 'system_admin') return true;
  const perms = await loadOrgPermissions(userId, organisationId);
  return perms.has(permissionKey);
}

// ─── Legacy shim (temporary) ───────────────────────────────────────────────────
// Routes that have not yet been migrated to requireOrgPermission still call
// requireRole. This shim keeps them working by allowing system_admin through
// and otherwise returning 403. Remove once all routes are migrated.

/** @deprecated Use requireOrgPermission or requireSubaccountPermission instead */
export const requireRole = (requiredRole: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.user.role === 'system_admin') {
      return next();
    }
    // Non-system-admin users must use requireOrgPermission
    res.status(403).json({ error: 'Forbidden' });
  };
};
