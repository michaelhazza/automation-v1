import { describe, it, expect } from 'vitest';
import { matchCapability } from '../capabilityMapService.js';
import type { RoutingContextV2 } from '../../../shared/types/routingContext.js';
import type { CapabilityMap } from '../capabilityMapService.js';

function makeMap(ownerUserId?: string): CapabilityMap {
  return {
    computedAt: new Date().toISOString(),
    integrations: ['dev_agent'],
    read_capabilities: [],
    write_capabilities: [],
    skills: ['stub_skill'],
    primitives: ['task_board'],
    ...(ownerUserId != null ? { owner_user_id: ownerUserId } : {}),
  };
}

function makeContext(overrides: Partial<RoutingContextV2> = {}): RoutingContextV2 {
  return {
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    requester_user_id: 'user-michael',
    raw_intent_text: '',
    normalised_intent_text: '',
    intent: '',
    addressed_agent: null,
    address_parse_result: 'not_found',
    ...overrides,
  };
}

const STUB_AGENT = {
  subaccountAgentId: 'sa-1',
  agentId: 'agent-stub-dev',
  agentName: 'Stub Dev Agent',
};

describe('matchCapability', () => {
  describe('Fixture 1 — Direct-owner request', () => {
    it('selects agent when requester owns it', () => {
      const ctx = makeContext({ requester_user_id: 'user-michael' });
      const candidate = { ...STUB_AGENT, capabilityMap: makeMap('user-michael') };
      const result = matchCapability(ctx, [candidate]);
      expect(result).toHaveLength(1);
      expect(result[0].candidate.agentId).toBe('agent-stub-dev');
      expect(result[0].scoreBoost).toBe(0);
    });
  });

  describe('Fixture 2 — Cross-ownership delegation', () => {
    it('selects agent when target_owner_user_id matches agent owner', () => {
      const ctx = makeContext({
        requester_user_id: 'user-sarah',
        target_owner_user_id: 'user-michael',
      });
      const candidate = { ...STUB_AGENT, capabilityMap: makeMap('user-michael') };
      const result = matchCapability(ctx, [candidate]);
      expect(result).toHaveLength(1);
      expect(result[0].candidate.agentId).toBe('agent-stub-dev');
    });
  });

  describe('Fixture 4 — Ambiguous routing (no target_owner, requester != owner)', () => {
    it('returns no candidates when ownership does not match', () => {
      const ctx = makeContext({ requester_user_id: 'user-sarah' });
      const candidate = { ...STUB_AGENT, capabilityMap: makeMap('user-michael') };
      const result = matchCapability(ctx, [candidate]);
      expect(result).toHaveLength(0);
    });
  });

  describe('Fixture 3 — Approval-owner rule (cross-owner match + verify ownership axis)', () => {
    it('selects agent and preserves owner_user_id in matched candidate map', () => {
      const ctx = makeContext({
        requester_user_id: 'user-sarah',
        target_owner_user_id: 'user-michael',
      });
      const candidate = { ...STUB_AGENT, capabilityMap: makeMap('user-michael') };
      const result = matchCapability(ctx, [candidate]);
      expect(result).toHaveLength(1);
      expect(result[0].candidate.capabilityMap?.owner_user_id).toBe('user-michael');
    });
  });

  describe('Subaccount-scoped agent (no owner_user_id)', () => {
    it('passes through regardless of requester', () => {
      const ctx = makeContext({ requester_user_id: 'user-sarah' });
      const candidate = { ...STUB_AGENT, capabilityMap: makeMap() };
      const result = matchCapability(ctx, [candidate]);
      expect(result).toHaveLength(1);
    });
  });

  describe('Null capability map', () => {
    it('excludes candidate with null map', () => {
      const ctx = makeContext();
      const candidate = { ...STUB_AGENT, capabilityMap: null };
      const result = matchCapability(ctx, [candidate]);
      expect(result).toHaveLength(0);
    });
  });

  describe('@address match applies 0.15 scoreBoost and sorts addressed agent first', () => {
    it('boosts addressed agent to front', () => {
      const ctx = makeContext({
        addressed_agent: { id: 'agent-ea', score_boost: 0.15 },
      });
      const eaCandidate = {
        subaccountAgentId: 'sa-2',
        agentId: 'agent-ea',
        agentName: 'Executive Assistant',
        capabilityMap: makeMap(),
      };
      const otherCandidate = { ...STUB_AGENT, capabilityMap: makeMap() };
      const result = matchCapability(ctx, [otherCandidate, eaCandidate]);
      expect(result).toHaveLength(2);
      expect(result[0].candidate.agentId).toBe('agent-ea');
      expect(result[0].scoreBoost).toBe(0.15);
      expect(result[1].scoreBoost).toBe(0);
    });
  });

  describe('@address boost NOT applied to ownership-mismatched candidate', () => {
    it('excludes candidate before boost can be applied', () => {
      const ctx = makeContext({
        requester_user_id: 'user-sarah',
        addressed_agent: { id: 'agent-stub-dev', score_boost: 0.15 },
      });
      // agent owned by michael; sarah is not the owner and no target_owner_user_id
      const candidate = { ...STUB_AGENT, capabilityMap: makeMap('user-michael') };
      const result = matchCapability(ctx, [candidate]);
      expect(result).toHaveLength(0);
    });
  });
});
