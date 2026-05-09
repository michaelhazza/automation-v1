import { describe, it, expect } from 'vitest';
import { resolvePresenceFromEvents, PresenceInput } from './agentPresenceServicePure';
import { PRESENCE_FRESHNESS_THRESHOLDS_MS } from '../../shared/types/agentPresence';

function makeInput(overrides: Partial<PresenceInput> = {}): PresenceInput {
  return {
    events: [],
    sessionState: null,
    scheduleState: null,
    serverNow: new Date('2026-05-08T12:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('resolvePresenceFromEvents', () => {
  it('returns idle when no events and no schedule', () => {
    const result = resolvePresenceFromEvents(makeInput());
    expect(result.state).toBe('idle');
  });

  it('returns scheduled when schedule has a next run', () => {
    const result = resolvePresenceFromEvents(
      makeInput({ scheduleState: { nextRunAt: '2026-05-09T08:00:00Z', label: 'Weekly run' } })
    );
    expect(result.state).toBe('scheduled');
    expect(result.nextRunAt).toBe('2026-05-09T08:00:00Z');
    expect(result.scheduledLabel).toBe('Weekly run');
  });

  it('returns running when there is an active run with no terminal event', () => {
    const result = resolvePresenceFromEvents(
      makeInput({
        events: [
          { id: 'e1', eventType: 'run.started', eventTimestamp: '2026-05-08T11:59:00Z', runId: 'run1', sequenceNumber: 1, payload: {} },
          { id: 'e2', eventType: 'step_started', eventTimestamp: '2026-05-08T11:59:01Z', runId: 'run1', sequenceNumber: 2, payload: {} },
        ],
      })
    );
    expect(result.state).toBe('running');
    expect(result.activeRunId).toBe('run1');
  });

  it('returns waiting_on_human when active run has hitl_gate_opened', () => {
    const result = resolvePresenceFromEvents(
      makeInput({
        events: [
          { id: 'e1', eventType: 'run.started', eventTimestamp: '2026-05-08T11:59:00Z', runId: 'run1', sequenceNumber: 1, payload: {} },
          { id: 'e2', eventType: 'hitl_gate_opened', eventTimestamp: '2026-05-08T11:59:01Z', runId: 'run1', sequenceNumber: 2, payload: {} },
        ],
      })
    );
    expect(result.state).toBe('waiting_on_human');
  });

  it('returns waiting_on_dependency when active run has external_call_started', () => {
    const result = resolvePresenceFromEvents(
      makeInput({
        events: [
          { id: 'e1', eventType: 'run.started', eventTimestamp: '2026-05-08T11:59:00Z', runId: 'run1', sequenceNumber: 1, payload: {} },
          { id: 'e2', eventType: 'external_call_started', eventTimestamp: '2026-05-08T11:59:01Z', runId: 'run1', sequenceNumber: 2, payload: {} },
        ],
      })
    );
    expect(result.state).toBe('waiting_on_dependency');
  });

  it('returns failed when run.completed has finalStatus !== "completed"', () => {
    // Run failure is signalled by the canonical run.completed event with a
    // non-"completed" finalStatus payload field — there is no separate
    // run.failed event in the production event-type union.
    const result = resolvePresenceFromEvents(
      makeInput({
        events: [
          { id: 'e1', eventType: 'run.started', eventTimestamp: '2026-05-08T11:59:00Z', runId: 'run1', sequenceNumber: 1, payload: {} },
          { id: 'e2', eventType: 'run.completed', eventTimestamp: '2026-05-08T11:59:10Z', runId: 'run1', sequenceNumber: 2, payload: { finalStatus: 'failed' } },
        ],
      })
    );
    expect(result.state).toBe('failed');
  });

  it('returns idle when run.completed has finalStatus === "completed"', () => {
    const result = resolvePresenceFromEvents(
      makeInput({
        events: [
          { id: 'e1', eventType: 'run.started', eventTimestamp: '2026-05-08T11:58:00Z', runId: 'run1', sequenceNumber: 1, payload: {} },
          { id: 'e2', eventType: 'run.completed', eventTimestamp: '2026-05-08T11:59:00Z', runId: 'run1', sequenceNumber: 2, payload: { finalStatus: 'completed' } },
        ],
      })
    );
    expect(result.state).toBe('idle');
  });

  it('failed ranks above degraded — terminal failure present returns failed even when stream is stale', () => {
    const staleTimestamp = new Date(Date.now() - 60_000).toISOString();
    const result = resolvePresenceFromEvents(
      makeInput({
        serverNow: new Date().toISOString(),
        events: [
          { id: 'e1', eventType: 'run.started', eventTimestamp: staleTimestamp, runId: 'run1', sequenceNumber: 1, payload: {} },
          { id: 'e2', eventType: 'run.completed', eventTimestamp: staleTimestamp, runId: 'run1', sequenceNumber: 2, payload: { finalStatus: 'failed' } },
        ],
      })
    );
    expect(result.state).toBe('failed');
  });

  it('returns degraded when event stream is delayed beyond threshold for active run', () => {
    const staleTimestamp = new Date(
      new Date('2026-05-08T12:00:00Z').getTime() - PRESENCE_FRESHNESS_THRESHOLDS_MS.EVENT_STREAM_DELAYED - 1000
    ).toISOString();
    const result = resolvePresenceFromEvents(
      makeInput({
        serverNow: '2026-05-08T12:00:00Z',
        events: [
          { id: 'e1', eventType: 'run.started', eventTimestamp: staleTimestamp, runId: 'run1', sequenceNumber: 1, payload: {} },
        ],
      })
    );
    expect(result.state).toBe('degraded');
    expect(result.degradedReason).toBe('event_stream_delayed');
    expect(result.degradedBaseState).toBe('running');
  });

  it('replay-safety: (event_timestamp, event_id) ordering — events already in canonical order, same result as sorted insert', () => {
    // Two events with identical timestamps — second event has higher ID lexicographically
    const ts = '2026-05-08T11:59:00Z';
    const events = [
      { id: 'aaa', eventType: 'run.started', eventTimestamp: ts, runId: 'run1', sequenceNumber: 1, payload: {} },
      { id: 'bbb', eventType: 'step_started', eventTimestamp: ts, runId: 'run1', sequenceNumber: 2, payload: {} },
    ];
    const result = resolvePresenceFromEvents(makeInput({ events }));
    expect(result.state).toBe('running');
    expect(result.activeRunId).toBe('run1');
  });

  it('wall-clock-jump simulation does not affect monotonic logic (pure function has no clock)', () => {
    // Pure function always uses the serverNow input; a "jump" in serverNow triggers degraded correctly
    const pastTs = '2026-05-08T11:40:00Z'; // 20 minutes before serverNow
    const result = resolvePresenceFromEvents(
      makeInput({
        serverNow: '2026-05-08T12:00:00Z',
        events: [
          { id: 'e1', eventType: 'run.started', eventTimestamp: pastTs, runId: 'run1', sequenceNumber: 1, payload: {} },
        ],
      })
    );
    // 20 min > EVENT_STREAM_DELAYED (10s) → degraded
    expect(result.state).toBe('degraded');
    expect(result.degradedReason).toBe('event_stream_delayed');
  });
});
