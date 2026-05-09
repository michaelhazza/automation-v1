import { describe, it, expect } from 'vitest';
import type { SupportCanonicalStatus } from '../../integrationAdapter.js';
import {
  TEAMWORK_SUPPORT_STATUS_MAP,
  mapTeamworkStatus,
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
