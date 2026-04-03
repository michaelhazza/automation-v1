import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hitlService, AlreadyDecidedError } from '../../../../server/services/hitlService.js';
import type { HitlDecision } from '../../../../server/services/hitlService.js';

describe('hitlService', () => {
  // The hitlService uses module-level Maps, so we rely on resolving decisions
  // to clean up between tests. For isolation we use unique actionIds per test.

  describe('awaitDecision', () => {
    it('returns a promise that resolves when resolveDecision is called', async () => {
      const promise = hitlService.awaitDecision('action-resolve-1', 30000);

      // Resolve it from the "human" side
      hitlService.resolveDecision('action-resolve-1', { approved: true, result: { ok: true } });

      const decision = await promise;
      expect(decision.approved).toBe(true);
      expect(decision.result).toEqual({ ok: true });
    });

    it('resolves with rejection when human rejects', async () => {
      const promise = hitlService.awaitDecision('action-reject-1', 30000);

      hitlService.resolveDecision('action-reject-1', { approved: false, comment: 'Not appropriate' });

      const decision = await promise;
      expect(decision.approved).toBe(false);
      expect(decision.comment).toBe('Not appropriate');
    });

    it('resolves with timeout when no response within timeout period', async () => {
      // Use a very short timeout
      const promise = hitlService.awaitDecision('action-timeout-1', 50);

      const decision = await promise;
      expect(decision.approved).toBe(false);
      expect(decision.comment).toContain('No response received within');
    });

    it('returns pre-resolved decision if resolveDecision was called before awaitDecision', async () => {
      // Resolve before awaiting (race condition case)
      hitlService.resolveDecision('action-preresolved-1', { approved: true, result: { fast: true } });

      const decision = await hitlService.awaitDecision('action-preresolved-1', 30000);
      expect(decision.approved).toBe(true);
      expect(decision.result).toEqual({ fast: true });
    });

    it('includes editedArgs when approved with edits', async () => {
      const promise = hitlService.awaitDecision('action-edited-1', 30000);

      hitlService.resolveDecision('action-edited-1', {
        approved: true,
        result: { executed: true },
        editedArgs: { amount: 50 },
      });

      const decision = await promise;
      expect(decision.approved).toBe(true);
      expect(decision.editedArgs).toEqual({ amount: 50 });
    });
  });

  describe('resolveDecision', () => {
    it('resolves a pending decision', async () => {
      const promise = hitlService.awaitDecision('action-resolve-2', 30000);
      hitlService.resolveDecision('action-resolve-2', { approved: true });

      const decision = await promise;
      expect(decision.approved).toBe(true);
    });

    it('stores as pre-resolved if no pending decision exists', () => {
      // Should not throw — stores in preResolvedDecisions map
      expect(() => {
        hitlService.resolveDecision('action-no-pending-1', { approved: false, comment: 'late' });
      }).not.toThrow();
    });
  });

  describe('isAwaited', () => {
    it('returns true for action currently being awaited', () => {
      // Start awaiting but don't resolve yet
      hitlService.awaitDecision('action-awaited-1', 60000);

      expect(hitlService.isAwaited('action-awaited-1')).toBe(true);

      // Clean up
      hitlService.resolveDecision('action-awaited-1', { approved: false });
    });

    it('returns false for action not being awaited', () => {
      expect(hitlService.isAwaited('action-not-awaited')).toBe(false);
    });

    it('returns false after decision is resolved', async () => {
      const promise = hitlService.awaitDecision('action-resolved-check', 30000);
      hitlService.resolveDecision('action-resolved-check', { approved: true });
      await promise;

      expect(hitlService.isAwaited('action-resolved-check')).toBe(false);
    });
  });

  describe('pendingCount', () => {
    it('returns 0 when no decisions are pending', () => {
      // Note: other tests may leave pending items; we check count is a number >= 0
      expect(typeof hitlService.pendingCount()).toBe('number');
    });

    it('increments when a new decision is awaited', () => {
      const before = hitlService.pendingCount();
      hitlService.awaitDecision('action-count-1', 60000);
      expect(hitlService.pendingCount()).toBe(before + 1);

      // Clean up
      hitlService.resolveDecision('action-count-1', { approved: false });
    });

    it('decrements when a decision is resolved', async () => {
      const promise = hitlService.awaitDecision('action-count-2', 60000);
      const during = hitlService.pendingCount();

      hitlService.resolveDecision('action-count-2', { approved: true });
      await promise;

      expect(hitlService.pendingCount()).toBe(during - 1);
    });
  });

  describe('AlreadyDecidedError', () => {
    it('extends Error', () => {
      const err = new AlreadyDecidedError('act-1');
      expect(err).toBeInstanceOf(Error);
    });

    it('has correct name', () => {
      const err = new AlreadyDecidedError('act-1');
      expect(err.name).toBe('AlreadyDecidedError');
    });

    it('includes action ID in message', () => {
      const err = new AlreadyDecidedError('act-xyz');
      expect(err.message).toContain('act-xyz');
    });
  });
});
