import { check } from '../../lib/inboundRateLimiter.js';
import { rateLimitKeys } from '../../lib/rateLimitKeys.js';

const IDENTITY_CAPS = [
  { cap: 60,   windowSec: 60 },    // 60/min
  { cap: 1000, windowSec: 3600 },  // 1000/hour
  { cap: 5000, windowSec: 86400 }, // 5000/day
];

const ORG_CAPS = [
  { cap: 600,    windowSec: 60 },    // 600/min
  { cap: 20000,  windowSec: 3600 },  // 20000/hour
  { cap: 100000, windowSec: 86400 }, // 100000/day
];

export async function defaultRateLimitCheck(scope: { identityId: string; organisationId: string }) {
  for (const { cap, windowSec } of IDENTITY_CAPS) {
    const r = await check(rateLimitKeys.workspaceEmailIdentity(scope.identityId), cap, windowSec);
    if (!r.allowed) {
      return { ok: false as const, scope: 'identity' as const, windowResetAt: r.resetAt, nowEpochMs: r.nowEpochMs, reason: 'identity_cap_exceeded' };
    }
  }
  let lastOrgResult = { nowEpochMs: undefined as number | undefined };
  for (const { cap, windowSec } of ORG_CAPS) {
    const r = await check(rateLimitKeys.workspaceEmailOrg(scope.organisationId), cap, windowSec);
    if (!r.allowed) {
      return { ok: false as const, scope: 'org' as const, windowResetAt: r.resetAt, nowEpochMs: r.nowEpochMs, reason: 'org_cap_exceeded' };
    }
    lastOrgResult = r;
  }
  return { ok: true as const, nowEpochMs: lastOrgResult.nowEpochMs };
}
