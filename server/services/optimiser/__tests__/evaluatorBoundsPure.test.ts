/**
 * server/services/optimiser/__tests__/evaluatorBoundsPure.test.ts
 *
 * Pure tests for assertPercentInBounds.
 * No DB imports. Uses Vitest with vi.spyOn on the logger.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertPercentInBounds } from '../evaluatorBoundsPure.js';

// ── Logger spy setup ──────────────────────────────────────────────────────────

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from '../../../lib/logger.js';

describe('assertPercentInBounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── In-bounds cases ───────────────────────────────────────────────────────

  it('returns true for 0.5 (mid-range)', () => {
    const result = assertPercentInBounds(0.5, 'escalation_pct', 'optimiser.test.cat', 'testQuery');
    expect(result).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns true for 0.0 (lower bound)', () => {
    const result = assertPercentInBounds(0.0, 'low_citation_pct', 'optimiser.test.cat', 'testQuery');
    expect(result).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns true for 1.0 (upper bound)', () => {
    const result = assertPercentInBounds(1.0, 'low_confidence_pct', 'optimiser.test.cat', 'testQuery');
    expect(result).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // ── Out-of-bounds cases ───────────────────────────────────────────────────

  it('returns false for 1.5 (above 1) and emits bounds-violation log', () => {
    const result = assertPercentInBounds(1.5, 'escalation_pct', 'optimiser.playbook.escalation_rate', 'optimiser.escalationRate');
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith('recommendations.evaluator_bounds_violation', {
      category: 'optimiser.playbook.escalation_rate',
      field: 'escalation_pct',
      value: 1.5,
      source_query: 'optimiser.escalationRate',
    });
  });

  it('returns false for -0.1 (below 0) and emits bounds-violation log', () => {
    const result = assertPercentInBounds(-0.1, 'low_citation_pct', 'optimiser.memory.low_citation_waste', 'optimiser.memoryCitation');
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith('recommendations.evaluator_bounds_violation', {
      category: 'optimiser.memory.low_citation_waste',
      field: 'low_citation_pct',
      value: -0.1,
      source_query: 'optimiser.memoryCitation',
    });
  });

  it('returns false for NaN and emits bounds-violation log', () => {
    const result = assertPercentInBounds(NaN, 'second_look_pct', 'optimiser.agent.routing_uncertainty', 'optimiser.routingUncertainty');
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('returns false for Infinity and emits bounds-violation log', () => {
    const result = assertPercentInBounds(Infinity, 'low_confidence_pct', 'optimiser.agent.routing_uncertainty', 'optimiser.routingUncertainty');
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('returns false for -Infinity and emits bounds-violation log', () => {
    const result = assertPercentInBounds(-Infinity, 'low_confidence_pct', 'optimiser.agent.routing_uncertainty', 'optimiser.routingUncertainty');
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('field name is passed through to the log payload', () => {
    assertPercentInBounds(2.0, 'my_special_field', 'optimiser.test.cat', 'sourceQ');
    expect(logger.warn).toHaveBeenCalledWith('recommendations.evaluator_bounds_violation', expect.objectContaining({
      field: 'my_special_field',
    }));
  });

  it('each out-of-bounds call emits exactly one log line (no duplicates)', () => {
    assertPercentInBounds(1.5, 'x', 'cat', 'src');
    assertPercentInBounds(-0.5, 'y', 'cat', 'src');
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
