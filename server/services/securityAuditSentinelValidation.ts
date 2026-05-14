/**
 * Boot-time validation for the security-audit sentinel organisation row.
 *
 * Pre-auth security events (e.g. `auth.login.failure`) write to the
 * `security_audit_events` table with `organisation_id =
 * SECURITY_AUDIT_SENTINEL_ORG_ID` because no tenant context exists at the
 * point the event is recorded. The sentinel UUID must therefore exist as a
 * real row in the `organisations` table — otherwise the FK constraint on
 * `security_audit_events.organisation_id` rejects the insert and the event
 * is silently swallowed by `recordSecurityEvent`'s catch block (which
 * logs but does not rethrow, since security audit must never block the
 * caller).
 *
 * This boot assert fails fast in production if the sentinel row is missing,
 * so the operator sees the misconfiguration at startup rather than
 * discovering hours later that login-failure events are not being recorded.
 *
 * In development the assert downgrades to a console.warn — local environments
 * may not have the sentinel row seeded, and the pre-auth event loss is
 * recoverable in dev. ChatGPT-Round-2 Finding 1.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { SECURITY_AUDIT_SENTINEL_ORG_ID } from './securityAuditService.js';

export async function validateSecurityAuditSentinelOrgOrThrow(): Promise<void> {
  const result = await db.execute<{ exists: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM organisations WHERE id = ${SECURITY_AUDIT_SENTINEL_ORG_ID}) AS exists`,
  );
  // Drizzle's NeonHttpQueryResult returns rows on `.rows`; node-postgres returns the array directly.
  const rows = (result as unknown as { rows?: Array<{ exists: boolean }> }).rows
    ?? (result as unknown as Array<{ exists: boolean }>);
  const exists = Array.isArray(rows) && rows.length > 0 && rows[0]?.exists === true;

  if (exists) return;

  const message =
    `[boot] security-audit sentinel organisation row is missing. ` +
    `Pre-auth security events (auth.login.failure, etc.) cannot be recorded ` +
    `because they reference organisation_id=${SECURITY_AUDIT_SENTINEL_ORG_ID} via FK, ` +
    `and recordSecurityEvent swallows insert failures by design. ` +
    `Insert the sentinel row with a SQL like:\n` +
    `  INSERT INTO organisations (id, name, slug, plan, status) VALUES ` +
    `('${SECURITY_AUDIT_SENTINEL_ORG_ID}', '__security_audit_sentinel__', '__security_audit_sentinel__', 'starter', 'suspended');`;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(message);
  }
  console.warn(message);
}
