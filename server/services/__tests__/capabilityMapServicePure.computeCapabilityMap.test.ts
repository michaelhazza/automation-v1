/**
 * capabilityMapServicePure.computeCapabilityMap.test.ts
 *
 * Pure-function tests for computeCapabilityMapPure — specifically the V2
 * owner_user_id extension (personal-assistant-v2-operator spec §5.1).
 *
 * Run via:
 *   npx vitest run server/services/__tests__/capabilityMapServicePure.computeCapabilityMap.test.ts
 */

import { describe, it, expect } from 'vitest';
import { computeCapabilityMapPure } from '../capabilityMapService.js';
import type { IntegrationReferenceSnapshot } from '../integrationReferenceService.js';

// ---------------------------------------------------------------------------
// Minimal snapshot fixture — no integrations, so results are purely
// derived from skill/option inputs. Sufficient for owner_user_id tests.
// ---------------------------------------------------------------------------

const EMPTY_TAXONOMY = {
  read_capabilities: [],
  write_capabilities: [],
  skills: [],
  primitives: [],
};

function makeSnapshot(overrides: Partial<IntegrationReferenceSnapshot> = {}): IntegrationReferenceSnapshot {
  return {
    schema_meta: { schema_version: '1', last_updated: '2026-01-01T00:00:00Z' },
    integrations: [],
    capability_taxonomy: EMPTY_TAXONOMY,
    reference_state: 'healthy',
    parse_errors: [],
    source_path: '/dev/null',
    ...overrides,
  };
}

const SNAPSHOT = makeSnapshot();
const NO_SKILLS: string[] = [];
const DEFAULT_OPTIONS = { scheduleEnabled: false, heartbeatEnabled: false };

// ---------------------------------------------------------------------------
// owner_user_id emission
// ---------------------------------------------------------------------------

describe('computeCapabilityMapPure — owner_user_id', () => {
  it('includes owner_user_id when agentRow.owner_user_id is a non-null string', () => {
    const map = computeCapabilityMapPure(
      NO_SKILLS,
      SNAPSHOT,
      DEFAULT_OPTIONS,
      { owner_user_id: 'user-uuid-123' },
    );
    expect(map.owner_user_id).toBe('user-uuid-123');
  });

  it('omits owner_user_id when agentRow.owner_user_id is null', () => {
    const map = computeCapabilityMapPure(
      NO_SKILLS,
      SNAPSHOT,
      DEFAULT_OPTIONS,
      { owner_user_id: null },
    );
    expect(map.owner_user_id).toBeUndefined();
  });

  it('omits owner_user_id when agentRow.owner_user_id is undefined', () => {
    const map = computeCapabilityMapPure(
      NO_SKILLS,
      SNAPSHOT,
      DEFAULT_OPTIONS,
      { owner_user_id: undefined },
    );
    expect(map.owner_user_id).toBeUndefined();
  });

  it('omits owner_user_id when agentRow is not supplied (legacy call signature)', () => {
    const map = computeCapabilityMapPure(NO_SKILLS, SNAPSHOT, DEFAULT_OPTIONS);
    expect(map.owner_user_id).toBeUndefined();
  });

  it('omits owner_user_id when agentRow argument is omitted entirely', () => {
    // Ensures all pre-V2 call sites remain unaffected
    const map = computeCapabilityMapPure(['send_email'], SNAPSHOT);
    expect(map.owner_user_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Determinism across input permutations
// ---------------------------------------------------------------------------

describe('computeCapabilityMapPure — determinism', () => {
  const SKILL_SET_A = ['send_email', 'create_task', 'send_slack'];
  const SKILL_SET_A_PERMUTED = ['send_slack', 'send_email', 'create_task'];

  it('produces identical sorted skills regardless of input order', () => {
    const mapA = computeCapabilityMapPure(SKILL_SET_A, SNAPSHOT, DEFAULT_OPTIONS);
    const mapB = computeCapabilityMapPure(SKILL_SET_A_PERMUTED, SNAPSHOT, DEFAULT_OPTIONS);
    expect(mapA.skills).toEqual(mapB.skills);
  });

  it('produces identical integrations regardless of input order', () => {
    const mapA = computeCapabilityMapPure(SKILL_SET_A, SNAPSHOT, DEFAULT_OPTIONS);
    const mapB = computeCapabilityMapPure(SKILL_SET_A_PERMUTED, SNAPSHOT, DEFAULT_OPTIONS);
    expect(mapA.integrations).toEqual(mapB.integrations);
  });

  it('includes owner_user_id deterministically across permutations', () => {
    const mapA = computeCapabilityMapPure(
      SKILL_SET_A,
      SNAPSHOT,
      DEFAULT_OPTIONS,
      { owner_user_id: 'user-abc' },
    );
    const mapB = computeCapabilityMapPure(
      SKILL_SET_A_PERMUTED,
      SNAPSHOT,
      DEFAULT_OPTIONS,
      { owner_user_id: 'user-abc' },
    );
    expect(mapA.owner_user_id).toBe('user-abc');
    expect(mapB.owner_user_id).toBe('user-abc');
    expect(mapA.skills).toEqual(mapB.skills);
  });

  it('always includes task_board primitive regardless of skills', () => {
    const map = computeCapabilityMapPure(NO_SKILLS, SNAPSHOT, DEFAULT_OPTIONS);
    expect(map.primitives).toContain('task_board');
  });
});
