/**
 * studioCanvasPure.test.ts — unit tests for pure canvas layout helpers.
 *
 * Run via:
 *   npx vitest run client/src/components/studio/__tests__/studioCanvasPure.test.ts
 */

import { expect, test, describe } from 'vitest';
import {
  computeBranchLayout,
  computeParallelLayout,
  computeRejectArrows,
  aggregateValidationStatus,
  aggregateCostEstimate,
  type CanvasStep,
  type StepValidationResult,
} from '../studioCanvasPure.js';

// ─── computeBranchLayout ─────────────────────────────────────────────────────

describe('computeBranchLayout', () => {
  test('single step: rowIndex 0, columnIndex 0', () => {
    const steps: CanvasStep[] = [{ id: 'a', name: 'A', type: 'agent' }];
    const result = computeBranchLayout(steps);
    expect(result).toHaveLength(1);
    expect(result[0].rowIndex).toBe(0);
    expect(result[0].columnIndex).toBe(0);
    expect(result[0].isBranchChild).toBe(false);
  });

  test('linear chain: a → b → c assigned increasing rows', () => {
    const steps: CanvasStep[] = [
      { id: 'a', name: 'A', type: 'agent', dependsOn: [] },
      { id: 'b', name: 'B', type: 'agent', dependsOn: ['a'] },
      { id: 'c', name: 'C', type: 'agent', dependsOn: ['b'] },
    ];
    const result = computeBranchLayout(steps);
    const byId = Object.fromEntries(result.map((r) => [r.step.id, r]));
    expect(byId['a'].rowIndex).toBe(0);
    expect(byId['b'].rowIndex).toBe(1);
    expect(byId['c'].rowIndex).toBe(2);
  });

  test('branch children get different column indices', () => {
    const steps: CanvasStep[] = [
      {
        id: 'decision',
        name: 'Decision',
        type: 'agent',
        branches: [
          { id: 'br1', label: 'Yes', onSuccess: 'yes_step' },
          { id: 'br2', label: 'No', onSuccess: 'no_step' },
        ],
      },
      { id: 'yes_step', name: 'Yes', type: 'agent', dependsOn: ['decision'] },
      { id: 'no_step', name: 'No', type: 'agent', dependsOn: ['decision'] },
    ];
    const result = computeBranchLayout(steps);
    const byId = Object.fromEntries(result.map((r) => [r.step.id, r]));
    expect(byId['yes_step'].isBranchChild).toBe(true);
    expect(byId['no_step'].isBranchChild).toBe(true);
    expect(byId['yes_step'].columnIndex).toBe(0);
    expect(byId['no_step'].columnIndex).toBe(1);
    expect(byId['yes_step'].branchLabel).toBe('Yes');
    expect(byId['no_step'].branchLabel).toBe('No');
  });

  test('result is sorted by rowIndex then columnIndex', () => {
    const steps: CanvasStep[] = [
      { id: 'c', name: 'C', type: 'agent', dependsOn: ['a'] },
      { id: 'a', name: 'A', type: 'agent', dependsOn: [] },
      { id: 'b', name: 'B', type: 'agent', dependsOn: [] },
    ];
    const result = computeBranchLayout(steps);
    // a and b share row 0, c is row 1
    expect(result[result.length - 1].step.id).toBe('c');
  });
});

// ─── computeParallelLayout ───────────────────────────────────────────────────

describe('computeParallelLayout', () => {
  test('steps with same rowIndex are grouped together', () => {
    const steps: CanvasStep[] = [
      { id: 'a', name: 'A', type: 'agent' },
      { id: 'b', name: 'B', type: 'agent' },
      { id: 'c', name: 'C', type: 'agent', dependsOn: ['a', 'b'] },
    ];
    const renderableSteps = computeBranchLayout(steps);
    const layout = computeParallelLayout(renderableSteps);
    const row0 = layout.get(0);
    expect(row0).toBeDefined();
    // a and b both have no deps → row 0
    expect(row0!.length).toBe(2);
  });

  test('single-step rows are not grouped', () => {
    const steps: CanvasStep[] = [
      { id: 'a', name: 'A', type: 'agent', dependsOn: [] },
      { id: 'b', name: 'B', type: 'agent', dependsOn: ['a'] },
    ];
    const renderableSteps = computeBranchLayout(steps);
    const layout = computeParallelLayout(renderableSteps);
    expect(layout.get(0)!.length).toBe(1);
    expect(layout.get(1)!.length).toBe(1);
  });
});

// ─── computeRejectArrows ─────────────────────────────────────────────────────

describe('computeRejectArrows', () => {
  test('approval step with onReject produces an arrow', () => {
    const steps: CanvasStep[] = [
      { id: 'review', name: 'Review', type: 'approval', onReject: 'fix_step' },
      { id: 'fix_step', name: 'Fix', type: 'agent' },
    ];
    const arrows = computeRejectArrows(steps);
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toEqual({ fromStepId: 'review', toStepId: 'fix_step' });
  });

  test('approval step without onReject produces no arrow', () => {
    const steps: CanvasStep[] = [
      { id: 'review', name: 'Review', type: 'approval' },
    ];
    const arrows = computeRejectArrows(steps);
    expect(arrows).toHaveLength(0);
  });

  test('non-approval steps are ignored even with onReject field', () => {
    const steps: CanvasStep[] = [
      { id: 'step', name: 'Step', type: 'agent', onReject: 'somewhere' },
    ];
    const arrows = computeRejectArrows(steps);
    expect(arrows).toHaveLength(0);
  });

  test('multiple approval steps produce multiple arrows', () => {
    const steps: CanvasStep[] = [
      { id: 'a1', name: 'A1', type: 'approval', onReject: 'fix_a' },
      { id: 'a2', name: 'A2', type: 'approval', onReject: 'fix_b' },
    ];
    const arrows = computeRejectArrows(steps);
    expect(arrows).toHaveLength(2);
  });
});

// ─── aggregateValidationStatus ───────────────────────────────────────────────

describe('aggregateValidationStatus', () => {
  test('empty map: valid = true, errorCount = 0', () => {
    const result = aggregateValidationStatus(new Map());
    expect(result.valid).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.worstError).toBeNull();
  });

  test('steps with no errors: valid = true', () => {
    const map = new Map<string, StepValidationResult[]>([
      ['step_a', []],
      ['step_b', []],
    ]);
    const result = aggregateValidationStatus(map);
    expect(result.valid).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  test('one error: valid = false, errorCount = 1, worstError set', () => {
    const map = new Map<string, StepValidationResult[]>([
      ['step_a', [{ rule: 'four_as_vocabulary', message: 'Bad type', severity: 'error' }]],
    ]);
    const result = aggregateValidationStatus(map);
    expect(result.valid).toBe(false);
    expect(result.errorCount).toBe(1);
    expect(result.worstError).toBe('Bad type');
  });

  test('warnings do not make valid = false', () => {
    const map = new Map<string, StepValidationResult[]>([
      ['step_a', [{ rule: 'four_as_vocabulary', message: 'Warn', severity: 'warning' }]],
    ]);
    const result = aggregateValidationStatus(map);
    expect(result.valid).toBe(true);
    expect(result.warningCount).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  test('multiple steps with errors: total errorCount is sum', () => {
    const map = new Map<string, StepValidationResult[]>([
      ['step_a', [{ rule: 'four_as_vocabulary', message: 'E1', severity: 'error' }]],
      ['step_b', [
        { rule: 'branching_target_exists', message: 'E2', severity: 'error' },
        { rule: 'parallel_depth', message: 'E3', severity: 'error' },
      ]],
    ]);
    const result = aggregateValidationStatus(map);
    expect(result.errorCount).toBe(3);
    expect(result.valid).toBe(false);
  });
});

// ─── aggregateCostEstimate ───────────────────────────────────────────────────

describe('aggregateCostEstimate', () => {
  test('empty steps: total = 0', () => {
    expect(aggregateCostEstimate([])).toBe(0);
  });

  test('agent step uses 50 cent default', () => {
    const steps: CanvasStep[] = [{ id: 'a', name: 'A', type: 'agent' }];
    expect(aggregateCostEstimate(steps)).toBe(50);
  });

  test('action step uses 5 cent default', () => {
    const steps: CanvasStep[] = [{ id: 'a', name: 'A', type: 'action' }];
    expect(aggregateCostEstimate(steps)).toBe(5);
  });

  test('unknown type costs 0', () => {
    const steps: CanvasStep[] = [{ id: 'a', name: 'A', type: 'ask' }];
    expect(aggregateCostEstimate(steps)).toBe(0);
  });

  test('explicit estimatedCostCents overrides default', () => {
    const steps: CanvasStep[] = [
      { id: 'a', name: 'A', type: 'agent', params: { estimatedCostCents: 200 } },
    ];
    expect(aggregateCostEstimate(steps)).toBe(200);
  });

  test('multiple steps sum correctly', () => {
    const steps: CanvasStep[] = [
      { id: 'a', name: 'A', type: 'agent' },      // 50
      { id: 'b', name: 'B', type: 'action' },     // 5
      { id: 'c', name: 'C', type: 'ask' },        // 0
      { id: 'd', name: 'D', type: 'invoke_automation' }, // 25
    ];
    expect(aggregateCostEstimate(steps)).toBe(80);
  });
});
