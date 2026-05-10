import { describe, it, expect } from 'vitest';
import type { SupportCanonicalStatus } from '../../integrationAdapter.js';
import {
  TEAMWORK_SUPPORT_STATUS_MAP,
  TEAMWORK_OUTBOUND_STATUS_MAP,
  mapTeamworkStatus,
  mapCanonicalToTeamworkStatus,
} from '../teamworkSupportStatusMap.js';

describe('TEAMWORK_SUPPORT_STATUS_MAP', () => {
  it('maps every documented key to its canonical value', () => {
    expect(TEAMWORK_SUPPORT_STATUS_MAP['active']).toBe('open');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['waiting on customer']).toBe('waiting_on_customer');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['on hold']).toBe('pending_internal');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['solved']).toBe('resolved');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['closed']).toBe('closed');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['spam']).toBe('closed');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['new']).toBe('open');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['open']).toBe('open');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['waiting']).toBe('waiting_on_customer');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['waitingoncustomer']).toBe('waiting_on_customer');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['waiting_on_customer']).toBe('waiting_on_customer');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['awaiting_customer']).toBe('waiting_on_customer');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['onhold']).toBe('pending_internal');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['on_hold']).toBe('pending_internal');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['pending']).toBe('pending_internal');
    expect(TEAMWORK_SUPPORT_STATUS_MAP['resolved']).toBe('resolved');
  });
});

describe('mapTeamworkStatus', () => {
  it('returns unknown_provider_status for null', () => {
    expect(mapTeamworkStatus(null)).toBe('unknown_provider_status');
  });

  it('returns unknown_provider_status for undefined', () => {
    expect(mapTeamworkStatus(undefined)).toBe('unknown_provider_status');
  });

  it('returns unknown_provider_status for empty string', () => {
    expect(mapTeamworkStatus('')).toBe('unknown_provider_status');
  });

  it('maps mixed-case "On Hold" same as lowercase', () => {
    expect(mapTeamworkStatus('On Hold')).toBe('pending_internal');
  });

  it('maps mixed-case "WAITING ON CUSTOMER" same as lowercase', () => {
    expect(mapTeamworkStatus('WAITING ON CUSTOMER')).toBe('waiting_on_customer');
  });

  it('maps mixed-case "Active" same as lowercase', () => {
    expect(mapTeamworkStatus('Active')).toBe('open');
  });

  it('maps mixed-case "Solved" same as lowercase', () => {
    expect(mapTeamworkStatus('Solved')).toBe('resolved');
  });

  it('returns unknown_provider_status for an unrecognised custom status', () => {
    expect(mapTeamworkStatus('OnHoldByEngineering')).toBe('unknown_provider_status');
  });

  it('returns unknown_provider_status for another unrecognised status', () => {
    expect(mapTeamworkStatus('in_progress')).toBe('unknown_provider_status');
  });

  it('result type is SupportCanonicalStatus', () => {
    const result: SupportCanonicalStatus = mapTeamworkStatus('open');
    expect(result).toBe('open');
  });

  it('maps every key in the status map correctly via the function', () => {
    const entries = Object.entries(TEAMWORK_SUPPORT_STATUS_MAP) as Array<[string, SupportCanonicalStatus]>;
    for (const [key, expectedValue] of entries) {
      expect(mapTeamworkStatus(key)).toBe(expectedValue);
    }
  });
});

describe('TEAMWORK_OUTBOUND_STATUS_MAP', () => {
  it('maps open to active', () => {
    expect(TEAMWORK_OUTBOUND_STATUS_MAP['open']).toBe('active');
  });

  it('maps pending_internal to on hold', () => {
    expect(TEAMWORK_OUTBOUND_STATUS_MAP['pending_internal']).toBe('on hold');
  });

  it('maps waiting_on_customer to waiting on customer', () => {
    expect(TEAMWORK_OUTBOUND_STATUS_MAP['waiting_on_customer']).toBe('waiting on customer');
  });

  it('maps resolved to solved', () => {
    expect(TEAMWORK_OUTBOUND_STATUS_MAP['resolved']).toBe('solved');
  });

  it('maps closed to closed', () => {
    expect(TEAMWORK_OUTBOUND_STATUS_MAP['closed']).toBe('closed');
  });
});

describe('mapCanonicalToTeamworkStatus', () => {
  it('maps open to active', () => {
    expect(mapCanonicalToTeamworkStatus('open')).toBe('active');
  });

  it('maps pending_internal to on hold', () => {
    expect(mapCanonicalToTeamworkStatus('pending_internal')).toBe('on hold');
  });

  it('maps waiting_on_customer to waiting on customer', () => {
    expect(mapCanonicalToTeamworkStatus('waiting_on_customer')).toBe('waiting on customer');
  });

  it('maps resolved to solved', () => {
    expect(mapCanonicalToTeamworkStatus('resolved')).toBe('solved');
  });

  it('maps closed to closed', () => {
    expect(mapCanonicalToTeamworkStatus('closed')).toBe('closed');
  });

  it('throws for unknown_provider_status', () => {
    expect(() => mapCanonicalToTeamworkStatus('unknown_provider_status')).toThrow(
      'Cannot dispatch unknown_provider_status to provider',
    );
  });

  it('round-trips: outbound -> inbound produces the original canonical for all 5 mappable values', () => {
    const mappable: Exclude<SupportCanonicalStatus, 'unknown_provider_status'>[] = [
      'open', 'pending_internal', 'waiting_on_customer', 'resolved', 'closed',
    ];
    for (const canonical of mappable) {
      const providerStr = mapCanonicalToTeamworkStatus(canonical);
      const roundTripped = mapTeamworkStatus(providerStr);
      expect(roundTripped).toBe(canonical);
    }
  });
});
