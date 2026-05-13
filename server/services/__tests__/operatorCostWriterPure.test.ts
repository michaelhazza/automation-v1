import { describe, expect, it } from 'vitest';

import {
  costRowKey,
  buildSubscriptionMediatedCostRow,
  buildSandboxComputeCostRow,
  derivePreSwapStepCount,
  COST_ROW_BOUNDARY_CHAIN_LINK,
} from '../operatorCostWriterPure.js';
import type { OperatorSessionFallbackEngagedEvent } from '../../../shared/types/operatorBackendEvents.js';

describe('costRowKey', () => {
  it('produces a deterministic key for (operator_run_id, source_type, boundary)', () => {
    const key = costRowKey('run-abc', 'subscription_mediated', 'chain_link');
    expect(key).toBe('run-abc:subscription_mediated:chain_link');
  });

  it('produces different keys for different source_types', () => {
    const key1 = costRowKey('run-abc', 'subscription_mediated', 'chain_link');
    const key2 = costRowKey('run-abc', 'sandbox_compute', 'chain_link');
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for different operator_run_ids', () => {
    const key1 = costRowKey('run-abc', 'subscription_mediated', 'chain_link');
    const key2 = costRowKey('run-xyz', 'subscription_mediated', 'chain_link');
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for different boundaries', () => {
    const key1 = costRowKey('run-abc', 'subscription_mediated', 'chain_link');
    const key2 = costRowKey('run-abc', 'subscription_mediated', 'other_boundary');
    expect(key1).not.toBe(key2);
  });
});

describe('buildSubscriptionMediatedCostRow', () => {
  const baseInput = {
    agentRunId: 'agent-run-001',
    operatorRunId: 'op-run-001',
    organisationId: 'org-001',
    subaccountId: 'sub-001',
    chainSeq: 3,
    vendorSessionId: 'opv1-abc',
    stepCount: 84,
    planTier: 'plus',
  };

  it('builds a subscription_mediated row with correct shape', () => {
    const row = buildSubscriptionMediatedCostRow(baseInput);
    expect(row.source_type).toBe('subscription_mediated');
    expect(row.agent_run_id).toBe('agent-run-001');
    expect(row.operator_run_id).toBe('op-run-001');
    expect(row.organisation_id).toBe('org-001');
    expect(row.subaccount_id).toBe('sub-001');
    expect(row.chain_seq).toBe(3);
    expect(row.vendor_session_id).toBe('opv1-abc');
    expect(row.credential_mode).toBe('operator_session');
    expect(row.step_count).toBe(84);
    expect(row.plan_tier).toBe('plus');
    expect(row.input_tokens).toBe(0);
    expect(row.output_tokens).toBe(0);
    expect(row.cost_cents).toBe(0);
    expect(row.boundary).toBe(COST_ROW_BOUNDARY_CHAIN_LINK);
  });

  it('accepts null vendor_session_id', () => {
    const row = buildSubscriptionMediatedCostRow({ ...baseInput, vendorSessionId: null });
    expect(row.vendor_session_id).toBeNull();
  });

  it('accepts null plan_tier', () => {
    const row = buildSubscriptionMediatedCostRow({ ...baseInput, planTier: null });
    expect(row.plan_tier).toBeNull();
  });
});

describe('buildSandboxComputeCostRow', () => {
  const baseInput = {
    agentRunId: 'agent-run-001',
    operatorRunId: 'op-run-001',
    organisationId: 'org-001',
    subaccountId: 'sub-001',
    chainSeq: 3,
    vcpuSeconds: 7200,
    wallClockMs: 7192000,
    peakMemoryBytes: 1073741824,
    costCents: 73,
  };

  it('builds a sandbox_compute row with correct shape', () => {
    const row = buildSandboxComputeCostRow(baseInput);
    expect(row.source_type).toBe('sandbox_compute');
    expect(row.agent_run_id).toBe('agent-run-001');
    expect(row.operator_run_id).toBe('op-run-001');
    expect(row.vcpu_seconds).toBe(7200);
    expect(row.wall_clock_ms).toBe(7192000);
    expect(row.peak_memory_bytes).toBe(1073741824);
    expect(row.cost_cents).toBe(73);
    expect(row.boundary).toBe(COST_ROW_BOUNDARY_CHAIN_LINK);
  });
});

describe('derivePreSwapStepCount', () => {
  it('returns the step_index from the fallback_engaged event', () => {
    const event: OperatorSessionFallbackEngagedEvent = {
      event: 'operator-session.fallback_engaged',
      chain_link_id: 'link-001',
      from_mode: 'operator_session',
      to_mode: 'api_key',
      reason: 'session_unavailable',
      step_index: 42,
    };
    expect(derivePreSwapStepCount(event)).toBe(42);
  });

  it('returns 0 when fallback engaged at step 0', () => {
    const event: OperatorSessionFallbackEngagedEvent = {
      event: 'operator-session.fallback_engaged',
      chain_link_id: 'link-001',
      from_mode: 'operator_session',
      to_mode: 'api_key',
      reason: 'session_unavailable',
      step_index: 0,
    };
    expect(derivePreSwapStepCount(event)).toBe(0);
  });
});
