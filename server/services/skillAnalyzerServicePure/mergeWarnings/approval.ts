import type { ProposedMerge, MergeWarning, MergeWarningCode, WarningTier } from './types.js';
import type { ApprovalBlockingReason, ApprovalState, WarningResolution, WarningResolutionKind, RequiredResolution } from './resolutions.js';
import { RESOLUTIONS_FOR_CODE } from './resolutions.js';
import { DEFAULT_WARNING_TIER_MAP } from './defaults.js';
import { sortWarningsBySeverity } from './sort.js';

/** Strip a common pluralisation / word-form suffix so "headlines" matches
 *  "headline" and "chars" matches "characters". Intentionally conservative —
 *  we want false negatives over false positives. */
function stemToken(token: string): string {
  let t = token;
  if (t.length > 4 && t.endsWith('s')) t = t.slice(0, -1); // plural
  // Normalise common word-form pairs seen in skill specs: characters↔chars,
  // seconds↔secs, minutes↔mins. The full words and short forms both collapse
  // to the shared prefix.
  if (t.startsWith('character')) t = 'char';
  else if (t.startsWith('second')) t = 'sec';
  else if (t.startsWith('minute')) t = 'min';
  return t;
}

/** Tokenise a snake_case field name into a set of informative tokens. */
function fieldNameTokens(name: string): Set<string> {
  const out = new Set<string>();
  for (const raw of name.toLowerCase().split(/[_\s-]+/)) {
    if (raw.length < 2) continue;
    out.add(stemToken(raw));
  }
  return out;
}

/** Parse demoted field list out of a REQUIRED_FIELD_DEMOTED warning's detail.
 *  Accepts both the legacy comma-delimited string and the structured JSON form. */
export function parseDemotedFields(detail: string | undefined): string[] {
  if (!detail) return [];
  const trimmed = detail.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed?.demotedFields)) return parsed.demotedFields.filter((f: unknown) => typeof f === 'string');
    } catch {
      // fall through to legacy split
    }
  }
  return trimmed.split(/\s*,\s*/).filter(Boolean);
}

/** Status for a demoted required field. v6 Fix 3 distinguishes:
 *   - `made_optional`: field still exists in merged properties, just not required
 *   - `replaced_by`: field was replaced by a similarly-named property
 *   - `removed_entirely`: field is gone from the merged schema */
export type DemotedFieldStatus =
  | { status: 'made_optional' }
  | { status: 'replaced_by'; replacement: string }
  | { status: 'removed_entirely' };

/** Parse the per-field status map out of a REQUIRED_FIELD_DEMOTED detail.
 *  Returns an empty map for legacy details (pre-v6) so callers fall back to
 *  the plain demoted-field list. */
export function parseDemotedFieldStatuses(
  detail: string | undefined,
): Record<string, DemotedFieldStatus> {
  if (!detail) return {};
  const trimmed = detail.trim();
  if (!trimmed.startsWith('{')) return {};
  try {
    const parsed = JSON.parse(trimmed) as { fieldStatus?: Record<string, DemotedFieldStatus> };
    const map = parsed?.fieldStatus;
    if (!map || typeof map !== 'object') return {};
    const out: Record<string, DemotedFieldStatus> = {};
    for (const [field, s] of Object.entries(map)) {
      if (!s || typeof s !== 'object') continue;
      if (s.status === 'made_optional' || s.status === 'removed_entirely') {
        out[field] = { status: s.status };
      } else if (s.status === 'replaced_by' && typeof s.replacement === 'string') {
        out[field] = { status: 'replaced_by', replacement: s.replacement };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Classify each demoted required field based on whether it still exists in
 *  the merged properties, was replaced by a similarly-named field, or was
 *  removed entirely. Used to build the REQUIRED_FIELD_DEMOTED warning detail.
 *
 *  The replacement heuristic tokenises the field name on `_` / `-` / spaces,
 *  stems each token, and scores each candidate property by the size of the
 *  shared informative-token set. Requires ≥ 2 shared tokens OR a single
 *  shared token paired with a pluralisation/suffix signal to guard against
 *  spurious matches (e.g. "user_name" matching "user_agent"). */
export function classifyDemotedFields(
  demotedFields: string[],
  mergedDefinition: object | null,
): Record<string, DemotedFieldStatus> {
  const out: Record<string, DemotedFieldStatus> = {};
  const properties =
    (mergedDefinition as Record<string, unknown> | null)?.input_schema &&
    (((mergedDefinition as Record<string, Record<string, unknown>>).input_schema as Record<string, unknown>).properties as Record<string, unknown> | undefined);
  const propertyNames = properties && typeof properties === 'object' ? Object.keys(properties) : [];
  const propertyNameSet = new Set(propertyNames);

  for (const field of demotedFields) {
    if (propertyNameSet.has(field)) {
      out[field] = { status: 'made_optional' };
      continue;
    }

    const fieldTokens = fieldNameTokens(field);
    if (fieldTokens.size === 0) {
      out[field] = { status: 'removed_entirely' };
      continue;
    }
    // Pluralisation / suffix family signals. Two fields from the same family
    // (e.g. competitor_name → competitor_urls) are treated as likely-related
    // even if the shared-token set is small.
    const fieldFamily = field.replace(/(_urls?|_names?|s)$/i, '');

    let best: { name: string; shared: number; sameFamily: boolean } | null = null;
    for (const p of propertyNames) {
      if (p === field) continue;
      const propTokens = fieldNameTokens(p);
      let shared = 0;
      for (const t of fieldTokens) if (propTokens.has(t)) shared++;
      const pFamily = p.replace(/(_urls?|_names?|s)$/i, '');
      const sameFamily = fieldFamily.length >= 3 && fieldFamily === pFamily;
      const qualifies = shared >= 2 || (shared >= 1 && sameFamily);
      if (!qualifies) continue;
      // Prefer higher shared count, then same-family, then shorter name.
      const score = shared * 10 + (sameFamily ? 5 : 0) - p.length * 0.01;
      const bestScore = best ? best.shared * 10 + (best.sameFamily ? 5 : 0) - best.name.length * 0.01 : -Infinity;
      if (score > bestScore) best = { name: p, shared, sameFamily };
    }

    if (best) {
      out[field] = { status: 'replaced_by', replacement: best.name };
    } else {
      out[field] = { status: 'removed_entirely' };
    }
  }
  return out;
}

/** v6 Fix 4 — adjust the LLM-reported classifier confidence with structural
 *  signals so the UI differentiates high-quality merges from borderline ones.
 *
 *  The LLM tends to cluster on a small number of confidence values (observed
 *  11/14 partial overlaps at exactly 0.85 on the marketingskills batch).
 *  Validation produces richer signals than the classifier sees — required
 *  fields demoted, scope expansion, forks, self-referencing Related Skills
 *  sections — so we apply per-signal deductions on top of the LLM's score.
 *
 *  Deductions are additive, capped per code, floored at 0.20. The goal is
 *  differentiation, not re-ranking: clean merges stay near their original
 *  score; structurally weaker merges drop proportional to their issues. */
export function adjustClassifierConfidence(
  llmConfidence: number,
  warnings: MergeWarning[],
  opts: {
    mergedInstructions: string | null;
    mergedName: string;
    candidateSlug: string;
    librarySlug: string;
  },
): number {
  if (!Number.isFinite(llmConfidence)) return 0.5;
  // No-op for rows that have nothing to adjust. Prevents the 0.20 floor from
  // clamping low-confidence DISTINCT/DUPLICATE rows that carry no warnings
  // and no merge. Deliberate behaviour change vs. applying the floor blindly.
  if (warnings.length === 0 && !opts.mergedInstructions) return llmConfidence;

  let score = llmConfidence;

  // Required field demotions — weighted by per-field status from Fix 3 so
  // "made optional" counts softer than "removed entirely". Reads fieldStatus
  // out of the warning's detail JSON; falls back to -0.05/field for legacy
  // details that only carry a demotedFields list.
  const reqWarning = warnings.find(w => w.code === 'REQUIRED_FIELD_DEMOTED');
  if (reqWarning) {
    const fields = parseDemotedFields(reqWarning.detail);
    const statuses = parseDemotedFieldStatuses(reqWarning.detail);
    let deduction = 0;
    for (const field of fields) {
      const s = statuses[field];
      if (!s) { deduction += 0.05; continue; } // legacy detail
      if (s.status === 'removed_entirely') deduction += 0.05;
      else if (s.status === 'replaced_by')  deduction += 0.03;
      else if (s.status === 'made_optional') deduction += 0.01;
    }
    score -= Math.min(0.15, deduction);
  }

  // Name change: -0.03 when the incoming renamed the skill.
  if (warnings.some(w => w.code === 'NAME_MISMATCH')) score -= 0.03;

  // Source fork: -0.05. NOTE: SOURCE_FORK warnings are emitted in Stage 5c
  // (batch-level, after per-candidate Stage 5 finishes). This per-candidate
  // call of adjustClassifierConfidence runs before Stage 5c, so this branch
  // only fires when a SOURCE_FORK warning has been attached via the
  // post-batch confidence re-adjustment pass (see skillAnalyzerJob.ts
  // finaliseForkConfidences).
  if (warnings.some(w => w.code === 'SOURCE_FORK')) score -= 0.05;

  // Critical scope expansion: -0.05 on top of NAME_MISMATCH / table checks.
  if (warnings.some(w => w.code === 'SCOPE_EXPANSION_CRITICAL')) score -= 0.05;

  // Genuine table drops (not restructured): -0.02 per code, capped at -0.08.
  // Restructured tables have `"restructured": true` in the JSON detail — Fix 1
  // downgrades those to informational-ish, so they don't contribute here.
  const tableDropCount = warnings.filter(w => {
    if (w.code !== 'TABLE_ROWS_DROPPED') return false;
    if (!w.detail) return true;
    try {
      const parsed = JSON.parse(w.detail) as { restructured?: boolean };
      return parsed?.restructured !== true;
    } catch {
      return true;
    }
  }).length;
  score -= Math.min(0.08, tableDropCount * 0.02);

  // Self-reference: merged instructions reference the incoming skill's own
  // slug inside a Related Skills section — signal that the incoming was
  // designed to live alongside the library skill, not replace it. Uses a
  // word-boundary regex to avoid false positives on short slugs (e.g. "ads"
  // matching inside "Google Ads"), gated by a ≥5-char minimum to keep the
  // match distinctive.
  if (opts.mergedInstructions) {
    const relIdx = opts.mergedInstructions.search(/^##\s+related\s+skills\b/im);
    if (relIdx !== -1) {
      const relatedSection = opts.mergedInstructions.slice(relIdx);
      const slug = opts.candidateSlug.toLowerCase();
      if (slug.length >= 5) {
        const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hyphenated = slug.replace(/_/g, '-');
        const escapedHyphen = hyphenated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b(${escaped}|${escapedHyphen})\\b`, 'i');
        if (re.test(relatedSection)) score -= 0.10;
      }
    }
  }

  if (!Number.isFinite(score)) return 0.2;
  return Math.max(0.20, Math.min(1.0, score));
}

/** Return true if a resolution satisfies a given warning/field pair. */
function isResolvedBy(
  code: MergeWarningCode,
  field: string | undefined,
  resolutions: WarningResolution[],
): boolean {
  const allowed = RESOLUTIONS_FOR_CODE[code] ?? [];
  return resolutions.some(r =>
    r.warningCode === code
    && (allowed.length === 0 || allowed.includes(r.resolution))
    && (field === undefined || r.details?.field === field));
}

/**
 * Canonical approval-gate evaluator. Server is authoritative; client imports
 * this for optimistic preview only. Covers all v2 fix-cycle tiers.
 *
 * - `informational`: never blocks.
 * - `standard`:      blocks unless an `acknowledge_warning` resolution exists.
 * - `decision_required`:
 *     - REQUIRED_FIELD_DEMOTED: per-field `accept_removal` or `restore_required`.
 *     - Otherwise: any allowed resolution for the code.
 * - `critical`: blocks unless `confirm_critical_phrase` resolution exists
 *     (or scope-expansion is already within threshold — the validator just
 *     won't re-emit the warning in that case).
 */
export function evaluateApprovalState(
  warnings: MergeWarning[] | null | undefined,
  resolutions: WarningResolution[] | null | undefined,
  tierMap: Record<string, WarningTier> = DEFAULT_WARNING_TIER_MAP,
): ApprovalState {
  const reasons: ApprovalBlockingReason[] = [];
  const required: RequiredResolution[] = [];
  const safeWarnings = warnings ?? [];
  const safeResolutions = resolutions ?? [];

  for (const w of safeWarnings) {
    const tier = (tierMap[w.code] ?? DEFAULT_WARNING_TIER_MAP[w.code]) ?? 'informational';
    if (tier === 'informational') continue;

    // Per-field decision gate for REQUIRED_FIELD_DEMOTED.
    if (w.code === 'REQUIRED_FIELD_DEMOTED') {
      const fields = parseDemotedFields(w.detail);
      for (const field of fields) {
        if (!isResolvedBy('REQUIRED_FIELD_DEMOTED', field, safeResolutions)) {
          reasons.push({
            warningCode: w.code,
            tier,
            message: `Field "${field}" — choose Accept removal or Restore required.`,
            field,
          });
          required.push({
            warningCode: w.code,
            allowedResolutions: RESOLUTIONS_FOR_CODE.REQUIRED_FIELD_DEMOTED,
            field,
          });
        }
      }
      continue;
    }

    // Generic gate: code must be resolved at least once.
    if (!isResolvedBy(w.code, undefined, safeResolutions)) {
      reasons.push({
        warningCode: w.code,
        tier,
        message: w.message,
      });
      required.push({
        warningCode: w.code,
        allowedResolutions: RESOLUTIONS_FOR_CODE[w.code] ?? ['acknowledge_warning'],
      });
    }
  }

  return {
    blocked: reasons.length > 0,
    reasons,
    requiredResolutions: required,
  };
}
