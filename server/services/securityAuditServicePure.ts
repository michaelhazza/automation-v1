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

const META_MAX_BYTES = 16 * 1024;
const PII_BLACKLIST = new Set(['password', 'token', 'secret', 'authorization']);

export function normaliseSecurityEvent(input: SecurityEventInput): SecurityEventInput {
  const meta = { ...(input.meta ?? {}) };
  for (const k of Object.keys(meta)) {
    if (PII_BLACKLIST.has(k.toLowerCase())) {
      meta[k] = '[redacted]';
    }
  }
  const json = JSON.stringify(meta);
  if (Buffer.byteLength(json) > META_MAX_BYTES) {
    return { ...input, meta: { _truncated: true, originalBytes: Buffer.byteLength(json) } };
  }
  return { ...input, meta };
}
