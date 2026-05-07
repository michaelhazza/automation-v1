/**
 * activityServicePure.test.ts — Unit tests for pure helpers in activityServicePure.ts.
 *
 * C1 (ui-consolidation-operate): covers aggregateFilterOptions with spec §4.1 faceted-search
 * semantics, mapAgentRunTriggerType, sortActivityItems, and addNullAdditiveFields.
 *
 * Test posture: targeted Vitest only — do NOT run umbrella suites locally.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateFilterOptions,
  mapAgentRunTriggerType,
  sortActivityItems,
  addNullAdditiveFields,
} from '../activityServicePure.js';
import type { AggregableItem, AggregateFilters } from '../activityServicePure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<AggregableItem> & { id: string }): AggregableItem {
  return {
    type: 'agent_run',
    status: 'completed',
    actor: 'Agent A',
    subaccountId: 'sub-1',
    subaccountName: 'Sub One',
    triggerType: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// aggregateFilterOptions — core invariant tests
// ---------------------------------------------------------------------------

describe('aggregateFilterOptions', () => {
  describe('empty filters — counts equal items grouped by dimension', () => {
    it('counts all types when no filter active', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', type: 'agent_run' }),
        makeItem({ id: '2', type: 'agent_run' }),
        makeItem({ id: '3', type: 'review_item' }),
      ];
      const result = aggregateFilterOptions(items, {});

      const typeCounts = Object.fromEntries(result.type.map((e) => [e.value, e.count]));
      expect(typeCounts['agent_run']).toBe(2);
      expect(typeCounts['review_item']).toBe(1);
    });

    it('counts all statuses when no filter active', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', status: 'completed' }),
        makeItem({ id: '2', status: 'completed' }),
        makeItem({ id: '3', status: 'failed' }),
        makeItem({ id: '4', status: 'active' }),
      ];
      const result = aggregateFilterOptions(items, {});

      const statusCounts = Object.fromEntries(result.status.map((e) => [e.value, e.count]));
      expect(statusCounts['completed']).toBe(2);
      expect(statusCounts['failed']).toBe(1);
      expect(statusCounts['active']).toBe(1);
    });

    it('counts all actors when no filter active', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', actor: 'Agent A' }),
        makeItem({ id: '2', actor: 'Agent A' }),
        makeItem({ id: '3', actor: 'Agent B' }),
      ];
      const result = aggregateFilterOptions(items, {});

      const actorCounts = Object.fromEntries(result.actor.map((e) => [e.value, e.count]));
      expect(actorCounts['Agent A']).toBe(2);
      expect(actorCounts['Agent B']).toBe(1);
    });

    it('counts all subaccounts when no filter active', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', subaccountId: 'sub-1', subaccountName: 'Sub One' }),
        makeItem({ id: '2', subaccountId: 'sub-1', subaccountName: 'Sub One' }),
        makeItem({ id: '3', subaccountId: 'sub-2', subaccountName: 'Sub Two' }),
      ];
      const result = aggregateFilterOptions(items, {});

      const subCounts = Object.fromEntries(result.subaccount.map((e) => [e.value, e.count]));
      expect(subCounts['sub-1']).toBe(2);
      expect(subCounts['sub-2']).toBe(1);
    });

    it('returns empty arrays when items list is empty', () => {
      const result = aggregateFilterOptions([], {});
      expect(result.type).toEqual([]);
      expect(result.status).toEqual([]);
      expect(result.actor).toEqual([]);
      expect(result.subaccount).toEqual([]);
    });
  });

  describe('single dimension active — that dimension counts ignore its own filter', () => {
    it('type facet counts ignore active type filter', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', type: 'agent_run', status: 'completed' }),
        makeItem({ id: '2', type: 'review_item', status: 'completed' }),
        makeItem({ id: '3', type: 'health_finding', status: 'attention_needed' }),
      ];
      // Only agent_run is selected but type counts should show ALL three types
      const filters: AggregateFilters = { type: ['agent_run'] };
      const result = aggregateFilterOptions(items, filters);

      const typeCounts = Object.fromEntries(result.type.map((e) => [e.value, e.count]));
      expect(typeCounts['agent_run']).toBe(1);
      expect(typeCounts['review_item']).toBe(1);
      expect(typeCounts['health_finding']).toBe(1);
    });

    it('status facet counts ignore active status filter', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', status: 'completed' }),
        makeItem({ id: '2', status: 'failed' }),
        makeItem({ id: '3', status: 'active' }),
      ];
      const filters: AggregateFilters = { status: ['completed'] };
      const result = aggregateFilterOptions(items, filters);

      const statusCounts = Object.fromEntries(result.status.map((e) => [e.value, e.count]));
      expect(statusCounts['completed']).toBe(1);
      expect(statusCounts['failed']).toBe(1);
      expect(statusCounts['active']).toBe(1);
    });

    it('actor facet counts ignore active actor filter', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', actor: 'Agent A' }),
        makeItem({ id: '2', actor: 'Agent B' }),
        makeItem({ id: '3', actor: 'Agent C' }),
      ];
      const filters: AggregateFilters = { actor: ['Agent A'] };
      const result = aggregateFilterOptions(items, filters);

      const actorCounts = Object.fromEntries(result.actor.map((e) => [e.value, e.count]));
      expect(actorCounts['Agent A']).toBe(1);
      expect(actorCounts['Agent B']).toBe(1);
      expect(actorCounts['Agent C']).toBe(1);
    });

    it('subaccount facet counts ignore active subaccount filter', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', subaccountId: 'sub-1', subaccountName: 'Sub One' }),
        makeItem({ id: '2', subaccountId: 'sub-2', subaccountName: 'Sub Two' }),
        makeItem({ id: '3', subaccountId: 'sub-3', subaccountName: 'Sub Three' }),
      ];
      const filters: AggregateFilters = { subaccount: ['sub-1'] };
      const result = aggregateFilterOptions(items, filters);

      const subCounts = Object.fromEntries(result.subaccount.map((e) => [e.value, e.count]));
      expect(subCounts['sub-1']).toBe(1);
      expect(subCounts['sub-2']).toBe(1);
      expect(subCounts['sub-3']).toBe(1);
    });

    it('non-type facets still respect the active type filter', () => {
      // 3 items: 2 agent_run + 1 review_item. Active filter: type=agent_run.
      // status counts should only reflect the 2 agent_run items.
      const items: AggregableItem[] = [
        makeItem({ id: '1', type: 'agent_run', status: 'completed', actor: 'Agent A' }),
        makeItem({ id: '2', type: 'agent_run', status: 'failed', actor: 'Agent A' }),
        makeItem({ id: '3', type: 'review_item', status: 'completed', actor: 'Reviewer' }),
      ];
      const filters: AggregateFilters = { type: ['agent_run'] };
      const result = aggregateFilterOptions(items, filters);

      // Status counts should exclude review_item (type filter respected for status)
      const statusCounts = Object.fromEntries(result.status.map((e) => [e.value, e.count]));
      expect(statusCounts['completed']).toBe(1);   // only agent_run completed
      expect(statusCounts['failed']).toBe(1);
      expect(statusCounts['completed'] + (statusCounts['failed'] ?? 0)).toBe(2); // total = 2 agent_runs

      // Actor counts should also exclude review_item's actor
      const actorCounts = Object.fromEntries(result.actor.map((e) => [e.value, e.count]));
      expect(actorCounts['Agent A']).toBe(2);
      expect(actorCounts['Reviewer']).toBeUndefined();
    });
  });

  describe('combined filters — AND across dimensions, OR within a dimension', () => {
    it('AND across type + status filters for non-type/non-status facets', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', type: 'agent_run', status: 'completed', actor: 'Agent A', subaccountId: 'sub-1', subaccountName: 'Sub One' }),
        makeItem({ id: '2', type: 'agent_run', status: 'failed', actor: 'Agent B', subaccountId: 'sub-1', subaccountName: 'Sub One' }),
        makeItem({ id: '3', type: 'review_item', status: 'completed', actor: 'Reviewer', subaccountId: 'sub-2', subaccountName: 'Sub Two' }),
        makeItem({ id: '4', type: 'workflow_run', status: 'active', actor: 'Workflow', subaccountId: 'sub-2', subaccountName: 'Sub Two' }),
      ];
      // Filters: type=agent_run AND status=completed
      const filters: AggregateFilters = { type: ['agent_run'], status: ['completed'] };
      const result = aggregateFilterOptions(items, filters);

      // Actor counts: for actor facet, ignore actor filter (none active), respect type + status
      // Items that pass type=agent_run AND status=completed: only item 1
      const actorCounts = Object.fromEntries(result.actor.map((e) => [e.value, e.count]));
      expect(actorCounts['Agent A']).toBe(1);
      expect(actorCounts['Agent B']).toBeUndefined();
      expect(actorCounts['Reviewer']).toBeUndefined();
    });

    it('OR within dimension: multiple type values include all matching items', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', type: 'agent_run', actor: 'Agent A' }),
        makeItem({ id: '2', type: 'review_item', actor: 'Reviewer' }),
        makeItem({ id: '3', type: 'health_finding', actor: 'Detector' }),
        makeItem({ id: '4', type: 'workflow_run', actor: 'Workflow' }),
      ];
      // Two types selected: agent_run OR review_item
      const filters: AggregateFilters = { type: ['agent_run', 'review_item'] };
      const result = aggregateFilterOptions(items, filters);

      // Actor counts respect type filter (for actor facet) → only agent_run + review_item actors
      const actorCounts = Object.fromEntries(result.actor.map((e) => [e.value, e.count]));
      expect(actorCounts['Agent A']).toBe(1);
      expect(actorCounts['Reviewer']).toBe(1);
      expect(actorCounts['Detector']).toBeUndefined();
      expect(actorCounts['Workflow']).toBeUndefined();
    });

    it('OR within actor dimension: multiple selected actors each show counts', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', actor: 'Agent A', type: 'agent_run' }),
        makeItem({ id: '2', actor: 'Agent B', type: 'agent_run' }),
        makeItem({ id: '3', actor: 'Agent C', type: 'review_item' }),
      ];
      // Both Agent A and Agent B selected
      const filters: AggregateFilters = { actor: ['Agent A', 'Agent B'] };
      const result = aggregateFilterOptions(items, filters);

      // Type facet: respect actor filter → only items 1 + 2 match (both agent_run)
      const typeCounts = Object.fromEntries(result.type.map((e) => [e.value, e.count]));
      expect(typeCounts['agent_run']).toBe(2);
      expect(typeCounts['review_item']).toBeUndefined();

      // Actor facet: ignores actor filter → all three actors visible
      const actorCounts = Object.fromEntries(result.actor.map((e) => [e.value, e.count]));
      expect(actorCounts['Agent A']).toBe(1);
      expect(actorCounts['Agent B']).toBe(1);
      expect(actorCounts['Agent C']).toBe(1);
    });
  });

  describe('missing/null triggerSource falls back to unknown subaccountId', () => {
    it('items with null subaccountId are counted under "unknown"', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', subaccountId: null, subaccountName: null }),
        makeItem({ id: '2', subaccountId: null, subaccountName: null }),
        makeItem({ id: '3', subaccountId: 'sub-1', subaccountName: 'Sub One' }),
      ];
      const result = aggregateFilterOptions(items, {});

      const subCounts = Object.fromEntries(result.subaccount.map((e) => [e.value, e.count]));
      expect(subCounts['unknown']).toBe(2);
      expect(subCounts['sub-1']).toBe(1);
    });

    it('subaccount filter on "unknown" matches items with null subaccountId', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', subaccountId: null, subaccountName: null, type: 'agent_run' }),
        makeItem({ id: '2', subaccountId: 'sub-1', subaccountName: 'Sub One', type: 'review_item' }),
      ];
      const filters: AggregateFilters = { subaccount: ['unknown'] };
      const result = aggregateFilterOptions(items, filters);

      // Type facet respects subaccount filter: only item 1 (unknown subaccount)
      const typeCounts = Object.fromEntries(result.type.map((e) => [e.value, e.count]));
      expect(typeCounts['agent_run']).toBe(1);
      expect(typeCounts['review_item']).toBeUndefined();
    });
  });

  describe('subaccount label resolution', () => {
    it('label falls back to subaccountId when no subaccountName is set', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', subaccountId: 'sub-orphan', subaccountName: null }),
      ];
      const result = aggregateFilterOptions(items, {});

      const sub = result.subaccount.find((e) => e.value === 'sub-orphan');
      expect(sub).toBeDefined();
      expect(sub!.label).toBe('sub-orphan');
    });

    it('label uses subaccountName when available', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', subaccountId: 'sub-1', subaccountName: 'My Workspace' }),
      ];
      const result = aggregateFilterOptions(items, {});

      const sub = result.subaccount.find((e) => e.value === 'sub-1');
      expect(sub).toBeDefined();
      expect(sub!.label).toBe('My Workspace');
    });
  });

  describe('result ordering', () => {
    it('sorts entries by count DESC then value ASC for stability', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', type: 'b_type' }),
        makeItem({ id: '2', type: 'a_type' }),
        makeItem({ id: '3', type: 'b_type' }),
        makeItem({ id: '4', type: 'c_type' }),
        makeItem({ id: '5', type: 'a_type' }),
        makeItem({ id: '6', type: 'a_type' }),
      ];
      const result = aggregateFilterOptions(items, {});

      // a_type=3, b_type=2, c_type=1 — sort by count DESC
      expect(result.type[0].value).toBe('a_type');
      expect(result.type[1].value).toBe('b_type');
      expect(result.type[2].value).toBe('c_type');
    });

    it('uses value ASC as a tiebreaker when counts are equal', () => {
      const items: AggregableItem[] = [
        makeItem({ id: '1', type: 'z_type' }),
        makeItem({ id: '2', type: 'a_type' }),
      ];
      const result = aggregateFilterOptions(items, {});

      // Both have count=1 → sorted a_type before z_type
      expect(result.type[0].value).toBe('a_type');
      expect(result.type[1].value).toBe('z_type');
    });
  });
});

// ---------------------------------------------------------------------------
// mapAgentRunTriggerType
// ---------------------------------------------------------------------------

describe('mapAgentRunTriggerType', () => {
  it('returns scheduled for run_type=scheduled', () => {
    expect(mapAgentRunTriggerType('scheduled', null)).toBe('scheduled');
  });

  it('returns manual for run_type=manual', () => {
    expect(mapAgentRunTriggerType('manual', null)).toBe('manual');
  });

  it('returns agent for run_type=triggered AND run_source=sub_agent', () => {
    expect(mapAgentRunTriggerType('triggered', 'sub_agent')).toBe('agent');
  });

  it('returns agent for run_type=triggered AND run_source=handoff', () => {
    expect(mapAgentRunTriggerType('triggered', 'handoff')).toBe('agent');
  });

  it('returns webhook for run_type=triggered AND run_source=null', () => {
    expect(mapAgentRunTriggerType('triggered', null)).toBe('webhook');
  });

  it('returns webhook for run_type=triggered AND unknown run_source', () => {
    expect(mapAgentRunTriggerType('triggered', 'some_external_hook')).toBe('webhook');
  });

  it('returns null for unknown run_type', () => {
    expect(mapAgentRunTriggerType('unknown_type', null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addNullAdditiveFields
// ---------------------------------------------------------------------------

describe('addNullAdditiveFields', () => {
  it('returns all expected null fields including triggerSource', () => {
    const fields = addNullAdditiveFields();
    expect(fields.triggeredByUserId).toBeNull();
    expect(fields.triggeredByUserName).toBeNull();
    expect(fields.triggerType).toBeNull();
    expect(fields.triggerSource).toBeNull();
    expect(fields.durationMs).toBeNull();
    expect(fields.runId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sortActivityItems — representative cases
// ---------------------------------------------------------------------------

describe('sortActivityItems', () => {
  const items = [
    { id: 'b', type: 'agent_run', status: 'attention_needed', severity: 'warning' as const, createdAt: '2024-01-01T10:00:00Z' },
    { id: 'a', type: 'agent_run', status: 'completed', severity: null, createdAt: '2024-01-02T10:00:00Z' },
    { id: 'c', type: 'agent_run', status: 'failed', severity: 'critical' as const, createdAt: '2024-01-01T10:00:00Z' },
  ];

  it('newest sorts by createdAt DESC with id ASC tiebreaker', () => {
    const result = sortActivityItems(items, 'newest');
    expect(result[0].id).toBe('a');   // newest createdAt
    expect(result[1].id).toBe('b');   // same date, 'b' < 'c' alphabetically
    expect(result[2].id).toBe('c');
  });

  it('oldest sorts by createdAt ASC with id ASC tiebreaker', () => {
    const result = sortActivityItems(items, 'oldest');
    expect(result[0].id).toBe('b');   // oldest, 'b' < 'c'
    expect(result[1].id).toBe('c');
    expect(result[2].id).toBe('a');   // newest date last
  });

  it('attention_first: attention_needed before failed before completed', () => {
    const result = sortActivityItems(items, 'attention_first');
    expect(result[0].id).toBe('b');   // attention_needed
    expect(result[1].id).toBe('c');   // failed
    expect(result[2].id).toBe('a');   // completed
  });
});
