import { expect, test } from 'vitest';
import { classifyAdapterOutcome } from '../apiAdapterClassifierPure.js';

test('2xx → terminal_success', () => {
  expect(classifyAdapterOutcome({ status: 200 })).toEqual({ kind: 'terminal_success' });
  expect(classifyAdapterOutcome({ status: 201 })).toEqual({ kind: 'terminal_success' });
  expect(classifyAdapterOutcome({ status: 204 })).toEqual({ kind: 'terminal_success' });
});

test('429 → retryable:rate_limit', () => {
  expect(classifyAdapterOutcome({ status: 429 })).toEqual({
    kind: 'retryable',
    reason: 'rate_limit',
  });
});

test('502 / 503 → retryable:gateway', () => {
  expect(classifyAdapterOutcome({ status: 502 })).toEqual({ kind: 'retryable', reason: 'gateway' });
  expect(classifyAdapterOutcome({ status: 503 })).toEqual({ kind: 'retryable', reason: 'gateway' });
});

test('network timeout → retryable:network_timeout', () => {
  expect(classifyAdapterOutcome({ networkError: true, timedOut: true })).toEqual({
    kind: 'retryable',
    reason: 'network_timeout',
  });
});

test('network error (non-timeout) → retryable:network_timeout', () => {
  expect(classifyAdapterOutcome({ networkError: true, timedOut: false })).toEqual({
    kind: 'retryable',
    reason: 'network_timeout',
  });
});

test('401 / 403 → terminal_failure:auth', () => {
  expect(classifyAdapterOutcome({ status: 401 })).toEqual({ kind: 'terminal_failure', reason: 'auth' });
  expect(classifyAdapterOutcome({ status: 403 })).toEqual({ kind: 'terminal_failure', reason: 'auth' });
});

test('404 → terminal_failure:not_found', () => {
  expect(classifyAdapterOutcome({ status: 404 })).toEqual({
    kind: 'terminal_failure',
    reason: 'not_found',
  });
});

test('422 → terminal_failure:validation', () => {
  expect(classifyAdapterOutcome({ status: 422 })).toEqual({
    kind: 'terminal_failure',
    reason: 'validation',
  });
});

test('other 5xx → retryable:server_error (retry cap enforced by outer loop)', () => {
  expect(classifyAdapterOutcome({ status: 500 })).toEqual({ kind: 'retryable', reason: 'server_error' });
  expect(classifyAdapterOutcome({ status: 504 })).toEqual({ kind: 'retryable', reason: 'server_error' });
  expect(classifyAdapterOutcome({ status: 599 })).toEqual({ kind: 'retryable', reason: 'server_error' });
});

test('other 4xx → terminal_failure:other', () => {
  expect(classifyAdapterOutcome({ status: 400 })).toEqual({ kind: 'terminal_failure', reason: 'other' });
  expect(classifyAdapterOutcome({ status: 409 })).toEqual({ kind: 'terminal_failure', reason: 'other' });
  expect(classifyAdapterOutcome({ status: 418 })).toEqual({ kind: 'terminal_failure', reason: 'other' });
});
