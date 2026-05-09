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
