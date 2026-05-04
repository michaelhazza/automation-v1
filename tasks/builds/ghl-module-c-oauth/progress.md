# Progress

## Status: MERGE_READY (PR #254)
## Current task: ChatGPT Round 3 closed; Phase 3 Steps 7-12 in progress
## Decisions / blockers: none open

## Pre-Prod Validation

Manual simulation to confirm the OAuth lifecycle terminates correctly under a forced refresh failure. Run against staging before first paying-customer install.

1. Pick a staging GHL agency install with `tokenScope='agency'` and `status='active'` in `connector_configs`. Note its `id`, `companyId`, `organisationId`.
2. Invalidate the refresh token: `UPDATE connector_configs SET refresh_token = encode(gen_random_bytes(32), 'hex') WHERE id = '<id>';` (overwrites the encrypted ciphertext with garbage so GHL returns 401 on refresh).
3. Force the agency-token refresh sweep to run on this row by setting `expires_at = now() - interval '1 minute'`. The next `connectorPollingTick` cron will pick it up.
4. Tail `logger.error` output and grep for `event:'ghl.token.refresh_failure'` followed by the disconnected-transition write at `connector_configs.status='disconnected'` and `disconnected_at IS NOT NULL`. Confirm exactly one refresh attempt was logged (no retry loop).
5. Confirm circuit-breaker holds: trigger any subsequent operation that would touch this connector (manual webhook replay, polling tick on the agency sweep) and verify zero new log lines for this `configId` — the `ne(status, 'disconnected')` filter should exclude it from every entry point listed in the Item 1 audit.

If any step fails, do not promote to production. The failure mode tells you which entry point is missing the disconnected guard.
