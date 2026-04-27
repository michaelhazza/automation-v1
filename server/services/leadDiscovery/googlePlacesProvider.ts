// In-memory LRU cache: keyed on SHA-256 of request JSON, 24h TTL.
import crypto from 'node:crypto';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { result: PlacesResult; expiresAt: number }>();

export interface PlaceSummary {
  name: string;
  address: string;
  category?: string;
  phone?: string;
  website?: string;
}

export interface PlacesResult {
  places: PlaceSummary[];
}

export interface PlacesNotConfigured {
  status: 'not_configured';
  warning: string;
}

export interface PlacesTransientError {
  status: 'transient_error';
  warning: string;
}

export type SearchPlacesResponse = PlacesResult | PlacesNotConfigured | PlacesTransientError;

export interface SearchPlacesInput {
  query: string;
  location: string;
  radius?: number;
  type?: string;
  limit?: number;
}

export async function searchPlaces(input: SearchPlacesInput): Promise<SearchPlacesResponse> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY'];
  if (!apiKey) {
    return { status: 'not_configured', warning: 'GOOGLE_PLACES_API_KEY not set' };
  }

  const cacheKey = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('query', `${input.query} ${input.location}`);
    url.searchParams.set('key', apiKey);
    if (input.type) url.searchParams.set('type', input.type);
    if (input.radius) url.searchParams.set('radius', String(input.radius));

    const response = await fetch(url.toString());
    if (response.status === 429 || response.status >= 500) {
      return { status: 'transient_error', warning: `Google Places returned HTTP ${response.status}` };
    }

    const data = (await response.json()) as { results: Array<{ name?: string; formatted_address?: string; types?: string[]; formatted_phone_number?: string; website?: string }> };
    const limit = input.limit ?? 20;
    const places: PlaceSummary[] = (data.results ?? []).slice(0, limit).map((r) => ({
      name: r.name ?? '',
      address: r.formatted_address ?? '',
      category: r.types?.[0],
      phone: r.formatted_phone_number,
      website: r.website,
    }));

    const result: PlacesResult = { places };
    cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch {
    return { status: 'transient_error', warning: 'Google Places request failed' };
  }
}
