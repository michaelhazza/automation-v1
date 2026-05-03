/**
 * ghlAdapter.test.ts — regression guard for withLocationToken wrapper.
 * Run: npx vitest run server/adapters/__tests__/ghlAdapter.test.ts
 */
import { test, expect, vi } from 'vitest';
import { withLocationTokenRetry } from '../ghlAdapterPure.js';

test('withLocationToken: 401 on first try triggers handle401 and retries with fresh token', async () => {
  let callCount = 0;
  const mockFn = vi.fn(async (token: string) => {
    callCount++;
    if (callCount === 1) {
      throw Object.assign(new Error('401'), { statusCode: 401 });
    }
    return `result-with-${token}`;
  });

  const handle401Mock = vi.fn(async () => 'fresh-token');

  const result = await withLocationTokenRetry(mockFn, {
    getToken: async () => 'initial-token',
    handle401: handle401Mock,
  });

  expect(result).toBe('result-with-fresh-token');
  expect(mockFn).toHaveBeenCalledTimes(2);
  expect(mockFn).toHaveBeenNthCalledWith(1, 'initial-token');
  expect(mockFn).toHaveBeenNthCalledWith(2, 'fresh-token');
  expect(handle401Mock).toHaveBeenCalledTimes(1);
});

test('withLocationToken: success on first try returns result without calling handle401', async () => {
  const mockFn = vi.fn(async (token: string) => `result-${token}`);
  const handle401Mock = vi.fn(async () => 'should-not-be-called');

  const result = await withLocationTokenRetry(mockFn, {
    getToken: async () => 'access-token',
    handle401: handle401Mock,
  });

  expect(result).toBe('result-access-token');
  expect(mockFn).toHaveBeenCalledTimes(1);
  expect(handle401Mock).not.toHaveBeenCalled();
});

test('withLocationToken: non-401 error propagates without retry', async () => {
  const networkError = Object.assign(new Error('Network Error'), { statusCode: 500 });
  const mockFn = vi.fn(async () => { throw networkError; });
  const handle401Mock = vi.fn(async () => 'should-not-be-called');

  await expect(
    withLocationTokenRetry(mockFn, {
      getToken: async () => 'access-token',
      handle401: handle401Mock,
    }),
  ).rejects.toThrow('Network Error');

  expect(mockFn).toHaveBeenCalledTimes(1);
  expect(handle401Mock).not.toHaveBeenCalled();
});

test('withLocationToken: handle401 throwing LOCATION_TOKEN_INVALID propagates the error', async () => {
  const locationTokenError = Object.assign(
    new Error('LOCATION_TOKEN_INVALID: second 401 for locationId=loc_123'),
    { code: 'LOCATION_TOKEN_INVALID', locationId: 'loc_123' },
  );

  const mockFn = vi.fn(async () => {
    throw Object.assign(new Error('401'), { statusCode: 401 });
  });

  const handle401Mock = vi.fn(async () => { throw locationTokenError; });

  await expect(
    withLocationTokenRetry(mockFn, {
      getToken: async () => 'initial-token',
      handle401: handle401Mock,
    }),
  ).rejects.toMatchObject({ code: 'LOCATION_TOKEN_INVALID' });

  expect(mockFn).toHaveBeenCalledTimes(1);
  expect(handle401Mock).toHaveBeenCalledTimes(1);
});

test('withLocationToken: detects 401 via response.status (axios error shape)', async () => {
  const axiosStyleError = Object.assign(new Error('Request failed'), {
    response: { status: 401 },
  });

  let callCount = 0;
  const mockFn = vi.fn(async (token: string) => {
    callCount++;
    if (callCount === 1) throw axiosStyleError;
    return `ok-${token}`;
  });

  const handle401Mock = vi.fn(async () => 'refreshed-token');

  const result = await withLocationTokenRetry(mockFn, {
    getToken: async () => 'stale-token',
    handle401: handle401Mock,
  });

  expect(result).toBe('ok-refreshed-token');
  expect(handle401Mock).toHaveBeenCalledTimes(1);
});
