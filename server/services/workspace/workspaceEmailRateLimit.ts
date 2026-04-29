import { check } from '../../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../../lib/rateLimitKeys.js';

const IDENTITY_CAP_PER_HOUR = 60;
const ORG_CAP_PER_HOUR = 1000;
const WINDOW_SEC = 3600;

export async function defaultRateLimitCheck(scope: { identityId: string; organisationId: string }) {
  const id = await check(rateLimitKeys.workspaceEmailIdentity(scope.identityId), IDENTITY_CAP_PER_HOUR, WINDOW_SEC);
  if (!id.allowed) {
    return { ok: false as const, scope: 'identity' as const, windowResetAt: id.resetAt, nowEpochMs: id.nowEpochMs, reason: 'identity_cap_exceeded' };
  }
  const org = await check(rateLimitKeys.workspaceEmailOrg(scope.organisationId), ORG_CAP_PER_HOUR, WINDOW_SEC);
  if (!org.allowed) {
    return { ok: false as const, scope: 'org' as const, windowResetAt: org.resetAt, nowEpochMs: org.nowEpochMs, reason: 'org_cap_exceeded' };
  }
  return { ok: true as const, nowEpochMs: org.nowEpochMs };
}
