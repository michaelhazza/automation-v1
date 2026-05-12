import { describe, expect, it } from 'vitest';

import {
  countActiveSlots,
  isSlotAvailable,
  isQueueEligibleForContinuation,
  sortByFifoOrder,
  selectNextDispatchCandidate,
} from '../operatorChainSchedulerServicePure.js';

describe('countActiveSlots', () => {
  it('counts running non-superseded chain links', () => {
    const links = [
      { subaccountId: 'sub-1', status: 'running', supersededByAttempt: null },
      { subaccountId: 'sub-1', status: 'running', supersededByAttempt: null },
      { subaccountId: 'sub-1', status: 'completed', supersededByAttempt: null },
      { subaccountId: 'sub-1', status: 'running', supersededByAttempt: 2 }, // superseded
    ];
    expect(countActiveSlots(links)).toBe(2);
  });

  it('returns 0 for an empty list', () => {
    expect(countActiveSlots([])).toBe(0);
  });

  it('excludes superseded_by_attempt IS NOT NULL', () => {
    const links = [
      { subaccountId: 'sub-1', status: 'running', supersededByAttempt: 2 },
      { subaccountId: 'sub-1', status: 'running', supersededByAttempt: 3 },
    ];
    expect(countActiveSlots(links)).toBe(0);
  });

  it('excludes non-running statuses', () => {
    const links = [
      { subaccountId: 'sub-1', status: 'pending', supersededByAttempt: null },
      { subaccountId: 'sub-1', status: 'completed', supersededByAttempt: null },
      { subaccountId: 'sub-1', status: 'failed', supersededByAttempt: null },
      { subaccountId: 'sub-1', status: 'cancelled', supersededByAttempt: null },
    ];
    expect(countActiveSlots(links)).toBe(0);
  });
});

describe('isSlotAvailable', () => {
  it('returns true when active slots < cap', () => {
    expect(isSlotAvailable(3, 5)).toBe(true);
  });

  it('returns false when active slots >= cap', () => {
    expect(isSlotAvailable(5, 5)).toBe(false);
    expect(isSlotAvailable(6, 5)).toBe(false);
  });

  it('returns true when no active slots', () => {
    expect(isSlotAvailable(0, 5)).toBe(true);
  });
});

describe('isQueueEligibleForContinuation', () => {
  it('returns true for paused_for_chain_continuation', () => {
    expect(
      isQueueEligibleForContinuation({
        agentRunId: 'run-1',
        status: 'paused_for_chain_continuation',
        updatedAt: new Date(),
      }),
    ).toBe(true);
  });

  it('returns false for other statuses', () => {
    const statuses = ['delegated', 'paused_chain_failure', 'paused_budget_exceeded', 'cancelled'];
    for (const status of statuses) {
      expect(
        isQueueEligibleForContinuation({ agentRunId: 'run-1', status, updatedAt: new Date() }),
        `status '${status}' must not be eligible`,
      ).toBe(false);
    }
  });
});

describe('sortByFifoOrder', () => {
  it('sorts tasks by updatedAt ASC (oldest first)', () => {
    const tasks = [
      {
        agentRunId: 'run-3',
        status: 'paused_for_chain_continuation',
        updatedAt: new Date('2026-05-12T10:30:00Z'),
      },
      {
        agentRunId: 'run-1',
        status: 'paused_for_chain_continuation',
        updatedAt: new Date('2026-05-12T09:00:00Z'),
      },
      {
        agentRunId: 'run-2',
        status: 'paused_for_chain_continuation',
        updatedAt: new Date('2026-05-12T10:00:00Z'),
      },
    ];

    const sorted = sortByFifoOrder(tasks);
    expect(sorted[0]?.agentRunId).toBe('run-1');
    expect(sorted[1]?.agentRunId).toBe('run-2');
    expect(sorted[2]?.agentRunId).toBe('run-3');
  });

  it('does not mutate the input array', () => {
    const tasks = [
      {
        agentRunId: 'run-2',
        status: 'paused_for_chain_continuation',
        updatedAt: new Date('2026-05-12T10:00:00Z'),
      },
      {
        agentRunId: 'run-1',
        status: 'paused_for_chain_continuation',
        updatedAt: new Date('2026-05-12T09:00:00Z'),
      },
    ];
    const originalFirst = tasks[0]?.agentRunId;
    sortByFifoOrder(tasks);
    expect(tasks[0]?.agentRunId).toBe(originalFirst);
  });
});

describe('selectNextDispatchCandidate', () => {
  it('returns the oldest paused_for_chain_continuation task', () => {
    const tasks = [
      {
        agentRunId: 'run-2',
        status: 'paused_for_chain_continuation',
        updatedAt: new Date('2026-05-12T10:00:00Z'),
      },
      {
        agentRunId: 'run-1',
        status: 'paused_for_chain_continuation',
        updatedAt: new Date('2026-05-12T09:00:00Z'),
      },
      {
        agentRunId: 'run-3',
        status: 'delegated', // not eligible
        updatedAt: new Date('2026-05-12T08:00:00Z'),
      },
    ];

    const candidate = selectNextDispatchCandidate(tasks);
    expect(candidate?.agentRunId).toBe('run-1');
  });

  it('returns null when no eligible tasks exist', () => {
    const tasks = [
      { agentRunId: 'run-1', status: 'delegated', updatedAt: new Date() },
    ];
    expect(selectNextDispatchCandidate(tasks)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(selectNextDispatchCandidate([])).toBeNull();
  });
});
