import { describe, it, expect } from 'vitest';
import { evaluateAutoExtractGate } from '../memoryBlockGatePure.js';

describe('evaluateAutoExtractGate', () => {
  it('override-locked + content changed → skips BOTH update and version insert', () => {
    const r = evaluateAutoExtractGate({ autoUpdateDisabled: true, contentUnchanged: false });
    expect(r.skipUpdate).toBe(true);
    expect(r.skipVersionInsert).toBe(true);
    expect(r.reason).toBe('override_locked');
  });

  it('override-locked + content unchanged → still skips BOTH (override wins)', () => {
    const r = evaluateAutoExtractGate({ autoUpdateDisabled: true, contentUnchanged: true });
    expect(r.skipUpdate).toBe(true);
    expect(r.skipVersionInsert).toBe(true);
    expect(r.reason).toBe('override_locked');
  });

  it('not override-locked + content unchanged → skips both (no-change semantics)', () => {
    const r = evaluateAutoExtractGate({ autoUpdateDisabled: false, contentUnchanged: true });
    expect(r.skipUpdate).toBe(true);
    expect(r.skipVersionInsert).toBe(true);
    expect(r.reason).toBe('no_change');
  });

  it('not override-locked + content changed → allows both writes', () => {
    const r = evaluateAutoExtractGate({ autoUpdateDisabled: false, contentUnchanged: false });
    expect(r.skipUpdate).toBe(false);
    expect(r.skipVersionInsert).toBe(false);
    expect(r.reason).toBe('allowed');
  });
});
