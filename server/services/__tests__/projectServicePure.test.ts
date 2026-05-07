/**
 * projectServicePure.test.ts — Pure mapper tests for projectService.
 *
 * Covers: toApiProject and fromApiPatch field mapping, unit conversions,
 * null/undefined handling, and array clearing.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/projectServicePure.test.ts
 */

import { expect, test } from 'vitest';
import { toApiProject, fromApiPatch } from '../projectService.js';
import type { ProjectPatch } from '../projectService.js';

// ---------------------------------------------------------------------------
// Minimal project row factory (matches typeof projects.$inferSelect shape)
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'proj-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    name: 'Test Project',
    description: null,
    status: 'active',
    color: '#6366f1',
    objective: null,
    targetDate: null,
    budgetCents: null,
    budgetWarningPercent: 75,
    repoUrl: null,
    linkedAgentIds: [],
    migratedFromGoalsAt: null,
    githubConnectionId: null,
    goalId: null,
    createdBy: null,
    sourceTemplateId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as Parameters<typeof toApiProject>[0];
}

// ---------------------------------------------------------------------------
// fromApiPatch tests
// ---------------------------------------------------------------------------

test('fromApiPatch: budgetUsd 5000 converts to budgetCents 500000', () => {
  const result = fromApiPatch({ budgetUsd: 5000 } as ProjectPatch);
  expect(result.budgetCents).toBe(500000);
});

test('fromApiPatch: budgetUsd 0 converts to budgetCents 0 (not null)', () => {
  const result = fromApiPatch({ budgetUsd: 0 } as ProjectPatch);
  expect(result.budgetCents).toBe(0);
});

test('fromApiPatch: targetDate null sets targetDate to null', () => {
  const result = fromApiPatch({ targetDate: null } as ProjectPatch);
  expect(result.targetDate).toBeNull();
});

test('fromApiPatch: targetDate string sets targetDate to a Date object', () => {
  const result = fromApiPatch({ targetDate: '2026-12-01' } as ProjectPatch);
  expect(result.targetDate).toBeInstanceOf(Date);
  expect((result.targetDate as Date).toISOString().startsWith('2026-12-01')).toBe(true);
});

test('fromApiPatch: missing field produces no key in output', () => {
  const result = fromApiPatch({});
  expect('name' in result).toBe(false);
  expect('budgetCents' in result).toBe(false);
  expect('targetDate' in result).toBe(false);
});

test('fromApiPatch: linkedAgents empty array sets linkedAgentIds to empty array', () => {
  const result = fromApiPatch({ linkedAgents: [] } as ProjectPatch);
  expect(result.linkedAgentIds).toEqual([]);
});

test('fromApiPatch: budgetUsd null sets budgetCents to null', () => {
  const result = fromApiPatch({ budgetUsd: null } as ProjectPatch);
  expect(result.budgetCents).toBeNull();
});

// ---------------------------------------------------------------------------
// toApiProject tests
// ---------------------------------------------------------------------------

test('toApiProject: budgetCents 500000 converts to budgetUsd 5000', () => {
  const project = toApiProject(makeRow({ budgetCents: 500000 }));
  expect(project.budgetUsd).toBe(5000);
});

test('toApiProject: budgetCents null yields budgetUsd null', () => {
  const project = toApiProject(makeRow({ budgetCents: null }));
  expect(project.budgetUsd).toBeNull();
});

test('toApiProject: linkedAgentIds null/undefined yields linkedAgents empty array', () => {
  const projectNull = toApiProject(makeRow({ linkedAgentIds: null }));
  expect(projectNull.linkedAgents).toEqual([]);

  const projectUndef = toApiProject(makeRow({ linkedAgentIds: undefined }));
  expect(projectUndef.linkedAgents).toEqual([]);
});
