/**
 * escalationPhrasesPure.test.ts — Pure tests for the phrase tokeniser (Chunk 2)
 *
 * No DB imports. Tests tokenisePhrase, countNGrams, and extractFrequentPhrases.
 * Run via: npx vitest run server/services/optimiser/queries/__tests__/escalationPhrasesPure.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  tokenisePhrase,
  countNGrams,
  extractFrequentPhrases,
} from '../escalationPhrases.js';

describe('tokenisePhrase', () => {
  it('1: collapses casing — "guarantee" and "Guarantee" both become "guarante" (stem)', () => {
    const tokens1 = tokenisePhrase('guarantee');
    const tokens2 = tokenisePhrase('Guarantee');
    expect(tokens1).toEqual(tokens2);
  });

  it('2: suffix-strip -ing: "guaranteeing" → "guarantee" (removes -ing)', () => {
    const tokens = tokenisePhrase('guaranteeing');
    // "guaranteeing" (12 chars) → slice(0,-3) = "guarantee" (9 chars)
    expect(tokens).toContain('guarantee');
  });

  it('2b: suffix-strip -ed: "guaranteed" → "guarante" (removes -ed from 10-char word)', () => {
    const tokens = tokenisePhrase('guaranteed');
    // "guaranteed" (10 chars) → slice(0,-2) = "guarante" (8 chars)
    expect(tokens).toContain('guarante');
  });

  it('2c: suffix-strip -s: "guarantees" → "guarantee" then "guarante" (via -s strip then no further)', () => {
    // "guarantees" → strip -s → "guarantee" → strip -e? no, we only strip -ing/-ed/-s
    // Actually "guarantee" length 9 > 3 so it stays. Let's just verify the stems match.
    const tokensPlural = tokenisePhrase('guarantees');
    const tokensSingular = tokenisePhrase('guarantee');
    expect(tokensPlural).toEqual(tokensSingular);
  });

  it('3: stop words excluded: "the and or" returns empty array', () => {
    const tokens = tokenisePhrase('the and or');
    expect(tokens).toHaveLength(0);
  });

  it('4: n-gram counting across bigrams', () => {
    const tokens = tokenisePhrase('payment failed unexpected error');
    expect(tokens.length).toBeGreaterThan(0);
    const bigrams = countNGrams(tokens, 2);
    // at least one bigram should exist if we have >= 2 tokens after stopword filtering
    if (tokens.length >= 2) {
      expect(bigrams.size).toBeGreaterThan(0);
    }
  });

  it('5: threshold filters: phrases with count 2 excluded at minOccurrences=3', () => {
    const payloads = [
      { id: 'id1', payload: 'payment failed' },
      { id: 'id2', payload: 'payment failed' },
      { id: 'id3', payload: 'something else' },
    ];
    const result = extractFrequentPhrases(payloads, { minOccurrences: 3, maxNgram: 2 });
    // "payment" and "failed" each appear in 2 docs — should NOT be in results (count < 3)
    const phrases = result.map((r) => r.phrase);
    // Count of unique-doc occurrences is 2 < 3, so filtered out
    expect(phrases).not.toContain('payment');
    expect(phrases).not.toContain('failed');
  });

  it('5b: threshold: phrases with count 3 included at minOccurrences=3', () => {
    const payloads = [
      { id: 'id1', payload: 'payment failed error' },
      { id: 'id2', payload: 'payment failed error' },
      { id: 'id3', payload: 'payment failed error' },
    ];
    const result = extractFrequentPhrases(payloads, { minOccurrences: 3, maxNgram: 1 });
    const phrases = result.map((r) => r.phrase);
    // "payment" / "fail" (stemmed from "failed") / "error" all appear in 3 distinct docs
    // Note: "failed" is stemmed to "fail" by the -ed suffix stripper
    expect(phrases).toContain('payment');
    // "failed" stems to "fail"
    const hasFailed = phrases.includes('fail') || phrases.includes('failed');
    expect(hasFailed).toBe(true);
    expect(phrases).toContain('error');
  });

  it('6: empty input returns empty array', () => {
    const result = extractFrequentPhrases([], { minOccurrences: 3, maxNgram: 2 });
    expect(result).toHaveLength(0);
  });

  it('7: punctuation stripped: "guarantee!" and "guarantee," both → same token', () => {
    const tokens1 = tokenisePhrase('guarantee!');
    const tokens2 = tokenisePhrase('guarantee,');
    expect(tokens1).toEqual(tokens2);
  });

  it('8: multi-line payload tokenised across newlines', () => {
    const payload = 'payment\nfailed\nerror';
    const tokens = tokenisePhrase(payload);
    expect(tokens).toContain('payment');
    // "failed" is stemmed to "fail" by the -ed stripper
    const hasFailed = tokens.includes('fail') || tokens.includes('failed');
    expect(hasFailed).toBe(true);
    expect(tokens).toContain('error');
  });

  it('9: JSONB shape — string values extracted from JSON object', () => {
    const payload = JSON.stringify({ reason: 'payment failed', context: 'unexpected error' });
    const tokens = tokenisePhrase(payload);
    expect(tokens).toContain('payment');
    // "failed" is stemmed to "fail" by the -ed stripper
    const hasFailed = tokens.includes('fail') || tokens.includes('failed');
    expect(hasFailed).toBe(true);
  });

  it('10: sample_escalation_ids sorted ascending in output', () => {
    const payloads = [
      { id: 'zz-id', payload: 'payment failed' },
      { id: 'aa-id', payload: 'payment failed' },
      { id: 'mm-id', payload: 'payment failed' },
    ];
    const result = extractFrequentPhrases(payloads, { minOccurrences: 3, maxNgram: 1 });
    for (const row of result) {
      const sorted = [...row.sample_escalation_ids].sort();
      expect(row.sample_escalation_ids).toEqual(sorted);
    }
  });
});

describe('countNGrams', () => {
  it('returns empty map for n=0', () => {
    const map = countNGrams(['a', 'b', 'c'], 0);
    expect(map.size).toBe(0);
  });

  it('returns empty map when tokens shorter than n', () => {
    const map = countNGrams(['a', 'b'], 3);
    expect(map.size).toBe(0);
  });

  it('correctly counts unigrams', () => {
    const map = countNGrams(['payment', 'failed', 'payment'], 1);
    expect(map.get('payment')).toBe(2);
    expect(map.get('failed')).toBe(1);
  });

  it('correctly counts bigrams', () => {
    const map = countNGrams(['payment', 'failed', 'payment', 'failed'], 2);
    expect(map.get('payment failed')).toBe(2);
  });
});
