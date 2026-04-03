import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock variables
// ---------------------------------------------------------------------------
const { mockReturning, mockWhere, mockFrom, mockOrderBy } = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockOrderBy = vi.fn();
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere, orderBy: mockOrderBy });
  return { mockReturning, mockWhere, mockFrom, mockOrderBy };
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

import { skillService } from '../../../../server/services/skillService.js';

describe('skillService', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── listSkills ─────────────────────────────────────────────────────────────

  describe('listSkills', () => {
    it('returns skills for an org (org-specific + built-in)', async () => {
      const mockSkills = [
        { id: 's-1', name: 'Web Search', organisationId: null },
        { id: 's-2', name: 'Custom Skill', organisationId: 'org-1' },
      ];
      mockOrderBy.mockResolvedValueOnce(mockSkills);

      const result = await skillService.listSkills('org-1');
      expect(result).toHaveLength(2);
      expect(mockFrom).toHaveBeenCalled();
    });

    it('returns only built-in skills when no orgId provided', async () => {
      const mockSkills = [{ id: 's-1', name: 'Web Search', organisationId: null }];
      mockOrderBy.mockResolvedValueOnce(mockSkills);

      const result = await skillService.listSkills();
      expect(result).toHaveLength(1);
    });
  });

  // ── getSkill ───────────────────────────────────────────────────────────────

  describe('getSkill', () => {
    it('returns skill when found', async () => {
      const skill = { id: 's-1', name: 'Web Search', isActive: true };
      mockWhere.mockResolvedValueOnce([skill]);

      const result = await skillService.getSkill('s-1', 'org-1');
      expect(result.id).toBe('s-1');
    });

    it('throws 404 when skill not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(skillService.getSkill('missing', 'org-1')).rejects.toMatchObject({
        statusCode: 404,
        message: 'Skill not found',
      });
    });
  });

  // ── getSkillBySlug ─────────────────────────────────────────────────────────

  describe('getSkillBySlug', () => {
    it('prefers org-specific skill over built-in', async () => {
      const builtIn = { id: 's-1', slug: 'web_search', organisationId: null };
      const orgSkill = { id: 's-2', slug: 'web_search', organisationId: 'org-1' };
      mockWhere.mockResolvedValueOnce([builtIn, orgSkill]);

      const result = await skillService.getSkillBySlug('web_search', 'org-1');
      expect(result!.id).toBe('s-2');
    });

    it('falls back to built-in when no org-specific skill exists', async () => {
      const builtIn = { id: 's-1', slug: 'web_search', organisationId: null };
      mockWhere.mockResolvedValueOnce([builtIn]);

      const result = await skillService.getSkillBySlug('web_search', 'org-1');
      expect(result!.id).toBe('s-1');
    });

    it('returns null when slug not found', async () => {
      mockWhere.mockResolvedValueOnce([]);

      const result = await skillService.getSkillBySlug('nonexistent', 'org-1');
      expect(result).toBeNull();
    });
  });

  // ── createSkill ────────────────────────────────────────────────────────────

  describe('createSkill', () => {
    it('inserts a new custom skill with org scoping', async () => {
      const created = { id: 's-new', name: 'My Skill', organisationId: 'org-1', skillType: 'custom' };
      mockReturning.mockResolvedValueOnce([created]);

      const result = await skillService.createSkill('org-1', {
        name: 'My Skill',
        slug: 'my_skill',
        definition: { name: 'my_skill', description: 'test', input_schema: { type: 'object', properties: {} } },
      });
      expect(result.id).toBe('s-new');
      expect(result.organisationId).toBe('org-1');
    });
  });

  // ── resolveSkillsForAgent ──────────────────────────────────────────────────

  describe('resolveSkillsForAgent', () => {
    it('returns empty tools and instructions for empty slugs', async () => {
      const result = await skillService.resolveSkillsForAgent([], 'org-1');
      expect(result.tools).toEqual([]);
      expect(result.instructions).toEqual([]);
    });

    it('resolves tools and instructions from skill slugs', async () => {
      const skill = {
        id: 's-1',
        slug: 'web_search',
        organisationId: null,
        definition: { name: 'web_search', description: 'Search the web', input_schema: { type: 'object', properties: {} } },
        instructions: 'Use web search when needed.',
        methodology: 'Phase 1: Broad Scan',
      };
      // getSkillBySlug internal query
      mockWhere.mockResolvedValueOnce([skill]);

      const result = await skillService.resolveSkillsForAgent(['web_search'], 'org-1');
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('web_search');
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0]).toContain('Use web search');
    });

    it('skips skills that are not found', async () => {
      mockWhere.mockResolvedValueOnce([]);

      const result = await skillService.resolveSkillsForAgent(['nonexistent'], 'org-1');
      expect(result.tools).toEqual([]);
      expect(result.instructions).toEqual([]);
    });
  });
});
