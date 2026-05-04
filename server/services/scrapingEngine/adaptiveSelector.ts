/**
 * adaptiveSelector — self-healing element matching engine.
 *
 * When a page's CSS selector fails (site redesigned), this engine
 * fingerprints elements and relocates them using weighted multi-feature
 * similarity scoring. No LLM calls, no network — pure string/set comparisons.
 *
 * Uses native DOM APIs (jsdom Document/Element) — no cheerio dependency.
 *
 * Algorithm: O(n) scan over all page elements. Pre-filtered by tagName for
 * pages with >5000 elements. Typical pages (1000–5000 elements) complete
 * in under 10ms.
 *
 * Thresholds:
 *   >= 0.85 → confident match
 *   0.6–0.85 → selector_uncertain (agent may ask for human confirmation)
 *   < 0.6   → no match found
 */

import { createHash } from 'crypto';
import type { ElementFingerprint } from '../../db/schema/scrapingSelectors.js';

export type { ElementFingerprint };

export interface AdaptiveScanResult {
  found: boolean;
  score: number;
  cssSelector: string | null;
  fingerprint: ElementFingerprint | null;
  uncertain: boolean;  // true when 0.6 <= score < 0.85
}

export const CONFIDENT_THRESHOLD = 0.85;
export const UNCERTAIN_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Fingerprint extraction — derives a DOM fingerprint from a DOM Element
// ---------------------------------------------------------------------------

export function computeTextHash(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex');
}

/**
 * Build an ElementFingerprint from a standard DOM Element.
 */
export function buildFingerprint(el: Element): ElementFingerprint {
  const tagName = el.tagName.toLowerCase();
  const id = el.id || null;
  const classAttr = el.getAttribute('class') ?? '';
  const classList = classAttr.split(/\s+/).filter(Boolean);

  // Collect attributes (excluding class, id, style for noise reduction)
  const attributes: Record<string, string> = {};
  const SKIP_ATTRS = new Set(['class', 'id', 'style']);
  for (const attr of Array.from(el.attributes)) {
    if (!SKIP_ATTRS.has(attr.name)) attributes[attr.name] = attr.value;
  }

  const textContent = (el.textContent ?? '').trim();
  const textContentHash = computeTextHash(textContent);
  const textPreview = textContent.slice(0, 100);

  // DOM path — ancestor chain from root to parent
  const domPath: string[] = [];
  let ancestor = el.parentElement;
  while (ancestor !== null && ancestor.tagName) {
    const aTag = ancestor.tagName.toLowerCase();
    const aClassAttr = ancestor.getAttribute('class') ?? '';
    const aClass = aClassAttr.split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    domPath.unshift(aClass ? `${aTag}.${aClass}` : aTag);
    ancestor = ancestor.parentElement;
  }

  // Parent descriptor
  const parentEl = el.parentElement;
  let parentTag = '';
  if (parentEl?.tagName) {
    const ptag = parentEl.tagName.toLowerCase();
    const pclassAttr = parentEl.getAttribute('class') ?? '';
    const pclass = pclassAttr.split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    parentTag = pclass ? `${ptag}.${pclass}` : ptag;
  }

  // Sibling tags (from parent's children, excluding self)
  const siblingTags = parentEl
    ? [...new Set(
        Array.from(parentEl.children)
          .filter(s => s !== el && s.tagName)
          .map(s => s.tagName.toLowerCase())
      )]
    : [];

  // Child tags
  const childTags = [...new Set(
    Array.from(el.children)
      .filter(c => c.tagName)
      .map(c => c.tagName.toLowerCase())
  )];

  // Position (nth-of-type among same-tag siblings)
  const sameSiblings = parentEl
    ? Array.from(parentEl.children).filter(s => s.tagName?.toLowerCase() === tagName)
    : [el];
  const indexAmongSameTag = sameSiblings.indexOf(el);
  const total = sameSiblings.length;

  return {
    tagName,
    id,
    classList,
    attributes,
    textContentHash,
    textPreview,
    domPath,
    parentTag,
    siblingTags,
    childTags,
    position: { index: indexAmongSameTag >= 0 ? indexAmongSameTag : 0, total: total || 1 },
  };
}

/**
 * Generate a stable CSS selector for a DOM Element.
 * Prefers id-based selector, then class-based, then nth-of-type.
 * `depth` guards against unbounded recursion on deeply-nested elements
 * without id/class ancestors (cap at 15 levels).
 */
export function buildCssSelector(el: Element, depth = 0): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) {
    const safeId = el.id.replace(/([^\w-])/g, '\\$1');
    return `${tag}#${safeId}`;
  }

  const classAttr = el.getAttribute('class') ?? '';
  const classes = classAttr.split(/\s+/).filter(Boolean).slice(0, 3);
  if (classes.length > 0) {
    return `${tag}.${classes.join('.')}`;
  }

  // Fallback: tag + nth-of-type (recurse into parent, depth-capped)
  const parent = el.parentElement;
  const idx = parent
    ? Array.from(parent.children).filter(s => s.tagName?.toLowerCase() === tag).indexOf(el) + 1
    : 1;
  if (!parent?.tagName || depth >= 15) {
    return `${tag}:nth-of-type(${idx})`;
  }
  const parentSel = buildCssSelector(parent, depth + 1);
  return `${parentSel} > ${tag}:nth-of-type(${idx})`;
}

// ---------------------------------------------------------------------------
// Similarity scoring
// ---------------------------------------------------------------------------

const WEIGHTS = {
  tagName:    0.15,
  id:         0.10,
  classList:  0.15,
  attributes: 0.10,
  textSim:    0.15,
  domPath:    0.15,
  parentTag:  0.10,
  siblings:   0.05,
  children:   0.05,
};

function jaccardSets(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1.0 : intersection / union;
}

function longestCommonSubsequenceRatio(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  return dp[a.length][b.length] / Math.max(a.length, b.length);
}

function tokenJaccard(a: string, b: string): number {
  const tokA = a.toLowerCase().split(/\W+/).filter(Boolean);
  const tokB = b.toLowerCase().split(/\W+/).filter(Boolean);
  return jaccardSets(tokA, tokB);
}

function attributeOverlapRatio(a: Record<string, string>, b: Record<string, string>): number {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length === 0 && bKeys.length === 0) return 1.0;
  const allKeys = new Set([...aKeys, ...bKeys]);
  if (allKeys.size === 0) return 1.0;
  let matches = 0;
  for (const k of allKeys) {
    if (a[k] !== undefined && b[k] !== undefined && a[k] === b[k]) matches++;
  }
  return matches / allKeys.size;
}

/**
 * Score how similar a candidate element fingerprint is to a stored reference fingerprint.
 * Returns a value from 0.0 (no match) to 1.0 (identical).
 */
export function scoreSimilarity(
  stored: ElementFingerprint,
  candidate: ElementFingerprint,
): number {
  const tagScore = stored.tagName === candidate.tagName ? 1.0 : 0.0;

  let idScore = 1.0;
  if (stored.id !== null || candidate.id !== null) {
    idScore = stored.id === candidate.id ? 1.0 : 0.0;
  }

  const classScore = jaccardSets(stored.classList, candidate.classList);
  const attrScore = attributeOverlapRatio(stored.attributes, candidate.attributes);

  // Text similarity — use token jaccard on previews (hashes are too strict after minor edits)
  const textScore = tokenJaccard(stored.textPreview, candidate.textPreview);

  const pathScore = longestCommonSubsequenceRatio(stored.domPath, candidate.domPath);

  const parentScore = (stored.parentTag === '' && candidate.parentTag === '')
    ? 1.0
    : (stored.parentTag === candidate.parentTag ? 1.0 : 0.0);

  const sibScore = jaccardSets(stored.siblingTags, candidate.siblingTags);
  const childScore = jaccardSets(stored.childTags, candidate.childTags);

  return (
    WEIGHTS.tagName    * tagScore +
    WEIGHTS.id         * idScore +
    WEIGHTS.classList  * classScore +
    WEIGHTS.attributes * attrScore +
    WEIGHTS.textSim    * textScore +
    WEIGHTS.domPath    * pathScore +
    WEIGHTS.parentTag  * parentScore +
    WEIGHTS.siblings   * sibScore +
    WEIGHTS.children   * childScore
  );
}

// ---------------------------------------------------------------------------
// Adaptive scan
// ---------------------------------------------------------------------------

/**
 * Given a stored fingerprint, scan all elements in the document and return the
 * best-matching element along with its similarity score.
 *
 * Pre-filters by tagName when the page has >5000 elements to keep O(n) fast.
 */
export function adaptiveScan(
  document: Document,
  stored: ElementFingerprint,
): AdaptiveScanResult {
  const allElements = Array.from(document.querySelectorAll('*'));
  const LARGE_PAGE_THRESHOLD = 5_000;

  // Pre-filter by tagName for large pages
  const candidates = allElements.length > LARGE_PAGE_THRESHOLD
    ? allElements.filter(el => el.tagName.toLowerCase() === stored.tagName)
    : allElements;

  if (candidates.length === 0) {
    return { found: false, score: 0, cssSelector: null, fingerprint: null, uncertain: false };
  }

  let bestScore = 0;
  let bestEl: Element | null = null;

  for (const node of candidates) {
    const fp = buildFingerprint(node);
    const score = scoreSimilarity(stored, fp);
    if (score > bestScore) {
      bestScore = score;
      bestEl = node;
    }
  }

  if (bestScore < UNCERTAIN_THRESHOLD || bestEl === null) {
    return { found: false, score: bestScore, cssSelector: null, fingerprint: null, uncertain: false };
  }

  const fingerprint = buildFingerprint(bestEl);
  const cssSelector = buildCssSelector(bestEl);
  const uncertain = bestScore < CONFIDENT_THRESHOLD;

  return { found: true, score: bestScore, cssSelector, fingerprint, uncertain };
}

/**
 * Try the original CSS selector first; fall back to adaptive scan if needed.
 *
 * Returns:
 *   - `adaptiveMatchUsed: false` when the original selector matched and had
 *     high confidence (≥ 0.85)
 *   - `adaptiveMatchUsed: true` when the selector was relocated via scanning
 *   - `found: false` when nothing matched above threshold
 */
export function resolveSelector(
  document: Document,
  cssSelector: string,
  storedFingerprint: ElementFingerprint,
): {
  found: boolean;
  score: number;
  cssSelector: string | null;
  fingerprint: ElementFingerprint | null;
  uncertain: boolean;
  adaptiveMatchUsed: boolean;
} {
  // Try original selector first
  let direct: Element | null = null;
  try {
    direct = document.querySelector(cssSelector);
  } catch {
    // Invalid selector — skip to adaptive scan
  }

  if (direct !== null) {
    const directFp = buildFingerprint(direct);
    const directScore = scoreSimilarity(storedFingerprint, directFp);
    if (directScore >= CONFIDENT_THRESHOLD) {
      return {
        found: true,
        score: directScore,
        cssSelector,
        fingerprint: directFp,
        uncertain: false,
        adaptiveMatchUsed: false,
      };
    }
    // Selector matched but fingerprint drifted — fall through to adaptive scan
  }

  // Adaptive scan
  const scanResult = adaptiveScan(document, storedFingerprint);
  return {
    ...scanResult,
    adaptiveMatchUsed: true,
  };
}
