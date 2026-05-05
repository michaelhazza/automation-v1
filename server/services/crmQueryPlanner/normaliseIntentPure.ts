// Intent normalisation — spec §7. Pure function; no side effects.
import { createHash } from 'crypto';
import { NORMALISER_VERSION, type NormalisedIntent } from '../../../shared/types/crmQueryPlanner.js';

export { NORMALISER_VERSION };

// §7.2 Stop words (conservative — intent-bearing words kept)
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'to', 'of',
  'for', 'on', 'in', 'at', 'by', 'with', 'me', 'my', 'our',
  'show', 'get', 'find', 'list',
]);

// §7.3 Synonyms — seed list; pressure test expands
// TODO(spec-open-1): alias list expanded by pressure test results
const SYNONYMS: Record<string, string> = {
  'deals':      'opportunities',
  'deal':       'opportunities',
  'leads':      'contacts',
  'lead':       'contacts',
  'customer':   'contacts',
  'customers':  'contacts',
  'client':     'contacts',
  'clients':    'contacts',
  'pipeline':   'opportunities',
  'inactive':   'stale',
  'dormant':    'stale',
  'idle':       'stale',
  'upcoming':   'future',
};

// Date-literal canonicalisation patterns → stable token
const DATE_LITERALS: [RegExp, string][] = [
  [/\b(?:last|past)\s+30[\s-]?d(?:ays?)?\b/gi, 'last_30d'],
  [/\b30[\s-]?days?\s+ago\b/gi,                'last_30d'],
  [/\b(?:last|past)\s+7[\s-]?d(?:ays?)?\b/gi,  'last_7d'],
  [/\b7[\s-]?days?\s+ago\b/gi,                 'last_7d'],
  [/\b(?:last|past)\s+month\b/gi,              'last_30d'],
  [/\b(?:this|current)\s+month\b/gi,           'this_month'],
  [/\b(?:this|current)\s+week\b/gi,            'this_week'],
  [/\b(?:this|current)\s+year\b/gi,            'this_year'],
];

export function normaliseIntent(rawIntent: string): NormalisedIntent {
  let s = rawIntent;

  // §7.1 step 2 — sort-stabilise date literals before stripping punctuation
  for (const [pattern, replacement] of DATE_LITERALS) {
    s = s.replace(pattern, ` ${replacement} `);
  }

  // §7.1 steps 1-4
  s = s.toLowerCase();
  // strip punctuation except digits, '-' in word context, '_' (our date tokens)
  s = s.replace(/[^a-z0-9\s\-_]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // tokenise
  let tokens = s.split(' ').filter(Boolean);

  // §7.1 step 5 — remove stop words
  tokens = tokens.filter(t => !STOP_WORDS.has(t));

  // §7.1 step 6 — synonym canonicalisation (single pass, insertion order)
  tokens = tokens.map(t => SYNONYMS[t] ?? t);

  // hash
  const hash = createHash('sha256')
    .update(tokens.join(' '))
    .digest('hex')
    .slice(0, 16);

  return { hash, tokens, rawIntent };
}
