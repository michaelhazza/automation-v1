import type { TierResult } from './types.js';

const MAX_CONTENT_BYTES = 1_048_576; // 1MB
const FETCH_TIMEOUT_MS = 30_000;

function isBlockedResponse(status: number, body: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  if (body.includes('challenge-platform') || body.includes('cf-turnstile')) return true;
  if (body.includes('Just a moment') && body.includes('cloudflare')) return true;
  if (body.length < 1000 && !body.includes('<body')) return true;
  return false;
}

export async function httpFetch(url: string): Promise<TierResult> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AutomationOS/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const text = await response.text();
    const capped = text.length > MAX_CONTENT_BYTES ? text.slice(0, MAX_CONTENT_BYTES) : text;
    const blocked = isBlockedResponse(response.status, capped);

    return {
      success: !blocked && response.ok,
      html: capped,
      statusCode: response.status,
      wasBlocked: blocked,
    };
  } catch (err) {
    return {
      success: false,
      wasBlocked: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
