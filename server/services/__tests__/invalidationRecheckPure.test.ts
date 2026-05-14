import { describe, it, expect } from 'vitest';
import { shouldDiscardWriteForInvalidation } from '../workflowEngineServicePure.js';

describe('shouldDiscardWriteForInvalidation', () => {
  it.each([
    ['invalidated', true],
    ['cancelled', true],
    ['running', false],
    ['completed', false],
    ['pending', false],
    ['', false],
  ])('status=%s → discard=%s', (status, expected) => {
    expect(shouldDiscardWriteForInvalidation(status)).toBe(expected);
  });
});
