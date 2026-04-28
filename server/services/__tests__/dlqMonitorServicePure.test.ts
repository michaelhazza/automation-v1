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

// Dedup is unreachable under the convention check (every entry's deadLetter
// must equal `<key>__dlq`, so two distinct keys cannot legally share a value).
// Object.fromEntries also collapses duplicate keys at construction time, so a
// test fixture cannot produce two entries with the same key. The Set in
// deriveDlqQueueNames is defense-in-depth; an explicit test would require
// bypassing the convention check, which would itself be a bug.

test('throws when deadLetter does not match <queue>__dlq', () => {
  const config = {
    'workflow-run-tick': { deadLetter: 'wrong-name' },
  } as unknown as Parameters<typeof deriveDlqQueueNames>[0];

  assert.throws(
    () => deriveDlqQueueNames(config),
    /JOB_CONFIG\['workflow-run-tick'\]\.deadLetter must equal 'workflow-run-tick__dlq', got 'wrong-name'/,
  );
});
