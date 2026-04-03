import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock variables
// ---------------------------------------------------------------------------
const { mockReturning, mockWhere, mockFrom, mockOnConflict, mockValues } = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockOnConflict = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict, returning: mockReturning });
  const mockWhere = vi.fn();
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  return { mockReturning, mockWhere, mockFrom, mockOnConflict, mockValues };
});

const mockDeleteWhere = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockExecute = vi.hoisted(() => vi.fn());

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn() }),
    }),
    execute: mockExecute,
  },
}));

import { subaccountTagService } from '../../../../server/services/subaccountTagService.js';

describe('subaccountTagService', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── setTag ─────────────────────────────────────────────────────────────────

  describe('setTag', () => {
    it('upserts a tag and returns the result', async () => {
      const tag = { id: 'tag-1', organisationId: 'org-1', subaccountId: 'sa-1', key: 'vertical', value: 'dental' };
      mockReturning.mockResolvedValueOnce([tag]);

      const result = await subaccountTagService.setTag('org-1', 'sa-1', 'vertical', 'dental');
      expect(result).toEqual(tag);
      expect(mockOnConflict).toHaveBeenCalled();
    });

    it('handles updating an existing tag (conflict path)', async () => {
      const updated = { id: 'tag-1', key: 'vertical', value: 'medical' };
      mockReturning.mockResolvedValueOnce([updated]);

      const result = await subaccountTagService.setTag('org-1', 'sa-1', 'vertical', 'medical');
      expect(result.value).toBe('medical');
    });
  });

  // ── removeTag ──────────────────────────────────────────────────────────────

  describe('removeTag', () => {
    it('deletes the tag matching org, subaccount, and key', async () => {
      await subaccountTagService.removeTag('org-1', 'sa-1', 'vertical');
      expect(mockDeleteWhere).toHaveBeenCalled();
    });
  });

  // ── getTags ────────────────────────────────────────────────────────────────

  describe('getTags', () => {
    it('returns all tags for a subaccount', async () => {
      const tags = [
        { id: 'tag-1', key: 'vertical', value: 'dental' },
        { id: 'tag-2', key: 'region', value: 'northeast' },
      ];
      mockWhere.mockResolvedValueOnce(tags);

      const result = await subaccountTagService.getTags('org-1', 'sa-1');
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no tags exist', async () => {
      mockWhere.mockResolvedValueOnce([]);
      const result = await subaccountTagService.getTags('org-1', 'sa-1');
      expect(result).toEqual([]);
    });
  });

  // ── getSubaccountsByTags ───────────────────────────────────────────────────

  describe('getSubaccountsByTags', () => {
    it('returns all active subaccounts when no filters provided', async () => {
      const rows = [{ id: 'sa-1' }, { id: 'sa-2' }];
      mockWhere.mockResolvedValueOnce(rows);

      const result = await subaccountTagService.getSubaccountsByTags('org-1', []);
      expect(result).toEqual(['sa-1', 'sa-2']);
    });

    it('returns matching subaccount IDs with AND logic', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [{ subaccount_id: 'sa-1' }] });

      const result = await subaccountTagService.getSubaccountsByTags('org-1', [
        { key: 'vertical', value: 'dental' },
        { key: 'region', value: 'northeast' },
      ]);

      expect(result).toEqual(['sa-1']);
      expect(mockExecute).toHaveBeenCalled();
    });

    it('returns empty array when no subaccounts match', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      const result = await subaccountTagService.getSubaccountsByTags('org-1', [
        { key: 'vertical', value: 'nonexistent' },
      ]);

      expect(result).toEqual([]);
    });
  });

  // ── bulkSetTag ─────────────────────────────────────────────────────────────

  describe('bulkSetTag', () => {
    it('applies tag to multiple subaccounts', async () => {
      mockOnConflict.mockResolvedValueOnce(undefined);

      await subaccountTagService.bulkSetTag('org-1', ['sa-1', 'sa-2'], 'tier', 'premium');
      expect(mockValues).toHaveBeenCalled();
    });

    it('does nothing when subaccountIds array is empty', async () => {
      await subaccountTagService.bulkSetTag('org-1', [], 'tier', 'premium');
      // insert should not be called for empty array
      expect(mockValues).not.toHaveBeenCalled();
    });
  });

  // ── listTagKeys ────────────────────────────────────────────────────────────

  describe('listTagKeys', () => {
    it('returns distinct tag keys for an org', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [{ key: 'region' }, { key: 'vertical' }] });

      const result = await subaccountTagService.listTagKeys('org-1');
      expect(result).toEqual(['region', 'vertical']);
    });

    it('returns empty array when no tags exist', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [] });

      const result = await subaccountTagService.listTagKeys('org-1');
      expect(result).toEqual([]);
    });
  });
});
