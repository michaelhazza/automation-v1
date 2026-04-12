// ---------------------------------------------------------------------------
// sanitizeSearchQuery — cleans agent-generated search queries
// Agents frequently contaminate queries with system prompt fragments or
// verbose preambles, collapsing retrieval accuracy. This 4-step cascade
// extracts the meaningful query core.
// ---------------------------------------------------------------------------

const MAX_CLEAN_LENGTH = 200;

export function sanitizeSearchQuery(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  // Step 1: short queries pass through
  if (trimmed.length <= MAX_CLEAN_LENGTH) return trimmed;
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
