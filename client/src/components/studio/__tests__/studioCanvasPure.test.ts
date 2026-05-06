/**
 * studioCanvasPure.test.ts — unit tests for groupStepsByLayer and hasBackEdge.
 */

import { describe, it, expect } from 'vitest';
import { groupStepsByLayer, hasBackEdge, type CanvasStep } from '../studioCanvasPure.js';

function step(id: string, dependsOn: string[] = []): CanvasStep {
  return { id, name: `Step ${id}`, type: 'agent', dependsOn, sideEffectType: 'none' };
}

describe('studioCanvasPure — groupStepsByLayer', () => {
  it('empty input → empty output', () => {
    expect(groupStepsByLayer([])).toEqual([]);
  });

  it('single step with no deps → layer 0', () => {
    const result = groupStepsByLayer([step('a')]);
    expect(result).toHaveLength(1);
    expect(result[0].map((s) => s.id)).toEqual(['a']);
  });

  it('3-step linear chain → 3 separate layers', () => {
    const steps = [step('a'), step('b', ['a']), step('c', ['b'])];
    const result = groupStepsByLayer(steps);
    expect(result).toHaveLength(3);
    expect(result[0].map((s) => s.id)).toEqual(['a']);
    expect(result[1].map((s) => s.id)).toEqual(['b']);
    expect(result[2].map((s) => s.id)).toEqual(['c']);
  });

  it('parallel steps (same dependsOn) → same layer', () => {
    const steps = [
      step('a'),
      step('b', ['a']),
      step('c', ['a']),
      step('d', ['b', 'c']),
    ];
    const result = groupStepsByLayer(steps);
    expect(result).toHaveLength(3);
    expect(result[0].map((s) => s.id)).toEqual(['a']);
    expect(result[1].map((s) => s.id).sort()).toEqual(['b', 'c']);
    expect(result[2].map((s) => s.id)).toEqual(['d']);
  });

  it('steps submitted in reverse order still produce correct layers', () => {
    const steps = [step('c', ['b']), step('b', ['a']), step('a')];
    const result = groupStepsByLayer(steps);
    expect(result).toHaveLength(3);
    expect(result[0].map((s) => s.id)).toEqual(['a']);
    expect(result[1].map((s) => s.id)).toEqual(['b']);
    expect(result[2].map((s) => s.id)).toEqual(['c']);
  });

  it('step with missing dep → placed in overflow layer without throwing', () => {
    const steps = [step('a'), step('b', ['missing-dep'])];
    const result = groupStepsByLayer(steps);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].some((s) => s.id === 'a')).toBe(true);
    const allIds = result.flat().map((s) => s.id);
    expect(allIds).toContain('b');
  });
});

describe('studioCanvasPure — hasBackEdge', () => {
  it('step with params.onReject pointing to prior step → true', () => {
    const steps: CanvasStep[] = [
      step('a'),
      { ...step('b', ['a']), params: { onReject: 'a' } },
    ];
    expect(hasBackEdge(steps, 'b', 'a')).toBe(true);
  });

  it('step with onReject pointing to itself → false (not a back edge to toId)', () => {
    const steps: CanvasStep[] = [
      step('a'),
      { ...step('b', ['a']), params: { onReject: 'b' } },
    ];
    expect(hasBackEdge(steps, 'b', 'a')).toBe(false);
  });

  it('step with no onReject → false', () => {
    const steps: CanvasStep[] = [step('a'), step('b', ['a'])];
    expect(hasBackEdge(steps, 'b', 'a')).toBe(false);
  });

  it('fromId not found → false', () => {
    const steps: CanvasStep[] = [step('a')];
    expect(hasBackEdge(steps, 'nonexistent', 'a')).toBe(false);
  });

  it('top-level onReject field (not inside params) → true', () => {
    const steps: CanvasStep[] = [
      step('a'),
      { ...step('b', ['a']), onReject: 'a' },
    ];
    expect(hasBackEdge(steps, 'b', 'a')).toBe(true);
  });
});
