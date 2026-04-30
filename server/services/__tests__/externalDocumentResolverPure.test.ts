import { test, expect } from 'vitest';
import {
  truncateContentToTokenBudget,
  buildProvenanceHeader,
  countTokensApprox,
} from '../externalDocumentResolverPure.js';

test('truncateContentToTokenBudget — under budget passes through unchanged', () => {
  const input = 'short content';
  const result = truncateContentToTokenBudget(input, 1000);
  expect(result.truncated).toBe(false);
  expect(result.content).toBe(input);
  expect(result.tokensRemoved).toBe(0);
});

test('truncateContentToTokenBudget — over budget applies 70/30 head+tail with marker', () => {
  const head = 'HEAD '.repeat(200);
  const tail = ' TAIL'.repeat(200);
  const middle = ' MID '.repeat(2000);
  const input = head + middle + tail;
  const result = truncateContentToTokenBudget(input, 600);
  expect(result.truncated).toBe(true);
  expect(result.content).toContain('HEAD');
  expect(result.content).toContain('TAIL');
  expect(result.content).toContain('[TRUNCATED:');
  expect(result.tokensRemoved).toBeGreaterThan(0);
  const head70 = result.content.split('[TRUNCATED:')[0];
  expect(countTokensApprox(head70)).toBeGreaterThanOrEqual(countTokensApprox(result.content) * 0.6);
});

test('buildProvenanceHeader — includes Source, Fetched, Revision when present', () => {
  const header = buildProvenanceHeader({
    docName: 'Test Doc',
    fetchedAt: '2026-04-30T09:04:00Z',
    revisionId: '7',
    isStale: false,
  });
  expect(header).toMatch(/^--- Document: Test Doc/m);
  expect(header).toMatch(/Source: Google Drive/);
  expect(header).toMatch(/Fetched: 2026-04-30T09:04:00Z/);
  expect(header).toMatch(/Revision: 7/);
  expect(header).not.toMatch(/Warning:/);
});

test('buildProvenanceHeader — omits Revision line when revisionId is null', () => {
  const header = buildProvenanceHeader({
    docName: 'No Rev Doc',
    fetchedAt: '2026-04-30T09:04:00Z',
    revisionId: null,
    isStale: false,
  });
  expect(header).not.toMatch(/Revision:/);
});

test('buildProvenanceHeader — adds Warning line on stale cache', () => {
  const header = buildProvenanceHeader({
    docName: 'Stale Doc',
    fetchedAt: '2026-04-29T09:00:00Z',
    revisionId: '5',
    isStale: true,
  });
  expect(header).toMatch(/Warning: content is from cache \(2026-04-29T09:00:00Z\); last fetch failed/);
});
