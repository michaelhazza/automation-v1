import { describe, it, expect } from 'vitest';

describe('Test infrastructure smoke test', () => {
  it('vitest runs and assertions work', () => {
    expect(1 + 1).toBe(2);
  });

  it('async tests work', async () => {
    const result = await Promise.resolve('hello');
    expect(result).toBe('hello');
  });
});
