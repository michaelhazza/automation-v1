// Pure unit test for resolveActiveRunForTask — mocks the DB layer.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB module before importing the service
vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
}));

import { resolveActiveRunForTask } from '../workflowRunResolverService.js';
import { db } from '../../db/index.js';

describe('resolveActiveRunForTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the chain for each test
    const mockDb = db as unknown as Record<string, ReturnType<typeof vi.fn>>;
    mockDb['select'].mockReturnValue(mockDb);
    mockDb['from'].mockReturnValue(mockDb);
    mockDb['where'].mockReturnValue(mockDb);
  });

  it('returns runId when an active run exists', async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'run-123' }]),
        }),
      }),
    });
    const result = await resolveActiveRunForTask('task-abc', 'org-xyz');
    expect(result).toBe('run-123');
  });

  it('returns null when no active run exists', async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const result = await resolveActiveRunForTask('task-abc', 'org-xyz');
    expect(result).toBeNull();
  });
});
