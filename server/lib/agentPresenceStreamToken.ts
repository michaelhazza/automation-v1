/**
 * Short-lived signed tokens for agent presence SSE stream connections.
 *
 * Tokens are HMAC-SHA256 signed JWTs bound to (userId, orgId, scope, agentId|subaccountId).
 * Default TTL: 120s. The browser holds tokens in memory only (not localStorage).
 *
 * Token endpoint: POST /api/agent-presence/stream-token
 * SSE endpoints consume them via ?token= query param (stripped before logging).
 */

import jwt from 'jsonwebtoken';
import { env } from './env.js';

export interface StreamTokenScope {
  kind: 'agent' | 'workspace';
  agentId?: string;
  subaccountId?: string;
}

export interface StreamTokenClaims {
  userId: string;
  orgId: string;
  scope: StreamTokenScope;
  /** jwt iat (issued-at, seconds) */
  iat?: number;
  /** jwt exp (expiry, seconds) */
  exp?: number;
}

const STREAM_TOKEN_AUDIENCE = 'agent-presence-stream';

/**
 * Sign a short-lived stream token.
 * Returns { token, expiresAt } where expiresAt is an ISO string.
 */
export function signStreamToken(
  claims: Omit<StreamTokenClaims, 'iat' | 'exp'>,
  ttlSeconds = 120,
): { token: string; expiresAt: string } {
  const token = jwt.sign(
    {
      userId: claims.userId,
      orgId: claims.orgId,
      scope: claims.scope,
    },
    env.JWT_SECRET,
    {
      expiresIn: ttlSeconds,
      audience: STREAM_TOKEN_AUDIENCE,
    },
  );

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return { token, expiresAt };
}

/**
 * Verify a stream token.
 * Returns the decoded claims or throws on invalid/expired token.
 */
export function verifyStreamToken(token: string): StreamTokenClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    audience: STREAM_TOKEN_AUDIENCE,
  }) as StreamTokenClaims;
  return decoded;
}
