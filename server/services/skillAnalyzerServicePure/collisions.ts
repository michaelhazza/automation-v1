// ---------------------------------------------------------------------------
// Skill graph collision detection — v2 Fix 3
// ---------------------------------------------------------------------------

import type { ProposedMerge } from './mergeWarnings/types.js';
import { extractDescriptionBigrams, isGenericBigram, wordOverlapRatio } from './textExtraction.js';
import { splitH2Sections } from './ruleBasedMerge.js';

export interface SkillGraphCollisionCheckInput {
  merged: ProposedMerge;
  libraryCatalog: ReadonlyArray<{ id: string | null; slug: string; name: string; instructions: string | null }>;
  sessionApprovedSlugs?: ReadonlySet<string>;      // other approved results in same session
  excludedId: string | null;                        // the matched-against skill (not a collision)
  /** Minimum fragment-overlap ratio to surface the warning. Default 0.40. */
  threshold?: number;
  /** Max number of top-K candidate skills to fragment-compare against. */
  maxCandidates?: number;
  /** Hard cap on fragment-pair comparisons per candidate (budget). */
  maxPairComparisons?: number;
}

export interface SkillGraphCollision {
  collidingSkillId: string | null;
  collidingSlug: string;
  collidingName: string;
  overlapRatio: number;
  overlappingFragments: string[];   // first line of each overlapping fragment
}

function splitCapabilityFragments(text: string | null): Array<{ heading: string; body: string }> {
  if (!text) return [];
  return splitH2Sections(text);
}

/**
 * Compare merged skill against the library catalog + session-approved set
 * to detect capability-fragment overlap. Pragmatic bigram-based implementation
 * that respects the §11.5 performance caps (top-K + budget).
 */
export function detectSkillGraphCollision(input: SkillGraphCollisionCheckInput): SkillGraphCollision[] {
  const threshold = input.threshold ?? 0.40;
  const maxCandidates = input.maxCandidates ?? 20;
  const maxPairs = input.maxPairComparisons ?? 200;
  const sessionApproved = input.sessionApprovedSlugs ?? new Set<string>();

  const mergedFragments = splitCapabilityFragments(input.merged.instructions);
  if (mergedFragments.length === 0) return [];

  // Pre-filter: skip the matched-against skill, skip anything with no bigram
  // overlap at all (cheap keyword check), rank by overall description + name
  // bigram overlap.
  const mergedDescBigrams = extractDescriptionBigrams(input.merged.description);
  type Scored = { skill: (typeof input.libraryCatalog)[number]; preScore: number };
  const preScored: Scored[] = [];
  for (const skill of input.libraryCatalog) {
    if (skill.id !== null && skill.id === input.excludedId) continue;
    // Allow session-approved slugs to flow through as additional collision
    // targets even if their id is null (synthesised from the job's approved set).
    const isSession = sessionApproved.has(skill.slug);
    if (!isSession && skill.id === null) continue;

    const otherBigrams = extractDescriptionBigrams(
      `${skill.name} ${skill.instructions?.slice(0, 2000) ?? ''}`,
    );
    let preScore = 0;
    for (const bg of mergedDescBigrams) if (otherBigrams.has(bg) && !isGenericBigram(bg)) preScore++;
    if (preScore === 0) continue;
    preScored.push({ skill, preScore });
  }

  preScored.sort((a, b) => b.preScore - a.preScore);
  const top = preScored.slice(0, maxCandidates);

  const collisions: SkillGraphCollision[] = [];
  let pairBudget = maxPairs;
  for (const { skill } of top) {
    const otherFragments = splitCapabilityFragments(skill.instructions ?? '');
    if (otherFragments.length === 0) continue;

    // Count overlapping fragment pairs by bigram ratio.
    const overlapping: string[] = [];
    let pairs = 0;
    outer: for (const mf of mergedFragments) {
      if (pairBudget <= 0) break;
      const mfBigrams = extractDescriptionBigrams(mf.body);
      for (const of of otherFragments) {
        if (pairBudget-- <= 0) break outer;
        pairs++;
        const ofBigrams = extractDescriptionBigrams(of.body);
        const denom = Math.min(mfBigrams.size, ofBigrams.size);
        if (denom < 3) continue;
        let shared = 0;
        for (const bg of mfBigrams) if (ofBigrams.has(bg) && !isGenericBigram(bg)) shared++;
        const ratio = shared / denom;
        if (ratio >= threshold) {
          overlapping.push(mf.heading || '(unnamed fragment)');
          break;
        }
      }
    }

    if (overlapping.length === 0) continue;
    const overlapRatio = overlapping.length / Math.max(1, mergedFragments.length);
    if (overlapRatio < threshold / 2) continue;  // require at least half-threshold

    collisions.push({
      collidingSkillId: skill.id,
      collidingSlug: skill.slug,
      collidingName: skill.name,
      overlapRatio,
      overlappingFragments: overlapping,
    });
  }

  return collisions;
}

// ---------------------------------------------------------------------------
// Fix 8 — content overlap detection across in-batch merges (v4 brief)
// ---------------------------------------------------------------------------

/** Extract H3+ section headings and their content from instructions. */
function extractH3Sections(text: string | null): Array<{ heading: string; body: string }> {
  if (!text) return [];
  const lines = text.split('\n');
  const sections: Array<{ heading: string; body: string }> = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    const h = line.match(/^#{3,}\s+(.+?)\s*$/);
    if (h) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
      current = { heading: h[1].toLowerCase().trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
  return sections;
}

export interface ContentOverlapResult {
  candidateSlugA: string;
  candidateSlugB: string;
  overlappingHeading: string;
  similarityPct: number;
}

/** Detect when two in-batch merged skills share an H3+ section heading with
 *  similar content (> `threshold` word-overlap ratio). Returns findings for
 *  all pairs above the threshold. */
export function detectContentOverlap(
  skills: ReadonlyArray<{ slug: string; instructions: string | null }>,
  threshold = 0.70,
): ContentOverlapResult[] {
  const results: ContentOverlapResult[] = [];
  for (let i = 0; i < skills.length; i++) {
    const sectionsA = extractH3Sections(skills[i].instructions);
    for (let j = i + 1; j < skills.length; j++) {
      const sectionsB = extractH3Sections(skills[j].instructions);
      for (const sa of sectionsA) {
        const sb = sectionsB.find(s => s.heading === sa.heading);
        if (!sb || !sa.body || !sb.body) continue;
        const ratio = wordOverlapRatio(sa.body, sb.body);
        if (ratio >= threshold) {
          results.push({
            candidateSlugA: skills[i].slug,
            candidateSlugB: skills[j].slug,
            overlappingHeading: sa.heading,
            similarityPct: Math.round(ratio * 100),
          });
        }
      }
    }
  }
  return results;
}
