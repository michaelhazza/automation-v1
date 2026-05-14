import { test, expect, describe } from 'vitest';
import { buildTree, subtreeWidth, CARD_W, COL_GAP } from '../layout.js';

describe('buildTree', () => {
  test('flat list with no parents returns all nodes as roots', () => {
    const agents = [
      { id: 'a1', agentId: 'a1', agentRole: null, agentTitle: null, parentSubaccountAgentId: null, isActive: true, agent: { name: 'Alice', icon: null, status: 'active' } },
      { id: 'a2', agentId: 'a2', agentRole: null, agentTitle: null, parentSubaccountAgentId: null, isActive: true, agent: { name: 'Bob', icon: null, status: 'active' } },
    ];
    const roots = buildTree(agents);
    expect(roots).toHaveLength(2);
    expect(roots[0].children).toHaveLength(0);
    expect(roots[1].children).toHaveLength(0);
  });

  test('parent-child relationship produces nested tree', () => {
    const agents = [
      { id: 'root', agentId: 'root', agentRole: null, agentTitle: null, parentSubaccountAgentId: null, isActive: true, agent: { name: 'Root', icon: null, status: 'active' } },
      { id: 'child1', agentId: 'child1', agentRole: null, agentTitle: null, parentSubaccountAgentId: 'root', isActive: true, agent: { name: 'Child1', icon: null, status: 'active' } },
      { id: 'child2', agentId: 'child2', agentRole: null, agentTitle: null, parentSubaccountAgentId: 'root', isActive: true, agent: { name: 'Child2', icon: null, status: 'active' } },
    ];
    const roots = buildTree(agents);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('root');
    expect(roots[0].children).toHaveLength(2);
    expect(roots[0].children[0].id).toBe('child1');
    expect(roots[0].children[1].id).toBe('child2');
  });

  test('node with unknown parentSubaccountAgentId becomes a root', () => {
    const agents = [
      { id: 'orphan', agentId: 'orphan', agentRole: null, agentTitle: null, parentSubaccountAgentId: 'nonexistent', isActive: true, agent: { name: 'Orphan', icon: null, status: 'active' } },
    ];
    const roots = buildTree(agents);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('orphan');
  });

  test('empty input returns empty array', () => {
    expect(buildTree([])).toHaveLength(0);
  });
});

describe('subtreeWidth', () => {
  test('leaf node returns CARD_W', () => {
    const leaf = { id: 'l', agentId: 'l', agentRole: null, agentTitle: null, parentSubaccountAgentId: null, isActive: true, agent: { name: 'Leaf', icon: null, status: 'active' }, children: [] };
    expect(subtreeWidth(leaf)).toBe(CARD_W);
  });

  test('node whose children are all leaves returns CARD_W (vertical stack)', () => {
    const child = { id: 'c', agentId: 'c', agentRole: null, agentTitle: null, parentSubaccountAgentId: null, isActive: true, agent: { name: 'C', icon: null, status: 'active' }, children: [] };
    const parent = { id: 'p', agentId: 'p', agentRole: null, agentTitle: null, parentSubaccountAgentId: null, isActive: true, agent: { name: 'P', icon: null, status: 'active' }, children: [child] };
    expect(subtreeWidth(parent)).toBe(CARD_W);
  });

  test('recursive sum: parent with two subtree children', () => {
    // Each child has a grandchild so they are NOT all-leaves → horizontal layout
    const grandchild1 = { id: 'gc1', agentId: 'gc1', agentRole: null, agentTitle: null, parentSubaccountAgentId: null, isActive: true, agent: { name: 'GC1', icon: null, status: 'active' }, children: [] };
    const grandchild2 = { id: 'gc2', agentId: 'gc2', agentRole: null, agentTitle: null, parentSubaccountAgentId: null, isActive: true, agent: { name: 'GC2', icon: null, status: 'active' }, children: [] };
    const child1 = { id: 'c1', agentId: 'c1', agentRole: null, agentTitle: null, parentSubaccountAgentId: null, isActive: true, agent: { name: 'C1', icon: null, status: 'active' }, children: [grandchild1] };
    const child2 = { id: 'c2', agentId: 'c2', agentRole: null, agentTitle: null, parentSubaccountAgentId: null, isActive: true, agent: { name: 'C2', icon: null, status: 'active' }, children: [grandchild2] };
    const parent = { id: 'p', agentId: 'p', agentRole: null, agentTitle: null, parentSubaccountAgentId: null, isActive: true, agent: { name: 'P', icon: null, status: 'active' }, children: [child1, child2] };
    // child1 and child2 each have one leaf child → each subtreeWidth = CARD_W
    // parent has 2 non-trivial children → horizontal layout
    // expected = CARD_W + CARD_W + COL_GAP * 1
    const expected = CARD_W + CARD_W + COL_GAP * 1;
    expect(subtreeWidth(parent)).toBe(expected);
  });
});
