import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { orgUserRoles, subaccountUserAssignments, permissionSetItems } from '../db/schema/index.js';
import { env } from '../lib/env.js';
import { auditService } from '../services/auditService.js';
import { withOrgTx } from '../instrumentation.js';

export interface JwtPayload {
  id: string;
  organisationId: string;
  role: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
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

/**
 * authenticate — verifies the JWT, sets `req.user` / `req.orgId`, then opens
 * a request-scoped org-scoped Drizzle transaction that binds
 * `app.organisation_id` via `set_config` and stashes the tx handle in
 * AsyncLocalStorage for every downstream service call to read (Sprint 2
 * P1.1 Layer 1). All service-layer DB access runs inside this tx so:
 *
 *   1. RLS policies observe a non-null `current_setting('app.organisation_id')`
 *      and enforce tenant isolation at the database layer.
 *   2. `getOrgScopedDb()` in service code returns the tx handle synchronously
 *      without threading it through every function signature.
 *   3. Service calls made without an active tx throw
 *      `failure('missing_org_context')` — Layer A of the three-layer
 *      fail-closed data isolation contract.
 *
 * The transaction commits when the response is flushed (res.finish / close)
 * and rolls back if `next(err)` propagates an error out of the handler chain.
 * Route handlers that throw are caught by `asyncHandler`, which writes a
 * JSON error response — that counts as a clean response from the middleware's
 * perspective, so the tx commits. Data-consistency boundaries (atomic writes
 * across multiple tables) should use a nested `db.transaction()` call inside
 * the service, not rely on this outer tx.
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.substring(7);
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

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

  const orgId = req.orgId!;

  try {
    await db.transaction(async (tx) => {
      // Bind app.organisation_id to the tx. `true` (is_local) scopes the
      // setting to this transaction so it's cleared on commit/rollback and
      // cannot leak across pool connections.
      await tx.execute(sql`SELECT set_config('app.organisation_id', ${orgId}, true)`);

      await withOrgTx(
        {
          tx,
          organisationId: orgId,
          subaccountId: (req.params?.subaccountId as string | undefined) ?? null,
          userId: payload.id,
          source: `http:${req.method} ${req.path}`,
        },
        () =>
          new Promise<void>((resolve, reject) => {
            let settled = false;
            const settle = (err?: unknown) => {
              if (settled) return;
              settled = true;
              if (err) reject(err);
              else resolve();
            };

            // Most success paths complete via res.json(...) inside
            // asyncHandler, so we resolve on `finish`. `close` handles
            // the client-disconnect case. `next(err)` handles errors
            // that bypass asyncHandler (middleware-raised errors).
            res.once('finish', () => settle());
            res.once('close', () => settle());

            next();
          }),
      );
    });
  } catch (err) {
    // Errors here come from set_config, the transaction itself, or from
    // next(err) bubbling up via the bridge above.
    next(err);
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

// ─── hasOrgPermission (programmatic check) ────────────────────────────────────

/**
 * Programmatic permission check usable inside async handlers (where the
 * `requireOrgPermission` middleware can't be applied — e.g. when the
 * decision affects the response shape rather than the request authorisation).
 *
 * Mirrors `requireOrgPermission` semantics:
 *  - system_admin and org_admin always return true
 *  - everyone else: returns true iff the permission key is in their org
 *    permission set
 *
 * Uses the same per-request cache as `requireOrgPermission`.
 */
export async function hasOrgPermission(req: Request, permissionKey: string): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === 'system_admin' || req.user.role === 'org_admin') return true;
  const organisationId = req.orgId ?? req.user.organisationId;
  if (!req._orgPermissionCache) {
    req._orgPermissionCache = await loadOrgPermissions(req.user.id, organisationId);
  }
  return req._orgPermissionCache.has(permissionKey);
}

// ─── hasSubaccountPermission (programmatic check) ────────────────────────────

/**
 * Programmatic subaccount permission check usable inside async handlers.
 *
 * Mirrors `requireSubaccountPermission` semantics:
 *  - system_admin and org_admin always return true
 *  - everyone else: returns true iff the permission key is in their subaccount
 *    permission set OR they hold org.subaccounts.edit / org.subaccounts.manage
 */
export async function hasSubaccountPermission(
  req: Request,
  subaccountId: string,
  permissionKey: string,
): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === 'system_admin' || req.user.role === 'org_admin') return true;
  const subPerms = await loadSubaccountPermissions(req.user.id, subaccountId);
  if (subPerms.has(permissionKey)) return true;
  const organisationId = req.orgId ?? req.user.organisationId;
  if (!req._orgPermissionCache) {
    req._orgPermissionCache = await loadOrgPermissions(req.user.id, organisationId);
  }
  return (
    req._orgPermissionCache.has('org.subaccounts.edit') ||
    req._orgPermissionCache.has('org.subaccounts.manage')
  );
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

    // system_admin and org_admin bypass all org-level permission checks
    if (req.user.role === 'system_admin' || req.user.role === 'org_admin') {
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

      if (subaccountPerms.has(permissionKey)) {
        return next();
      }

      // Fallback: org admins and users with org-level permissions can access subaccounts
      const organisationId = req.orgId ?? req.user.organisationId;
      if (req.user.role === 'org_admin') {
        return next();
      }
      if (organisationId) {
        const orgPerms = req._orgPermissionCache ?? await loadOrgPermissions(req.user.id, organisationId);
        req._orgPermissionCache = orgPerms;
        // Map subaccount permission to org-level equivalent (e.g. subaccount.connections.view -> org.subaccounts.edit)
        if (orgPerms.has('org.subaccounts.edit') || orgPerms.has('org.subaccounts.manage')) {
          return next();
        }
      }

      res.status(403).json({ error: 'Forbidden' });
      return;
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
