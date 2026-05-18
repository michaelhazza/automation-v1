ALTER TABLE subaccount_iee_browser_settings
  DROP CONSTRAINT IF EXISTS chk_proxy_locale_overrides_shape;

ALTER TABLE subaccount_iee_browser_settings
  DROP CONSTRAINT IF EXISTS chk_proxy_config_no_raw_credentials;

ALTER TABLE subaccount_iee_browser_settings
  DROP COLUMN IF EXISTS proxy_locale_overrides;

ALTER TABLE subaccount_iee_browser_settings
  DROP COLUMN IF EXISTS proxy_config;
