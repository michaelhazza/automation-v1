import crypto from 'node:crypto';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const domainCache = new Map<string, { result: DomainSearchResponse; expiresAt: number }>();

export interface HunterEmail {
  value: string;
  first_name?: string;
  last_name?: string;
  confidence?: number;
  type?: string;
}

export interface DomainSearchResult {
  domain: string;
  emails: HunterEmail[];
  total: number;
}

export interface TransientError {
  status: 'transient_error';
  warning: string;
  data: null;
}

export interface NotConfigured {
  status: 'not_configured';
  warning: string;
  data: null;
}

export type DomainSearchResponse = { status: 'ok'; data: DomainSearchResult } | TransientError | NotConfigured;
export type EmailFinderResponse = { status: 'ok'; data: { email: string; confidence: number } } | TransientError | NotConfigured;

export async function domainSearch(domain: string): Promise<DomainSearchResponse> {
  const apiKey = process.env['HUNTER_API_KEY'];
  if (!apiKey) {
    return { status: 'not_configured', warning: 'HUNTER_API_KEY not set', data: null };
  }

  const cacheKey = crypto.createHash('sha256').update(`domain:${domain}`).digest('hex');
  const cached = domainCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const url = new URL('https://api.hunter.io/v2/domain-search');
    url.searchParams.set('domain', domain);
    url.searchParams.set('api_key', apiKey);

    const response = await fetch(url.toString());
    if (response.status === 402 || response.status === 429) {
      return { status: 'transient_error', warning: `Hunter.io returned HTTP ${response.status} (quota/rate-limit)`, data: null };
    }
    if (response.status >= 500) {
      return { status: 'transient_error', warning: `Hunter.io returned HTTP ${response.status}`, data: null };
    }

    const json = (await response.json()) as { data?: { domain?: string; emails?: HunterEmail[]; total?: number } };
    const result: DomainSearchResponse = {
      status: 'ok',
      data: {
        domain: json.data?.domain ?? domain,
        emails: json.data?.emails ?? [],
        total: json.data?.total ?? 0,
      },
    };
    domainCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch {
    return { status: 'transient_error', warning: 'Hunter.io domain-search request failed', data: null };
  }
}

export async function emailFinder(input: { domain: string; firstName: string; lastName: string }): Promise<EmailFinderResponse> {
  const apiKey = process.env['HUNTER_API_KEY'];
  if (!apiKey) {
    return { status: 'not_configured', warning: 'HUNTER_API_KEY not set', data: null };
  }

  try {
    const url = new URL('https://api.hunter.io/v2/email-finder');
    url.searchParams.set('domain', input.domain);
    url.searchParams.set('first_name', input.firstName);
    url.searchParams.set('last_name', input.lastName);
    url.searchParams.set('api_key', apiKey);

    const response = await fetch(url.toString());
    if (response.status === 402 || response.status === 429) {
      return { status: 'transient_error', warning: `Hunter.io returned HTTP ${response.status} (quota/rate-limit)`, data: null };
    }
    if (response.status >= 500) {
      return { status: 'transient_error', warning: `Hunter.io returned HTTP ${response.status}`, data: null };
    }

    const json = (await response.json()) as { data?: { email?: string; score?: number } };
    return {
      status: 'ok',
      data: { email: json.data?.email ?? '', confidence: json.data?.score ?? 0 },
    };
  } catch {
    return { status: 'transient_error', warning: 'Hunter.io email-finder request failed', data: null };
  }
}
