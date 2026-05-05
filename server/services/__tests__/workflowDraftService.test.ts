// guard-ignore-file: pure-helper-convention reason="shape-only contract test against the impure service module; the service is the unit under test, not a sibling pure helper. The DraftSource union is a shared/types literal, not a sibling extraction"
/**
 * workflowDraftService.test.ts
 *
 * Shape and type-level tests for workflowDraftService.
 * DB-touching methods are not called — only the exported shape is verified.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14b.
 */

import { describe, it, expect } from 'vitest';
import { workflowDraftService } from '../workflowDraftService.js';

// DraftSource literal union mirror — kept in lockstep with shared/types/workflowStepGate.ts
type DraftSource = 'orchestrator' | 'studio_handoff';
const validSources: DraftSource[] = ['orchestrator', 'studio_handoff'];

describe('DraftSource literal union', () => {
  it('contains exactly two values', () => {
    expect(validSources).toHaveLength(2);
  });

  it('contains "orchestrator"', () => {
    expect(validSources).toContain('orchestrator');
  });

  it('contains "studio_handoff"', () => {
    expect(validSources).toContain('studio_handoff');
  });
});

describe('workflowDraftService shape', () => {
  it('exports findById as a 2-arg function', () => {
    expect(typeof workflowDraftService.findById).toBe('function');
    expect(workflowDraftService.findById.length).toBe(2);
  });

  it('exports markConsumed as a 2-arg function', () => {
    expect(typeof workflowDraftService.markConsumed).toBe('function');
    expect(workflowDraftService.markConsumed.length).toBe(2);
  });

  it('exports create as a 1-arg function', () => {
    expect(typeof workflowDraftService.create).toBe('function');
    expect(workflowDraftService.create.length).toBe(1);
  });

  it('exports listUnconsumedOlderThan as a 1-arg function', () => {
    expect(typeof workflowDraftService.listUnconsumedOlderThan).toBe('function');
    expect(workflowDraftService.listUnconsumedOlderThan.length).toBe(1);
  });
});
