import { describe, it, expect } from 'vitest';
import {
  runTraceProjectionForViewer,
  type ProjectableRun,
} from '../runTracePure.js';

const makeEvent = (eventType: string): import('../runTracePure.js').ProjectableEvent => ({
  eventType,
  payload: {},
});

const ownerUserId = 'user-owner';
const otherUserId = 'user-other';

describe('runTraceProjectionForViewer', () => {
  it('owner view: returns all events unchanged', () => {
    const run: ProjectableRun = {
      ownerUserId,
      events: [makeEvent('tool_call.completed'), makeEvent('agent_run.started')],
    };
    const result = runTraceProjectionForViewer(ownerUserId, run);
    expect(result.events).toHaveLength(2);
    expect(result).toBe(run); // same reference (no copy needed for owner)
  });

  it('non-owner view: cross_owner_substep.* + run-trace lifecycle events allowed, owner-private redacted', () => {
    const run: ProjectableRun = {
      ownerUserId,
      events: [
        // Allowed: cross-owner substep events
        makeEvent('cross_owner_substep.approved'),
        makeEvent('cross_owner_substep.proposed'),
        // Allowed: run-trace lifecycle events (no owner-private payload)
        makeEvent('delegation_spawned'),
        makeEvent('delegation_completed'),
        makeEvent('review_requested'),
        makeEvent('review_decided'),
        makeEvent('run_started'),
        makeEvent('run_terminated'),
        // Redacted: owner-private events
        makeEvent('tool_call.completed'),
        makeEvent('agent_run.started'),
      ],
    };
    const result = runTraceProjectionForViewer(otherUserId, run);
    const allowedTypes = new Set([
      'cross_owner_substep.approved',
      'cross_owner_substep.proposed',
      'delegation_spawned',
      'delegation_completed',
      'review_requested',
      'review_decided',
      'run_started',
      'run_terminated',
    ]);
    expect(result.events.map((e) => e.eventType).sort()).toEqual(
      [...allowedTypes].sort(),
    );
    expect(result.events.every((e) => allowedTypes.has(e.eventType))).toBe(true);
  });

  it('null owner: returns all events (subaccount agent, no cross-owner)', () => {
    const run: ProjectableRun = {
      ownerUserId: null,
      events: [makeEvent('tool_call.completed'), makeEvent('agent_run.started')],
    };
    const result = runTraceProjectionForViewer(otherUserId, run);
    expect(result.events).toHaveLength(2);
    expect(result).toBe(run);
  });

  it('idempotency: applying twice gives same result as once', () => {
    const run: ProjectableRun = {
      ownerUserId,
      events: [
        makeEvent('tool_call.completed'),
        makeEvent('cross_owner_substep.approved'),
      ],
    };
    const once = runTraceProjectionForViewer(otherUserId, run);
    const twice = runTraceProjectionForViewer(otherUserId, once);
    expect(twice.events).toHaveLength(once.events.length);
    expect(twice.events.map((e) => e.eventType)).toEqual(once.events.map((e) => e.eventType));
  });

  it('missing viewerUserId throws', () => {
    const run: ProjectableRun = {
      ownerUserId,
      events: [],
    };
    expect(() => runTraceProjectionForViewer('', run)).toThrow(
      'runTraceProjectionForViewer: viewerUserId is required',
    );
  });

  it('non-owner view with no cross_owner_substep events returns empty array', () => {
    const run: ProjectableRun = {
      ownerUserId,
      events: [makeEvent('tool_call.completed'), makeEvent('agent_run.started')],
    };
    const result = runTraceProjectionForViewer(otherUserId, run);
    expect(result.events).toHaveLength(0);
  });
});
