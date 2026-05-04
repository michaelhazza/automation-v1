import { test, expect } from 'vitest';
import {
  BASELINE_SLUGS,
  TIER_BY_SLUG,
  APPLIES_TO_DOMAINS_BY_SLUG,
  WORKSPACE_MEMORY_TOPIC_BY_SLUG,
  isBaselineSlug,
  tierFor,
} from '../baselineArtefacts.js';

test('all 6 slugs appear in BASELINE_SLUGS exactly once', () => {
  const unique = new Set(BASELINE_SLUGS);
  expect(unique.size).toBe(6);
  expect(BASELINE_SLUGS.length).toBe(6);
});

test('TIER_BY_SLUG maps every slug; exactly 2 tier-1, 2 tier-2, 2 tier-3', () => {
  const tiers = BASELINE_SLUGS.map((s) => TIER_BY_SLUG[s]);
  expect(tiers.filter((t) => t === 1)).toHaveLength(2);
  expect(tiers.filter((t) => t === 2)).toHaveLength(2);
  expect(tiers.filter((t) => t === 3)).toHaveLength(2);
});

test('Tier-1 slugs have NO entry in APPLIES_TO_DOMAINS_BY_SLUG', () => {
  const tier1Slugs = BASELINE_SLUGS.filter((s) => TIER_BY_SLUG[s] === 1);
  for (const slug of tier1Slugs) {
    expect(APPLIES_TO_DOMAINS_BY_SLUG[slug]).toBeUndefined();
  }
});

test('Tier-2 slugs each have between 3-4 domain identifiers', () => {
  const tier2Slugs = BASELINE_SLUGS.filter((s) => TIER_BY_SLUG[s] === 2);
  for (const slug of tier2Slugs) {
    const domains = APPLIES_TO_DOMAINS_BY_SLUG[slug];
    expect(domains).toBeDefined();
    expect(domains!.length).toBeGreaterThanOrEqual(3);
    expect(domains!.length).toBeLessThanOrEqual(4);
  }
});

test('Tier-3 slugs each have an entry in WORKSPACE_MEMORY_TOPIC_BY_SLUG', () => {
  const tier3Slugs = BASELINE_SLUGS.filter((s) => TIER_BY_SLUG[s] === 3);
  for (const slug of tier3Slugs) {
    expect(WORKSPACE_MEMORY_TOPIC_BY_SLUG[slug]).toBeDefined();
  }
});

test('isBaselineSlug returns false for unknown slug', () => {
  expect(isBaselineSlug('baseline.unknown')).toBe(false);
});

test('isBaselineSlug returns true for known slug', () => {
  expect(isBaselineSlug('baseline.brand_identity')).toBe(true);
});

test('tierFor brand_identity === 1', () => {
  expect(tierFor('baseline.brand_identity')).toBe(1);
});

test('tierFor audience_icp === 2', () => {
  expect(tierFor('baseline.audience_icp')).toBe(2);
});

test('tierFor proof_library === 3', () => {
  expect(tierFor('baseline.proof_library')).toBe(3);
});
