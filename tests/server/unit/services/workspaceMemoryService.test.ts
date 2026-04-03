import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockDb, mockRouteCall, mockTaskService, mockGenerateEmbedding } = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([{ id: 'mem-1', runsSinceSummary: 0, qualityThreshold: 0.3, version: 1, summary: null, boardSummary: null }]);
  const mockInsertValues = vi.fn().mockReturnValue({ returning: mockReturning, onConflictDoNothing: vi.fn() });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
  const mockUpdateWhere = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) });
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });
  const mockDeleteWhere = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'entry-1' }]) });
  const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });
  const mockSelectOffset = vi.fn().mockResolvedValue([]);
  const mockSelectLimit = vi.fn().mockReturnValue({ offset: mockSelectOffset });
  const mockSelectOrderBy = vi.fn().mockReturnValue({ limit: mockSelectLimit });
  const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy });
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });
  const mockExecute = vi.fn().mockResolvedValue([]);

  return {
    mockDb: {
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
      execute: mockExecute,
      _selectWhere: mockSelectWhere,
      _selectFrom: mockSelectFrom,
      _returning: mockReturning,
      _insertValues: mockInsertValues,
      _updateSet: mockUpdateSet,
      _updateWhere: mockUpdateWhere,
      _deleteWhere: mockDeleteWhere,
      _selectOrderBy: mockSelectOrderBy,
    },
    mockRouteCall: vi.fn(),
    mockTaskService: { listTasks: vi.fn().mockResolvedValue([]) },
    mockGenerateEmbedding: vi.fn().mockResolvedValue(null),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../server/db/index.js', () => ({ db: mockDb }));

vi.mock('../../../../server/db/schema/index.js', () => ({
  workspaceMemories: {
    id: 'id',
    organisationId: 'organisationId',
    subaccountId: 'subaccountId',
    summary: 'summary',
    boardSummary: 'boardSummary',
    qualityThreshold: 'qualityThreshold',
    runsSinceSummary: 'runsSinceSummary',
    summaryThreshold: 'summaryThreshold',
    version: 'version',
    summaryGeneratedAt: 'summaryGeneratedAt',
    updatedAt: 'updatedAt',
    createdAt: 'createdAt',
  },
  workspaceMemoryEntries: {
    id: 'id',
    organisationId: 'organisationId',
    subaccountId: 'subaccountId',
    agentRunId: 'agentRunId',
    agentId: 'agentId',
    content: 'content',
    entryType: 'entryType',
    qualityScore: 'qualityScore',
    includedInSummary: 'includedInSummary',
    accessCount: 'accessCount',
    lastAccessedAt: 'lastAccessedAt',
    taskSlug: 'taskSlug',
    createdAt: 'createdAt',
  },
  workspaceEntities: {
    id: 'id',
    organisationId: 'organisationId',
    subaccountId: 'subaccountId',
    name: 'name',
    displayName: 'displayName',
    entityType: 'entityType',
    attributes: 'attributes',
    confidence: 'confidence',
    mentionCount: 'mentionCount',
    firstSeenAt: 'firstSeenAt',
    lastSeenAt: 'lastSeenAt',
    deletedAt: 'deletedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}));

vi.mock('../../../../server/services/llmRouter.js', () => ({
  routeCall: mockRouteCall,
}));

vi.mock('../../../../server/services/taskService.js', () => ({
  taskService: mockTaskService,
}));

vi.mock('../../../../server/lib/embeddings.js', () => ({
  generateEmbedding: mockGenerateEmbedding,
  formatVectorLiteral: vi.fn().mockReturnValue('[0.1,0.2]'),
}));

vi.mock('../../../../server/config/limits.js', () => ({
  EXTRACTION_MODEL: 'claude-haiku-4-5',
  EXTRACTION_MAX_TOKENS: 2048,
  SUMMARY_MAX_TOKENS: 4096,
  DEFAULT_ENTRY_LIMIT: 50,
  VALID_ENTRY_TYPES: ['observation', 'decision', 'preference', 'issue', 'pattern'],
  MIN_MEMORY_CONTENT_LENGTH: 10,
  MAX_PROMPT_ENTITIES: 20,
  MAX_ENTITIES_PER_EXTRACTION: 10,
  MIN_ENTITY_CONFIDENCE: 0.7,
  MAX_ENTITY_ATTRIBUTES: 5,
  VECTOR_SEARCH_LIMIT: 10,
  VECTOR_SIMILARITY_THRESHOLD: 0.3,
  VECTOR_SEARCH_RECENCY_DAYS: 30,
  ABBREVIATED_SUMMARY_LENGTH: 500,
  MIN_QUERY_CONTEXT_LENGTH: 50,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((arg: unknown) => arg),
  inArray: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
  isNull: vi.fn((arg: unknown) => arg),
  lt: vi.fn((...args: unknown[]) => args),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { workspaceMemoryService } from '../../../../server/services/workspaceMemoryService.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workspaceMemoryService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getOrCreateMemory', () => {
    it('returns existing memory when found', async () => {
      const existing = { id: 'mem-1', organisationId: 'org-1', subaccountId: 'sa-1', summary: 'test' };
      mockDb._selectWhere.mockReturnValueOnce(Promise.resolve([existing]));

      const result = await workspaceMemoryService.getOrCreateMemory('org-1', 'sa-1');
      expect(result).toEqual(existing);
    });

    it('creates new memory when not found', async () => {
      const created = { id: 'mem-new', organisationId: 'org-1', subaccountId: 'sa-1', runsSinceSummary: 0, qualityThreshold: 0.3, version: 1 };
      // First call: getMemory returns empty
      mockDb._selectWhere.mockReturnValueOnce(Promise.resolve([]));
      // Insert returning
      mockDb._returning.mockResolvedValueOnce([created]);

      const result = await workspaceMemoryService.getOrCreateMemory('org-1', 'sa-1');
      expect(result).toEqual(created);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('getMemory', () => {
    it('returns null when no memory exists', async () => {
      mockDb._selectWhere.mockReturnValueOnce(Promise.resolve([]));
      const result = await workspaceMemoryService.getMemory('org-1', 'sa-1');
      expect(result).toBeNull();
    });

    it('returns memory when it exists', async () => {
      const memory = { id: 'mem-1', summary: 'test summary' };
      mockDb._selectWhere.mockReturnValueOnce(Promise.resolve([memory]));
      const result = await workspaceMemoryService.getMemory('org-1', 'sa-1');
      expect(result).toEqual(memory);
    });
  });

  describe('deleteEntry', () => {
    it('deletes and returns the entry', async () => {
      const deleted = { id: 'entry-1', content: 'test' };
      mockDb._deleteWhere.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([deleted]) });

      const result = await workspaceMemoryService.deleteEntry('entry-1', 'org-1', 'sa-1');
      expect(result).toEqual(deleted);
    });

    it('returns null when entry not found', async () => {
      mockDb._deleteWhere.mockReturnValueOnce({ returning: vi.fn().mockResolvedValue([]) });

      const result = await workspaceMemoryService.deleteEntry('missing', 'org-1', 'sa-1');
      expect(result).toBeNull();
    });
  });

  describe('getMemoryForPrompt', () => {
    it('returns null when no memory or summary exists', async () => {
      mockDb._selectWhere.mockReturnValueOnce(Promise.resolve([]));

      const result = await workspaceMemoryService.getMemoryForPrompt('org-1', 'sa-1');
      expect(result).toBeNull();
    });

    it('returns formatted summary with boundary markers', async () => {
      mockDb._selectWhere.mockReturnValueOnce(Promise.resolve([{
        id: 'mem-1',
        summary: 'Client prefers informal tone.',
        qualityThreshold: 0.3,
      }]));

      const result = await workspaceMemoryService.getMemoryForPrompt('org-1', 'sa-1');

      expect(result).toContain('### Shared Workspace Memory');
      expect(result).toContain('<workspace-memory-data>');
      expect(result).toContain('Client prefers informal tone.');
      expect(result).toContain('</workspace-memory-data>');
    });

    it('falls back to compiled summary when semantic search returns no results', async () => {
      const memory = { id: 'mem-1', summary: 'Summary here', qualityThreshold: 0.3 };
      // getMemory call
      mockDb._selectWhere.mockReturnValueOnce(Promise.resolve([memory]));
      // Mock embedding generation succeeds but vector search returns empty
      mockGenerateEmbedding.mockResolvedValueOnce([0.1, 0.2, 0.3]);
      mockDb.execute.mockResolvedValueOnce([]);

      const longContext = 'A'.repeat(60); // Above MIN_QUERY_CONTEXT_LENGTH
      const result = await workspaceMemoryService.getMemoryForPrompt('org-1', 'sa-1', longContext);

      // Falls back to compiled summary
      expect(result).toContain('Summary here');
      expect(result).toContain('<workspace-memory-data>');
    });
  });

  describe('getEntitiesForPrompt', () => {
    it('returns null when no entities exist', async () => {
      mockDb._selectWhere.mockReturnValueOnce({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      });

      // Need to mock the full chain since getEntitiesForPrompt uses orderBy.limit
      const result = await workspaceMemoryService.getEntitiesForPrompt('sa-1');
      // The default mockSelectWhere chain returns [] via orderBy chain
      expect(result).toBeNull();
    });
  });

  describe('listEntries', () => {
    it('returns entries for subaccount', async () => {
      const entries = [
        { id: 'e-1', content: 'Entry 1', entryType: 'observation' },
        { id: 'e-2', content: 'Entry 2', entryType: 'preference' },
      ];

      // The chain: where -> orderBy -> limit -> offset
      const mockOffset = vi.fn().mockResolvedValue(entries);
      const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
      mockDb._selectWhere.mockReturnValueOnce({ orderBy: mockOrderBy });

      const result = await workspaceMemoryService.listEntries('sa-1', { limit: 10, offset: 0 });
      expect(result).toEqual(entries);
    });
  });

  describe('updateSummary', () => {
    it('updates the summary on an existing memory', async () => {
      // getOrCreateMemory returns existing
      mockDb._selectWhere.mockReturnValueOnce(Promise.resolve([
        { id: 'mem-1', runsSinceSummary: 0, qualityThreshold: 0.3, version: 1 },
      ]));
      mockDb._updateWhere.mockReturnValueOnce({
        returning: vi.fn().mockResolvedValue([{ id: 'mem-1', summary: 'Updated summary' }]),
      });

      const result = await workspaceMemoryService.updateSummary('org-1', 'sa-1', 'Updated summary');
      expect(mockDb.update).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('getBoardSummaryForPrompt', () => {
    it('returns null when no board summary exists', async () => {
      mockDb._selectWhere.mockReturnValueOnce(Promise.resolve([{ id: 'mem-1', boardSummary: null }]));

      const result = await workspaceMemoryService.getBoardSummaryForPrompt('org-1', 'sa-1');
      expect(result).toBeNull();
    });

    it('returns formatted board summary with boundaries', async () => {
      mockDb._selectWhere.mockReturnValueOnce(Promise.resolve([{
        id: 'mem-1',
        boardSummary: '3 tasks in progress, 1 blocked',
      }]));

      const result = await workspaceMemoryService.getBoardSummaryForPrompt('org-1', 'sa-1');
      expect(result).toContain('<workspace-memory-data>');
      expect(result).toContain('3 tasks in progress');
      expect(result).toContain('</workspace-memory-data>');
    });
  });
});
