-- Migration: add proxy_config and proxy_locale_overrides to subaccount_iee_browser_settings
-- These columns store proxy configuration for IEE browser sandboxes.
-- proxy_config: { url: string, credentialId?: string } — NEVER raw credentials
-- proxy_locale_overrides: { timezone?, locale?, language? }

ALTER TABLE subaccount_iee_browser_settings
  ADD COLUMN IF NOT EXISTS proxy_config JSONB,
  ADD COLUMN IF NOT EXISTS proxy_locale_overrides JSONB;

-- CHECK: proxy_config is closed-set { url, credentialId? } — NO raw credentials of any kind.
-- The locked contract (see progress.md § Critical contracts) forbids ANY credential material
-- in proxyConfig. An allow-list (subtract-then-empty-object) is the only way to express that
-- closed contract; a deny-list misses future credential-shaped keys (token, apiKey, auth, ...).
ALTER TABLE subaccount_iee_browser_settings
  ADD CONSTRAINT chk_proxy_config_no_raw_credentials
  CHECK (
    proxy_config IS NULL OR (
      jsonb_typeof(proxy_config) = 'object'
      AND (proxy_config - 'url' - 'credentialId') = '{}'::jsonb
      AND (proxy_config ? 'url')
      AND jsonb_typeof(proxy_config->'url') = 'string'
      AND (NOT proxy_config ? 'credentialId' OR jsonb_typeof(proxy_config->'credentialId') = 'string')
    )
  );

-- CHECK: proxy_locale_overrides is closed-set { timezone?, locale?, language? }, all string values.
-- The "no extra keys" predicate is the binding minimum per spec §5.3.
ALTER TABLE subaccount_iee_browser_settings
  ADD CONSTRAINT chk_proxy_locale_overrides_shape
  CHECK (
    proxy_locale_overrides IS NULL OR (
      jsonb_typeof(proxy_locale_overrides) = 'object'
      AND (proxy_locale_overrides - 'timezone' - 'locale' - 'language') = '{}'::jsonb
      AND (NOT proxy_locale_overrides ? 'timezone' OR jsonb_typeof(proxy_locale_overrides->'timezone') = 'string')
      AND (NOT proxy_locale_overrides ? 'locale' OR jsonb_typeof(proxy_locale_overrides->'locale') = 'string')
      AND (NOT proxy_locale_overrides ? 'language' OR jsonb_typeof(proxy_locale_overrides->'language') = 'string')
    )
  );
