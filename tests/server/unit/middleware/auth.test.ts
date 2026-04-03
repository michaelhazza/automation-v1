import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockJwtVerify, mockDbSelect, mockInnerJoin, mockPermWhere } = vi.hoisted(() => {
  const mockPermWhere = vi.fn();
  const mockInnerJoin = vi.fn().mockReturnValue({ where: mockPermWhere });
  const mockDbSelect = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      innerJoin: mockInnerJoin,
    }),
  });
  const mockJwtVerify = vi.fn();
  return { mockJwtVerify, mockDbSelect, mockInnerJoin, mockPermWhere };
});

vi.mock('jsonwebtoken', () => ({
  default: { verify: mockJwtVerify },
}));

vi.mock('../../../../server/db/index.js', () => ({
  db: { select: mockDbSelect },
}));

vi.mock('../../../../server/db/schema/index.js', () => ({
  orgUserRoles: { userId: 'userId', organisationId: 'organisationId', permissionSetId: 'permissionSetId' },
  subaccountUserAssignments: { userId: 'userId', subaccountId: 'subaccountId', permissionSetId: 'permissionSetId' },
  permissionSetItems: { permissionSetId: 'permissionSetId', permissionKey: 'permissionKey' },
}));

vi.mock('../../../../server/lib/env.js', () => ({
  env: { JWT_SECRET: 'test-secret-32-chars-minimum-xxxxx' },
}));

vi.mock('../../../../server/services/auditService.js', () => ({
  auditService: { log: vi.fn() },
}));

import { authenticate, requireSystemAdmin, requireOrgPermission } from '../../../../server/middleware/auth.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    method: 'GET',
    path: '/test',
    ip: '127.0.0.1',
    params: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('authenticate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when no Authorization header is present', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header does not start with Bearer', () => {
    const req = mockReq({ headers: { authorization: 'Basic abc123' } as any });
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is invalid', () => {
    mockJwtVerify.mockImplementation(() => { throw new Error('invalid token'); });
    const req = mockReq({ headers: { authorization: 'Bearer bad-token' } as any });
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and req.orgId when token is valid', () => {
    const payload = { id: 'u1', organisationId: 'org-1', role: 'member', email: 'test@example.com' };
    mockJwtVerify.mockReturnValue(payload);
    const req = mockReq({ headers: { authorization: 'Bearer valid-token' } as any });
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(req.user).toEqual(payload);
    expect(req.orgId).toBe('org-1');
    expect(next).toHaveBeenCalled();
  });

  it('system_admin uses X-Organisation-Id header to scope into another org', () => {
    const payload = { id: 'u1', organisationId: 'org-1', role: 'system_admin', email: 'admin@example.com' };
    mockJwtVerify.mockReturnValue(payload);
    const req = mockReq({
      headers: {
        authorization: 'Bearer valid-token',
        'x-organisation-id': 'org-other',
      } as any,
    });
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(req.orgId).toBe('org-other');
    expect(next).toHaveBeenCalled();
  });

  it('system_admin without X-Organisation-Id uses own orgId', () => {
    const payload = { id: 'u1', organisationId: 'org-1', role: 'system_admin', email: 'admin@example.com' };
    mockJwtVerify.mockReturnValue(payload);
    const req = mockReq({ headers: { authorization: 'Bearer valid-token' } as any });
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(req.orgId).toBe('org-1');
  });
});

describe('requireSystemAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when req.user is not set', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    requireSystemAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user is not system_admin', () => {
    const req = mockReq();
    (req as any).user = { id: 'u1', role: 'member' };
    const res = mockRes();
    const next = vi.fn();

    requireSystemAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when user is system_admin', () => {
    const req = mockReq();
    (req as any).user = { id: 'u1', role: 'system_admin' };
    const res = mockRes();
    const next = vi.fn();

    requireSystemAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('requireOrgPermission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when req.user is not set', async () => {
    const middleware = requireOrgPermission('org.agents.view');
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('bypasses check for system_admin', async () => {
    const middleware = requireOrgPermission('org.agents.view');
    const req = mockReq();
    (req as any).user = { id: 'u1', role: 'system_admin', organisationId: 'org-1' };
    (req as any).orgId = 'org-1';
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('bypasses check for org_admin', async () => {
    const middleware = requireOrgPermission('org.agents.view');
    const req = mockReq();
    (req as any).user = { id: 'u1', role: 'org_admin', organisationId: 'org-1' };
    (req as any).orgId = 'org-1';
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when user lacks the permission', async () => {
    const middleware = requireOrgPermission('org.agents.edit');
    const req = mockReq();
    (req as any).user = { id: 'u1', role: 'member', organisationId: 'org-1' };
    (req as any).orgId = 'org-1';
    const res = mockRes();
    const next = vi.fn();

    // DB returns no permission rows
    mockPermWhere.mockResolvedValueOnce([]);

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when user has the permission', async () => {
    const middleware = requireOrgPermission('org.agents.view');
    const req = mockReq();
    (req as any).user = { id: 'u1', role: 'member', organisationId: 'org-1' };
    (req as any).orgId = 'org-1';
    const res = mockRes();
    const next = vi.fn();

    // DB returns matching permission
    mockPermWhere.mockResolvedValueOnce([{ permissionKey: 'org.agents.view' }]);

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('uses cached permissions on second call within same request', async () => {
    const middleware = requireOrgPermission('org.agents.view');
    const req = mockReq();
    (req as any).user = { id: 'u1', role: 'member', organisationId: 'org-1' };
    (req as any).orgId = 'org-1';
    // Pre-populate cache
    (req as any)._orgPermissionCache = new Set(['org.agents.view', 'org.connections.view']);
    const res = mockRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    // DB should not have been queried since cache was present
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});
