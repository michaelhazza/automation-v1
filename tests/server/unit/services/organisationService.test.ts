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
  },
}));

vi.mock('../../../../server/services/emailService.js', () => ({
  emailService: { sendInvitationEmail: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../../server/services/permissionSeedService.js', () => ({
  assignOrgUserRole: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../server/services/policyEngineService.js', () => ({
  policyEngineService: { seedFallbackRule: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../../server/lib/env.js', () => ({
  env: { INVITE_TOKEN_EXPIRY_HOURS: 48 },
}));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed'), compare: vi.fn() },
}));

import { organisationService } from '../../../../server/services/organisationService.js';

describe('organisationService', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── listOrganisations ──────────────────────────────────────────────────────

  describe('listOrganisations', () => {
    it('returns all orgs with soft delete filter', async () => {
      const orgs = [{ id: 'org-1', name: 'Org One', status: 'active' }];
      mockOffset.mockResolvedValueOnce(orgs);

      const result = await organisationService.listOrganisations({});
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('org-1');
    });

    it('applies status filter when provided', async () => {
      mockOffset.mockResolvedValueOnce([]);
      const result = await organisationService.listOrganisations({ status: 'active' });
      expect(result).toEqual([]);
      expect(mockWhere).toHaveBeenCalled();
    });

    it('applies pagination with default limit/offset', async () => {
      mockOffset.mockResolvedValueOnce([]);
      await organisationService.listOrganisations({});
      expect(mockLimit).toHaveBeenCalledWith(50);
      expect(mockOffset).toHaveBeenCalledWith(0);
    });
  });

  // ── getOrganisation ────────────────────────────────────────────────────────

  describe('getOrganisation', () => {
    it('returns org when found', async () => {
      const org = { id: 'org-1', name: 'Org One', slug: 'org-one', plan: 'pro', status: 'active', settings: null, createdAt: new Date() };
      mockWhere.mockResolvedValueOnce([org]);

      const result = await organisationService.getOrganisation('org-1');
      expect(result.id).toBe('org-1');
      expect(result.name).toBe('Org One');
    });

    it('throws 404 when org not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(organisationService.getOrganisation('missing')).rejects.toMatchObject({
        statusCode: 404,
        message: 'Organisation not found',
      });
    });
  });

  // ── createOrganisation ─────────────────────────────────────────────────────

  describe('createOrganisation', () => {
    it('creates org with slug and admin user', async () => {
      // Check existing: none
      mockWhere.mockResolvedValueOnce([]);
      // Insert org returning
      mockReturning.mockResolvedValueOnce([{ id: 'org-new', name: 'New Org', slug: 'new-org', plan: 'starter', status: 'active' }]);
      // Insert admin user returning
      mockReturning.mockResolvedValueOnce([{ id: 'user-1' }]);

      const result = await organisationService.createOrganisation({
        name: 'New Org',
        slug: 'new-org',
        plan: 'starter',
        adminEmail: 'admin@test.com',
        adminFirstName: 'Admin',
        adminLastName: 'User',
      });

      expect(result.id).toBe('org-new');
      expect(result.slug).toBe('new-org');
    });

    it('throws 409 when name or slug already exists', async () => {
      mockWhere.mockResolvedValueOnce([{ id: 'existing' }]);

      await expect(
        organisationService.createOrganisation({
          name: 'Existing Org',
          slug: 'existing-org',
          plan: 'pro',
          adminEmail: 'admin@test.com',
          adminFirstName: 'Admin',
          adminLastName: 'User',
        })
      ).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  // ── updateOrganisation ─────────────────────────────────────────────────────

  describe('updateOrganisation', () => {
    it('updates org fields and returns updated record', async () => {
      const org = { id: 'org-1', name: 'Old Name' };
      const updated = { id: 'org-1', name: 'New Name', plan: 'pro', status: 'active' };
      mockWhere.mockResolvedValueOnce([org]);
      mockReturning.mockResolvedValueOnce([updated]);

      const result = await organisationService.updateOrganisation('org-1', { name: 'New Name' });
      expect(result.name).toBe('New Name');
    });

    it('throws 404 when org not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(
        organisationService.updateOrganisation('missing', { name: 'X' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
