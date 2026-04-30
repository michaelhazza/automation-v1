import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  truncateContentToTokenBudget,
  buildProvenanceHeader,
  countTokensApprox,
} from '../externalDocumentResolverPure';

test('truncateContentToTokenBudget — under budget passes through unchanged', () => {
  const input = 'short content';
  const result = truncateContentToTokenBudget(input, 1000);
  assert.equal(result.truncated, false);
  assert.equal(result.content, input);
  assert.equal(result.tokensRemoved, 0);
});

test('truncateContentToTokenBudget — over budget applies 70/30 head+tail with marker', () => {
  const head = 'HEAD '.repeat(200);
  const tail = ' TAIL'.repeat(200);
  const middle = ' MID '.repeat(2000);
  const input = head + middle + tail;
  const result = truncateContentToTokenBudget(input, 600);
  assert.equal(result.truncated, true);
  assert.ok(result.content.includes('HEAD'));
  assert.ok(result.content.includes('TAIL'));
  assert.ok(result.content.includes('[TRUNCATED:'));
  assert.ok(result.tokensRemoved > 0);
  const head70 = result.content.split('[TRUNCATED:')[0];
  assert.ok(countTokensApprox(head70) >= countTokensApprox(result.content) * 0.6);
});

test('buildProvenanceHeader — includes Source, Fetched, Revision when present', () => {
  const header = buildProvenanceHeader({
    docName: 'Test Doc',
    fetchedAt: '2026-04-30T09:04:00Z',
    revisionId: '7',
    isStale: false,
  });
  assert.match(header, /^--- Document: Test Doc/m);
  assert.match(header, /Source: Google Drive/);
  assert.match(header, /Fetched: 2026-04-30T09:04:00Z/);
  assert.match(header, /Revision: 7/);
  assert.doesNotMatch(header, /Warning:/);
});

test('buildProvenanceHeader — omits Revision line when revisionId is null', () => {
  const header = buildProvenanceHeader({
    docName: 'No Rev Doc',
    fetchedAt: '2026-04-30T09:04:00Z',
    revisionId: null,
    isStale: false,
  });
  assert.doesNotMatch(header, /Revision:/);
});

test('buildProvenanceHeader — adds Warning line on stale cache', () => {
  const header = buildProvenanceHeader({
    docName: 'Stale Doc',
    fetchedAt: '2026-04-29T09:00:00Z',
    revisionId: '5',
    isStale: true,
  });
  assert.match(header, /Warning: content is from cache \(2026-04-29T09:00:00Z\); last fetch failed/);
});
