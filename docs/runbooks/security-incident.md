# Security incident runbook

**Audience:** on-call engineer + security lead.
**Trigger:** any of: cross-org access alert, mass auth failure spike, credential leak suspected, unauthorised data export attempt, RLS bypass detection.

## Triage (first 5 minutes)
1. Is the incident in-progress? Check `security_audit_events` for the matching event_type within the last hour.
2. Identify scope: single org, multiple orgs, system-wide.
3. Decide containment: rate-limit, IP block, account suspension, or full read-only mode.

## Containment levers
- **IP block.** Add to denylist in `server/middleware/auth.ts` (env var `IP_DENYLIST`). Effective immediately on next request.
- **User account suspension.** `UPDATE users SET status = 'suspended', password_changed_at = now()` (forces JWT revocation per Phase 2 Chunk 4).
- **Org freeze (read-only).** Set the `org_status` column to `frozen`; routes that gate on org_status return 423 Locked.
- **System-wide read-only.** Flip `READ_ONLY_MODE=true` env var; mutating routes return 503.

## Investigation
1. Query `security_audit_events` filtered to (org, time-window) for the affected scope.
2. Pull related `webhook_audit_log` and `audit_events` rows.
3. Check `system_incidents` for related fingerprints.
4. Build the timeline: first observation, containment, escalation, root cause.

## Communication
- **Internal:** post to #incidents Slack channel within 10 min of containment decision.
- **External (if customer data affected):** decision tree — see External notification matrix below.

## Post-incident
- Write a post-mortem within 48h.
- File any new fixed-class items in `tasks/todo.md`.
- Update KNOWLEDGE.md with the lesson.
- Update this runbook if the response process surfaced a gap.

## External notification matrix
- **Cross-tenant data exposure (any customer's data visible to another tenant):** notify within 72h per GDPR.
- **Auth/credential exposure (creds visible in logs or external):** notify affected users within 24h.
- **No customer data exposed (e.g. internal DB metric scrape):** internal post-mortem only; no customer notification required.

## On-call rota
[fill in after Phase 2 ships]
