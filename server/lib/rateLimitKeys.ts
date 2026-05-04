/**
 * rateLimitKeys.ts — typed builders for the keys consumed by inboundRateLimiter.check.
 *
 * Centralisation rationale (spec §7.2 *Key cardinality*): inline string assembly
 * at every call site fragments buckets when contributors vary casing, delimiters,
 * or dimension order. This module pins the canonical shape.
 *
 * Convention: `{namespace}:{kind}:{value}[:{secondary}]`.
 *
 * NORMALISATION POLICY:
 *   - Emails ARE lowercased (RFC 5321 §2.3.11).
 *   - IPs are NOT normalised.
 *   - UUIDs are NOT normalised.
 *   - Page IDs / generic opaque IDs are NOT normalised.
 *
 * Every key starts with `rl:${KEY_VERSION}:`. Bump KEY_VERSION to invalidate
 * all buckets (e.g. for structural changes); old rows age out via the TTL cleanup job.
 */
const KEY_VERSION = 'v1';

export const rateLimitKeys = {
  // ---------------- auth (Phase 2D) ----------------
  authLogin: (ip: string, email: string): string =>
    `rl:${KEY_VERSION}:auth:login:${ip}:${email.toLowerCase()}`,
  authSignup: (ip: string): string =>
    `rl:${KEY_VERSION}:auth:signup:${ip}`,
  authForgot: (ip: string): string =>
    `rl:${KEY_VERSION}:auth:forgot:${ip}`,
  authReset: (ip: string): string =>
    `rl:${KEY_VERSION}:auth:reset:${ip}`,

  // ---------------- public (Phase 2D) ----------------
  publicFormIp: (ip: string): string =>
    `rl:${KEY_VERSION}:public:form:ip:${ip}`,
  publicFormPage: (pageId: string): string =>
    `rl:${KEY_VERSION}:public:form:page:${pageId}`,
  publicTrackIp: (ip: string): string =>
    `rl:${KEY_VERSION}:public:track:ip:${ip}`,

  // ---------------- test-run (Phase 2E) ----------------
  testRun: (userId: string): string =>
    `rl:${KEY_VERSION}:testrun:user:${userId}`,

  // ---------------- session message (Phase 6) ----------------
  sessionMessage: (userId: string): string =>
    `rl:${KEY_VERSION}:session:message:user:${userId}`,

  // ---------------- workspace email ----------------
  workspaceEmailIdentity: (identityId: string): string =>
    `rl:${KEY_VERSION}:workspace:email:identity:${identityId}`,
  workspaceEmailOrg: (organisationId: string): string =>
    `rl:${KEY_VERSION}:workspace:email:org:${organisationId}`,
};
