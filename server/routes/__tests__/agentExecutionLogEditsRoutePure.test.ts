/**
 * agentExecutionLogEditsRoutePure.test.ts — Pure tests for the
 * GET /api/agent-runs/:runId/edits response-shape mapper.
 *
 * Tests the DB row → AgentExecutionLogEdit transformation that
 * the route applies before sending the response.
 *
 * No DB, no HTTP. Pure shape assertions.
 *
 * Runnable via:
 *   npx vitest run server/routes/__tests__/agentExecutionLogEditsRoutePure.test.ts
 */

import { expect, test } from 'vitest';
import type { AgentExecutionLogEdit } from '../../../shared/types/agentExecutionLogEdits.js';

// ---------------------------------------------------------------------------
// Inline the mapper — mirrors what the route does after querying the DB.
// If the route mapper changes, this must be updated too.
// ---------------------------------------------------------------------------

interface DbEditRow {
  id: string;
  entityType: string;
  entityId: string;
  editedAt: Date;
  editedByUserId: string;
  editSummary: string;
}

function mapRowToEdit(row: DbEditRow): AgentExecutionLogEdit {
  return {
    id: row.id,
    entityType: row.entityType as AgentExecutionLogEdit['entityType'],
    entityId: row.entityId,
    editedAt: row.editedAt.toISOString(),
    editedByUserId: row.editedByUserId,
    editSummary: row.editSummary,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('full row maps to correct AgentExecutionLogEdit shape', () => {
  const now = new Date('2026-05-16T12:00:00.000Z');
  const row: DbEditRow = {
    id: '00000000-0000-0000-0000-000000000001',
    entityType: 'memory_block',
    entityId: '00000000-0000-0000-0000-000000000002',
    editedAt: now,
    editedByUserId: '00000000-0000-0000-0000-000000000003',
    editSummary: 'Updated content (50→100 chars)',
  };

  const edit = mapRowToEdit(row);

  expect(edit.id).toBe(row.id);
  expect(edit.entityType).toBe('memory_block');
  expect(edit.entityId).toBe(row.entityId);
  expect(edit.editedAt).toBe('2026-05-16T12:00:00.000Z');
  expect(edit.editedByUserId).toBe(row.editedByUserId);
  expect(edit.editSummary).toBe('Updated content (50→100 chars)');
});

test('workspace_memory_summary row maps correctly (sparse — no snapshot fields)', () => {
  const now = new Date('2026-05-16T09:30:00.000Z');
  const row: DbEditRow = {
    id: '00000000-0000-0000-0000-000000000010',
    entityType: 'workspace_memory_summary',
    entityId: '00000000-0000-0000-0000-000000000020',
    editedAt: now,
    editedByUserId: '00000000-0000-0000-0000-000000000030',
    editSummary: 'Updated content (0→250 chars)',
  };

  const edit = mapRowToEdit(row);

  expect(edit.entityType).toBe('workspace_memory_summary');
  expect(edit.editedAt).toBe('2026-05-16T09:30:00.000Z');
  // The shared type does not include snapshot fields — verify no leakage
  expect((edit as unknown as Record<string, unknown>).beforeSnapshot).toBeUndefined();
  expect((edit as unknown as Record<string, unknown>).afterSnapshot).toBeUndefined();
});
