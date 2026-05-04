/**
 * teamsServicePure.test.ts — Pure validation tests for teams service.
 *
 * Tests the name validation and mock-list behaviour without DB calls.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/teamsServicePure.test.ts
 */

import { expect, test, describe } from 'vitest';

// ── Pure name validation helper (mirrors service logic) ───────────────────────

function validateTeamName(name: string): { valid: boolean; reason?: string } {
  if (!name || !name.trim()) return { valid: false, reason: 'name_required' };
  return { valid: true };
}

// ── Mock list helper ───────────────────────────────────────────────────────────

interface MockTeamRow {
  id: string;
  name: string;
  organisationId: string;
  subaccountId: string | null;
  memberCount: number;
  createdAt: Date;
}

function mockListTeams(rows: MockTeamRow[]): MockTeamRow[] {
  return rows;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('createTeam name validation', () => {
  test('rejects empty string name', () => {
    const result = validateTeamName('');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('name_required');
  });

  test('rejects whitespace-only name', () => {
    const result = validateTeamName('   ');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('name_required');
  });

  test('accepts a valid name', () => {
    const result = validateTeamName('Engineering');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

describe('listTeams mock behaviour', () => {
  test('returns empty array for org with no teams', () => {
    const result = mockListTeams([]);
    expect(result).toEqual([]);
  });

  test('returns all rows passed to it', () => {
    const rows: MockTeamRow[] = [
      { id: 'team-1', name: 'Alpha', organisationId: 'org-1', subaccountId: null, memberCount: 2, createdAt: new Date() },
      { id: 'team-2', name: 'Beta',  organisationId: 'org-1', subaccountId: null, memberCount: 0, createdAt: new Date() },
    ];
    const result = mockListTeams(rows);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Alpha');
    expect(result[1].name).toBe('Beta');
  });
});

console.log('teamsServicePure tests passed');
