// ---------------------------------------------------------------------------
// sanitizeSearchQuery — cleans agent-generated search queries
// Agents frequently contaminate queries with system prompt fragments or
// verbose preambles, collapsing retrieval accuracy. This cascade extracts
// the meaningful query core while preserving multi-clause user queries.
// ---------------------------------------------------------------------------

const MAX_CLEAN_LENGTH = 200;

/**
 * Patterns that indicate agent-generated preamble noise. These are phrases
 * that agents prepend before the actual search intent. Only when these are
 * detected do we apply the lossy sentence extraction — otherwise we preserve
 * the full query structure (truncated to MAX_CLEAN_LENGTH).
 */
const AGENT_NOISE_PATTERNS = /\b(let me|i should|i need to|i will|searching for|looking for information|based on|i am going to|the agent|workspace memory|previous conversations|prior runs)\b/i;

export function sanitizeSearchQuery(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  // Step 1: short queries pass through
  if (trimmed.length <= MAX_CLEAN_LENGTH) return trimmed;

  // Step 1.5: If the query doesn't contain agent noise patterns, it's likely
  // a genuine multi-clause user query — preserve structure, just truncate.
  if (!AGENT_NOISE_PATTERNS.test(trimmed)) {
    return trimmed.slice(0, MAX_CLEAN_LENGTH).trim();
  }

  // Step 2: extract question-mark-terminated sentence
  const qMatch = trimmed.match(/[^.!?]*\?/);
  if (qMatch && qMatch[0].length >= 10) return qMatch[0].trim();
  // Step 3: extract last sentence (agents tend to front-load preamble)
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const last = sentences[sentences.length - 1];
  if (last && last.length >= 10 && last.length <= MAX_CLEAN_LENGTH) return last.trim();
  // Step 4: tail truncate
  return trimmed.slice(-MAX_CLEAN_LENGTH).trim();
}
