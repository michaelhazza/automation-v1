# OAuth State Telemetry

This document covers the four `auditEvent.oauth.state*` events emitted by `server/services/ghlOAuthStateStore.ts`, the `latencyMs` capture pattern, the post-launch revert decision rubric, and the admin query shape.

---

## Events

All four events use `SECURITY_AUDIT_SENTINEL_ORG_ID` as `organisationId`. OAuth state is issued before the callback resolves a tenant organisation, so no real org ID is available at emit time.

### `auditEvent.oauth.stateIssued` (`oauth.state.issued`)

Emitted when a new GHL OAuth state nonce is created via `setGhlOAuthState`.

Payload:
```json
{ "provider": "ghl" }
```

Optional context fields (when available from the calling HTTP request): `userAgent`, `ip`.

### `auditEvent.oauth.stateConsumed` (`oauth.state.consumed`)

Emitted when the state nonce is successfully consumed (valid, not expired) during the OAuth callback.

Payload:
```json
{
  "provider": "ghl",
  "issuedAt": "<ISO-8601>",
  "consumedAt": "<ISO-8601>",
  "latencyMs": 12345
}
```

`latencyMs` is `consumedAt - issuedAt` in milliseconds. This measures the wall-clock duration of the OAuth round-trip from the user's perspective.

Optional context fields: `userAgent`, `ip`.

### `auditEvent.oauth.stateExpired` (`oauth.state.expired`)

Emitted when the state nonce exists in the database but has passed its `expires_at` timestamp (default TTL: 5 minutes).

Payload:
```json
{
  "provider": "ghl",
  "issuedAt": "<ISO-8601>",
  "latencyMs": 305000
}
```

`latencyMs` is `now - issuedAt`. A value consistently above 300 000 ms (5 minutes) suggests users are not completing the OAuth flow within the TTL window.

### `auditEvent.oauth.stateNotFound` (`oauth.state.not_found`)

Emitted when neither a valid nor an expired row can be found for the presented nonce. Possible causes: the nonce was never issued, it was already consumed (replay attempt), or the cleanup job deleted the expired row between the DELETE and the follow-up SELECT.

Payload:
```json
{ "provider": "ghl" }
```

---

## latencyMs capture

`latencyMs` is computed client-side (application layer) as the difference between the row's `createdAt` timestamp (set at nonce creation) and `Date.now()` at consume time. This is wall-clock latency, not server processing time. It includes:

- Browser redirect time from the application to the GHL authorization page
- User dwell time on the GHL consent screen
- Browser redirect back to the application callback URL

For aggregate analysis, group by `meta->>'provider'` and segment by `meta->>'latencyMs'` buckets.

---

## Post-launch revert decision rubric

The `stateExpired` event exists to inform a future decision about whether to tighten or relax the 5-minute TTL. After launch, collect at least 30 days of data before evaluating.

**Decision inputs:**

| Dimension | Query | Threshold |
|---|---|---|
| Expiry rate by IdP | `event_type = 'oauth.state.expired'` grouped by `meta->>'provider'` | If >2% of flows expire for a given provider, investigate |
| Expiry rate by client type | Join `userAgent` against mobile UA patterns | If mobile expiry rate >5% (slower device + redirect overhead), extend TTL for mobile-initiated flows |
| latencyMs P95 for consumed | `event_type = 'oauth.state.consumed'`, P95 of `meta->>'latencyMs'` | If P95 is >240 000 ms (4 min), the 5-min TTL is marginal — extend to 10 min |

**Revert criteria:** If the expiry rate is <0.5% and P95 latency is <120 000 ms (2 min) for all segments, the current TTL is healthy — no change needed.

---

## Admin query

Use the `queryAuditEvents` helper from `server/services/securityAuditService.ts` to surface these events. Because all state events are stored under `SECURITY_AUDIT_SENTINEL_ORG_ID`, set `includeSentinelOrg: true`:

```typescript
import { queryAuditEvents } from '../services/securityAuditService.js';

const events = await queryAuditEvents({
  organisationId:    myOrgId,
  includeSentinelOrg: true,
  eventType:         'oauth.state.expired',
  limit:             500,
});
```

To see all four state event types in one query, omit `eventType` and filter client-side, or run separate calls per event type.

For raw SQL (Postgres):

```sql
SELECT occurred_at, event_type, meta
FROM security_audit_events
WHERE organisation_id = '00000000-0000-0000-0000-000000000000'
  AND event_type LIKE 'oauth.state.%'
ORDER BY occurred_at DESC
LIMIT 500;
```

The sentinel org UUID `00000000-0000-0000-0000-000000000000` is defined as `SECURITY_AUDIT_SENTINEL_ORG_ID` in `server/services/securityAuditService.ts`.
