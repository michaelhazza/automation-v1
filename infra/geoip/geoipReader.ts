// ---------------------------------------------------------------------------
// geoipReader.ts — Concrete GeoipReader implementation.
//
// Reads the GeoLite2-City .mmdb file from the runtime path using mmdb-lib.
// Returns null from every lookup when the database file is absent or unreadable
// (graceful degradation per spec §10).
//
// This is the ONLY file in the codebase that imports mmdb-lib or reads the
// .mmdb binary. Vendor-isolation invariant per spec §4.2 + chunk-7 contracts.
//
// Telemetry: emits geoip.db.source.selected once per session boot on first
// lookup, keyed by whether the runtime file was loadable.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { Reader, type CityResponse } from 'mmdb-lib';
import type { GeoipReader } from '../../server/services/sandbox/proxyAlignmentServicePure.js';

const RUNTIME_DIR = process.env.GEOIP_RUNTIME_DIR ?? '/var/lib/synthetos/geoip';
const DB_PATH = `${RUNTIME_DIR}/geolite2-city.mmdb`;

let reader: Reader<CityResponse> | null = null;
let readerLoaded = false;
let sourceSelectedEmitted = false;

function loadReader(): Reader<CityResponse> | null {
  if (readerLoaded) return reader;
  readerLoaded = true;
  try {
    if (!existsSync(DB_PATH)) {
      reader = null;
      emitSourceSelected('unavailable');
      return null;
    }
    const buf = readFileSync(DB_PATH);
    reader = new Reader<CityResponse>(buf);
    emitSourceSelected('runtime');
  } catch {
    reader = null;
    emitSourceSelected('unavailable');
  }
  return reader;
}

function emitSourceSelected(source: 'runtime' | 'unavailable'): void {
  if (sourceSelectedEmitted) return;
  sourceSelectedEmitted = true;
  console.log(JSON.stringify({ event: 'geoip.db.source.selected', source }));
}

const countryToLocale: Record<string, string> = {
  US: 'en-US', GB: 'en-GB', AU: 'en-AU', CA: 'en-CA', NZ: 'en-NZ',
  DE: 'de-DE', FR: 'fr-FR', ES: 'es-ES', IT: 'it-IT', PT: 'pt-PT',
  BR: 'pt-BR', JP: 'ja-JP', KR: 'ko-KR', CN: 'zh-CN', TW: 'zh-TW',
  RU: 'ru-RU', PL: 'pl-PL', NL: 'nl-NL', SE: 'sv-SE', NO: 'nb-NO',
  DK: 'da-DK', FI: 'fi-FI', CZ: 'cs-CZ', HU: 'hu-HU', RO: 'ro-RO',
  TR: 'tr-TR', IN: 'en-IN', ZA: 'en-ZA', AR: 'es-AR', MX: 'es-MX',
};

function extractLocale(result: CityResponse): string | undefined {
  const country = result.country?.iso_code;
  if (!country) return undefined;
  return countryToLocale[country];
}

function extractLanguage(result: CityResponse): string | undefined {
  const locale = extractLocale(result);
  if (!locale) return undefined;
  const [lang] = locale.split('-');
  return `${locale},${lang};q=0.9,en;q=0.8`;
}

export const geoipReader: GeoipReader = {
  lookup(ip: string): { timezone?: string; locale?: string; language?: string } | null {
    const r = loadReader();
    if (!r) return null;
    try {
      const result = r.get(ip);
      if (!result) return null;
      return {
        timezone: result.location?.time_zone,
        locale: extractLocale(result),
        language: extractLanguage(result),
      };
    } catch {
      return null;
    }
  },
};
