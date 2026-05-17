// ---------------------------------------------------------------------------
// Model mapping for fallback providers
// Maps Anthropic model names → equivalent models on other providers
// ---------------------------------------------------------------------------

export const FALLBACK_MODEL_MAP: Record<string, Record<string, string>> = {
  openai: {
    'claude-sonnet-4-6': 'gpt-4o',
    'claude-haiku-4-5':  'gpt-4o-mini',
    'claude-opus-4-6':   'gpt-4o',
  },
  gemini: {
    'claude-sonnet-4-6': 'gemini-2.5-flash',
    'claude-haiku-4-5':  'gemini-2.5-flash-lite',
    'claude-opus-4-6':   'gemini-2.5-flash',
  },
  openrouter: {
    'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
    'claude-haiku-4-5':  'anthropic/claude-haiku-4-5',
    'claude-opus-4-6':   'anthropic/claude-opus-4-6',
    'gpt-4o':            'openai/gpt-4o',
    'gpt-4o-mini':       'openai/gpt-4o-mini',
  },
};

export function isNonRetryableError(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string; message?: string };
  if (e.statusCode === 400 || e.statusCode === 401 || e.statusCode === 403) return true;
  if (e.code === 'PROVIDER_NOT_CONFIGURED') return true;
  // Rev §6 — caller-initiated aborts must not retry. The caller decided to
  // stop; re-hitting the provider on their behalf wastes tokens and can
  // produce confusing duplicate calls in the Anthropic console.
  if (e.code === 'CLIENT_DISCONNECTED') return true;
  // Provider timeouts are "ambiguous state" — the provider may have already
  // completed generation server-side. A retry under the same idempotency key
  // would issue a second concurrent call and double-bill at the provider
  // layer (no LLM provider currently supports request-level dedup headers).
  // Propagate immediately; the caller decides whether to replay under a new
  // idempotency key. See spec §17 deferred items.
  if (e.code === 'PROVIDER_TIMEOUT') return true;
  const code = (e.code ?? '').toLowerCase();
  return code.includes('auth') || code.includes('invalid') || code.includes('bad_request');
}
