// ---------------------------------------------------------------------------
// proxyAlignmentServicePure.ts — pure helpers for proxy alignment resolution.
//
// No DB, no filesystem, no external calls. All inputs are passed as parameters.
//
// Spec §6.1 (per-field fallbacks, tenant-override precedence),
// Spec §6.4 (fourth bullet — tenant overrides win),
// Spec §8.2, §11.1 (pure tests).
//
// verify-pure-helper-convention.sh checks that test files import from this
// module using a relative path ending in `.js`.
//
// REDACTION NOTE: This module only receives ProxyLocaleOverrides (timezone/locale/language)
// and geo lookup results — never ProxyConfig.credentialId or any credential material.
// The assembled ProxyAlignment is therefore inherently free of credential data.
// ---------------------------------------------------------------------------

import type { ProxyAlignment, ProxyLocaleOverrides } from '../../../shared/types/proxyAlignment.js';

// ---------------------------------------------------------------------------
// GeoipReader interface
// Chunk 7 provides the concrete implementation; chunk 6 depends on this interface
// via dependency injection so the vendor boundary is enforced at the file level.
// ---------------------------------------------------------------------------

export interface GeoipReader {
  lookup(ip: string): { timezone?: string; locale?: string; language?: string } | null;
}

// Per-field fallback defaults per spec §6.1
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_LANGUAGE = 'en-US,en;q=0.9';
const DEFAULT_WEBRTC_POLICY = 'disable_non_proxied_udp' as const;

// ---------------------------------------------------------------------------
// extractIpFromProxyUrl
// ---------------------------------------------------------------------------

/**
 * Extract the hostname or IP from a proxy URL string.
 * Returns null if the URL is unparseable or has no host.
 */
export function extractIpFromProxyUrl(proxyUrl: string): string | null {
  try {
    const parsed = new URL(proxyUrl);
    const host = parsed.hostname;
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// translateIpToGeo
// ---------------------------------------------------------------------------

/**
 * Translate a GeoIP lookup result for the given IP into partial geo fields.
 * Returns null if the GeoipReader.lookup returns null (unknown IP / DB unavailable).
 * Returns whatever fields the reader provides; missing fields are left absent
 * so assembleAlignment can apply per-field fallbacks.
 */
export function translateIpToGeo(
  ip: string,
  geoipReader: GeoipReader,
): { timezone?: string; locale?: string; language?: string } | null {
  return geoipReader.lookup(ip);
}

// ---------------------------------------------------------------------------
// assembleAlignment
// ---------------------------------------------------------------------------

/**
 * Assemble a ProxyAlignment from geo data and tenant overrides.
 *
 * Precedence (highest to lowest per spec §6.1 + §6.4):
 *   1. Tenant override field (from ProxyLocaleOverrides)
 *   2. GeoIP-derived field
 *   3. Default fallback (timezone→UTC, locale→en-US, language→en-US,en;q=0.9)
 *
 * webrtcPolicy is always 'disable_non_proxied_udp'.
 *
 * resolvedFields: fields whose value came from GeoIP (not override, not fallback).
 * fallbackFields: fields whose value fell back to defaults (neither override nor GeoIP).
 *
 * REDACTION: overrides contains only timezone/locale/language — no credential material.
 * The returned ProxyAlignment contains only timezone/locale/language/webrtcPolicy.
 */
export function assembleAlignment(
  geo: { timezone?: string; locale?: string; language?: string } | null,
  overrides: ProxyLocaleOverrides | null,
): { alignment: ProxyAlignment; resolvedFields: string[]; fallbackFields: string[] } {
  const resolvedFields: string[] = [];
  const fallbackFields: string[] = [];

  function resolveField(
    fieldName: string,
    overrideVal: string | undefined,
    geoVal: string | undefined,
    defaultVal: string,
  ): string {
    if (overrideVal !== undefined) {
      // Tenant override wins — not counted as resolved from GeoIP or fallback
      return overrideVal;
    }
    if (geoVal !== undefined) {
      resolvedFields.push(fieldName);
      return geoVal;
    }
    fallbackFields.push(fieldName);
    return defaultVal;
  }

  const timezone = resolveField('timezone', overrides?.timezone, geo?.timezone, DEFAULT_TIMEZONE);
  const locale = resolveField('locale', overrides?.locale, geo?.locale, DEFAULT_LOCALE);
  const language = resolveField('language', overrides?.language, geo?.language, DEFAULT_LANGUAGE);

  const alignment: ProxyAlignment = {
    timezone,
    locale,
    language,
    webrtcPolicy: DEFAULT_WEBRTC_POLICY,
  };

  return { alignment, resolvedFields, fallbackFields };
}
