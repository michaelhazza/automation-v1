/**
 * Pure-function tests for computeConsolidationViolations
 * (Chunk 3 of skill-merge-consolidation-pass).
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/skillAnalyzerServicePure.orchestration.test.ts
 */

import { test, expect } from 'vitest';
import { computeConsolidationViolations } from '../skillAnalyzerServicePure.js';

test('still-bloated-but-shorter output with retained SCOPE_EXPANSION returns no violations (succeeded)', () => {
  const preWarnings = [{ code: 'SCOPE_EXPANSION' }];
  const postWarnings = [{ code: 'SCOPE_EXPANSION' }];
  const result = computeConsolidationViolations(preWarnings, postWarnings);
  expect(result).toEqual([]);
});

test('post-consolidation output that introduces HITL_LOST returns that violation (failed revert)', () => {
  const preWarnings = [{ code: 'SCOPE_EXPANSION' }];
  const postWarnings = [{ code: 'SCOPE_EXPANSION' }, { code: 'HITL_LOST' }];
  const result = computeConsolidationViolations(preWarnings, postWarnings);
  expect(result).toEqual(['HITL_LOST']);
});
