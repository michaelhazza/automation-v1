/**
 * orchestratorCadenceDetectionPure.test.ts
 *
 * Pure-logic tests for detectCadenceSignals.
 * No database or I/O required.
 *
 * Run via:
 *   npx vitest run server/services/__tests__/orchestratorCadenceDetectionPure.test.ts
 */

import { expect, test, describe } from 'vitest';
import {
  detectCadenceSignals,
  CADENCE_RECOMMEND_THRESHOLD,
} from '../orchestratorCadenceDetectionPure.js';

// ─── No signals ───────────────────────────────────────────────────────────────

describe('no cadence signals', () => {
  test('plain task with no recurrence cues → score 0', () => {
    const result = detectCadenceSignals({
      promptText: 'Write a summary of the last quarter results',
      priorRunCount: 0,
    });
    expect(result.score).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  test('score 0 is below recommend threshold', () => {
    const result = detectCadenceSignals({
      promptText: 'Update the CRM record for Acme',
      priorRunCount: 1,
    });
    expect(result.score).toBeLessThan(CADENCE_RECOMMEND_THRESHOLD);
  });
});

// ─── Calendar phrasing (+0.4) ─────────────────────────────────────────────────

describe('calendar phrasing', () => {
  test('"every Monday" → calendar_phrasing signal, score 0.4', () => {
    const result = detectCadenceSignals({
      promptText: 'Send the team update every Monday morning',
      priorRunCount: 0,
    });
    expect(result.signals.some((s) => s.name === 'calendar_phrasing')).toBe(true);
    expect(result.score).toBeCloseTo(0.4);
  });

  test('"weekly" → calendar signal', () => {
    const result = detectCadenceSignals({
      promptText: 'Generate the weekly performance report',
      priorRunCount: 0,
    });
    expect(result.signals.some((s) => s.name === 'calendar_phrasing')).toBe(true);
  });

  test('"every week" → calendar signal', () => {
    const result = detectCadenceSignals({
      promptText: 'Post the newsletter every week',
      priorRunCount: 0,
    });
    expect(result.signals.some((s) => s.name === 'calendar_phrasing')).toBe(true);
  });

  test('"daily" → calendar signal', () => {
    const result = detectCadenceSignals({
      promptText: 'Run the daily standup summary',
      priorRunCount: 0,
    });
    expect(result.signals.some((s) => s.name === 'calendar_phrasing')).toBe(true);
  });

  test('"every morning" → calendar signal', () => {
    const result = detectCadenceSignals({
      promptText: 'Check the inbox every morning',
      priorRunCount: 0,
    });
    expect(result.signals.some((s) => s.name === 'calendar_phrasing')).toBe(true);
  });

  test('"monthly" → calendar signal', () => {
    const result = detectCadenceSignals({
      promptText: 'Run the monthly billing reconciliation',
      priorRunCount: 0,
    });
    expect(result.signals.some((s) => s.name === 'calendar_phrasing')).toBe(true);
  });

  test('"first of the month" → calendar signal', () => {
    const result = detectCadenceSignals({
      promptText: 'Send the invoice on the first of the month',
      priorRunCount: 0,
    });
    expect(result.signals.some((s) => s.name === 'calendar_phrasing')).toBe(true);
  });

  test('calendar phrasing alone (0.4) does NOT cross recommend threshold (0.6)', () => {
    const result = detectCadenceSignals({
      promptText: 'Send the weekly digest',
      priorRunCount: 0,
    });
    // 0.4 < 0.6 — two signals are required to cross the threshold without an explicit signal.
    expect(result.score).toBeLessThan(CADENCE_RECOMMEND_THRESHOLD);
  });
});

// ─── Recurring intent verbs (+0.2) ────────────────────────────────────────────

describe('recurring intent verbs', () => {
  test('"again" → recurring_intent_verb signal, score 0.2', () => {
    const result = detectCadenceSignals({
      promptText: 'Run the report again',
      priorRunCount: 0,
    });
    expect(result.signals.some((s) => s.name === 'recurring_intent_verb')).toBe(true);
    expect(result.score).toBeCloseTo(0.2);
  });

  test('"next time" → recurring_intent_verb signal', () => {
    const result = detectCadenceSignals({
      promptText: 'Do this next time a lead comes in',
      priorRunCount: 0,
    });
    expect(result.signals.some((s) => s.name === 'recurring_intent_verb')).toBe(true);
  });

  test('"regularly" → recurring_intent_verb signal', () => {
    const result = detectCadenceSignals({
      promptText: 'Check the pipeline status regularly',
      priorRunCount: 0,
    });
    expect(result.signals.some((s) => s.name === 'recurring_intent_verb')).toBe(true);
  });

  test('"as usual" → recurring_intent_verb signal', () => {
    const result = detectCadenceSignals({
      promptText: 'Run the close-out tasks as usual',
      priorRunCount: 0,
    });
    expect(result.signals.some((s) => s.name === 'recurring_intent_verb')).toBe(true);
  });

  test('recurring verb alone does NOT cross recommend threshold', () => {
    const result = detectCadenceSignals({
      promptText: 'Do this again',
      priorRunCount: 0,
    });
    expect(result.score).toBeLessThan(CADENCE_RECOMMEND_THRESHOLD);
  });
});

// ─── Prior-run pattern (+0.4) ─────────────────────────────────────────────────

describe('prior-run pattern', () => {
  test('3 runs, 7-day gap → prior_run_pattern signal, score 0.4', () => {
    const result = detectCadenceSignals({
      promptText: 'Generate the client summary',
      priorRunCount: 3,
      priorRunFrequencyDays: 7,
    });
    expect(result.signals.some((s) => s.name === 'prior_run_pattern')).toBe(true);
    expect(result.score).toBeCloseTo(0.4);
  });

  test('5 runs, 14-day gap → prior_run_pattern signal (boundary)', () => {
    const result = detectCadenceSignals({
      promptText: 'Pull the weekly report',
      priorRunCount: 5,
      priorRunFrequencyDays: 14,
    });
    expect(result.signals.some((s) => s.name === 'prior_run_pattern')).toBe(true);
  });

  test('2 runs → no prior_run_pattern signal (below threshold)', () => {
    const result = detectCadenceSignals({
      promptText: 'Summarise activity',
      priorRunCount: 2,
      priorRunFrequencyDays: 7,
    });
    expect(result.signals.some((s) => s.name === 'prior_run_pattern')).toBe(false);
  });

  test('3 runs, 30-day gap → no prior_run_pattern signal (gap too wide)', () => {
    const result = detectCadenceSignals({
      promptText: 'Summarise activity',
      priorRunCount: 3,
      priorRunFrequencyDays: 30,
    });
    expect(result.signals.some((s) => s.name === 'prior_run_pattern')).toBe(false);
  });

  test('3 runs, no frequency data → no prior_run_pattern signal', () => {
    const result = detectCadenceSignals({
      promptText: 'Summarise activity',
      priorRunCount: 3,
    });
    expect(result.signals.some((s) => s.name === 'prior_run_pattern')).toBe(false);
  });

  test('prior-run pattern alone (0.4) does NOT cross recommend threshold (0.6)', () => {
    const result = detectCadenceSignals({
      promptText: 'Run the report',
      priorRunCount: 4,
      priorRunFrequencyDays: 7,
    });
    // 0.4 < 0.6 — two signals are required to cross the threshold without an explicit signal.
    expect(result.score).toBeLessThan(CADENCE_RECOMMEND_THRESHOLD);
  });
});

// ─── Explicit workflow signal (+1.0) ─────────────────────────────────────────

describe('explicit workflow intent signal', () => {
  test('"make this a workflow" → score 1.0', () => {
    const result = detectCadenceSignals({
      promptText: 'Make this a workflow and run it every Friday',
      priorRunCount: 0,
    });
    expect(result.score).toBe(1.0);
    expect(result.signals.some((s) => s.name === 'explicit_workflow_intent')).toBe(true);
  });

  test('"save as workflow" → score 1.0', () => {
    const result = detectCadenceSignals({
      promptText: 'Save as workflow please',
      priorRunCount: 0,
    });
    expect(result.score).toBe(1.0);
  });

  test('"automate this" → score 1.0', () => {
    const result = detectCadenceSignals({
      promptText: 'Automate this for next time',
      priorRunCount: 0,
    });
    expect(result.score).toBe(1.0);
  });

  test('explicit signal saturates even with other signals already present', () => {
    // Calendar + explicit → still 1.0, not 1.4
    const result = detectCadenceSignals({
      promptText: 'Every Monday, automate this report',
      priorRunCount: 0,
    });
    // Explicit pattern is checked first and returns immediately.
    expect(result.score).toBe(1.0);
  });
});

// ─── Combined signals ─────────────────────────────────────────────────────────

describe('combined signals', () => {
  test('calendar + recurring intent = 0.6 → crosses threshold', () => {
    const result = detectCadenceSignals({
      promptText: 'Run this weekly again',
      priorRunCount: 0,
    });
    expect(result.score).toBeGreaterThanOrEqual(CADENCE_RECOMMEND_THRESHOLD);
  });

  test('combined signals cap at 1.0', () => {
    const result = detectCadenceSignals({
      promptText: 'Run this daily again',
      priorRunCount: 5,
      priorRunFrequencyDays: 7,
    });
    expect(result.score).toBeLessThanOrEqual(1.0);
  });
});

// ─── Threshold boundary ───────────────────────────────────────────────────────

describe('threshold boundary', () => {
  test('CADENCE_RECOMMEND_THRESHOLD is 0.6', () => {
    expect(CADENCE_RECOMMEND_THRESHOLD).toBe(0.6);
  });
});
