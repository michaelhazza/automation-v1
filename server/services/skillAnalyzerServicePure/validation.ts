// ---------------------------------------------------------------------------
// Merge Validation — pure, no DB/env/service imports
// ---------------------------------------------------------------------------

import type { ProposedMerge, MergeWarning, WarningTier } from './mergeWarnings/types.js';
import { DEFAULT_WARNING_TIER_MAP } from './mergeWarnings/defaults.js';
import { sortWarningsBySeverity } from './mergeWarnings/sort.js';
import { classifyDemotedFields } from './mergeWarnings/approval.js';
import {
  extractTables,
  extractTablesWithRows,
  extractDescriptionBigrams,
  isGenericBigram,
  containsHitlGate,
  containsApprovalIntent,
  hasOutputFormatBlock,
  INVOCATION_TRIGGER_RE,
  mergedOutputCoversTableData,
  wordOverlapRatio,
} from './textExtraction.js';

// ---------------------------------------------------------------------------
// Name mismatch detection — Fix 7
// ---------------------------------------------------------------------------

/** Name-mismatch detection (Fix 7).
 *
 * Compares the four locations where a skill name appears:
 *   - top-level merged.name (file-level)
 *   - merged.definition.name (tool schema)
 *   - any name reference inside merged.description
 *   - any name reference inside merged.instructions
 *
 * Returns null if all four are consistent (or fewer than two distinct names
 * appear). Otherwise, returns a structured mismatch object the UI resolution
 * picker consumes.
 */
export interface NameMismatch {
  topLevel: string;
  schemaName: string | null;
  distinctNames: string[];
  candidates: Array<'top_level' | 'schema' | 'description' | 'instructions' | 'incoming_skill'>;
}

export function detectNameMismatch(
  merged: ProposedMerge,
  /** The incoming candidate's original name. When the rule-based merger (or LLM)
   *  adopts the library name as default, the rename would otherwise be silent.
   *  Passing the incoming name here surfaces it as a NAME_MISMATCH so the
   *  reviewer explicitly confirms or overrides the rename (v3 Fix 7). */
  incomingName?: string,
): NameMismatch | null {
  const topLevel = (merged.name ?? '').trim();
  const schemaNameRaw = (merged.definition as Record<string, unknown> | null | undefined)?.name;
  const schemaName = typeof schemaNameRaw === 'string' && schemaNameRaw.trim().length > 0
    ? schemaNameRaw.trim()
    : null;
  if (!topLevel && !schemaName) return null;

  const normalise = (s: string) => s.toLowerCase().replace(/[-_]+/g, '_').trim();
  const candidates = new Set<string>();
  if (topLevel) candidates.add(normalise(topLevel));
  if (schemaName) candidates.add(normalise(schemaName));

  // If the incoming skill had a different name (merger defaulted to library name),
  // surface it as an additional candidate so the reviewer sees and resolves the rename.
  const normIncoming = incomingName ? normalise(incomingName) : null;
  if (normIncoming && topLevel && normIncoming !== normalise(topLevel)) {
    candidates.add(normIncoming);
  }

  // Look for either name used as a bare identifier in description / instructions.
  // Only flag when a DIFFERENT name appears there, not the same one.
  const allBareNames = collectBareNames(merged.description)
    .concat(collectBareNames(merged.instructions))
    .map(normalise);
  for (const n of allBareNames) {
    candidates.add(n);
  }

  if (candidates.size < 2) return null;

  const sources: Array<'top_level' | 'schema' | 'description' | 'instructions' | 'incoming_skill'> = [];
  if (topLevel) sources.push('top_level');
  if (schemaName) sources.push('schema');
  if (merged.description && collectBareNames(merged.description).length > 0) sources.push('description');
  if (merged.instructions && collectBareNames(merged.instructions).length > 0) sources.push('instructions');
  if (normIncoming && topLevel && normIncoming !== normalise(topLevel)) sources.push('incoming_skill');

  return {
    topLevel,
    schemaName,
    distinctNames: [...candidates],
    candidates: sources,
  };
}

/** Collect bare-identifier name-like tokens (lowercase letters / digits /
 *  underscores / hyphens, ≥3 chars) that look like skill slugs or tool names.
 *  Used as a heuristic for detecting stale references inside prose. */
function collectBareNames(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const re = /`([a-z][a-z0-9_-]{2,})`|\b([a-z][a-z0-9_]{3,})\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = (m[1] ?? m[2] ?? '').trim();
    if (token.length >= 3 && /[_-]/.test(token)) {
      out.push(token);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Retention scoring helpers
// ---------------------------------------------------------------------------

export function computeDefinitionRetention(
  base: { definition: object | null },
  merged: ProposedMerge,
): number {
  const baseReq = ((base.definition as Record<string, unknown> | null)?.input_schema as Record<string, unknown> | undefined)?.required;
  const mergedReq = ((merged.definition as Record<string, unknown> | null)?.input_schema as Record<string, unknown> | undefined)?.required;
  const baseArr = Array.isArray(baseReq) ? (baseReq as string[]) : [];
  const mergedArr = Array.isArray(mergedReq) ? (mergedReq as string[]) : [];
  if (baseArr.length === 0) return 1;
  return baseArr.filter(f => mergedArr.includes(f)).length / baseArr.length;
}

export function computeTableRetention(
  sourceLookup: Map<string, number>,
  mergedByHeader: Map<string, number>,
): number {
  if (sourceLookup.size === 0) return 1;
  let total = 0;
  for (const [header, sourceRows] of sourceLookup) {
    const mergedRows = mergedByHeader.get(header) ?? 0;
    total += sourceRows > 0 ? Math.min(1, mergedRows / sourceRows) : 1;
  }
  return total / sourceLookup.size;
}

export function computeSourceRetention(
  base: { definition: object | null; instructions: string | null },
  merged: ProposedMerge,
  sourceLookup: Map<string, number>,
  mergedByHeader: Map<string, number>,
): number {
  const defRet   = computeDefinitionRetention(base, merged);
  const tblRet   = computeTableRetention(sourceLookup, mergedByHeader);
  const instrRet = wordOverlapRatio(base.instructions, merged.instructions);
  return defRet * 0.3 + tblRet * 0.3 + instrRet * 0.4;
}

// ---------------------------------------------------------------------------
// Merge Validation
// ---------------------------------------------------------------------------

/** Word count of skill instructions — used for scope expansion arithmetic only.
 *  Do NOT use for base selection; use richnessScore for that. */
function wordCount(text: string | null): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const MAX_MERGE_WARNINGS = 10;

/** Thresholds injected into validateMergeOutput from the config snapshot. */
export interface ValidationThresholds {
  scopeExpansionStandardPct?: number;   // decimal fraction, e.g. 0.40
  scopeExpansionCriticalPct?: number;   // decimal fraction, e.g. 0.75
  tierMap?: Record<string, WarningTier>;
}

/**
 * Post-processing validator for LLM-generated merge output.
 * Pure — no DB, no clock. Returns an array of structured warnings.
 * An empty array means no issues were detected.
 *
 * Thresholds are read from the optional `thresholds` parameter (captured from
 * the job's config_snapshot). Defaults preserve pre-v2 behaviour when absent.
 */
export function validateMergeOutput(
  base: { definition: object | null; instructions: string | null; invocationBlock?: string | null },
  nonBase: { definition: object | null; instructions: string | null; invocationBlock?: string | null },
  merged: ProposedMerge,
  allLibraryNames: ReadonlySet<string>,
  allLibrarySlugs: ReadonlySet<string>,
  allLibrarySkills: ReadonlyArray<{ id: string | null; name: string; description: string }>,
  excludedId: string | null,
  thresholds: ValidationThresholds = {},
  /** Optional: the incoming candidate's original name, used by detectNameMismatch
   *  to surface rename decisions the merger made silently. */
  candidateName?: string,
): MergeWarning[] {
  const warnings: MergeWarning[] = [];
  const scopeStd = Math.round((thresholds.scopeExpansionStandardPct ?? 0.30) * 100);
  const scopeCrit = Math.round((thresholds.scopeExpansionCriticalPct ?? 0.60) * 100);
  const tierMap = thresholds.tierMap ?? DEFAULT_WARNING_TIER_MAP;

  // --- Bug 1: Required field demotion ---
  const baseRequired: string[] = (base.definition as Record<string, unknown> | null)?.input_schema
    ? ((base.definition as Record<string, Record<string, unknown>>).input_schema?.required as string[] ?? [])
    : [];
  const nonBaseRequired: string[] = (nonBase.definition as Record<string, unknown> | null)?.input_schema
    ? ((nonBase.definition as Record<string, Record<string, unknown>>).input_schema?.required as string[] ?? [])
    : [];
  const mergedRequired: string[] = (merged.definition as Record<string, unknown> | null)?.input_schema
    ? ((merged.definition as Record<string, Record<string, unknown>>).input_schema?.required as string[] ?? [])
    : [];

  const allSourceRequired = [...new Set([...baseRequired, ...nonBaseRequired])];
  const demoted = allSourceRequired.filter(f => !mergedRequired.includes(f));
  if (demoted.length > 0) {
    // v6 Fix 3: classify each demoted field so the reviewer sees "made
    // optional" vs "removed entirely" vs "possibly replaced by X" in the UI.
    // The fieldStatus map is additive — parseDemotedFields (legacy) still
    // reads the demotedFields array, so older clients keep working.
    const fieldStatus = classifyDemotedFields(demoted, merged.definition);
    const madeOptional = demoted.filter(f => fieldStatus[f]?.status === 'made_optional').length;
    const removed = demoted.length - madeOptional;
    const messageParts: string[] = [];
    if (madeOptional > 0) messageParts.push(`${madeOptional} made optional`);
    if (removed > 0) messageParts.push(`${removed} removed`);
    warnings.push({
      code: 'REQUIRED_FIELD_DEMOTED',
      severity: 'critical',
      message: `${demoted.length} required field(s) from the source skills ${messageParts.join(', ')}.`,
      detail: JSON.stringify({ demotedFields: demoted, fieldStatus }),
    });
  }

  // --- Bug 2: Capability overlap (name collision fast-check first) ---
  const mergedNameLower = merged.name.toLowerCase();
  if (allLibraryNames.has(mergedNameLower) || allLibrarySlugs.has(mergedNameLower)) {
    warnings.push({
      code: 'CAPABILITY_OVERLAP',
      severity: 'critical',
      message: `The merged name "${merged.name}" already exists in the skill library.`,
      detail: merged.name,
    });
  } else {
    // Bigram overlap check
    const mergedBigrams = extractDescriptionBigrams(merged.description);
    for (const skill of allLibrarySkills) {
      if (skill.id === excludedId) continue;
      const otherBigrams = extractDescriptionBigrams(skill.description);
      const overlap = [...mergedBigrams]
        .filter(b => otherBigrams.has(b))
        .filter(b => !isGenericBigram(b));
      const denom = Math.min(mergedBigrams.size, otherBigrams.size);
      const overlapRatio = denom > 0 ? overlap.length / denom : 0;
      if (overlap.length >= 2 && overlapRatio > 0.2) {
        warnings.push({
          code: 'CAPABILITY_OVERLAP',
          severity: 'warning',
          message: `Merged skill may overlap in purpose with "${skill.name}".`,
          detail: overlap.slice(0, 5).join(', '),
        });
      }
    }
  }

  // --- Bug 8: Scope expansion (thresholds from config snapshot) ---
  const baseWords = wordCount(base.instructions);
  const nonBaseWords = wordCount(nonBase.instructions);
  const richerSourceWords = Math.max(baseWords, nonBaseWords);
  const mergedWords = wordCount(merged.instructions);
  if (richerSourceWords > 0) {
    const pct = Math.round((mergedWords / richerSourceWords - 1) * 100);
    if (pct > scopeCrit) {
      warnings.push({
        code: 'SCOPE_EXPANSION_CRITICAL',
        severity: 'critical',
        message: `Merged instructions are ${pct}% longer than the richer source skill — likely out-of-scope content was imported.`,
        detail: `richer source: ${richerSourceWords} words, merged: ${mergedWords} words`,
      });
    } else if (pct > scopeStd) {
      warnings.push({
        code: 'SCOPE_EXPANSION',
        severity: 'warning',
        message: `Merged instructions are ${pct}% longer than the richer source skill. Review for scope creep.`,
        detail: `richer source: ${richerSourceWords} words, merged: ${mergedWords} words`,
      });
    }
  }

  // --- Bug 10: Table completeness ---
  // v6 Fix 1: when the LLM restructured a source table inline (split it into
  // sub-tables, merged multiple tables, or reordered columns), the header-key
  // comparison below treats it as "dropped". Before emitting the warning,
  // verify whether the row data is still present in the merged text. If
  // ≥80% of source rows are covered by substring match, downgrade the message
  // from "rows dropped" to "table restructured — N/M rows verified present"
  // and skip the paired reference appendix in recoverDroppedTableRows.
  const baseTables = extractTables(base.instructions);
  const nonBaseTables = extractTables(nonBase.instructions);
  const mergedTables = extractTables(merged.instructions);
  const mergedByHeader = new Map(mergedTables.map(t => [t.headerKey, t.rowCount]));
  const sourceLookup = new Map<string, number>();
  for (const t of [...baseTables, ...nonBaseTables]) {
    const existing = sourceLookup.get(t.headerKey) ?? 0;
    if (t.rowCount > existing) sourceLookup.set(t.headerKey, t.rowCount);
  }
  // Source rows by headerKey for content verification (only computed for
  // tables that look dropped — avoid the cost on the happy path).
  const sourceRowsByHeader = new Map<string, ReturnType<typeof extractTablesWithRows>[number]>();
  for (const t of [...extractTablesWithRows(base.instructions), ...extractTablesWithRows(nonBase.instructions)]) {
    const existing = sourceRowsByHeader.get(t.headerKey);
    if (!existing || t.rows.length > existing.rows.length) {
      sourceRowsByHeader.set(t.headerKey, t);
    }
  }
  for (const [headerKey, sourceRows] of sourceLookup) {
    const mergedRows = mergedByHeader.get(headerKey) ?? 0;
    if (mergedRows >= sourceRows) continue;
    const sourceWithRows = sourceRowsByHeader.get(headerKey);
    const coverage = sourceWithRows && merged.instructions
      ? mergedOutputCoversTableData(sourceWithRows, merged.instructions)
      : { covered: false, matchedRows: 0, totalRows: sourceRows };
    if (coverage.covered) {
      warnings.push({
        code: 'TABLE_ROWS_DROPPED',
        severity: 'warning',
        message: `Table "${headerKey}" was restructured in the merge — ${coverage.matchedRows}/${coverage.totalRows} source rows verified present.`,
        detail: JSON.stringify({
          header: headerKey,
          sourceRows,
          mergedRows,
          restructured: true,
          matchedRows: coverage.matchedRows,
          totalRows: coverage.totalRows,
        }),
      });
    } else {
      warnings.push({
        code: 'TABLE_ROWS_DROPPED',
        severity: 'warning',
        message: `Table "${headerKey}" has ${mergedRows} rows in the merge but ${sourceRows} in the source.`,
        detail: `header: ${headerKey}, source rows: ${sourceRows}, merged rows: ${mergedRows}`,
      });
    }
  }

  // --- Bug 3 post-check: Invocation block preservation ---
  const sourceHasInvocation = !!(base.invocationBlock || nonBase.invocationBlock);
  if (sourceHasInvocation) {
    let mergedHasInvocationAtTop = false;
    if (merged.instructions) {
      const triggerMatch = merged.instructions.match(INVOCATION_TRIGGER_RE);
      mergedHasInvocationAtTop = triggerMatch !== null
        && merged.instructions.trimStart().startsWith(triggerMatch[0].trimStart());
    }
    if (!mergedHasInvocationAtTop) {
      warnings.push({
        code: 'INVOCATION_LOST',
        severity: 'critical',
        message: 'One or both source skills had an invocation trigger block that is missing or not at the top of the merged output.',
      });
    }
  }

  // --- Bug 4 post-check: HITL gate preservation ---
  const sourceHasHitl = containsHitlGate(base.instructions) || containsHitlGate(nonBase.instructions);
  if (sourceHasHitl
    && !containsHitlGate(merged.instructions)
    && !containsApprovalIntent(merged.instructions)) {
    warnings.push({
      code: 'HITL_LOST',
      severity: 'critical',
      message: 'A human review gate instruction from a source skill is missing from the merged output.',
    });
  }

  // --- Bug 7 post-check: Output format block preservation ---
  const sourceHasFormat = hasOutputFormatBlock(base.instructions) || hasOutputFormatBlock(nonBase.instructions);
  if (sourceHasFormat && !hasOutputFormatBlock(merged.instructions)) {
    warnings.push({
      code: 'OUTPUT_FORMAT_LOST',
      severity: 'warning',
      message: 'Source skill(s) had an output format or code block specification that is not present in the merged output.',
    });
  }

  // --- Fix 7: Name mismatch across file name / schema name / references ---
  const mismatch = detectNameMismatch(merged, candidateName);
  if (mismatch) {
    warnings.push({
      code: 'NAME_MISMATCH',
      severity: 'critical',
      message: `Skill name is inconsistent across ${mismatch.candidates.length} locations. Reviewer must choose one.`,
      detail: JSON.stringify({
        topLevel: mismatch.topLevel,
        schemaName: mismatch.schemaName,
        distinctNames: mismatch.distinctNames,
        candidates: mismatch.candidates,
      }),
    });
  }

  // --- Fix 4 (v4/v5): NEAR_REPLACEMENT — merged retains < 30% of source structure ---
  const retentionScore = computeSourceRetention(base, merged, sourceLookup, mergedByHeader);
  if (retentionScore < 0.30) {
    const defRet = computeDefinitionRetention(base, merged);
    const tblRet = computeTableRetention(sourceLookup, mergedByHeader);
    const instrRet = wordOverlapRatio(base.instructions, merged.instructions);
    warnings.push({
      code: 'NEAR_REPLACEMENT',
      severity: 'warning',
      message: `This merge retains only ~${Math.round(retentionScore * 100)}% of the library skill's structure. Consider treating as a new skill rather than a merge.`,
      detail: JSON.stringify({
        retentionScore: Math.round(retentionScore * 100),
        definitionRetentionPct: Math.round(defRet * 100),
        tableRetentionPct: Math.round(tblRet * 100),
        instructionRetentionPct: Math.round(instrRet * 100),
      }),
    });
  }

  // Safety cap: prevent unbounded warning list from malformed input.
  // Sort by severity + tier priority so critical codes survive truncation,
  // then cap.
  if (warnings.length > MAX_MERGE_WARNINGS) {
    const sorted = sortWarningsBySeverity(warnings, tierMap);
    warnings.length = 0;
    for (let i = 0; i < MAX_MERGE_WARNINGS - 1 && i < sorted.length; i++) warnings.push(sorted[i]);
    warnings.push({
      code: 'WARNINGS_TRUNCATED',
      severity: 'warning',
      message: `Additional warnings were truncated (more than ${MAX_MERGE_WARNINGS} issues detected).`,
    });
  }

  return warnings;
}
