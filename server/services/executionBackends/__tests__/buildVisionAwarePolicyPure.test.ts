import { describe, it, expect } from 'vitest';
import { buildVisionAwarePolicy } from '../_ieeShared.js';
import type { SandboxNetworkPolicy } from '../../../../shared/types/sandbox.js';

describe('buildVisionAwarePolicy', () => {
  const baseNone: SandboxNetworkPolicy = { mode: 'none' };
  const visionEntry = { host: 'vllm.example.com', port: 443, protocol: 'https' as const };

  it('dom mode — returns base policy unchanged', () => {
    const result = buildVisionAwarePolicy(baseNone, 'dom', visionEntry);
    expect(result).toBe(baseNone);
  });

  it('null decisionMode — returns base policy unchanged', () => {
    const result = buildVisionAwarePolicy(baseNone, null, visionEntry);
    expect(result).toBe(baseNone);
  });

  it('undefined decisionMode — returns base policy unchanged', () => {
    const result = buildVisionAwarePolicy(baseNone, undefined, visionEntry);
    expect(result).toBe(baseNone);
  });

  it('null visionAllowlistEntry — returns base policy unchanged', () => {
    const result = buildVisionAwarePolicy(baseNone, 'vision', null);
    expect(result).toBe(baseNone);
  });

  it('vision mode with base mode=none — returns allowlist with vision entry', () => {
    const result = buildVisionAwarePolicy(baseNone, 'vision', visionEntry);
    expect(result.mode).toBe('allowlist');
    expect(result.allowlist).toEqual([visionEntry]);
  });

  it('hybrid mode with base mode=none — returns allowlist with vision entry', () => {
    const result = buildVisionAwarePolicy(baseNone, 'hybrid', visionEntry);
    expect(result.mode).toBe('allowlist');
    expect(result.allowlist).toEqual([visionEntry]);
  });

  it('vision mode with existing allowlist — appends vision entry, preserves existing', () => {
    const existing: SandboxNetworkPolicy = {
      mode: 'allowlist',
      allowlist: [{ host: 'existing.example.com', port: 80, protocol: 'http' }],
    };
    const result = buildVisionAwarePolicy(existing, 'vision', visionEntry);
    expect(result.mode).toBe('allowlist');
    expect(result.allowlist).toHaveLength(2);
    expect(result.allowlist![0]).toEqual({ host: 'existing.example.com', port: 80, protocol: 'http' });
    expect(result.allowlist![1]).toEqual(visionEntry);
  });

  it('vision mode with existing allowlist=undefined — returns allowlist with vision entry only', () => {
    const base: SandboxNetworkPolicy = { mode: 'allowlist' };
    const result = buildVisionAwarePolicy(base, 'vision', visionEntry);
    expect(result.mode).toBe('allowlist');
    expect(result.allowlist).toEqual([visionEntry]);
  });

  it('vision mode with unknown base mode — throws FailureError', () => {
    const unknownBase = { mode: 'unknown' } as unknown as SandboxNetworkPolicy;
    expect(() => buildVisionAwarePolicy(unknownBase, 'vision', visionEntry)).toThrow();
  });
});
