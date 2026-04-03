import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock variables
// ---------------------------------------------------------------------------
const { mockReturning, mockWhere, mockFrom, mockLimit, mockOffset } = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockOffset = vi.fn();
  const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  return { mockReturning, mockWhere, mockFrom, mockLimit, mockOffset };
});

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: mockReturning }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: mockReturning }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('../../../../server/services/emailService.js', () => ({
  emailService: { sendInvitationEmail: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../../server/services/permissionSeedService.js', () => ({
  assignOrgUserRole: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../server/lib/env.js', () => ({
  env: { INVITE_TOKEN_EXPIRY_HOURS: 48 },
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed-password'),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

import { userService } from '../../../../server/services/userService.js';

describe('userService', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── listUsers ──────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('returns users scoped to org', async () => {
      const users = [
        { id: 'u-1', email: 'user@test.com', firstName: 'Test', lastName: 'User', role: 'user', status: 'active', lastLoginAt: null, createdAt: new Date() },
      ];
      mockOffset.mockResolvedValueOnce(users);

      const result = await userService.listUsers('org-1', {});
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('u-1');
    });

    it('applies role filter when provided', async () => {
      mockOffset.mockResolvedValueOnce([]);
      const result = await userService.listUsers('org-1', { role: 'org_admin' });
      expect(result).toEqual([]);
    });

    it('applies status filter when provided', async () => {
      mockOffset.mockResolvedValueOnce([]);
      const result = await userService.listUsers('org-1', { status: 'active' });
      expect(result).toEqual([]);
    });

    it('uses default limit of 50 and offset of 0', async () => {
      mockOffset.mockResolvedValueOnce([]);
      await userService.listUsers('org-1', {});
      expect(mockLimit).toHaveBeenCalledWith(50);
      expect(mockOffset).toHaveBeenCalledWith(0);
    });
  });

  // ── getUser ────────────────────────────────────────────────────────────────

  describe('getUser', () => {
    it('returns user when found', async () => {
      const user = { id: 'u-1', email: 'user@test.com', firstName: 'Test', lastName: 'User', role: 'user', status: 'active' };
      mockWhere.mockResolvedValueOnce([user]);

      const result = await userService.getUser('u-1', 'org-1');
      expect(result.id).toBe('u-1');
    });

    it('throws 404 when user not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(userService.getUser('missing', 'org-1')).rejects.toMatchObject({
        statusCode: 404,
        message: 'User not found',
      });
    });
  });

  // ── inviteUser ─────────────────────────────────────────────────────────────

  describe('inviteUser', () => {
    it('creates user with pending status and sends invite', async () => {
      // Check existing
      mockWhere.mockResolvedValueOnce([]);
      // Get org name
      mockWhere.mockResolvedValueOnce([{ name: 'Test Org' }]);
      // Insert user returning
      mockReturning.mockResolvedValueOnce([{
        id: 'u-new', email: 'new@test.com', status: 'pending', inviteExpiresAt: new Date(),
      }]);

      const result = await userService.inviteUser('org-1', 'admin-1', {
        email: 'new@test.com',
        role: 'user',
      });

      expect(result.id).toBe('u-new');
      expect(result.status).toBe('pending');
    });

    it('throws 409 when email already exists in org', async () => {
      mockWhere.mockResolvedValueOnce([{ id: 'existing' }]);

      await expect(
        userService.inviteUser('org-1', 'admin-1', { email: 'existing@test.com', role: 'user' })
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('throws 403 when trying to invite system_admin', async () => {
      await expect(
        userService.inviteUser('org-1', 'admin-1', { email: 'admin@test.com', role: 'system_admin' })
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  // ── updateUser ─────────────────────────────────────────────────────────────

  describe('updateUser', () => {
    it('updates user fields', async () => {
      const user = { id: 'u-1', role: 'user', organisationId: 'org-1' };
      mockWhere.mockResolvedValueOnce([user]);
      mockReturning.mockResolvedValueOnce([{ id: 'u-1', role: 'manager', status: 'active' }]);

      const result = await userService.updateUser('u-1', 'org-1', { role: 'manager' });
      expect(result.role).toBe('manager');
    });

    it('throws 404 when user not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(
        userService.updateUser('missing', 'org-1', { role: 'user' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws 400 when modifying system_admin via this endpoint', async () => {
      mockWhere.mockResolvedValueOnce([{ id: 'u-1', role: 'system_admin' }]);
      await expect(
        userService.updateUser('u-1', 'org-1', { role: 'user' })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  // ── deleteUser ─────────────────────────────────────────────────────────────

  describe('deleteUser', () => {
    it('throws 400 when trying to delete own account', async () => {
      await expect(
        userService.deleteUser('u-1', 'org-1', 'u-1')
      ).rejects.toMatchObject({ statusCode: 400, message: 'Cannot delete your own account' });
    });

    it('throws 404 when user not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(
        userService.deleteUser('missing', 'org-1', 'admin-1')
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
