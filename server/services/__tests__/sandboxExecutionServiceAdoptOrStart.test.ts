/**
 * Pure tests for the adoption-vs-fresh-start decision in the sandbox primitive
 * extension (Chunk 4 — operator-backend build).
 *
 * Tests `decideAdoptOrStart` from sandboxExecutionServicePure.ts and the
 * `SandboxStartKeyConflict` typed error. No DB, no network, no filesystem.
 *
 * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §7.1
 */

import { describe, it, expect } from 'vitest';
import {
  decideAdoptOrStart,
  SandboxStartKeyConflict,
} from '../sandboxExecutionServicePure.js';

const CALLER_EXEC_ID = 'exec-aaaa-0000-0000-000000000001';
const START_KEY = 'op-run-bbbb-0000-0000-000000000001';
const OTHER_EXEC_ID = 'exec-cccc-0000-0000-000000000099';

describe('decideAdoptOrStart', () => {
  describe('(a) no existing row → fresh_start', () => {
    it('returns fresh_start when existingRow is null', () => {
      const decision = decideAdoptOrStart({
        callerExecutionId: CALLER_EXEC_ID,
        sandboxStartKey: START_KEY,
        existingRow: null,
      });
      expect(decision.action).toBe('fresh_start');
    });
  });

  describe('(b) existing row in `pending` with matching start-key → adopt', () => {
    it('returns adopt with the existing execution id', () => {
      const decision = decideAdoptOrStart({
        callerExecutionId: CALLER_EXEC_ID,
        sandboxStartKey: START_KEY,
        existingRow: { id: CALLER_EXEC_ID, status: 'pending' },
      });
      expect(decision.action).toBe('adopt');
      if (decision.action === 'adopt') {
        expect(decision.existingExecutionId).toBe(CALLER_EXEC_ID);
      }
    });
  });

  describe('(c) existing row in `running` with matching start-key → adopt', () => {
    it('returns adopt for running status', () => {
      const decision = decideAdoptOrStart({
        callerExecutionId: CALLER_EXEC_ID,
        sandboxStartKey: START_KEY,
        existingRow: { id: CALLER_EXEC_ID, status: 'running' },
      });
      expect(decision.action).toBe('adopt');
      if (decision.action === 'adopt') {
        expect(decision.existingExecutionId).toBe(CALLER_EXEC_ID);
      }
    });

    it('returns adopt for harvesting status', () => {
      const decision = decideAdoptOrStart({
        callerExecutionId: CALLER_EXEC_ID,
        sandboxStartKey: START_KEY,
        existingRow: { id: CALLER_EXEC_ID, status: 'harvesting' },
      });
      expect(decision.action).toBe('adopt');
    });
  });

  describe('(d) existing row in terminal state → fresh_start (fall through to runTask Case 3)', () => {
    const terminalStatuses = [
      'completed',
      'timed_out',
      'cost_ceiling_hit',
      'crashed',
      'output_validation_failed',
      'harvest_failed',
      'artefact_upload_failed',
      'provider_unavailable',
    ] as const;

    for (const status of terminalStatuses) {
      it(`returns fresh_start for terminal status '${status}'`, () => {
        const decision = decideAdoptOrStart({
          callerExecutionId: CALLER_EXEC_ID,
          sandboxStartKey: START_KEY,
          existingRow: { id: CALLER_EXEC_ID, status },
        });
        expect(decision.action).toBe('fresh_start');
      });
    }
  });

  describe('(e) start-key conflict with different sandboxExecutionId → conflict', () => {
    it('returns conflict when existing live row has a different execution id', () => {
      const decision = decideAdoptOrStart({
        callerExecutionId: CALLER_EXEC_ID,
        sandboxStartKey: START_KEY,
        existingRow: { id: OTHER_EXEC_ID, status: 'running' },
      });
      expect(decision.action).toBe('conflict');
      if (decision.action === 'conflict') {
        expect(decision.existingExecutionId).toBe(OTHER_EXEC_ID);
      }
    });

    it('reports conflict for pending row with different execution id', () => {
      const decision = decideAdoptOrStart({
        callerExecutionId: CALLER_EXEC_ID,
        sandboxStartKey: START_KEY,
        existingRow: { id: OTHER_EXEC_ID, status: 'pending' },
      });
      expect(decision.action).toBe('conflict');
    });

    it('does NOT report conflict when terminal row has a different execution id (terminal rows fall through)', () => {
      // Terminal rows are excluded from adoption — conflict check only applies to live rows.
      const decision = decideAdoptOrStart({
        callerExecutionId: CALLER_EXEC_ID,
        sandboxStartKey: START_KEY,
        existingRow: { id: OTHER_EXEC_ID, status: 'completed' },
      });
      expect(decision.action).toBe('fresh_start');
    });
  });
});

describe('SandboxStartKeyConflict', () => {
  it('is an Error subclass with correct properties', () => {
    const err = new SandboxStartKeyConflict(START_KEY, OTHER_EXEC_ID, CALLER_EXEC_ID);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SandboxStartKeyConflict');
    expect(err.sandboxStartKey).toBe(START_KEY);
    expect(err.existingExecutionId).toBe(OTHER_EXEC_ID);
    expect(err.callerExecutionId).toBe(CALLER_EXEC_ID);
    expect(err.message).toContain(START_KEY);
    expect(err.message).toContain(OTHER_EXEC_ID);
    expect(err.message).toContain(CALLER_EXEC_ID);
  });
});
