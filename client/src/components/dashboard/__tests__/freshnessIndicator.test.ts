// client/src/components/dashboard/__tests__/freshnessIndicator.test.ts
// Import fails until FreshnessIndicator.tsx is created in Task 2.
// Run this test now to confirm it fails with "Cannot find module".
import { expect, test } from 'vitest';
import { formatAge } from '../FreshnessIndicator.js';

test('assertions', () => {
  const t = (isoBase: string) => new Date(isoBase);
  const now = t('2026-04-27T10:00:00.000Z');
  
  function check(secsAgo: number, expected: string) {
    const lastUpdatedAt = new Date(now.getTime() - secsAgo * 1000);
    const result = formatAge(lastUpdatedAt, now);
    expect(result, `formatAge(${secsAgo}s ago) → expected "${expected}", got "${result}"`).toBe(expected);
  }
  
  check(0,    'updated just now');
  check(5,    'updated just now');
  check(9,    'updated just now');
  check(10,   'updated 10s ago');
  check(59,   'updated 59s ago');
  check(60,   'updated 1m ago');
  check(90,   'updated 1m ago');
  check(3599, 'updated 59m ago');
  check(3600, 'updated 1h ago');
  check(7200, 'updated 2h ago');
});
