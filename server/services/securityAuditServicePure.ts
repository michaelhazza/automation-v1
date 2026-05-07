import type { SecurityAuditEventName, SecurityEventSeverity } from '../../shared/types/securityAuditEvents.js';

export type SecurityEventType =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.signup'
  | 'auth.password_reset_requested'
  | 'auth.password_reset_completed'
  | 'auth.permission_denied'
  | 'auth.cross_org_access'
  | 'auth.token_revoked'
  | 'oauth.cross_org_state_mismatch'
  | 'oauth.invalid_state'
  | 'data.config_changed'
  | 'data.scope_drift_detected'
  | 'job.partial_failure';

/**
 * Legacy input shape — retained for backward compatibility during migration.
 * @deprecated Phase 4 removal — use SecurityEventInputV2 instead.
 */
export interface SecurityEventInput {
  organisationId: string;
  subaccountId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  eventType: SecurityEventType;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

/** V2 input shape — uses the typed audit-event factory. All new call sites MUST use this shape. */
export interface SecurityEventInputV2 {
  event: { readonly name: SecurityAuditEventName; readonly severity?: SecurityEventSeverity };
  organisationId: string;
  subaccountId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

/** Normalised shape written to the DB. */
export interface NormalisedSecurityEvent {
  organisationId: string;
  subaccountId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta: Record<string, unknown>;
}

const META_MAX_BYTES = 16 * 1024;
const PII_BLACKLIST = new Set(['password', 'token', 'secret', 'authorization']);
const PII_SUBSTRINGS = ['password', 'token', 'secret', 'authorization', 'credential'] as const;

function sanitiseMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const sanitised = { ...meta };
  for (const k of Object.keys(sanitised)) {
    if (PII_BLACKLIST.has(k.toLowerCase())) {
      sanitised[k] = '[redacted]';
      continue;
    }
    // substring match for keys like 'user_password', 'AUTH_TOKEN', 'client_secret'
    if (PII_SUBSTRINGS.some(s => k.toLowerCase().includes(s))) {
      sanitised[k] = '[redacted]';
    }
  }
  return sanitised;
}

/**
 * @deprecated Phase 4 removal — use normaliseSecurityEventV2 instead.
 */
export function normaliseSecurityEvent(input: SecurityEventInput): NormalisedSecurityEvent {
  const meta = sanitiseMeta(input.meta ?? {});
  const json = JSON.stringify(meta);
  if (Buffer.byteLength(json) > META_MAX_BYTES) {
    return { ...input, meta: { _truncated: true, originalBytes: Buffer.byteLength(json) } };
  }
  return { ...input, meta };
}

export function normaliseSecurityEventV2(input: SecurityEventInputV2): NormalisedSecurityEvent {
  const rawMeta = input.meta ?? {};
  // Inject severity from the factory entry into meta if present
  const metaWithSeverity: Record<string, unknown> =
    input.event.severity !== undefined
      ? { ...rawMeta, severity: input.event.severity }
      : rawMeta;
  const meta = sanitiseMeta(metaWithSeverity);
  const json = JSON.stringify(meta);
  const { event, ...rest } = input;
  if (Buffer.byteLength(json) > META_MAX_BYTES) {
    return { ...rest, eventType: event.name, meta: { _truncated: true, originalBytes: Buffer.byteLength(json) } };
  }
  return { ...rest, eventType: event.name, meta };
}
