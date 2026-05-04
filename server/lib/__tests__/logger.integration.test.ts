import { expect, test } from 'vitest';
import { logger } from '../logger.js';
import { readLinesForCorrelationId, _resetBufferForTest } from '../../services/systemMonitor/logBuffer.js';

test('logger.info with correlationId populates the log buffer', async () => {
  _resetBufferForTest();
  logger.info('test_event_42', { correlationId: 'cid-42', foo: 'bar' });
  // Lazy import resolves asynchronously; give it time to settle.
  await new Promise(r => setTimeout(r, 50));

  const lines = readLinesForCorrelationId('cid-42', 100);
  expect(lines.length >= 1).toBeTruthy();
  const line = lines.find(l => l.event === 'test_event_42');
  expect(line).toBeTruthy();
  expect(line!.correlationId).toBe('cid-42');
  expect((line!.meta as { foo?: string }).foo).toBe('bar');
});

test('logger.info without correlationId does NOT populate the buffer', async () => {
  _resetBufferForTest();
  logger.info('test_event_no_cid', { foo: 'baz' });
  await new Promise(r => setTimeout(r, 50));

  const allKeys = ['', 'undefined', 'null'];
  for (const k of allKeys) {
    const lines = readLinesForCorrelationId(k, 100);
    expect(lines.length, `expected no lines for key '${k}'`).toBe(0);
  }
});
