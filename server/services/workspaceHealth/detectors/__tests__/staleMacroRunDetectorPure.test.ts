/**
 * staleMacroRunDetectorPure.test.ts — Unit tests for computeStuckMacroRuns().
 * Phase 1 Showcase §4.6.2.
 */

import { expect, test } from 'vitest';
import {
  computeStuckMacroRuns,
  MACRO_STUCK_THRESHOLD_MS,
  type MacroRunCandidate,
} from '../staleMacroRunDetectorPure.js';

function makeCandidate(overrides: Partial<MacroRunCandidate> = {}): MacroRunCandidate {
  return {
    ieeRunId: 'iee-1',
    agentRunId: 'run-1',
    organisationId: 'org-1',
    lastHeartbeatAt: new Date(),
    stepCount: 3,
    ...overrides,
  };
}

const now = new Date('2026-05-10T12:00:00.000Z');

test('run with heartbeat 20 min ago → returns finding with correct stuckSinceMs', () => {
  const heartbeat = new Date(now.getTime() - 20 * 60 * 1000);
  const candidate = makeCandidate({ lastHeartbeatAt: heartbeat });

  const findings = computeStuckMacroRuns([candidate], now, MACRO_STUCK_THRESHOLD_MS);

  expect(findings.length).toBe(1);
  expect(findings[0].ieeRunId).toBe('iee-1');
  expect(findings[0].agentRunId).toBe('run-1');
  expect(findings[0].organisationId).toBe('org-1');
  expect(findings[0].type).toBe('macro.run_stuck');
  expect(findings[0].stuckSinceMs).toBe(20 * 60 * 1000);
  expect(findings[0].thresholdMs).toBe(MACRO_STUCK_THRESHOLD_MS);
  expect(findings[0].currentStep).toBe('3');
});

test('run with heartbeat 5 min ago → returns empty array', () => {
  const heartbeat = new Date(now.getTime() - 5 * 60 * 1000);
  const candidate = makeCandidate({ lastHeartbeatAt: heartbeat });

  const findings = computeStuckMacroRuns([candidate], now, MACRO_STUCK_THRESHOLD_MS);

  expect(findings).toEqual([]);
});

test('run with heartbeat exactly at threshold → not stuck (threshold is exclusive)', () => {
  const heartbeat = new Date(now.getTime() - MACRO_STUCK_THRESHOLD_MS);
  const candidate = makeCandidate({ lastHeartbeatAt: heartbeat });

  const findings = computeStuckMacroRuns([candidate], now, MACRO_STUCK_THRESHOLD_MS);

  expect(findings).toEqual([]);
});

test('multiple runs mixed → returns only the stuck ones', () => {
  const stuckHeartbeat = new Date(now.getTime() - 20 * 60 * 1000);
  const freshHeartbeat = new Date(now.getTime() - 5 * 60 * 1000);
  const atThresholdHeartbeat = new Date(now.getTime() - MACRO_STUCK_THRESHOLD_MS);

  const candidates: MacroRunCandidate[] = [
    makeCandidate({ ieeRunId: 'iee-stuck', agentRunId: 'run-stuck', lastHeartbeatAt: stuckHeartbeat }),
    makeCandidate({ ieeRunId: 'iee-fresh', agentRunId: 'run-fresh', lastHeartbeatAt: freshHeartbeat }),
    makeCandidate({ ieeRunId: 'iee-at-threshold', agentRunId: 'run-at-threshold', lastHeartbeatAt: atThresholdHeartbeat }),
  ];

  const findings = computeStuckMacroRuns(candidates, now, MACRO_STUCK_THRESHOLD_MS);

  expect(findings.length).toBe(1);
  expect(findings[0].ieeRunId).toBe('iee-stuck');
});
