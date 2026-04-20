import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classifyAdapterOutcome } from '../apiAdapterClassifierPure.js';

test('2xx → terminal_success', () => {
  assert.deepEqual(classifyAdapterOutcome({ status: 200 }), { kind: 'terminal_success' });
  assert.deepEqual(classifyAdapterOutcome({ status: 201 }), { kind: 'terminal_success' });
  assert.deepEqual(classifyAdapterOutcome({ status: 204 }), { kind: 'terminal_success' });
});

test('429 → retryable:rate_limit', () => {
  assert.deepEqual(classifyAdapterOutcome({ status: 429 }), {
    kind: 'retryable',
    reason: 'rate_limit',
  });
});

test('502 / 503 → retryable:gateway', () => {
  assert.deepEqual(classifyAdapterOutcome({ status: 502 }), { kind: 'retryable', reason: 'gateway' });
  assert.deepEqual(classifyAdapterOutcome({ status: 503 }), { kind: 'retryable', reason: 'gateway' });
});

test('network timeout → retryable:network_timeout', () => {
  assert.deepEqual(classifyAdapterOutcome({ networkError: true, timedOut: true }), {
    kind: 'retryable',
    reason: 'network_timeout',
  });
});

test('network error (non-timeout) → retryable:network_timeout', () => {
  assert.deepEqual(classifyAdapterOutcome({ networkError: true, timedOut: false }), {
    kind: 'retryable',
    reason: 'network_timeout',
  });
});

test('401 / 403 → terminal_failure:auth', () => {
  assert.deepEqual(classifyAdapterOutcome({ status: 401 }), { kind: 'terminal_failure', reason: 'auth' });
  assert.deepEqual(classifyAdapterOutcome({ status: 403 }), { kind: 'terminal_failure', reason: 'auth' });
});

test('404 → terminal_failure:not_found', () => {
  assert.deepEqual(classifyAdapterOutcome({ status: 404 }), {
    kind: 'terminal_failure',
    reason: 'not_found',
  });
});

test('422 → terminal_failure:validation', () => {
  assert.deepEqual(classifyAdapterOutcome({ status: 422 }), {
    kind: 'terminal_failure',
    reason: 'validation',
  });
});

test('other 5xx → retryable:server_error (retry cap enforced by outer loop)', () => {
  assert.deepEqual(classifyAdapterOutcome({ status: 500 }), { kind: 'retryable', reason: 'server_error' });
  assert.deepEqual(classifyAdapterOutcome({ status: 504 }), { kind: 'retryable', reason: 'server_error' });
  assert.deepEqual(classifyAdapterOutcome({ status: 599 }), { kind: 'retryable', reason: 'server_error' });
});

test('other 4xx → terminal_failure:other', () => {
  assert.deepEqual(classifyAdapterOutcome({ status: 400 }), { kind: 'terminal_failure', reason: 'other' });
  assert.deepEqual(classifyAdapterOutcome({ status: 409 }), { kind: 'terminal_failure', reason: 'other' });
  assert.deepEqual(classifyAdapterOutcome({ status: 418 }), { kind: 'terminal_failure', reason: 'other' });
});
