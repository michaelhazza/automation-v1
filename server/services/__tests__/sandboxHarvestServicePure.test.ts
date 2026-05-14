import { describe, it, expect } from 'vitest';
import { resolveHarvestSubtype } from '../sandboxHarvestServicePure.js';

describe('resolveHarvestSubtype', () => {
  it('returns task for harvest-pipeline cost rows', () => {
    expect(resolveHarvestSubtype()).toBe('task');
  });

  it('never returns warm_pool', () => {
    const result = resolveHarvestSubtype();
    expect(result).not.toBe('warm_pool');
  });
});
