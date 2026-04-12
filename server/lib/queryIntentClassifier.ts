// ---------------------------------------------------------------------------
// Heuristic query intent classifier
// Classifies a search query into a RetrievalProfile to select optimal
// RRF lane weights. Regex-based — no LLM call needed.
// ---------------------------------------------------------------------------

import type { RetrievalProfile } from './queryIntent.js';

const TEMPORAL_PATTERNS = /\b(when|last|recent|this week|today|yesterday|month|ago|since|before|after|history|timeline)\b/i;
const EXACT_PATTERNS = /\b(what is|define|name of|exact|specific|id|email|phone|url)\b/i;
const RELATIONSHIP_PATTERNS = /\b(related|connected|linked|between|depends|caused|affected|impact)\b/i;
const EXPLORATORY_PATTERNS = /\b(how|why|overview|summary|explain|tell me about|what do we know)\b/i;

export function classifyQueryIntent(query: string): RetrievalProfile {
  const q = query.toLowerCase();
  if (TEMPORAL_PATTERNS.test(q)) return 'temporal';
  if (EXACT_PATTERNS.test(q)) return 'factual';
  if (RELATIONSHIP_PATTERNS.test(q)) return 'relational';
  if (EXPLORATORY_PATTERNS.test(q)) return 'exploratory';
  return 'general';
}
