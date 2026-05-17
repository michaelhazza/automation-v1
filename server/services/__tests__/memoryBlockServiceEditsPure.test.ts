/**
 * memoryBlockServiceEditsPure.test.ts — Pure unit tests for the
 * buildEditSummary helper exported from memoryBlockService.
 *
 * No DB access. Tests the pure decision logic only.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/memoryBlockServiceEditsPure.test.ts
 */

import { expect, test } from 'vitest';
import { buildEditSummary } from '../memoryBlockService.js';

test('content delta produces length-annotated summary', () => {
  const summary = buildEditSummary(
    { name: 'my-block', content: 'short' },
    { content: 'a much longer piece of content here' },
  );
  // 'short' = 5 chars, long string = 35 chars
  expect(summary).toBe('Updated content (5→35 chars)');
});

test('name change produces renamed summary', () => {
  const summary = buildEditSummary(
    { name: 'old-name', content: 'hello' },
    { name: 'new-name' },
  );
  expect(summary).toBe('Renamed: old-name → new-name');
});

test('no-op changes produce no-changes summary', () => {
  const summary = buildEditSummary(
    { name: 'my-block', content: 'same content' },
    { isReadOnly: false }, // only isReadOnly changed — not tracked in summary
  );
  expect(summary).toBe('No changes detected');
});
