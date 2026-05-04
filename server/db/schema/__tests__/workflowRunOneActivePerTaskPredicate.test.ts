import { expect, test } from 'vitest';
import { WORKFLOW_RUN_TERMINAL_STATUSES } from '../../../../shared/types/workflowRunStatus.js';

// This test ensures the partial-unique-index predicate and the terminal-status
// constant stay in sync. If a new terminal status is added, this test fails.
test('WORKFLOW_RUN_TERMINAL_STATUSES matches partial-index predicate', () => {
  const expectedSet = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled', 'partial']);
  expect(WORKFLOW_RUN_TERMINAL_STATUSES).toEqual(expectedSet);
});
