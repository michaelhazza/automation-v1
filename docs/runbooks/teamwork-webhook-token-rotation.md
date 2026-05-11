# Teamwork Webhook Token Rotation

Runbook for rotating the per-connector webhook URL token on a Teamwork connector config.

## When to rotate

- Suspected token compromise (token appeared in logs, shared with wrong party, etc.)
- Routine security rotation policy (e.g. annual or post-incident)
- Migrating to a new webhook endpoint URL

## How to fetch the current token

Connect to the database and run:

```sql
SELECT id, organisation_id, webhook_token, status
FROM connector_configs
WHERE connector_type = 'teamwork'
  AND status = 'active';
```

The `webhook_token` column contains the UUID used in the Teamwork delivery URL:

```
POST /api/webhooks/teamwork/<webhook_token>
```

## How to rotate the token

1. Generate a new UUID:

```sql
SELECT gen_random_uuid() AS new_token;
```

2. Update the connector config:

```sql
UPDATE connector_configs
SET webhook_token = '<new_token_uuid>',
    updated_at = now()
WHERE id = '<connector_config_id>';
```

3. Update the Teamwork delivery URL in the Teamwork Desk admin panel to point to the new token:

```
https://<your-domain>/api/webhooks/teamwork/<new_token_uuid>
```

## Consequence of old token after rotation

- Any webhook delivery sent to the old URL (containing the old token) will receive a **401 webhook.token_unknown** response.
- Teamwork Desk will typically retry the delivery. If retries exhaust before the delivery URL is updated, events may be lost.
- Update the Teamwork delivery URL promptly after rotation to minimise event loss.
- There is no grace period or dual-token support — the old token is immediately invalid.

## Verifying the new token is working

After updating the delivery URL in Teamwork, trigger a test webhook from Teamwork Desk and confirm:

1. The application logs show `webhook.teamwork.processed` (not `webhook.token_unknown`).
2. No new `system_incidents` rows with fingerprint `webhook:teamwork:*` appear.
