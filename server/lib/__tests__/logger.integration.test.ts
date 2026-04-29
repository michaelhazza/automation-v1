import test from 'node:test';
import assert from 'node:assert/strict';
import { logger } from '../logger.js';
import { readLinesForCorrelationId, _resetBufferForTest } from '../../services/systemMonitor/logBuffer.js';

test('logger.info with correlationId populates the log buffer', async () => {
  _resetBufferForTest();
  logger.info('test_event_42', { correlationId: 'cid-42', foo: 'bar' });
  // Lazy import resolves asynchronously; give it time to settle.
  await new Promise(r => setTimeout(r, 50));

  const lines = readLinesForCorrelationId('cid-42', 100);
  assert.ok(lines.length >= 1, 'expected at least one buffered line');
  const line = lines.find(l => l.event === 'test_event_42');
  assert.ok(line, 'expected line with matching event name');
  assert.equal(line.correlationId, 'cid-42');
  assert.equal((line.meta as { foo?: string }).foo, 'bar');
});

test('logger.info without correlationId does NOT populate the buffer', async () => {
  _resetBufferForTest();
  logger.info('test_event_no_cid', { foo: 'baz' });
  await new Promise(r => setTimeout(r, 50));

  const allKeys = ['', 'undefined', 'null'];
  for (const k of allKeys) {
    const lines = readLinesForCorrelationId(k, 100);
    assert.equal(lines.length, 0, `expected no lines for key '${k}'`);
  }
});
