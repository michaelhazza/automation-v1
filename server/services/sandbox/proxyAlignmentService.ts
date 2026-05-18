// ---------------------------------------------------------------------------
// proxyAlignmentService.ts — consumer service for proxy alignment resolution.
//
// Wraps the pure module and handles GeoIP IO via an injected GeoipReader.
// Emits telemetry events for resolved / partial / failed outcomes.
//
// Spec §4.2, §5.1, §8.2, §10.2 (safe: no DB writes, no side effects beyond logging).
//
// VENDOR ISOLATION: this file MUST NOT import from infra/geoip/ or mmdb-lib.
// The GeoipReader is injected; chunk 7 provides the concrete implementation.
// ---------------------------------------------------------------------------

import { logger } from '../../lib/logger.js';
import type { ProxyAlignment, ProxyConfig, ProxyLocaleOverrides } from '../../../shared/types/proxyAlignment.js';
import {
  extractIpFromProxyUrl,
  translateIpToGeo,
  assembleAlignment,
  type GeoipReader,
} from './proxyAlignmentServicePure.js';

// Re-export GeoipReader so chunk 8 / chunk 7 callers can import it from one place.
export type { GeoipReader };

/**
 * Resolve a ProxyAlignment from the given proxy configuration and optional locale overrides.
 *
 * Returns null when alignment cannot be determined (invalid proxy URL or GeoIP lookup error).
 * Returns a valid ProxyAlignment (possibly with default fallback fields) in all other cases.
 *
 * Telemetry:
 *   browser.proxy.alignment.resolved — all three geo fields came from GeoIP (no fallbacks)
 *   browser.proxy.alignment.partial  — some fields fell back to defaults
 *   browser.proxy.alignment.failed   — could not determine alignment at all
 */
export function resolve(
  proxyConfig: ProxyConfig,
  overrides: ProxyLocaleOverrides | null,
  geoipReader: GeoipReader,
): ProxyAlignment | null {
  // Step 1: extract hostname from proxy URL
  const ip = extractIpFromProxyUrl(proxyConfig.url);
  if (ip === null) {
    logger.warn('browser.proxy.alignment.failed', { reason: 'invalid_ip' });
    return null;
  }

  // Step 2: GeoIP lookup (may throw if reader is unavailable)
  let geo: { timezone?: string; locale?: string; language?: string } | null;
  try {
    geo = translateIpToGeo(ip, geoipReader);
  } catch {
    logger.warn('browser.proxy.alignment.failed', { reason: 'geoip_lookup_error' });
    return null;
  }

  // Step 3: assemble alignment from geo + overrides
  // When geo is null (lookup returned null), assembleAlignment produces all defaults
  // unless overrides cover the fields.
  const { alignment, resolvedFields, fallbackFields } = assembleAlignment(geo, overrides);

  // Step 4: emit appropriate telemetry
  if (fallbackFields.length === 0) {
    // All fields resolved from GeoIP (overrides may be present but geo covered the rest)
    logger.info('browser.proxy.alignment.resolved', {});
  } else {
    logger.info('browser.proxy.alignment.partial', { resolvedFields, fallbackFields });
  }

  return alignment;
}
