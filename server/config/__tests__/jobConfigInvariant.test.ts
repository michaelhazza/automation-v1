import { expect, test } from 'vitest';
import { JOB_CONFIG } from '../jobConfig.js';

test('every JOB_CONFIG entry declares a deadLetter queue', () => {
  const missing: string[] = [];
  for (const [name, entry] of Object.entries(JOB_CONFIG)) {
    const dlq = (entry as { deadLetter?: string }).deadLetter;
    if (typeof dlq !== 'string' || dlq.length === 0) {
      missing.push(name);
    }
  }
  expect(missing).toEqual([],
    `Queues without deadLetter — every entry MUST declare one to be visible to dlqMonitorService:\n${missing.join('\n')}`);
});

test('every deadLetter follows the <queue>__dlq convention', () => {
  const violations: Array<{ queue: string; deadLetter: string }> = [];
  for (const [name, entry] of Object.entries(JOB_CONFIG)) {
    const dlq = (entry as { deadLetter?: string }).deadLetter;
    if (typeof dlq !== 'string') continue;
    const expected = `${name}__dlq`;
    if (dlq !== expected) {
      violations.push({ queue: name, deadLetter: dlq });
    }
  }
  expect(violations).toEqual([],
    `Queues with deadLetter that doesn't match <queue>__dlq:\n${violations.map(v => `${v.queue} → ${v.deadLetter}`).join('\n')}`);
});
