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

  it('non-owner view: only cross_owner_substep.* events returned', () => {
    const run: ProjectableRun = {
      ownerUserId,
      events: [
        makeEvent('tool_call.completed'),
        makeEvent('cross_owner_substep.approved'),
        makeEvent('agent_run.started'),
        makeEvent('cross_owner_substep.proposed'),
      ],
    };
    const result = runTraceProjectionForViewer(otherUserId, run);
    expect(result.events).toHaveLength(2);
    expect(result.events.every((e) => e.eventType.startsWith('cross_owner_substep.'))).toBe(true);
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
