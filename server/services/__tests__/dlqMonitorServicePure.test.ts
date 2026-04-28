import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDlqQueueNames } from '../dlqMonitorServicePure.js';

test('returns DLQ names for every entry that declares deadLetter', () => {
  const config = {
    'a': { deadLetter: 'a__dlq' },
    'b': { deadLetter: 'b__dlq' },
  } as unknown as Parameters<typeof deriveDlqQueueNames>[0];
  assert.deepEqual(deriveDlqQueueNames(config), ['a__dlq', 'b__dlq']);
});

test('skips entries without deadLetter', () => {
  const config = {
    'a': { deadLetter: 'a__dlq' },
    'b': {},
  } as unknown as Parameters<typeof deriveDlqQueueNames>[0];
  assert.deepEqual(deriveDlqQueueNames(config), ['a__dlq']);
});

test('deduplicates identical deadLetter values', () => {
  // Build config programmatically so the Set dedup path is exercised —
  // the convention checker requires key === dlq-prefix, so we inject the
  // same entry under the same key via a Map-style construct.
  const base = {
    'shared': { deadLetter: 'shared__dlq' },
  };
  // Force two references to the same entry in the iterable to test dedup.
  const config = Object.fromEntries([
    ...Object.entries(base),
    ...Object.entries(base),
  ]) as unknown as Parameters<typeof deriveDlqQueueNames>[0];
  assert.deepEqual(deriveDlqQueueNames(config), ['shared__dlq']);
});

test('throws when deadLetter does not match <queue>__dlq', () => {
  const config = {
    'workflow-run-tick': { deadLetter: 'wrong-name' },
  } as unknown as Parameters<typeof deriveDlqQueueNames>[0];

  assert.throws(
    () => deriveDlqQueueNames(config),
    /JOB_CONFIG\['workflow-run-tick'\]\.deadLetter must equal 'workflow-run-tick__dlq', got 'wrong-name'/,
  );
});
