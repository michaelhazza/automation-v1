import { EXTERNAL_DOC_TRUNCATION_HEAD_RATIO } from '../lib/constants';

export function countTokensApprox(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface TruncationResult {
  content: string;
  truncated: boolean;
  tokensRemoved: number;
}

export function truncateContentToTokenBudget(
  content: string,
  tokenBudget: number,
  tokenizer: (s: string) => number = countTokensApprox
): TruncationResult {
  const totalTokens = tokenizer(content);
  if (totalTokens <= tokenBudget) {
    return { content, truncated: false, tokensRemoved: 0 };
  }
  const headTokens = Math.floor(tokenBudget * EXTERNAL_DOC_TRUNCATION_HEAD_RATIO);
  const tailTokens = tokenBudget - headTokens;
  const headChars = Math.floor((headTokens / totalTokens) * content.length);
  const tailChars = Math.floor((tailTokens / totalTokens) * content.length);
  const head = content.slice(0, headChars);
  const tail = content.slice(content.length - tailChars);
  const removed = totalTokens - tokenBudget;
  return {
    content: `${head}\n\n[TRUNCATED: ${removed} tokens removed]\n\n${tail}`,
    truncated: true,
    tokensRemoved: removed,
  };
}

export interface ProvenanceParams {
  docName: string;
  fetchedAt: string;
  revisionId: string | null;
  isStale: boolean;
}

export function buildProvenanceHeader(p: ProvenanceParams): string {
  const lines: string[] = [
    `--- Document: ${p.docName}`,
    `Source: Google Drive`,
    `Fetched: ${p.fetchedAt}`,
  ];
  if (p.revisionId !== null) lines.push(`Revision: ${p.revisionId}`);
  if (p.isStale) lines.push(`Warning: content is from cache (${p.fetchedAt}); last fetch failed`);
  lines.push('---');
  return lines.join('\n');
}

export function isPastStalenessBoundary(fetchedAt: Date, now: Date, maxStalenessMinutes: number): boolean {
  const diffMs = now.getTime() - fetchedAt.getTime();
  return diffMs > maxStalenessMinutes * 60_000;
}

export function isResolverVersionStale(cachedVersion: number, currentVersion: number): boolean {
  return cachedVersion !== currentVersion;
}
