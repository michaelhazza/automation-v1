/**
 * Tests for askFormSubmissionServicePure — decision function coverage.
 *
 * Spec: docs/workflows-dev-spec.md §11.
 */

import { describe, it, expect } from 'vitest';
import { decideAskSubmissionOutcome } from '../askFormSubmissionServicePure.js';
import type { DecideAskSubmissionInput } from '../askFormSubmissionServicePure.js';

function base(overrides: Partial<DecideAskSubmissionInput> = {}): DecideAskSubmissionInput {
  return {
    gateExists: true,
    callerInPool: true,
    allowSkip: true,
    currentStatus: 'awaiting_input',
    intent: 'submit',
    ...overrides,
  };
}

describe('decideAskSubmissionOutcome', () => {
  describe('404 — gate not found', () => {
    it('returns 404 when gateExists is false (submit)', () => {
      const result = decideAskSubmissionOutcome(base({ gateExists: false }));
      expect(result.proceed).toBe(false);
      if (!result.proceed) {
        expect(result.statusCode).toBe(404);
        expect(result.errorCode).toBe('ask_not_found');
      }
    });

    it('returns 404 when gateExists is false (skip)', () => {
      const result = decideAskSubmissionOutcome(base({ gateExists: false, intent: 'skip' }));
      expect(result.proceed).toBe(false);
      if (!result.proceed) expect(result.statusCode).toBe(404);
    });
  });

  describe('403 — not in pool', () => {
    it('returns 403 when callerInPool is false (submit)', () => {
      const result = decideAskSubmissionOutcome(base({ callerInPool: false }));
      expect(result.proceed).toBe(false);
      if (!result.proceed) {
        expect(result.statusCode).toBe(403);
        expect(result.errorCode).toBe('not_in_submitter_pool');
      }
    });

    it('returns 403 when callerInPool is false (skip)', () => {
      const result = decideAskSubmissionOutcome(base({ callerInPool: false, intent: 'skip' }));
      expect(result.proceed).toBe(false);
      if (!result.proceed) expect(result.statusCode).toBe(403);
    });
  });

  describe('400 — skip not allowed', () => {
    it('returns 400 when intent=skip and allowSkip=false', () => {
      const result = decideAskSubmissionOutcome(
        base({ intent: 'skip', allowSkip: false }),
      );
      expect(result.proceed).toBe(false);
      if (!result.proceed) {
        expect(result.statusCode).toBe(400);
        expect(result.errorCode).toBe('skip_not_allowed');
      }
    });

    it('does NOT return 400 for submit when allowSkip=false', () => {
      const result = decideAskSubmissionOutcome(
        base({ intent: 'submit', allowSkip: false }),
      );
      expect(result.proceed).toBe(true);
    });
  });

  describe('409 — already submitted', () => {
    it('returns 409 already_submitted when status is "submitted"', () => {
      const result = decideAskSubmissionOutcome(base({ currentStatus: 'submitted' }));
      expect(result.proceed).toBe(false);
      if (!result.proceed) {
        expect(result.statusCode).toBe(409);
        expect(result.errorCode).toBe('already_submitted');
        if (result.errorCode === 'already_submitted') {
          expect(result.currentStatus).toBe('submitted');
        }
      }
    });

    it('returns 409 already_submitted when status is "completed"', () => {
      const result = decideAskSubmissionOutcome(base({ currentStatus: 'completed', intent: 'submit' }));
      expect(result.proceed).toBe(false);
      if (!result.proceed) expect(result.statusCode).toBe(409);
    });
  });

  describe('409 — already resolved (skip)', () => {
    it('returns 409 already_resolved when status is "skipped" and intent=skip', () => {
      const result = decideAskSubmissionOutcome(
        base({ currentStatus: 'skipped', intent: 'skip' }),
      );
      expect(result.proceed).toBe(false);
      if (!result.proceed) {
        expect(result.statusCode).toBe(409);
        expect(result.errorCode).toBe('already_resolved');
      }
    });
  });

  describe('200 — proceed', () => {
    it('returns proceed=true for valid submit', () => {
      const result = decideAskSubmissionOutcome(base());
      expect(result.proceed).toBe(true);
    });

    it('returns proceed=true for valid skip', () => {
      const result = decideAskSubmissionOutcome(
        base({ intent: 'skip', allowSkip: true }),
      );
      expect(result.proceed).toBe(true);
    });

    it('returns proceed=true when currentStatus is null (no step run found yet)', () => {
      const result = decideAskSubmissionOutcome(base({ currentStatus: null }));
      expect(result.proceed).toBe(true);
    });
  });

  describe('precedence: 404 before 403', () => {
    it('404 wins when gate missing even if not in pool', () => {
      const result = decideAskSubmissionOutcome(
        base({ gateExists: false, callerInPool: false }),
      );
      expect(result.proceed).toBe(false);
      if (!result.proceed) expect(result.statusCode).toBe(404);
    });
  });

  describe('precedence: 403 before 400', () => {
    it('403 wins when not in pool even for skip-not-allowed', () => {
      const result = decideAskSubmissionOutcome(
        base({ callerInPool: false, intent: 'skip', allowSkip: false }),
      );
      expect(result.proceed).toBe(false);
      if (!result.proceed) expect(result.statusCode).toBe(403);
    });
  });
});
