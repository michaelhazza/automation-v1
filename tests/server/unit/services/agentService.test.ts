import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock variables
// ---------------------------------------------------------------------------
const { mockReturning, mockWhere, mockFrom, mockSetWhere, mockSet } = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockSetWhere = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
  const mockWhere = vi.fn();
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  return { mockReturning, mockWhere, mockFrom, mockSetWhere, mockSet };
});

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: mockReturning }),
    }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
  },
}));

vi.mock('../../../../server/services/hierarchyService.js', () => ({
  validateHierarchy: vi.fn().mockResolvedValue({ valid: true }),
  buildTree: vi.fn(),
}));

vi.mock('../../../../server/services/connectionTokenService.js', () => ({
  connectionTokenService: { decryptToken: vi.fn((t: string) => t), refreshWithLock: vi.fn() },
}));

vi.mock('../../../../server/lib/storage.js', () => ({
  getS3Client: vi.fn(),
  getBucketName: vi.fn(),
}));

vi.mock('../../../../server/services/llmService.js', () => ({
  approxTokens: vi.fn(() => 100),
  resolveTemperature: vi.fn((_mode: string, t: number) => t),
  resolveMaxTokens: vi.fn((_size: string, t: number) => t),
}));

vi.mock('../../../../server/services/emailService.js', () => ({
  emailService: { sendDataSourceSyncAlert: vi.fn(), sendDataSourceSyncRecovery: vi.fn() },
}));

vi.mock('../../../../server/lib/env.js', () => ({
  env: { APP_BASE_URL: 'http://localhost:3000', INVITE_TOKEN_EXPIRY_HOURS: 48 },
}));

vi.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { agentService } from '../../../../server/services/agentService.js';

describe('agentService', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── listAgents ─────────────────────────────────────────────────────────────

  describe('listAgents', () => {
    it('returns agents scoped to org with soft delete filter', async () => {
      const agents = [
        { id: 'a-1', name: 'Agent 1', slug: 'agent-1', description: null, modelProvider: 'anthropic', modelId: 'claude-sonnet-4-6', status: 'active', systemAgentId: null, isSystemManaged: false, heartbeatEnabled: false, heartbeatIntervalHours: null, heartbeatOffsetHours: 0, parentAgentId: null, agentRole: null, agentTitle: null, createdAt: new Date(), updatedAt: new Date() },
      ];
      mockWhere.mockResolvedValueOnce(agents);

      const result = await agentService.listAgents('org-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a-1');
    });

    it('returns empty array when no agents exist', async () => {
      mockWhere.mockResolvedValueOnce([]);
      const result = await agentService.listAgents('org-1');
      expect(result).toEqual([]);
    });
  });

  // ── getAgent ───────────────────────────────────────────────────────────────

  describe('getAgent', () => {
    it('returns agent with data sources when found', async () => {
      const agent = {
        id: 'a-1', name: 'Agent 1', slug: 'agent-1', description: null,
        masterPrompt: 'You are helpful', additionalPrompt: null,
        modelProvider: 'anthropic', modelId: 'claude-sonnet-4-6',
        temperature: 0.7, maxTokens: 4096, responseMode: 'balanced', outputSize: 'standard',
        allowModelOverride: true, status: 'active', systemAgentId: null, isSystemManaged: false,
        heartbeatEnabled: false, heartbeatIntervalHours: null, heartbeatOffsetHours: 0,
        parentAgentId: null, agentRole: null, agentTitle: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      // select agent
      mockWhere.mockResolvedValueOnce([agent]);
      // select data sources (orderBy chain)
      const mockOrderBy = vi.fn().mockResolvedValueOnce([]);
      mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });

      const result = await agentService.getAgent('a-1', 'org-1');
      expect(result.id).toBe('a-1');
      expect(result).toHaveProperty('dataSources');
    });

    it('throws 404 when agent not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(agentService.getAgent('missing', 'org-1')).rejects.toMatchObject({
        statusCode: 404,
        message: 'Agent not found',
      });
    });
  });

  // ── createAgent ────────────────────────────────────────────────────────────

  describe('createAgent', () => {
    it('inserts agent with org scoping and draft status', async () => {
      const created = { id: 'a-new', name: 'New Agent', status: 'draft' };
      mockReturning.mockResolvedValueOnce([created]);

      const result = await agentService.createAgent('org-1', {
        name: 'New Agent',
        masterPrompt: 'You are a test agent',
      });
      expect(result.id).toBe('a-new');
      expect(result.status).toBe('draft');
    });
  });

  // ── updateAgent ────────────────────────────────────────────────────────────

  describe('updateAgent', () => {
    it('updates agent fields', async () => {
      const existing = { id: 'a-1', isSystemManaged: false, organisationId: 'org-1' };
      const updated = { id: 'a-1', name: 'Renamed', status: 'active' };
      mockWhere.mockResolvedValueOnce([existing]);
      mockReturning.mockResolvedValueOnce([updated]);

      const result = await agentService.updateAgent('a-1', 'org-1', { name: 'Renamed' });
      expect(result.name).toBe('Renamed');
    });

    it('throws 404 when updating non-existent agent', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(
        agentService.updateAgent('missing', 'org-1', { name: 'X' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('blocks masterPrompt edits on system-managed agents', async () => {
      const existing = { id: 'a-1', isSystemManaged: true, organisationId: 'org-1' };
      mockWhere.mockResolvedValueOnce([existing]);

      await expect(
        agentService.updateAgent('a-1', 'org-1', { masterPrompt: 'hacked' })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  // ── activateAgent / deactivateAgent ────────────────────────────────────────

  describe('activateAgent', () => {
    it('sets status to active', async () => {
      const existing = { id: 'a-1', isSystemManaged: false, masterPrompt: 'Valid prompt' };
      mockWhere.mockResolvedValueOnce([existing]);
      mockReturning.mockResolvedValueOnce([{ id: 'a-1', status: 'active' }]);

      const result = await agentService.activateAgent('a-1', 'org-1');
      expect(result.status).toBe('active');
    });

    it('throws 404 when agent not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(agentService.activateAgent('missing', 'org-1')).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('rejects activation of non-system-managed agent without masterPrompt', async () => {
      const existing = { id: 'a-1', isSystemManaged: false, masterPrompt: '' };
      mockWhere.mockResolvedValueOnce([existing]);

      await expect(agentService.activateAgent('a-1', 'org-1')).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });

  describe('deactivateAgent', () => {
    it('sets status to inactive', async () => {
      mockWhere.mockResolvedValueOnce([{ id: 'a-1' }]);
      mockReturning.mockResolvedValueOnce([{ id: 'a-1', status: 'inactive' }]);

      const result = await agentService.deactivateAgent('a-1', 'org-1');
      expect(result.status).toBe('inactive');
    });
  });

  // ── deleteAgent ────────────────────────────────────────────────────────────

  describe('deleteAgent', () => {
    it('soft-deletes by setting deletedAt', async () => {
      mockWhere.mockResolvedValueOnce([{ id: 'a-1' }]);
      mockSetWhere.mockResolvedValueOnce(undefined);

      const result = await agentService.deleteAgent('a-1', 'org-1');
      expect(result.message).toBe('Agent deleted successfully');
      expect(mockSet).toHaveBeenCalled();
    });

    it('throws 404 when agent not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(agentService.deleteAgent('missing', 'org-1')).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });
});
