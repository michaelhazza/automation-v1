/**
 * credentialBrokerServicePure.test.ts — Unit tests for pure helpers
 * in credentialBrokerServicePure.ts.
 *
 * operator-session-identity chunk 2.
 *
 * Test posture: targeted Vitest only — do NOT run umbrella suites locally.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  assertCredentialUsableOrThrow,
  orderResolvedCredentials,
  CredentialNotUsableError,
} from '../credentialBrokerServicePure.js';
import type { OrderableRow } from '../credentialBrokerServicePure.js';
import type { UsabilityState } from '../operatorSessionLifecycleServicePure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<OrderableRow> & { id: string }): OrderableRow {
  return {
    id: overrides.id,
    label: overrides.label ?? null,
    isDefault: overrides.isDefault ?? false,
    usabilityState: overrides.usabilityState ?? 'connected_usable',
    allowedAgentIds: overrides.allowedAgentIds ?? null,
    availabilityScope: overrides.availabilityScope ?? 'all_agents',
    authType: overrides.authType ?? 'operator_session',
  };
}

// ---------------------------------------------------------------------------
// assertCredentialUsableOrThrow
// ---------------------------------------------------------------------------

describe('assertCredentialUsableOrThrow', () => {
  const ALL_STATES: UsabilityState[] = [
    'connected_usable',
    'connected_needs_consent',
    'connected_needs_reauth',
    'connected_unverified',
    'revoked',
    'disabled',
  ];

  it('invokes decryptHook exactly once and returns its result for connected_usable', () => {
    const hook = vi.fn(() => 'secret-value');
    const result = assertCredentialUsableOrThrow('connected_usable', hook);
    expect(result).toBe('secret-value');
    expect(hook).toHaveBeenCalledTimes(1);
  });

  for (const state of ALL_STATES.filter((s) => s !== 'connected_usable')) {
    it(`throws CredentialNotUsableError and does NOT call decryptHook for state: ${state}`, () => {
      const hook = vi.fn(() => 'should-not-be-called');
      expect(() => assertCredentialUsableOrThrow(state, hook)).toThrow(CredentialNotUsableError);
      expect(hook).not.toHaveBeenCalled();
    });

    it(`thrown error carries the correct state for: ${state}`, () => {
      let caught: CredentialNotUsableError | null = null;
      try {
        assertCredentialUsableOrThrow(state, () => 'x');
      } catch (e) {
        caught = e as CredentialNotUsableError;
      }
      expect(caught).toBeInstanceOf(CredentialNotUsableError);
      expect(caught?.state).toBe(state);
    });
  }
});

// ---------------------------------------------------------------------------
// orderResolvedCredentials
// ---------------------------------------------------------------------------

describe('orderResolvedCredentials', () => {
  const AGENT_ID = 'agent-1';

  // (a) one default + three non-default operator_session + two platform rows
  it('(a) default operator_session first, then non-default sorted by label, then others in input order', () => {
    const rows: OrderableRow[] = [
      makeRow({ id: 'non-c', label: 'Charlie', authType: 'operator_session', isDefault: false }),
      makeRow({ id: 'platform-2', label: 'Platform B', authType: 'platform', isDefault: false }),
      makeRow({ id: 'non-a', label: 'Alpha', authType: 'operator_session', isDefault: false }),
      makeRow({ id: 'default-1', label: 'Default', authType: 'operator_session', isDefault: true }),
      makeRow({ id: 'platform-1', label: 'Platform A', authType: 'platform', isDefault: false }),
      makeRow({ id: 'non-b', label: 'Bravo', authType: 'operator_session', isDefault: false }),
    ];

    const result = orderResolvedCredentials(rows, AGENT_ID);

    expect(result[0].id).toBe('default-1');
    expect(result[1].id).toBe('non-a');   // Alpha
    expect(result[2].id).toBe('non-b');   // Bravo
    expect(result[3].id).toBe('non-c');   // Charlie
    expect(result[4].id).toBe('platform-2'); // input order for others
    expect(result[5].id).toBe('platform-1');
    expect(result).toHaveLength(6);
  });

  // (b) default not usable → default NOT first (filtered out)
  it('(b) default not usable — it is filtered out, non-default operator_session rows appear without it', () => {
    const rows: OrderableRow[] = [
      makeRow({ id: 'default-1', label: 'Default', authType: 'operator_session', isDefault: true, usabilityState: 'connected_needs_reauth' }),
      makeRow({ id: 'non-a', label: 'Alpha', authType: 'operator_session', isDefault: false }),
    ];

    const result = orderResolvedCredentials(rows, AGENT_ID);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('non-a');
  });

  // (c) all labels NULL → id-tiebreaker (lexicographic)
  it('(c) all labels null — sorted by id ascending', () => {
    const rows: OrderableRow[] = [
      makeRow({ id: 'c-id', label: null, authType: 'operator_session', isDefault: false }),
      makeRow({ id: 'a-id', label: null, authType: 'operator_session', isDefault: false }),
      makeRow({ id: 'b-id', label: null, authType: 'operator_session', isDefault: false }),
    ];

    const result = orderResolvedCredentials(rows, AGENT_ID);

    expect(result.map((r) => r.id)).toEqual(['a-id', 'b-id', 'c-id']);
  });

  // (d) identical labels → id-tiebreaker
  it('(d) identical labels — tiebreak by id ascending', () => {
    const rows: OrderableRow[] = [
      makeRow({ id: 'z-id', label: 'Same Label', authType: 'operator_session', isDefault: false }),
      makeRow({ id: 'a-id', label: 'Same Label', authType: 'operator_session', isDefault: false }),
      makeRow({ id: 'm-id', label: 'Same Label', authType: 'operator_session', isDefault: false }),
    ];

    const result = orderResolvedCredentials(rows, AGENT_ID);

    expect(result.map((r) => r.id)).toEqual(['a-id', 'm-id', 'z-id']);
  });

  // (e) agent not in allowlist and scope is 'specific_agents' → excluded
  it('(e) agent not in allowedAgentIds with specific_agents scope — excluded', () => {
    const rows: OrderableRow[] = [
      makeRow({ id: 'row-1', availabilityScope: 'specific_agents', allowedAgentIds: ['other-agent'] }),
      makeRow({ id: 'row-2', availabilityScope: 'specific_agents', allowedAgentIds: [AGENT_ID] }),
    ];

    const result = orderResolvedCredentials(rows, AGENT_ID);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('row-2');
  });

  // (f) availabilityScope === 'all_agents' regardless of allowedAgentIds → included
  it('(f) availabilityScope all_agents — included regardless of allowedAgentIds', () => {
    const rows: OrderableRow[] = [
      makeRow({ id: 'row-1', availabilityScope: 'all_agents', allowedAgentIds: ['completely-different-agent'] }),
      makeRow({ id: 'row-2', availabilityScope: 'all_agents', allowedAgentIds: null }),
      makeRow({ id: 'row-3', availabilityScope: 'all_agents', allowedAgentIds: [] }),
    ];

    const result = orderResolvedCredentials(rows, AGENT_ID);

    expect(result).toHaveLength(3);
  });

  // (g) determinism test: three different input orderings produce identical output
  it('(g) deterministic — three different input orderings produce identical output', () => {
    const base: OrderableRow[] = [
      makeRow({ id: 'default-1', label: 'Default', authType: 'operator_session', isDefault: true }),
      makeRow({ id: 'non-b', label: 'Beta', authType: 'operator_session', isDefault: false }),
      makeRow({ id: 'non-a', label: 'Alpha', authType: 'operator_session', isDefault: false }),
      makeRow({ id: 'platform-1', label: 'Plat', authType: 'platform', isDefault: false }),
    ];

    const order2 = [base[3], base[0], base[2], base[1]];  // different input order
    const order3 = [base[2], base[3], base[1], base[0]];  // another different order

    const r1 = orderResolvedCredentials(base, AGENT_ID).map((r) => r.id);
    const r2 = orderResolvedCredentials(order2, AGENT_ID).map((r) => r.id);
    const r3 = orderResolvedCredentials(order3, AGENT_ID).map((r) => r.id);

    expect(r1).toEqual(r2);
    expect(r1).toEqual(r3);
  });

  // Filtering: unusable rows are excluded regardless of availability scope
  it('filters out rows that are not connected_usable', () => {
    const rows: OrderableRow[] = [
      makeRow({ id: 'usable', usabilityState: 'connected_usable' }),
      makeRow({ id: 'needs-reauth', usabilityState: 'connected_needs_reauth' }),
      makeRow({ id: 'revoked', usabilityState: 'revoked' }),
    ];

    const result = orderResolvedCredentials(rows, AGENT_ID);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('usable');
  });

  // Edge case: empty input
  it('returns empty array when input is empty', () => {
    expect(orderResolvedCredentials([], AGENT_ID)).toEqual([]);
  });

  // Edge case: all rows filtered out
  it('returns empty array when all rows are unusable', () => {
    const rows: OrderableRow[] = [
      makeRow({ id: 'r1', usabilityState: 'disabled' }),
      makeRow({ id: 'r2', usabilityState: 'revoked' }),
    ];
    expect(orderResolvedCredentials(rows, AGENT_ID)).toEqual([]);
  });

  // Non-default operator_session rows with null label appear after those with labels
  it('null label rows appear after labelled rows in non-default operator_session group (NULLS LAST)', () => {
    const rows: OrderableRow[] = [
      makeRow({ id: 'null-id', label: null, authType: 'operator_session', isDefault: false }),
      makeRow({ id: 'labelled-id', label: 'Alpha', authType: 'operator_session', isDefault: false }),
    ];

    const result = orderResolvedCredentials(rows, AGENT_ID);

    expect(result[0].id).toBe('labelled-id');
    expect(result[1].id).toBe('null-id');
  });
});
