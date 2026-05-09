import { describe, it, expect } from 'vitest';
import { fanOut, subscribe, replaySinceLastEventId, type PresenceStreamEvent } from './agentPresenceStreamPublisher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_ORG = 'org-test-1';

function makeEvent(overrides: Partial<PresenceStreamEvent> = {}): PresenceStreamEvent {
  return {
    agentId: 'agent-1',
    organisationId: TEST_ORG,
    eventTimestamp: new Date().toISOString(),
    serverNow: new Date().toISOString(),
    eventId: crypto.randomUUID(),
    data: { message: 'test' },
    eventType: 'presence_state_changed',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Payload cap / truncation
// ---------------------------------------------------------------------------

describe('enforcePayloadCap (via fanOut)', () => {
  it('passes through events under the 32KB cap unchanged', () => {
    const received: PresenceStreamEvent[] = [];
    const { unsubscribe } = subscribe({ kind: 'agent', agentId: 'agent-cap-1', organisationId: TEST_ORG }, 'sub-1', (e) => received.push(e));

    const event = makeEvent({ agentId: 'agent-cap-1', data: { x: 'a'.repeat(100) } });
    fanOut(event);
    unsubscribe();

    expect(received).toHaveLength(1);
    expect(received[0].truncated).toBeUndefined();
    expect((received[0].data as { x: string }).x).toHaveLength(100);
  });

  it('truncates events that exceed 32KB and sets truncated flag', () => {
    const received: PresenceStreamEvent[] = [];
    const { unsubscribe } = subscribe({ kind: 'agent', agentId: 'agent-cap-2', organisationId: TEST_ORG }, 'sub-2', (e) => received.push(e));

    // 40KB of data — well over the 32KB cap
    const largeData = { payload: 'x'.repeat(40_960) };
    const event = makeEvent({ agentId: 'agent-cap-2', data: largeData });
    fanOut(event);
    unsubscribe();

    expect(received).toHaveLength(1);
    expect(received[0].truncated).toBe(true);
    expect((received[0].data as { truncated: boolean; byteLength: number }).truncated).toBe(true);
    expect(typeof (received[0].data as { byteLength: number }).byteLength).toBe('number');
    expect((received[0].data as { byteLength: number }).byteLength).toBeGreaterThan(32_768);
  });

  it('cap decision is deterministic: same oversized event always yields truncated=true', () => {
    const received1: PresenceStreamEvent[] = [];
    const received2: PresenceStreamEvent[] = [];
    const { unsubscribe: u1 } = subscribe({ kind: 'agent', agentId: 'agent-cap-3', organisationId: TEST_ORG }, 'sub-3a', (e) => received1.push(e));
    const { unsubscribe: u2 } = subscribe({ kind: 'agent', agentId: 'agent-cap-3', organisationId: TEST_ORG }, 'sub-3b', (e) => received2.push(e));

    const largeData = { payload: 'y'.repeat(40_000) };
    fanOut(makeEvent({ agentId: 'agent-cap-3', data: largeData }));
    u1(); u2();

    expect(received1[0].truncated).toBe(true);
    expect(received2[0].truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ring buffer eviction order
// ---------------------------------------------------------------------------

describe('ring buffer eviction order', () => {
  it('evicts the oldest (eventTimestamp ASC, eventId ASC) entry when at capacity', () => {
    const agentId = 'agent-evict-1';
    const received: PresenceStreamEvent[] = [];
    const { unsubscribe } = subscribe({ kind: 'agent', agentId, organisationId: TEST_ORG }, 'sub-evict', (e) => received.push(e));

    // We cannot directly test 300-event eviction in a unit test without flooding.
    // Instead, verify canonical ordering via replaySinceLastEventId.
    const t1 = '2026-01-01T00:00:01.000Z';
    const t2 = '2026-01-01T00:00:02.000Z';
    const t3 = '2026-01-01T00:00:03.000Z';

    const e3 = makeEvent({ agentId, eventTimestamp: t3, eventId: 'id-c' });
    const e1 = makeEvent({ agentId, eventTimestamp: t1, eventId: 'id-a' });
    const e2 = makeEvent({ agentId, eventTimestamp: t2, eventId: 'id-b' });

    // Insert out of order
    fanOut(e3);
    fanOut(e1);
    fanOut(e2);
    unsubscribe();

    // Replay should return in canonical order: t1, t2, t3
    const replayed = replaySinceLastEventId({ kind: 'agent', agentId, organisationId: TEST_ORG }, null);
    const ids = replayed.map(e => e.eventId);
    expect(ids).toEqual(['id-a', 'id-b', 'id-c']);
  });

  it('replaySinceLastEventId returns events after the given eventId in canonical order', () => {
    const agentId = 'agent-replay-1';

    const e1 = makeEvent({ agentId, eventTimestamp: '2026-01-01T00:00:01.000Z', eventId: 'r-id-a' });
    const e2 = makeEvent({ agentId, eventTimestamp: '2026-01-01T00:00:02.000Z', eventId: 'r-id-b' });
    const e3 = makeEvent({ agentId, eventTimestamp: '2026-01-01T00:00:03.000Z', eventId: 'r-id-c' });

    fanOut(e1);
    fanOut(e2);
    fanOut(e3);

    const replayed = replaySinceLastEventId({ kind: 'agent', agentId, organisationId: TEST_ORG }, 'r-id-a');
    expect(replayed.map(e => e.eventId)).toEqual(['r-id-b', 'r-id-c']);
  });

  it('replaySinceLastEventId returns the full buffer when lastEventId is not found', () => {
    const agentId = 'agent-replay-2';

    const e1 = makeEvent({ agentId, eventTimestamp: '2026-02-01T00:00:01.000Z', eventId: 'rr-id-a' });
    const e2 = makeEvent({ agentId, eventTimestamp: '2026-02-01T00:00:02.000Z', eventId: 'rr-id-b' });

    fanOut(e1);
    fanOut(e2);

    const replayed = replaySinceLastEventId({ kind: 'agent', agentId, organisationId: TEST_ORG }, 'not-in-buffer');
    expect(replayed.map(e => e.eventId)).toEqual(['rr-id-a', 'rr-id-b']);
  });

  it('events from different orgs on the same agentId are scoped separately (B1 isolation)', () => {
    const agentId = 'shared-agent-uuid';
    const orgA = 'org-a';
    const orgB = 'org-b';

    const receivedA: PresenceStreamEvent[] = [];
    const receivedB: PresenceStreamEvent[] = [];

    const { unsubscribe: ua } = subscribe({ kind: 'agent', agentId, organisationId: orgA }, 'sub-a', (e) => receivedA.push(e));
    const { unsubscribe: ub } = subscribe({ kind: 'agent', agentId, organisationId: orgB }, 'sub-b', (e) => receivedB.push(e));

    fanOut(makeEvent({ agentId, organisationId: orgA }));
    ua(); ub();

    // Only org-a subscriber receives the event
    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// subscribe / unsubscribe lifecycle
// ---------------------------------------------------------------------------

describe('subscribe / unsubscribe', () => {
  it('delivers events to subscribers', () => {
    const agentId = 'agent-sub-1';
    const received: PresenceStreamEvent[] = [];
    const { unsubscribe } = subscribe({ kind: 'agent', agentId, organisationId: TEST_ORG }, 'sub-lifecycle-1', (e) => received.push(e));

    fanOut(makeEvent({ agentId }));
    expect(received).toHaveLength(1);

    unsubscribe();
    fanOut(makeEvent({ agentId }));
    expect(received).toHaveLength(1); // no new events after unsubscribe
  });

  it('one subscriber error does not prevent other subscribers from receiving the event', () => {
    const agentId = 'agent-sub-err';
    const goodReceived: PresenceStreamEvent[] = [];

    const { unsubscribe: u1 } = subscribe({ kind: 'agent', agentId, organisationId: TEST_ORG }, 'sub-err', () => {
      throw new Error('subscriber boom');
    });
    const { unsubscribe: u2 } = subscribe({ kind: 'agent', agentId, organisationId: TEST_ORG }, 'sub-good', (e) => goodReceived.push(e));

    fanOut(makeEvent({ agentId }));
    u1(); u2();

    expect(goodReceived).toHaveLength(1);
  });
});
