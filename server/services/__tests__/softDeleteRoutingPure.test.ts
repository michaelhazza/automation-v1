import { describe, expect, it } from 'vitest';
import { selectActiveRoutingCandidates } from '../subaccountAgentServicePure.js';

describe('selectActiveRoutingCandidates', () => {
  it('excludes soft-deleted candidates', () => {
    const candidates = [
      { id: 'a', deletedAt: null, subaccountId: 'sub-1' },
      { id: 'b', deletedAt: new Date(), subaccountId: 'sub-1' },
    ];
    expect(selectActiveRoutingCandidates(candidates, 'sub-1')).toHaveLength(1);
    expect(selectActiveRoutingCandidates(candidates, 'sub-1')[0].id).toBe('a');
  });

  it('excludes candidates from other subaccounts', () => {
    const candidates = [
      { id: 'a', deletedAt: null, subaccountId: 'sub-1' },
      { id: 'b', deletedAt: null, subaccountId: 'sub-2' },
    ];
    expect(selectActiveRoutingCandidates(candidates, 'sub-1')).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(selectActiveRoutingCandidates([], 'sub-1')).toEqual([]);
  });
});
