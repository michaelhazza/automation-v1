import { createHash } from 'crypto';

// ── SuggestionResult ─────────────────────────────────────────────────────────

export interface SuggestionResult {
  name: string;
  blastRadius: 'self' | 'tenant' | 'external';
  reversible: boolean;
  suggestedCheck: {
    kind: string;
    parameters: Record<string, unknown>;
  };
  plainEnglish: string;
  cacheHit: boolean;
}

// ── deriveCacheKey ────────────────────────────────────────────────────────────

export function deriveCacheKey(description: string, apiSpec?: string): string {
  return createHash('sha256')
    .update(description + (apiSpec ?? ''))
    .digest('hex');
}

// ── validateSuggestionResponse ────────────────────────────────────────────────

export function validateSuggestionResponse(raw: unknown): SuggestionResult | null {
  if (raw === null || typeof raw !== 'object') return null;

  const r = raw as Record<string, unknown>;

  if (typeof r.name !== 'string' || r.name.length === 0) return null;

  if (r.blastRadius !== 'self' && r.blastRadius !== 'tenant' && r.blastRadius !== 'external') return null;

  if (typeof r.reversible !== 'boolean') return null;

  if (r.suggestedCheck === null || typeof r.suggestedCheck !== 'object') return null;
  const sc = r.suggestedCheck as Record<string, unknown>;
  if (typeof sc.kind !== 'string' || sc.kind.length === 0) return null;
  if (sc.parameters === null || typeof sc.parameters !== 'object' || Array.isArray(sc.parameters)) return null;

  if (typeof r.plainEnglish !== 'string' || r.plainEnglish.length === 0) return null;

  return {
    name: r.name,
    blastRadius: r.blastRadius as 'self' | 'tenant' | 'external',
    reversible: r.reversible,
    suggestedCheck: {
      kind: sc.kind,
      parameters: sc.parameters as Record<string, unknown>,
    },
    plainEnglish: r.plainEnglish,
    cacheHit: false,
  };
}
