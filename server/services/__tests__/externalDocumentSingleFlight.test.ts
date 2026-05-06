import { test, expect } from 'vitest';
import { SingleFlightGuard } from '../externalDocumentSingleFlight.js';

test('SingleFlightGuard — concurrent calls for same key share one promise', async () => {
  const guard = new SingleFlightGuard<string>(10);
  let calls = 0;
  const work = async () => { calls++; await new Promise(r => setTimeout(r, 20)); return 'value'; };
  const [a, b, c] = await Promise.all([
    guard.run('k1', work),
    guard.run('k1', work),
    guard.run('k1', work),
  ]);
  expect(calls).toBe(1);
  expect(a).toBe('value');
  expect(b).toBe('value');
  expect(c).toBe('value');
});

test('SingleFlightGuard — different keys execute independently', async () => {
  const guard = new SingleFlightGuard<string>(10);
  let calls = 0;
  const work = async () => { calls++; return 'v'; };
  await Promise.all([guard.run('k1', work), guard.run('k2', work)]);
  expect(calls).toBe(2);
});

test('SingleFlightGuard — key is cleared after completion (no stale caching)', async () => {
  const guard = new SingleFlightGuard<string>(10);
  let calls = 0;
  const work = async () => { calls++; return 'v'; };
  await guard.run('k1', work);
  await guard.run('k1', work);
  expect(calls).toBe(2);
});
