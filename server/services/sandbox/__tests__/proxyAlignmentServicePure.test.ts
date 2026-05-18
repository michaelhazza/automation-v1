/**
 * proxyAlignmentServicePure.test.ts — Pure tests for proxyAlignmentServicePure.ts
 *
 * Spec §11.1, §6.1 (per-field fallbacks), §6.4 (tenant-override precedence).
 *
 * Covers:
 *   1. US IP resolves to US timezone/locale/language
 *   2. UK IP resolves to UK timezone
 *   3. JP IP resolves to Japan timezone
 *   4. AU IP resolves to AU timezone
 *   5. Tenant override wins over GeoIP value
 *   6. Partial fallback shape (GeoIP returns only timezone)
 *   7. GeoipReader returns null → all defaults, fallbackFields.length === 3
 *   8. Redaction test — assembled ProxyAlignment contains no credential material
 *
 * No DB, no network, no filesystem.
 *
 * Runnable via:
 *   npx vitest run server/services/sandbox/__tests__/proxyAlignmentServicePure.test.ts
 */

import { describe, test, expect } from 'vitest';
import {
  extractIpFromProxyUrl,
  translateIpToGeo,
  assembleAlignment,
  type GeoipReader,
} from '../proxyAlignmentServicePure.js';

// ---------------------------------------------------------------------------
// Stub GeoipReader factory
// ---------------------------------------------------------------------------

function makeStubReader(
  result: { timezone?: string; locale?: string; language?: string } | null,
): GeoipReader {
  return {
    lookup: (_ip: string) => result,
  };
}

// ---------------------------------------------------------------------------
// extractIpFromProxyUrl
// ---------------------------------------------------------------------------

describe('extractIpFromProxyUrl', () => {
  test('extracts hostname from a standard proxy URL', () => {
    expect(extractIpFromProxyUrl('http://192.0.2.0:8080')).toBe('192.0.2.0');
  });

  test('extracts hostname from a proxy URL without port', () => {
    expect(extractIpFromProxyUrl('http://proxy.example.com')).toBe('proxy.example.com');
  });

  test('returns null for an unparseable string', () => {
    expect(extractIpFromProxyUrl('not-a-url')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(extractIpFromProxyUrl('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// translateIpToGeo
// ---------------------------------------------------------------------------

describe('translateIpToGeo', () => {
  test('returns geo fields from a reader that returns a result', () => {
    const reader = makeStubReader({ timezone: 'America/New_York', locale: 'en-US', language: 'en-US,en;q=0.9' });
    const result = translateIpToGeo('192.0.2.0', reader);
    expect(result).toEqual({ timezone: 'America/New_York', locale: 'en-US', language: 'en-US,en;q=0.9' });
  });

  test('returns null when reader returns null', () => {
    const reader = makeStubReader(null);
    expect(translateIpToGeo('192.0.2.0', reader)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// assembleAlignment — geographic resolution cases
// ---------------------------------------------------------------------------

describe('assembleAlignment — US IP', () => {
  test('resolves to US timezone/locale/language with no overrides', () => {
    const geo = { timezone: 'America/New_York', locale: 'en-US', language: 'en-US,en;q=0.9' };
    const { alignment, resolvedFields, fallbackFields } = assembleAlignment(geo, null);
    expect(alignment.timezone).toBe('America/New_York');
    expect(alignment.locale).toBe('en-US');
    expect(alignment.language).toBe('en-US,en;q=0.9');
    expect(alignment.webrtcPolicy).toBe('disable_non_proxied_udp');
    expect(resolvedFields).toContain('timezone');
    expect(resolvedFields).toContain('locale');
    expect(resolvedFields).toContain('language');
    expect(fallbackFields).toHaveLength(0);
  });
});

describe('assembleAlignment — UK IP', () => {
  test('resolves to UK timezone/locale/language with no overrides', () => {
    const geo = { timezone: 'Europe/London', locale: 'en-GB', language: 'en-GB,en;q=0.9' };
    const { alignment } = assembleAlignment(geo, null);
    expect(alignment.timezone).toBe('Europe/London');
    expect(alignment.locale).toBe('en-GB');
    expect(alignment.language).toBe('en-GB,en;q=0.9');
  });
});

describe('assembleAlignment — JP IP', () => {
  test('resolves to Japan timezone/locale/language with no overrides', () => {
    const geo = { timezone: 'Asia/Tokyo', locale: 'ja-JP', language: 'ja-JP,ja;q=0.9,en;q=0.8' };
    const { alignment } = assembleAlignment(geo, null);
    expect(alignment.timezone).toBe('Asia/Tokyo');
    expect(alignment.locale).toBe('ja-JP');
    expect(alignment.language).toBe('ja-JP,ja;q=0.9,en;q=0.8');
  });
});

describe('assembleAlignment — AU IP', () => {
  test('resolves to Australia timezone/locale/language with no overrides', () => {
    const geo = { timezone: 'Australia/Sydney', locale: 'en-AU', language: 'en-AU,en;q=0.9' };
    const { alignment } = assembleAlignment(geo, null);
    expect(alignment.timezone).toBe('Australia/Sydney');
    expect(alignment.locale).toBe('en-AU');
    expect(alignment.language).toBe('en-AU,en;q=0.9');
  });
});

// ---------------------------------------------------------------------------
// Tenant override precedence
// ---------------------------------------------------------------------------

describe('assembleAlignment — tenant override wins', () => {
  test('override timezone wins over GeoIP timezone; other fields from GeoIP', () => {
    const geo = { timezone: 'America/New_York', locale: 'en-US', language: 'en-US,en;q=0.9' };
    const overrides = { timezone: 'Europe/London' };
    const { alignment, resolvedFields, fallbackFields } = assembleAlignment(geo, overrides);
    expect(alignment.timezone).toBe('Europe/London');
    expect(alignment.locale).toBe('en-US');
    expect(alignment.language).toBe('en-US,en;q=0.9');
    // timezone was overridden, not counted as resolved from GeoIP
    expect(resolvedFields).not.toContain('timezone');
    expect(resolvedFields).toContain('locale');
    expect(resolvedFields).toContain('language');
    expect(fallbackFields).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Partial fallback shape
// ---------------------------------------------------------------------------

describe('assembleAlignment — partial fallback', () => {
  test('GeoIP returns only timezone; locale and language fall back to defaults', () => {
    const geo = { timezone: 'America/New_York' };
    const { alignment, resolvedFields, fallbackFields } = assembleAlignment(geo, null);
    expect(alignment.timezone).toBe('America/New_York');
    expect(alignment.locale).toBe('en-US');
    expect(alignment.language).toBe('en-US,en;q=0.9');
    expect(resolvedFields).toContain('timezone');
    expect(fallbackFields).toContain('locale');
    expect(fallbackFields).toContain('language');
  });
});

// ---------------------------------------------------------------------------
// GeoipReader returns null → all defaults
// ---------------------------------------------------------------------------

describe('assembleAlignment — GeoipReader returns null', () => {
  test('geo=null with no overrides produces all defaults; fallbackFields.length === 3', () => {
    const { alignment, resolvedFields, fallbackFields } = assembleAlignment(null, null);
    expect(alignment.timezone).toBe('UTC');
    expect(alignment.locale).toBe('en-US');
    expect(alignment.language).toBe('en-US,en;q=0.9');
    expect(alignment.webrtcPolicy).toBe('disable_non_proxied_udp');
    expect(resolvedFields).toHaveLength(0);
    expect(fallbackFields).toHaveLength(3);
    expect(fallbackFields).toContain('timezone');
    expect(fallbackFields).toContain('locale');
    expect(fallbackFields).toContain('language');
  });
});

// ---------------------------------------------------------------------------
// Redaction test — no credential material in assembled ProxyAlignment
// ---------------------------------------------------------------------------

describe('assembleAlignment — redaction', () => {
  test('assembled ProxyAlignment contains no credential fields', () => {
    const geo = { timezone: 'America/New_York', locale: 'en-US', language: 'en-US,en;q=0.9' };
    // Overrides only carry locale fields — no credential material possible at this layer
    const overrides = { timezone: 'Europe/London' };
    const { alignment } = assembleAlignment(geo, overrides);
    const alignmentKeys = Object.keys(alignment);
    expect(alignmentKeys).not.toContain('credentialId');
    expect(alignmentKeys).not.toContain('password');
    expect(alignmentKeys).not.toContain('username');
    expect(alignmentKeys).not.toContain('secret');
    // Confirm only the expected keys are present
    expect(alignmentKeys.sort()).toEqual(['language', 'locale', 'timezone', 'webrtcPolicy'].sort());
  });
});
