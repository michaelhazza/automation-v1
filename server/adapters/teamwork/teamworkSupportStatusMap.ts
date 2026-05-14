import type { SupportCanonicalStatus, SupportStatusMap } from '../integrationAdapter.js';

export const TEAMWORK_SUPPORT_STATUS_MAP: SupportStatusMap = {
  'active':               'open',
  'waiting on customer':  'waiting_on_customer',
  'on hold':              'pending_internal',
  'solved':               'resolved',
  'closed':               'closed',
  'spam':                 'closed',
  'new':                  'open',
  'open':                 'open',
  'waiting':              'waiting_on_customer',
  'waitingoncustomer':    'waiting_on_customer',
  'waiting_on_customer':  'waiting_on_customer',
  'awaiting_customer':    'waiting_on_customer',
  'onhold':               'pending_internal',
  'on_hold':              'pending_internal',
  'pending':              'pending_internal',
  'resolved':             'resolved',
};

export function mapTeamworkStatus(provider: string | null | undefined): SupportCanonicalStatus {
  if (!provider) return 'unknown_provider_status';
  const normalised = provider.trim().toLowerCase();
  return TEAMWORK_SUPPORT_STATUS_MAP[normalised] ?? 'unknown_provider_status';
}

// Outbound mapping: canonical status → Teamwork provider string.
// Inbound map keys for the 5 mappable values are the provider strings used here
// (round-trip verified: mapTeamworkStatus(TEAMWORK_OUTBOUND_STATUS_MAP[x]) === x
//  for all x except 'unknown_provider_status').
export const TEAMWORK_OUTBOUND_STATUS_MAP: Record<Exclude<SupportCanonicalStatus, 'unknown_provider_status'>, string> = {
  open:                   'active',
  pending_internal:       'on hold',
  waiting_on_customer:    'waiting on customer',
  resolved:               'solved',
  closed:                 'closed',
};

export function mapCanonicalToTeamworkStatus(canonical: SupportCanonicalStatus): string {
  if (canonical === 'unknown_provider_status') {
    throw new Error('Cannot dispatch unknown_provider_status to provider');
  }
  return TEAMWORK_OUTBOUND_STATUS_MAP[canonical];
}
