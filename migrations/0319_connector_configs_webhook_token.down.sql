DROP INDEX IF EXISTS connector_configs_webhook_token_unique;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS webhook_token;
