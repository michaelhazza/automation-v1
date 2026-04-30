import { expect, test } from 'vitest';
import { buildLogLineForBuffer } from '../loggerBufferAdapterPure.js';

test('returns null when correlationId is missing', () => {
  expect(buildLogLineForBuffer({ event: 'e' })).toBe(null);
});

test('returns null when correlationId is an empty string', () => {
  expect(buildLogLineForBuffer({ correlationId: '', event: 'e' })).toBe(null);
});

test('returns null when correlationId is non-string', () => {
  expect(buildLogLineForBuffer({ correlationId: 42 as unknown as string })).toBe(null);
  expect(buildLogLineForBuffer({ correlationId: undefined })).toBe(null);
  expect(buildLogLineForBuffer({ correlationId: {} as unknown as string })).toBe(null);
});

test('returns a valid LogLine when correlationId is non-empty', () => {
  const line = buildLogLineForBuffer({
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'info',
    event: 'agent_run_started',
    correlationId: 'cid-7a8b',
    runId: 'run-42',
    orgId: 'org-1',
  });
  expect(line).toBeTruthy();
  expect(line.correlationId).toBe('cid-7a8b');
  expect(line.event).toBe('agent_run_started');
  expect(line.level).toBe('info');
  expect(line.meta).toEqual({ runId: 'run-42', orgId: 'org-1' });
});

test('strips timestamp/level/event/correlationId from meta', () => {
  const line = buildLogLineForBuffer({
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'warn',
    event: 'e',
    correlationId: 'cid',
    foo: 'bar',
  });
  expect(line).toBeTruthy();
  expect(line.meta).toEqual({ foo: 'bar' });
  expect(!('timestamp' in line.meta)).toBeTruthy();
  expect(!('level' in line.meta)).toBeTruthy();
  expect(!('event' in line.meta)).toBeTruthy();
  expect(!('correlationId' in line.meta)).toBeTruthy();
});

test('preserves all other keys in meta', () => {
  const line = buildLogLineForBuffer({
    correlationId: 'cid',
    a: 1,
    b: 'two',
    c: { nested: true },
  });
  expect(line).toBeTruthy();
  expect(line.meta).toEqual({ a: 1, b: 'two', c: { nested: true } });
});

test('falls back to new Date() when timestamp is missing or invalid', () => {
  const line1 = buildLogLineForBuffer({ correlationId: 'cid' });
  expect(line1).toBeTruthy();
  expect(line1.ts instanceof Date).toBeTruthy();
  expect(!isNaN(line1.ts.getTime())).toBeTruthy();

  const line2 = buildLogLineForBuffer({ correlationId: 'cid', timestamp: 'not-a-date' });
  expect(line2).toBeTruthy();
  expect(!isNaN(line2.ts.getTime())).toBeTruthy();
});
