/**
 * Pure-function tests for computeConsolidationViolations
 * (Chunk 3 of skill-merge-consolidation-pass).
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/skillAnalyzerServicePure.orchestration.test.ts
 */

import { test, expect } from 'vitest';
import {
  computeConsolidationViolations,
  buildConsolidationPrompt,
  parseConsolidationResponse,
  type ProposedMerge,
} from '../skillAnalyzerServicePure.js';

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

test('rationale round-trip: buildConsolidationPrompt includes mergeRationale, parseConsolidationResponse accepts verbatim echo', () => {
  const original: ProposedMerge = {
    name: 'Test Skill',
    description: 'A test skill description.',
    definition: { type: 'object', properties: { foo: { type: 'string' } } },
    instructions: 'Do the thing.',
    mergeRationale: 'Original rationale.',
  };

  const { userMessage } = buildConsolidationPrompt(original, 100, 120, 0.40);
  // The prompt must embed mergeRationale so the LLM can echo it.
  expect(userMessage).toContain('Original rationale.');

  // Simulate an LLM response that echoes mergeRationale verbatim.
  const syntheticResponse = JSON.stringify({
    consolidatedMerge: {
      name: original.name,
      description: original.description,
      definition: original.definition,
      instructions: 'Shorter instructions.',
      mergeRationale: 'Original rationale.',
    },
    consolidationNote: 'Trimmed redundant sections.',
    declinedToConsolidate: false,
    declineReason: null,
  });

  const result = parseConsolidationResponse(syntheticResponse, original);
  // Must NOT be a rejection.
  expect('reason' in result).toBe(false);
  if (!('reason' in result)) {
    expect(result.consolidatedMerge.mergeRationale).toBe('Original rationale.');
  }
});
