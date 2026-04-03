import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockBcryptCompare, mockJwtSign, mockDbSelectWhere, mockDbUpdateSet } = vi.hoisted(() => {
  const mockBcryptCompare = vi.fn();
  const mockJwtSign = vi.fn().mockReturnValue('mock-jwt-token');
  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockDbUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockDbSelectWhere = vi.fn();
  return { mockBcryptCompare, mockJwtSign, mockDbSelectWhere, mockDbUpdateSet };
});

vi.mock('jsonwebtoken', () => ({
  default: { sign: mockJwtSign },
}));

vi.mock('bcryptjs', () => ({
  default: { compare: mockBcryptCompare, hash: vi.fn().mockResolvedValue('hashed') },
}));

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: mockDbSelectWhere,
        }),
        where: mockDbSelectWhere,
      }),
    }),
    update: vi.fn().mockReturnValue({ set: mockDbUpdateSet }),
  },
}));

vi.mock('../../../../server/db/schema/index.js', () => ({
  users: {
    id: 'id', email: 'email', organisationId: 'organisationId',
    deletedAt: 'deletedAt', inviteToken: 'inviteToken', inviteExpiresAt: 'inviteExpiresAt',
    passwordResetToken: 'passwordResetToken', passwordResetExpiresAt: 'passwordResetExpiresAt',
    status: 'status',
  },
  organisations: {
    id: 'id', slug: 'slug', deletedAt: 'deletedAt',
  },
}));

vi.mock('../../../../server/lib/env.js', () => ({
  env: { JWT_SECRET: 'test-secret-32-chars-minimum-xxxxx' },
}));

vi.mock('../../../../server/services/emailService.js', () => ({
  emailService: { sendPasswordResetEmail: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ op: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col) => ({ op: 'isNull', col })),
  gt: vi.fn((col, val) => ({ op: 'gt', col, val })),
}));

import { authService } from '../../../../server/services/authService.js';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('login', () => {
    const mockUser = {
      id: 'u1',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'member',
      organisationId: 'org-1',
      passwordHash: 'hashed-password',
      status: 'active',
    };

    it('returns token and user on valid credentials', async () => {
      mockDbSelectWhere.mockResolvedValueOnce([{ user: mockUser, organisationSlug: 'test-org' }]);
      mockBcryptCompare.mockResolvedValueOnce(true);

      const result = await authService.login('test@example.com', 'correct-password');

      expect(result.token).toBe('mock-jwt-token');
      expect(result.user.id).toBe('u1');
      expect(result.user.email).toBe('test@example.com');
      expect(mockJwtSign).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1', email: 'test@example.com' }),
        expect.any(String),
        expect.objectContaining({ expiresIn: '24h' }),
      );
    });

    it('throws 401 on invalid email (no user found)', async () => {
      mockDbSelectWhere.mockResolvedValueOnce([]);

      try {
        await authService.login('nonexistent@example.com', 'password');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(401);
        expect(err.message).toBe('Invalid email or password');
      }
    });

    it('throws 401 on wrong password', async () => {
      mockDbSelectWhere.mockResolvedValueOnce([{ user: mockUser, organisationSlug: 'test-org' }]);
      mockBcryptCompare.mockResolvedValueOnce(false);

      try {
        await authService.login('test@example.com', 'wrong-password');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(401);
        expect(err.message).toBe('Invalid email or password');
      }
    });

    it('throws 403 when account is inactive', async () => {
      const inactiveUser = { ...mockUser, status: 'inactive' };
      mockDbSelectWhere.mockResolvedValueOnce([{ user: inactiveUser, organisationSlug: 'test-org' }]);

      try {
        await authService.login('test@example.com', 'password');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.message).toBe('Account is inactive or suspended');
      }
    });

    it('throws 403 when account is pending', async () => {
      const pendingUser = { ...mockUser, status: 'pending' };
      mockDbSelectWhere.mockResolvedValueOnce([{ user: pendingUser, organisationSlug: 'test-org' }]);

      try {
        await authService.login('test@example.com', 'password');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
      }
    });

    it('normalizes email to lowercase', async () => {
      mockDbSelectWhere.mockResolvedValueOnce([{ user: mockUser, organisationSlug: 'test-org' }]);
      mockBcryptCompare.mockResolvedValueOnce(true);

      await authService.login('Test@Example.COM', 'correct-password');

      // The eq() mock is called with the lowercase version
      const { eq } = await import('drizzle-orm');
      expect(eq).toHaveBeenCalledWith('email', 'test@example.com');
    });

    it('throws 400 when multiple accounts found without organisationSlug', async () => {
      mockDbSelectWhere.mockResolvedValueOnce([
        { user: mockUser, organisationSlug: 'org-a' },
        { user: { ...mockUser, organisationId: 'org-2' }, organisationSlug: 'org-b' },
      ]);

      try {
        await authService.login('test@example.com', 'password');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('Multiple accounts');
      }
    });

    it('updates lastLoginAt on successful login', async () => {
      mockDbSelectWhere.mockResolvedValueOnce([{ user: mockUser, organisationSlug: 'test-org' }]);
      mockBcryptCompare.mockResolvedValueOnce(true);

      await authService.login('test@example.com', 'correct-password');

      expect(mockDbUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      );
    });
  });
});
