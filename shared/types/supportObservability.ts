// Support Desk observability log codes.
// C8 initial set — extended in C9 with remaining codes from spec §15.
// Keep codes in the format: support.<domain>.<event_slug>

export const SUPPORT_LOG_CODES = {
  // Status / ingest
  STATUS_UNKNOWN_PROVIDER_STATUS:    'support.status.unknown_provider_status',
  INGEST_DUPLICATE_COLLAPSED:        'support.ingest.duplicate_collapsed',
  INGEST_CONTRACT_VIOLATION:         'support.ingest.contract_violation',
  INGEST_CONTACT_UNMATCHED:          'support.ingest.contact_unmatched',
  // Provider
  PROVIDER_RATE_LIMITED:             'support.provider.rate_limited',
  PROVIDER_POLL_PAGE_FAILED:         'support.provider.poll_page_failed',
  PROVIDER_WEBHOOK_UNMAPPED_EVENT:   'support.provider.webhook_unmapped_event',
  // Ticket
  TICKET_PROVIDER_DELETED:           'support.ticket.provider_deleted',
  TICKET_HUMAN_COLLISION_BLOCKED:    'support.ticket.human_collision_blocked',
  TICKET_RESTORED_AFTER_DELETION:    'support.ticket.restored_after_deletion',
  // Draft
  DRAFT_BACKLINK_AMBIGUOUS:          'support.draft.backlink_ambiguous',
  DRAFT_SENT:                        'support.draft.sent',
  DRAFT_FAILED:                      'support.draft.failed',
  DRAFT_REJECTED:                    'support.draft.rejected',
  DRAFT_EXPIRED:                     'support.draft.expired',
  DRAFT_SUPERSEDED:                  'support.draft.superseded',
  DRAFT_MANUALLY_MARKED_SENT:        'support.draft.manually_marked_sent',
  // Action
  ACTION_RETRY_IDEMPOTENT:           'support.action.retry_idempotent',
  ACTION_PROVIDER_CONFLICT:          'support.action.provider_conflict',
  // Attachment
  ATTACHMENT_RESOLVE_FAILED:         'support.attachment.resolve_failed',
  // Message
  MESSAGE_REDACTED:                  'support.message.redacted',
} as const;

export type SupportLogCode = typeof SUPPORT_LOG_CODES[keyof typeof SUPPORT_LOG_CODES];
