// Support Desk observability log codes.
// C8 initial set — C9 will extend with remaining codes from spec §15.
// Keep codes in the format: support.<domain>.<event_slug>

export const SUPPORT_LOG_CODES = {
  STATUS_UNKNOWN_PROVIDER_STATUS: 'support.status.unknown_provider_status',
  INGEST_DUPLICATE_COLLAPSED:     'support.ingest.duplicate_collapsed',
  INGEST_CONTRACT_VIOLATION:      'support.ingest.contract_violation',
  INGEST_CONTACT_UNMATCHED:       'support.ingest.contact_unmatched',
  PROVIDER_RATE_LIMITED:          'support.provider.rate_limited',
  PROVIDER_POLL_PAGE_FAILED:      'support.provider.poll_page_failed',
  TICKET_PROVIDER_DELETED:        'support.ticket.provider_deleted',
} as const;

export type SupportLogCode = typeof SUPPORT_LOG_CODES[keyof typeof SUPPORT_LOG_CODES];
