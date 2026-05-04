import { expect, test } from 'vitest';
import { getLaneConfig, LANE_CONFIG } from '../PendingApprovalCard.js';

// chatgpt-pr-review (PR #255, agentic-commerce, round 1) Finding 7 — assert
// the lane-config fallback. Any future lane added without a matching
// LANE_CONFIG entry must not crash or render blank.

test('known lane: client → ClientPulse + rose dot', () => {
  expect(getLaneConfig('client')).toEqual({ badgeText: 'ClientPulse', dotClass: 'bg-rose-700' });
});

test('known lane: spend → Spend + emerald dot', () => {
  expect(getLaneConfig('spend')).toEqual({ badgeText: 'Spend', dotClass: 'bg-emerald-600' });
});

test('unknown lane: falls back to raw lane string + neutral slate dot', () => {
  const config = getLaneConfig('not_a_real_lane_yet');
  expect(config.badgeText).toBe('not_a_real_lane_yet');
  expect(config.dotClass).toBe('bg-slate-300');
});

test('empty lane string: still renders without crashing', () => {
  const config = getLaneConfig('');
  expect(config.badgeText).toBe('');
  expect(config.dotClass).toBe('bg-slate-300');
});

test('LANE_CONFIG covers every lane currently emitted by the server', () => {
  // If a new lane is added on the server (server/services/agentActivityService.ts
  // pulse-attention pipeline), this test forces a paired update to LANE_CONFIG.
  // Update both sides together.
  const expectedLanes: ReadonlyArray<string> = ['client', 'major', 'internal', 'spend'];
  for (const lane of expectedLanes) {
    expect(LANE_CONFIG[lane]).toBeDefined();
  }
});
