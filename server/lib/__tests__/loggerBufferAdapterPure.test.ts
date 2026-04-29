import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogLineForBuffer } from '../loggerBufferAdapterPure.js';

test('returns null when correlationId is missing', () => {
  assert.equal(buildLogLineForBuffer({ event: 'e' }), null);
});

test('returns null when correlationId is an empty string', () => {
  assert.equal(buildLogLineForBuffer({ correlationId: '', event: 'e' }), null);
});

test('returns null when correlationId is non-string', () => {
  assert.equal(buildLogLineForBuffer({ correlationId: 42 as unknown as string }), null);
  assert.equal(buildLogLineForBuffer({ correlationId: undefined }), null);
  assert.equal(buildLogLineForBuffer({ correlationId: {} as unknown as string }), null);
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
  assert.ok(line);
  assert.equal(line.correlationId, 'cid-7a8b');
  assert.equal(line.event, 'agent_run_started');
  assert.equal(line.level, 'info');
  assert.deepEqual(line.meta, { runId: 'run-42', orgId: 'org-1' });
});

test('strips timestamp/level/event/correlationId from meta', () => {
  const line = buildLogLineForBuffer({
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'warn',
    event: 'e',
    correlationId: 'cid',
    foo: 'bar',
  });
  assert.ok(line);
  assert.deepEqual(line.meta, { foo: 'bar' });
  assert.ok(!('timestamp' in line.meta));
  assert.ok(!('level' in line.meta));
  assert.ok(!('event' in line.meta));
  assert.ok(!('correlationId' in line.meta));
});

test('preserves all other keys in meta', () => {
  const line = buildLogLineForBuffer({
    correlationId: 'cid',
    a: 1,
    b: 'two',
    c: { nested: true },
  });
  assert.ok(line);
  assert.deepEqual(line.meta, { a: 1, b: 'two', c: { nested: true } });
});

test('falls back to new Date() when timestamp is missing or invalid', () => {
  const line1 = buildLogLineForBuffer({ correlationId: 'cid' });
  assert.ok(line1);
  assert.ok(line1.ts instanceof Date);
  assert.ok(!isNaN(line1.ts.getTime()));

  const line2 = buildLogLineForBuffer({ correlationId: 'cid', timestamp: 'not-a-date' });
  assert.ok(line2);
  assert.ok(!isNaN(line2.ts.getTime()));
});
