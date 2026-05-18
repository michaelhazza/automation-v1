import { describe, it, expect } from 'vitest';
import { defaultAgentId, type SubaccountAgent } from '../TaskAgentPickerPure.js';

function makeAgent(agentId: string, parentSubaccountAgentId: string | null = null): SubaccountAgent {
  return {
    agentId,
    parentSubaccountAgentId,
    agent: { name: `Agent ${agentId}`, icon: null },
  };
}

describe('defaultAgentId — layout variant', () => {
  it('always returns null regardless of agents', () => {
    expect(defaultAgentId([makeAgent('a1')], 'layout')).toBeNull();
  });

  it('returns null for empty agents array', () => {
    expect(defaultAgentId([], 'layout')).toBeNull();
  });
});

describe('defaultAgentId — review-queue variant', () => {
  it('returns top-level agent (no parent) when one exists', () => {
    const agents = [makeAgent('child', 'parent-id'), makeAgent('top', null)];
    expect(defaultAgentId(agents, 'review-queue')).toBe('top');
  });

  it('returns first top-level agent when multiple exist', () => {
    const agents = [makeAgent('top1', null), makeAgent('top2', null)];
    expect(defaultAgentId(agents, 'review-queue')).toBe('top1');
  });

  it('falls back to first agent when no top-level agent exists', () => {
    const agents = [makeAgent('child1', 'parent1'), makeAgent('child2', 'parent2')];
    expect(defaultAgentId(agents, 'review-queue')).toBe('child1');
  });

  it('returns null for empty agents array', () => {
    expect(defaultAgentId([], 'review-queue')).toBeNull();
  });

  it('is deterministic — same result for same input regardless of call order', () => {
    const agents = [makeAgent('child', 'p1'), makeAgent('top', null), makeAgent('child2', 'p2')];
    const result1 = defaultAgentId(agents, 'review-queue');
    const result2 = defaultAgentId(agents, 'review-queue');
    const result3 = defaultAgentId(agents, 'review-queue');
    expect(result1).toBe('top');
    expect(result2).toBe('top');
    expect(result3).toBe('top');
  });
});
