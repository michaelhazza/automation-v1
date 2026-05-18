// ProxyAlignment — browser proxy locale/timezone/language alignment envelope
// Shape per spec §6.1. Non-null means GeoIP resolved; null means alignment unavailable.

export type WebRtcPolicy = 'disable_non_proxied_udp';

export interface ProxyAlignment {
  timezone: string;       // e.g. 'America/New_York'
  locale: string;         // e.g. 'en-US'
  language: string;       // e.g. 'en-US,en;q=0.9'
  webrtcPolicy: WebRtcPolicy;
}

// Proxy configuration stored in subaccount_iee_browser_settings.proxy_config JSONB
// credentialId references credentialBrokerService — NEVER raw username/password
export interface ProxyConfig {
  url: string;
  credentialId?: string;
}

// Locale overrides stored in subaccount_iee_browser_settings.proxy_locale_overrides JSONB
export interface ProxyLocaleOverrides {
  timezone?: string;
  locale?: string;
  language?: string;
}
