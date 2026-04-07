// ---------------------------------------------------------------------------
// Worker integration_connections persistence — DELIBERATELY single-purpose.
//
// Spec: docs/reporting-agent-paywall-workflow-spec.md §6.6.2 (T8) and
// §6.6.3 (T14).
//
// Hard rules enforced by this file:
//
//   1. The ONLY exported function is `getWebLoginConnectionForRun`. There is
//      no generic `getById`, no `list`, no `search`. Future connection types
//      get sibling single-purpose functions (`getSlackConnectionForRun`,
//      `getOpenAiConnectionForRun`), never a generic `getConnectionById`.
//
//   2. Every fetch is scoped by:
//        - exact organisationId match (run's org)
//        - providerType === 'web_login'
//        - deletedAt / soft-delete equivalent: connectionStatus !== 'revoked'
//        - subaccount scoping (T14):
//            * if the run has subaccountId, the connection must belong to
//              that subaccount OR be org-wide (subaccountId IS NULL)
//            * if the run is org-level (subaccountId NULL), the connection
//              must also be org-level — a different subaccount's connection
//              must NEVER resolve via this path.
//
//   3. The function decrypts the password at the boundary so callers never
//      see ciphertext. The decrypted credentials object is returned. The
//      caller is responsible for discarding it before entering any LLM loop.
//
//   4. The decrypted password type is branded as `Plaintext` so a custom
//      JSON.stringify replacer can detect accidental serialisation in
//      logger / error reporting paths.
//
// This file does NOT export the `integrationConnections` table object. Lint
// rule (.eslintrc.cjs) bans `import { integrationConnections }` outside this
// directory in worker/src/.
// ---------------------------------------------------------------------------

import { and, eq, isNull, or, ne } from 'drizzle-orm';
import { db } from '../db.js';
import { integrationConnections } from '../../../server/db/schema/integrationConnections.js';
import { connectionTokenService } from '../../../server/services/connectionTokenService.js';
import { logger } from '../logger.js';

/**
 * Branded plaintext type. The brand prevents accidental serialisation:
 *  - `JSON.stringify(creds)` still produces a string (TypeScript can't stop
 *    runtime serialisation), but the brand makes it possible to add a
 *    custom replacer in the logger that strips any `__plaintext` keys.
 *  - At least one logger redaction path becomes type-aware.
 */
export type Plaintext<T extends string> = T & { readonly __brand: 'Plaintext' };

export interface DecryptedWebLoginCredentials {
  /** Connection row id (safe to log). */
  id: string;
  organisationId: string;
  subaccountId: string | null;
  /** Resolved configJson — selectors and URLs (safe to log). */
  config: WebLoginConfig;
  /** Plaintext password — branded to discourage accidental log/serialise. */
  password: Plaintext<string>;
}

export interface WebLoginConfig {
  loginUrl: string;
  contentUrl?: string;
  username: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  successSelector?: string;
  timeoutMs?: number;
}

export class WebLoginConnectionNotFound extends Error {
  readonly _tag = 'WebLoginConnectionNotFound' as const;
  constructor(
    public readonly connectionId: string,
    public readonly runContext: { organisationId: string; subaccountId: string | null; runId: string },
  ) {
    super(`web_login connection ${connectionId} not found for run ${runContext.runId}`);
  }
}

/**
 * Fetch and decrypt a web_login connection for a specific run.
 *
 * The single-purpose API. Use this and only this for paywall credentials.
 *
 * Throws `WebLoginConnectionNotFound` if the connection does not exist,
 * is for a different org, is for a different subaccount (when the run has
 * a subaccountId set), is the wrong provider type, or has been revoked.
 */
export async function getWebLoginConnectionForRun(
  runContext: { organisationId: string; subaccountId: string | null; runId: string },
  connectionId: string,
): Promise<DecryptedWebLoginCredentials> {
  // Build the WHERE clause. Each condition is a hard requirement.
  const orgScope = eq(integrationConnections.organisationId, runContext.organisationId);
  const providerScope = eq(integrationConnections.providerType, 'web_login');
  const notRevoked = ne(integrationConnections.connectionStatus, 'revoked');
  const idMatch = eq(integrationConnections.id, connectionId);

  // T14 — subaccount scoping rule:
  //   - run has subaccountId  → conn.subaccountId === that OR conn.subaccountId IS NULL (org fallback)
  //   - run is org-level      → conn.subaccountId IS NULL only
  const subaccountScope = runContext.subaccountId
    ? or(
        eq(integrationConnections.subaccountId, runContext.subaccountId),
        isNull(integrationConnections.subaccountId),
      )!
    : isNull(integrationConnections.subaccountId);

  const rows = await db
    .select()
    .from(integrationConnections)
    .where(and(idMatch, orgScope, providerScope, notRevoked, subaccountScope))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new WebLoginConnectionNotFound(connectionId, runContext);
  }

  if (!row.secretsRef) {
    throw new WebLoginConnectionNotFound(connectionId, runContext);
  }

  const config = (row.configJson as WebLoginConfig | null) ?? null;
  if (!config || !config.loginUrl || !config.username) {
    throw new WebLoginConnectionNotFound(connectionId, runContext);
  }

  // Decrypt at the boundary so callers never see ciphertext.
  const password = connectionTokenService.decryptToken(row.secretsRef) as Plaintext<string>;

  // Audit log entry for the secret read. Worker has DB access so the audit
  // event is written by the caller via auditEvents (not via the server-side
  // auditService which depends on the request context). The minimum we
  // emit here is a structured log line carrying { runId, connectionId,
  // organisationId, subaccountId } so an operator can trace it.
  logger.info('worker.web_login_connection.fetched', {
    runId: runContext.runId,
    connectionId: row.id,
    organisationId: row.organisationId,
    subaccountId: row.subaccountId,
  });

  return {
    id: row.id,
    organisationId: row.organisationId,
    subaccountId: row.subaccountId,
    config: {
      ...config,
      // Mask username via shorter exposure in logs — caller can read it
      // via the returned object but we never log the full string here.
    },
    password,
  };
}
