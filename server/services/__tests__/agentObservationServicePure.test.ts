import { describe, it, expect } from 'vitest';
import {
  validateObservationBody,
  detectSupersessionCycle,
  classifyObservation,
  OBSERVATION_BODY_MAX_BYTES,
  SUPERSESSION_DEPTH_LIMIT,
} from '../agentObservationServicePure';

describe('validateObservationBody', () => {
  it('accepts body at exactly 8192 ASCII bytes', () => {
    const body = 'a'.repeat(OBSERVATION_BODY_MAX_BYTES);
    const result = validateObservationBody(body);
    expect(result.ok).toBe(true);
    expect(result.byteLength).toBe(OBSERVATION_BODY_MAX_BYTES);
  });

  it('rejects body exceeding 8192 bytes', () => {
    const body = 'a'.repeat(OBSERVATION_BODY_MAX_BYTES + 1);
    const result = validateObservationBody(body);
    expect(result.ok).toBe(false);
    expect(result.byteLength).toBe(OBSERVATION_BODY_MAX_BYTES + 1);
  });

  it('measures UTF-8 byte length, not JS string length (é is 2 bytes in UTF-8)', () => {
    // 'é' is 2 bytes in UTF-8. 4097 × 'é' = 8194 bytes → over limit
    const body = 'é'.repeat(4097);
    const result = validateObservationBody(body);
    // JS string length = 4097, but byteLength = 8194
    expect(body.length).toBe(4097);
    expect(result.byteLength).toBe(8194);
    expect(result.ok).toBe(false);
  });

  it('accepts é body within 8192 UTF-8 bytes (4096 × é = 8192 bytes)', () => {
    const body = 'é'.repeat(4096);
    const result = validateObservationBody(body);
    expect(result.byteLength).toBe(8192);
    expect(result.ok).toBe(true);
  });
});

describe('detectSupersessionCycle', () => {
  it('returns false for null candidateParentId', () => {
    expect(detectSupersessionCycle([], null)).toBe(false);
  });

  it('returns false for a chain with no cycle', () => {
    const rows = [
      { id: 'A', supersedesObservationId: null },
      { id: 'B', supersedesObservationId: 'A' },
    ];
    // Adding C → B is not a cycle
    expect(detectSupersessionCycle(rows, 'B')).toBe(false);
  });

  it('detects a self-loop (A supersedes A)', () => {
    const rows = [{ id: 'A', supersedesObservationId: 'A' }];
    expect(detectSupersessionCycle(rows, 'A')).toBe(true);
  });

  it('detects a 2-cycle (A → B, B would → A)', () => {
    const rows = [
      { id: 'A', supersedesObservationId: null },
      { id: 'B', supersedesObservationId: 'A' },
    ];
    // If we try to insert C with supersedes = B, and B chain leads to A (acyclic, ok)
    // But if A would supersede the new row — that's tested by a different setup
    // Here: adding a row that supersedes B — B → A → null: no cycle
    expect(detectSupersessionCycle(rows, 'B')).toBe(false);

    // Now simulate B superseding A and A superseding B (2-cycle in existing data)
    const cycleRows = [
      { id: 'A', supersedesObservationId: 'B' },
      { id: 'B', supersedesObservationId: 'A' },
    ];
    expect(detectSupersessionCycle(cycleRows, 'B')).toBe(true);
  });

  it('detects a 3-cycle (A → B → C → A)', () => {
    const rows = [
      { id: 'A', supersedesObservationId: 'C' },
      { id: 'B', supersedesObservationId: 'A' },
      { id: 'C', supersedesObservationId: 'B' },
    ];
    expect(detectSupersessionCycle(rows, 'A')).toBe(true);
  });

  it('returns true when depth limit is exceeded (33-row chain)', () => {
    const rows: { id: string; supersedesObservationId: string | null }[] = [];
    for (let i = 0; i < SUPERSESSION_DEPTH_LIMIT + 1; i++) {
      rows.push({ id: `obs${i}`, supersedesObservationId: i > 0 ? `obs${i - 1}` : null });
    }
    // Chain: obs32 → obs31 → ... → obs0 → null (33 hops)
    expect(detectSupersessionCycle(rows, `obs${SUPERSESSION_DEPTH_LIMIT}`)).toBe(true);
  });

  it('returns false for a 5-row acyclic chain', () => {
    const rows = [
      { id: 'obs0', supersedesObservationId: null },
      { id: 'obs1', supersedesObservationId: 'obs0' },
      { id: 'obs2', supersedesObservationId: 'obs1' },
      { id: 'obs3', supersedesObservationId: 'obs2' },
      { id: 'obs4', supersedesObservationId: 'obs3' },
    ];
    expect(detectSupersessionCycle(rows, 'obs4')).toBe(false);
  });
});

describe('classifyObservation', () => {
  it('maps known event types to observation types', () => {
    expect(classifyObservation('knowledge_learned').type).toBe('learned');
    expect(classifyObservation('anomaly_detected').type).toBe('detected');
    expect(classifyObservation('decision_made').type).toBe('decided');
    expect(classifyObservation('issue_flagged').type).toBe('flagged');
    expect(classifyObservation('artifact_produced').type).toBe('produced');
  });

  it('returns null for unknown event types', () => {
    expect(classifyObservation('unknown_event_xyz').type).toBeNull();
  });

  it('extracts valid sourceKind from metadata', () => {
    const result = classifyObservation('knowledge_learned', { source_kind: 'run_step' });
    expect(result.sourceKind).toBe('run_step');
  });

  it('returns null sourceKind for invalid enum value', () => {
    const result = classifyObservation('knowledge_learned', { source_kind: 'not_a_valid_kind' });
    expect(result.sourceKind).toBeNull();
  });
});
