ALTER TABLE connector_configs ADD COLUMN webhook_token uuid NULL;

CREATE UNIQUE INDEX IF NOT EXISTS connector_configs_webhook_token_unique
  ON connector_configs (webhook_token)
  WHERE webhook_token IS NOT NULL;

UPDATE connector_configs SET webhook_token = gen_random_uuid()
  WHERE connector_type = 'teamwork' AND webhook_token IS NULL;
