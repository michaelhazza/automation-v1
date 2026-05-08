import { describe, it, expect } from 'vitest';
import { decideIdleTimeout, classifyTeardownReason, detectOrphan, IEE_SESSION_IDLE_TIMEOUT_SECONDS } from './ieeSessionServicePure';

function makeSession(overrides: Partial<Parameters<typeof decideIdleTimeout>[0]> = {}) {
  return {
    status: 'active' as const,
    lastHeartbeatAt: null,
    startedAt: new Date('2026-05-08T10:00:00Z').toISOString(),
    releasedAt: null,
    idleTimeoutSeconds: IEE_SESSION_IDLE_TIMEOUT_SECONDS,
    ...overrides,
  };
}

describe('decideIdleTimeout', () => {
  it('returns keep when within timeout window', () => {
    const session = makeSession({ lastHeartbeatAt: '2026-05-08T10:04:00Z' }); // 1 min ago
    const now = new Date('2026-05-08T10:05:00Z');
    expect(decideIdleTimeout(session, now)).toBe('keep');
  });

  it('returns tear_down when heartbeat exceeds timeout', () => {
    const session = makeSession({ lastHeartbeatAt: '2026-05-08T09:54:00Z' }); // 6 min ago
    const now = new Date('2026-05-08T10:00:00Z');
    // IEE_SESSION_IDLE_TIMEOUT_SECONDS = 300 = 5 min
    expect(decideIdleTimeout(session, now)).toBe('tear_down');
  });

  it('returns tear_down at exactly the timeout boundary', () => {
    const session = makeSession({ lastHeartbeatAt: '2026-05-08T09:55:00Z' }); // exactly 5 min
    const now = new Date('2026-05-08T10:00:00Z');
    expect(decideIdleTimeout(session, now)).toBe('tear_down');
  });

  it('returns tear_down for torn_down sessions immediately', () => {
    const session = makeSession({ status: 'torn_down', lastHeartbeatAt: '2026-05-08T09:59:00Z' });
    const now = new Date('2026-05-08T10:00:00Z'); // 1 min ago
    expect(decideIdleTimeout(session, now)).toBe('tear_down'); // already terminal
  });

  it('uses startedAt as fallback when lastHeartbeatAt is null', () => {
    const session = makeSession({ lastHeartbeatAt: null, startedAt: '2026-05-08T09:54:00Z' });
    const now = new Date('2026-05-08T10:00:00Z'); // 6 min since start
    expect(decideIdleTimeout(session, now)).toBe('tear_down');
  });
});

describe('classifyTeardownReason', () => {
  it('maps run_completed to run_completed', () => {
    expect(classifyTeardownReason('run_completed')).toBe('run_completed');
  });
  it('maps run_failed to failed', () => {
    expect(classifyTeardownReason('run_failed')).toBe('failed');
  });
  it('maps run_cancelled to operator_cancelled', () => {
    expect(classifyTeardownReason('run_cancelled')).toBe('operator_cancelled');
  });
  it('maps idle_timeout to idle_timeout', () => {
    expect(classifyTeardownReason('idle_timeout')).toBe('idle_timeout');
  });
  it('maps orphan_detected to orphan_cleanup', () => {
    expect(classifyTeardownReason('orphan_detected')).toBe('orphan_cleanup');
  });
  it('maps unknown events to orphan_cleanup (safe fallback)', () => {
    expect(classifyTeardownReason('unknown_event')).toBe('orphan_cleanup');
  });
});

describe('detectOrphan', () => {
  it('returns false for torn_down session', () => {
    const session = makeSession({ status: 'torn_down', lastHeartbeatAt: null, startedAt: '2026-05-08T09:00:00Z' });
    expect(detectOrphan(session, new Date('2026-05-08T10:00:00Z'), true)).toBe(false);
  });

  it('returns false when run is not terminal', () => {
    const session = makeSession({ lastHeartbeatAt: null, startedAt: '2026-05-08T09:00:00Z' });
    expect(detectOrphan(session, new Date('2026-05-08T10:00:00Z'), false)).toBe(false);
  });

  it('returns true when run is terminal and no heartbeat for > 2× timeout', () => {
    // 2 × 300s = 600s = 10min. More than 10min ago with no heartbeat → orphan
    const session = makeSession({ lastHeartbeatAt: null, startedAt: '2026-05-08T09:49:00Z' });
    const now = new Date('2026-05-08T10:00:00Z'); // 11 min since start
    expect(detectOrphan(session, now, true)).toBe(true);
  });

  it('returns false when within 2× timeout', () => {
    const session = makeSession({ lastHeartbeatAt: '2026-05-08T09:55:00Z' }); // 5 min ago
    const now = new Date('2026-05-08T10:00:00Z');
    expect(detectOrphan(session, now, true)).toBe(false); // 5 min < 10 min
  });
});
