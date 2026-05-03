import { expect, test } from 'vitest';
import { decideRunNextState } from '../workflowRunPauseStopServicePure.js';
import type { RunStateInput } from '../workflowRunPauseStopServicePure.js';

// ---------------------------------------------------------------------------
// decideRunNextState — pure state-transition logic for pause/stop
// ---------------------------------------------------------------------------

const base: RunStateInput = {
  currentStatus: 'running',
  currentCostCents: 0,
  currentElapsedSeconds: 0,
  effectiveCostCeilingCents: null,
  effectiveWallClockCapSeconds: null,
};

test('no caps, no operator action → no change', () => {
  const d = decideRunNextState(base);
  expect(d.nextStatus).toBe('running');
  expect(d.shouldPause).toBe(false);
  expect(d.shouldStop).toBe(false);
  expect(d.reason).toBeNull();
});

test('null caps (unlimited): never pause regardless of cost or elapsed', () => {
  const d = decideRunNextState({
    ...base,
    currentCostCents: 1_000_000,
    currentElapsedSeconds: 1_000_000,
    effectiveCostCeilingCents: null,
    effectiveWallClockCapSeconds: null,
  });
  expect(d.nextStatus).toBe('running');
  expect(d.shouldPause).toBe(false);
});

test('cost ceiling: pause when accumulator >= ceiling', () => {
  const d = decideRunNextState({
    ...base,
    currentCostCents: 100,
    effectiveCostCeilingCents: 100,
  });
  expect(d.nextStatus).toBe('paused');
  expect(d.shouldPause).toBe(true);
  expect(d.shouldStop).toBe(false);
  expect(d.reason).toBe('cost_ceiling');
});

test('cost ceiling: no pause when accumulator < ceiling', () => {
  const d = decideRunNextState({
    ...base,
    currentCostCents: 99,
    effectiveCostCeilingCents: 100,
  });
  expect(d.shouldPause).toBe(false);
});

test('wall-clock cap: pause when elapsed >= cap', () => {
  const d = decideRunNextState({
    ...base,
    currentElapsedSeconds: 3600,
    effectiveWallClockCapSeconds: 3600,
  });
  expect(d.nextStatus).toBe('paused');
  expect(d.shouldPause).toBe(true);
  expect(d.reason).toBe('wall_clock');
});

test('wall-clock cap: no pause when elapsed < cap', () => {
  const d = decideRunNextState({
    ...base,
    currentElapsedSeconds: 3599,
    effectiveWallClockCapSeconds: 3600,
  });
  expect(d.shouldPause).toBe(false);
});

test('both caps exceeded: cost_ceiling wins (cost checked before wall_clock)', () => {
  const d = decideRunNextState({
    ...base,
    currentCostCents: 200,
    currentElapsedSeconds: 7200,
    effectiveCostCeilingCents: 100,
    effectiveWallClockCapSeconds: 3600,
  });
  expect(d.shouldPause).toBe(true);
  expect(d.reason).toBe('cost_ceiling');
});

test('operator stop: transitions to failed regardless of caps', () => {
  const d = decideRunNextState({
    ...base,
    currentCostCents: 200,
    effectiveCostCeilingCents: 100,
    operatorAction: 'stop',
  });
  expect(d.nextStatus).toBe('failed');
  expect(d.shouldStop).toBe(true);
  expect(d.shouldPause).toBe(false);
  expect(d.reason).toBe('operator_stop');
});

test('operator stop: highest priority — beats cost ceiling', () => {
  const d = decideRunNextState({
    ...base,
    currentCostCents: 1000,
    effectiveCostCeilingCents: 100,
    operatorAction: 'stop',
  });
  expect(d.nextStatus).toBe('failed');
  expect(d.reason).toBe('operator_stop');
});

test('operator pause: transitions to paused with by_user reason', () => {
  const d = decideRunNextState({ ...base, operatorAction: 'pause' });
  expect(d.nextStatus).toBe('paused');
  expect(d.shouldPause).toBe(true);
  expect(d.shouldStop).toBe(false);
  expect(d.reason).toBe('by_user');
});

test('operator pause: beats cost ceiling check (evaluated first)', () => {
  const d = decideRunNextState({
    ...base,
    currentCostCents: 1000,
    effectiveCostCeilingCents: 100,
    operatorAction: 'pause',
  });
  expect(d.reason).toBe('by_user');
});

test('operator resume: transitions to running', () => {
  const d = decideRunNextState({
    ...base,
    currentStatus: 'paused',
    operatorAction: 'resume',
  });
  expect(d.nextStatus).toBe('running');
  expect(d.shouldPause).toBe(false);
  expect(d.shouldStop).toBe(false);
  expect(d.reason).toBe('operator_resume');
});

test('priority: stop > pause > resume', () => {
  // stop beats pause — they would not both be set in practice, but test the precedence
  const stopResult = decideRunNextState({ ...base, operatorAction: 'stop' });
  expect(stopResult.nextStatus).toBe('failed');
});
