/**
 * baselineReadinessService.test.ts
 *
 * Pure-function tests for the readiness evaluation logic.
 *
 * Strategy: drive `evaluateReadiness` directly with canned rows — no DB
 * connection or mocking required. The DB queries are thin wrappers that
 * collect connector and metric rows then delegate to this function.
 *
 * Run via:
 *   npx vitest run server/services/__tests__/baselineReadinessService.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateReadiness,
  type CoreConnectorRow,
  type CoreMetricRow,
} from '../baselineReadinessPure.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeConnector(overrides: Partial<CoreConnectorRow> = {}): CoreConnectorRow {
  return {
    pollCount: 2,
    firstAt: new Date('2026-04-01T00:00:00Z'),
    settleOk: true,
    ...overrides,
  };
}

function makeMetric(slug: string): CoreMetricRow {
  return { slug };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('evaluateReadiness', () => {
  it('0 active connectors → all four conditions missing', () => {
    const result = evaluateReadiness([], []);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain('active_connector');
    expect(result.missing).toContain('successful_polls_min_2');
    expect(result.missing).toContain('settle_window_1h');
    expect(result.missing).toContain('canonical_metrics_min_2');
    expect(result.qualifying_poll_count).toBe(0);
    expect(result.earliest_qualifying_poll_at).toBeNull();
  });

  it('1 connector with pollCount=1, settleOk=true → missing successful_polls_min_2', () => {
    const result = evaluateReadiness(
      [makeConnector({ pollCount: 1, settleOk: true })],
      [makeMetric('pipeline_value'), makeMetric('lead_count')],
    );
    expect(result.ready).toBe(false);
    expect(result.missing).toContain('successful_polls_min_2');
    expect(result.missing).not.toContain('active_connector');
    expect(result.missing).not.toContain('settle_window_1h');
    expect(result.missing).not.toContain('canonical_metrics_min_2');
    expect(result.qualifying_poll_count).toBe(1);
  });

  it('1 connector with pollCount=2, settleOk=false → missing settle_window_1h', () => {
    const result = evaluateReadiness(
      [makeConnector({ pollCount: 2, settleOk: false })],
      [makeMetric('pipeline_value'), makeMetric('lead_count')],
    );
    expect(result.ready).toBe(false);
    expect(result.missing).toContain('settle_window_1h');
    expect(result.missing).not.toContain('active_connector');
    expect(result.missing).not.toContain('successful_polls_min_2');
    expect(result.missing).not.toContain('canonical_metrics_min_2');
    expect(result.qualifying_poll_count).toBe(2);
  });

  it('1 connector with pollCount=2, settleOk=true, 1 metric → missing canonical_metrics_min_2', () => {
    const result = evaluateReadiness(
      [makeConnector({ pollCount: 2, settleOk: true })],
      [makeMetric('pipeline_value')],
    );
    expect(result.ready).toBe(false);
    expect(result.missing).toContain('canonical_metrics_min_2');
    expect(result.missing).not.toContain('active_connector');
    expect(result.missing).not.toContain('successful_polls_min_2');
    expect(result.missing).not.toContain('settle_window_1h');
  });

  it('1 connector with pollCount=2, settleOk=true, 2 metrics → ready=true', () => {
    const result = evaluateReadiness(
      [makeConnector({ pollCount: 2, settleOk: true })],
      [makeMetric('pipeline_value'), makeMetric('lead_count')],
    );
    expect(result.ready).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.reason).toBeUndefined();
    expect(result.qualifying_poll_count).toBe(2);
  });

  it('2 connectors with pollCounts 1+2=3, one settleOk, 4 metrics → ready=true', () => {
    const result = evaluateReadiness(
      [
        makeConnector({ pollCount: 1, settleOk: false, firstAt: new Date('2026-04-01T00:00:00Z') }),
        makeConnector({ pollCount: 2, settleOk: true, firstAt: new Date('2026-03-31T00:00:00Z') }),
      ],
      [
        makeMetric('pipeline_value'),
        makeMetric('lead_count'),
        makeMetric('conversation_engagement'),
        makeMetric('revenue_last_30d'),
      ],
    );
    expect(result.ready).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.qualifying_poll_count).toBe(3);
    // earliest_qualifying_poll_at should be the older date
    expect(result.earliest_qualifying_poll_at?.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('duplicate metric slugs only count once toward the threshold', () => {
    // Duplicate slug should not double-count
    const result = evaluateReadiness(
      [makeConnector({ pollCount: 2, settleOk: true })],
      [makeMetric('pipeline_value'), makeMetric('pipeline_value')],
    );
    expect(result.ready).toBe(false);
    expect(result.missing).toContain('canonical_metrics_min_2');
  });

  it('returns reason string when not ready', () => {
    const result = evaluateReadiness([], []);
    expect(result.reason).toMatch(/missing:/);
  });

  it('earliest_qualifying_poll_at is null when no connector has firstAt', () => {
    const result = evaluateReadiness(
      [makeConnector({ pollCount: 2, settleOk: true, firstAt: null })],
      [makeMetric('pipeline_value'), makeMetric('lead_count')],
    );
    expect(result.ready).toBe(true);
    expect(result.earliest_qualifying_poll_at).toBeNull();
  });
});
