-- Migration: add proxy_config and proxy_locale_overrides to subaccount_iee_browser_settings
-- These columns store proxy configuration for IEE browser sandboxes.
-- proxy_config: { url: string, credentialId?: string } — NEVER raw credentials
-- proxy_locale_overrides: { timezone?, locale?, language? }

ALTER TABLE subaccount_iee_browser_settings
  ADD COLUMN IF NOT EXISTS proxy_config JSONB,
  ADD COLUMN IF NOT EXISTS proxy_locale_overrides JSONB;

-- CHECK: proxy_config must not contain raw credential fields
ALTER TABLE subaccount_iee_browser_settings
  ADD CONSTRAINT chk_proxy_config_no_raw_credentials
  CHECK (
    proxy_config IS NULL OR (
      jsonb_typeof(proxy_config) = 'object'
      AND (NOT proxy_config ? 'username')
      AND (NOT proxy_config ? 'password')
      AND (NOT proxy_config ? 'secret')
      AND (proxy_config ? 'url')
      AND jsonb_typeof(proxy_config->'url') = 'string'
      AND (NOT proxy_config ? 'credentialId' OR jsonb_typeof(proxy_config->'credentialId') = 'string')
    )
  );

-- CHECK: proxy_locale_overrides must only contain allowed keys, all string values
ALTER TABLE subaccount_iee_browser_settings
  ADD CONSTRAINT chk_proxy_locale_overrides_shape
  CHECK (
    proxy_locale_overrides IS NULL OR (
      jsonb_typeof(proxy_locale_overrides) = 'object'
      AND (NOT proxy_locale_overrides ? 'timezone' OR jsonb_typeof(proxy_locale_overrides->'timezone') = 'string')
      AND (NOT proxy_locale_overrides ? 'locale' OR jsonb_typeof(proxy_locale_overrides->'locale') = 'string')
      AND (NOT proxy_locale_overrides ? 'language' OR jsonb_typeof(proxy_locale_overrides->'language') = 'string')
    )
  );
