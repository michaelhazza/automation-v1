import { describe, it, expect } from 'vitest';
import { computeNextSkillVersion } from '../skillVersioningPure.js';

describe('computeNextSkillVersion', () => {
  it('null (no prior version) → 1', () => {
    expect(computeNextSkillVersion(null)).toBe(1);
  });
  it('n → n+1', () => {
    expect(computeNextSkillVersion(5)).toBe(6);
  });
  it('0 → 1', () => {
    expect(computeNextSkillVersion(0)).toBe(1);
  });
});
