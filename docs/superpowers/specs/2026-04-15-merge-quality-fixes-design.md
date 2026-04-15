# Merge Quality Fixes — Design Spec

**Date:** 2026-04-15
**Scope:** Skill Analyzer — PARTIAL_OVERLAP / IMPROVEMENT merge output quality
**Status:** Draft

---

## Table of Contents

1. [Overview](#1-overview)
2. [Bug Taxonomy](#2-bug-taxonomy)
3. [Database Changes](#3-database-changes)
4. [Prompt Changes](#4-prompt-changes-bugs-3-4-5-7-9)
5. [LLM Output Extension — mergeRationale](#5-llm-output-extension-bug-6)
6. [Post-Processing Validation](#6-post-processing-validation-bugs-1-2-8-10)
7. [UI Changes](#7-ui-changes)
8. [File Inventory, Migration Sequence & Testing](#8-file-inventory-migration-sequence--testing)

---

## 1. Overview

Ten quality bugs were identified through human review of merge outputs produced by the skill analyzer's PARTIAL_OVERLAP and IMPROVEMENT classification path. The bugs divide into three root-cause categories:

- **Prompt gaps** — the LLM prompt lacks explicit rules for specific content preservation patterns (invocation triggers, HITL gates, output format placement, section ordering, tool references). The LLM's defaults produce inconsistent or wrong results for these patterns.
- **Missing LLM output field** — the prompt does not ask the LLM to explain its merge decisions. Without rationale, reviewers cannot quickly assess whether a merge is trustworthy.
- **Missing post-processing validation** — the pipeline accepts LLM output without checking it against the source skills. Required field demotions, name collisions, scope explosions, and table row drops go undetected and surface only during human review.

The fix is applied at three layers: (1) targeted additions to `CLASSIFICATION_WITH_MERGE_SYSTEM_PROMPT`, (2) a new `mergeRationale` field in the LLM output schema, and (3) a new pure `validateMergeOutput` function that runs server-side after the LLM call and writes structured warnings to a new `merge_warnings` column.

**What is not changing:**
- The four-field `proposedMerge` shape (`name`, `description`, `definition`, `instructions`) is unchanged on the wire.
- The `parseClassificationResponseWithMerge` parser structure is extended but backward-compatible.
- No changes to Stage 7b, Stage 8b, or the execute path.
- No new LLM calls — `mergeRationale` is added to the same Sonnet call, not a separate request.

---

## 2. Bug Taxonomy

| # | Bug | Root cause | Fix layer |
|---|-----|-----------|-----------|
| 1 | Silent required field demotion | Prompt allows demoting required fields; no post-check | Post-processing + prompt clarification |
| 2 | Skill graph collision detection | No name/slug collision check after merge | Post-processing |
| 3 | Agent invocation context loss | Prompt has no rule for invocation trigger blocks | Prompt |
| 4 | HITL review-gate preservation | Prompt has no rule for human-review-gate phrases | Prompt |
| 5 | Pipeline dependency chain extraction | Prompt has no rule for tool reference preservation | Prompt |
| 6 | Missing merge rationale | LLM output schema has no rationale field | New output field |
| 7 | Output format template burial | No rule forcing output format to final position | Prompt |
| 8 | Scope expansion warning | No check on merged vs source word count | Post-processing |
| 9 | Section ordering instability | Soft constraint on section order; not specific enough | Prompt |
| 10 | Table completeness validation | No check that merged tables contain all source rows | Post-processing |

## 3. Database Changes

Two new columns are added to `skill_analyzer_results`. Both are nullable so existing rows are unaffected.

### 3.1 `merge_warnings` — JSONB array

Stores structured warnings produced by the post-processing validator. Written by `skillAnalyzerJob.ts` Stage 5 immediately after the LLM call and parsing. Null when no warnings are raised or when classification is DUPLICATE / DISTINCT.

**Schema:**
```sql
merge_warnings jsonb DEFAULT NULL
```

**TypeScript shape (stored in the column):**
```typescript
type MergeWarningCode =
  | 'REQUIRED_FIELD_DEMOTED'   // Bug 1: a required field from base or non-base was dropped
  | 'CAPABILITY_OVERLAP'        // Bug 2: merged skill's capabilities overlap with another library skill
  | 'SCOPE_EXPANSION'          // Bug 8 (amber): merged instructions exceed richer source by >30%
  | 'SCOPE_EXPANSION_CRITICAL' // Bug 8 (red): merged instructions exceed richer source by >60%
  | 'TABLE_ROWS_DROPPED'       // Bug 10: a merged table has fewer rows than its source counterpart
  | 'INVOCATION_LOST'          // Bug 3 post-check: invocation trigger block not preserved
  | 'HITL_LOST'                // Bug 4 post-check: human-review-gate phrase not preserved
  | 'OUTPUT_FORMAT_LOST';      // Bug 7 post-check: source had output format block, merged does not

type MergeWarningSeverity = 'warning' | 'critical';

interface MergeWarning {
  code: MergeWarningCode;
  severity: MergeWarningSeverity;
  message: string;        // human-readable description surfaced in the UI
  detail?: string;        // optional structured detail (field name, table excerpt, etc.)
}

type MergeWarnings = MergeWarning[];
```

**Severity mapping by code:**

| Code | Severity |
|------|----------|
| `REQUIRED_FIELD_DEMOTED` | `critical` |
| `CAPABILITY_OVERLAP` | `warning` |
| `SCOPE_EXPANSION` | `warning` |
| `SCOPE_EXPANSION_CRITICAL` | `critical` |
| `TABLE_ROWS_DROPPED` | `warning` |
| `INVOCATION_LOST` | `critical` |
| `HITL_LOST` | `critical` |
| `OUTPUT_FORMAT_LOST` | `warning` |

### 3.2 `merge_rationale` — TEXT

Stores the LLM's explanation of its merge decisions. Populated when the LLM returns the new `mergeRationale` string in its output (Bug 6). Null when classification is DUPLICATE / DISTINCT, when the LLM omits the field, or on legacy rows.

```sql
merge_rationale text DEFAULT NULL
```

### 3.3 Migration

Update the Drizzle schema (§3.4) first, then run `npm run db:generate`. Drizzle creates the migration file automatically in `migrations/` with the next free sequence number. The generated migration will contain a single `ALTER TABLE skill_analyzer_results` statement adding both columns.

No index is needed on either column — they are read per-row in the Review UI, never queried in aggregate.

### 3.4 Drizzle schema update

`server/db/schema/skillAnalyzerResults.ts` — add two new columns to the table definition:

```typescript
mergeWarnings: jsonb('merge_warnings').$type<MergeWarning[]>(),
mergeRationale: text('merge_rationale'),
```

`MergeWarning` and `MergeWarningCode` are defined in `server/services/skillAnalyzerServicePure.ts` and re-exported from there for use in the schema file and job.

### 3.5 API / AnalysisResult client type

`client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx` — extend `AnalysisResult` with two optional fields:

```typescript
mergeWarnings?: MergeWarning[] | null;
mergeRationale?: string | null;
```

`MergeWarning` and `MergeWarningCode` are defined in a new shared type file `client/src/components/skill-analyzer/mergeTypes.ts` (imported by both `SkillAnalyzerWizard.tsx` and `MergeReviewBlock.tsx`).

## 4. Prompt Changes (Bugs 3, 4, 5, 7, 9)

All changes are to `CLASSIFICATION_WITH_MERGE_SYSTEM_PROMPT` in `server/services/skillAnalyzerServicePure.ts`. The base `CLASSIFICATION_SYSTEM_PROMPT` (used by the non-merge classify path) is unchanged.

The prompt is modified in three places: (a) new hard constraints are added to the "Hard constraints" section, (b) the final self-check list is extended, and (c) section ordering rules in the soft constraints are made explicit.

### 4.1 Bug 3 — Agent invocation context loss

**Problem:** Skills that begin with a structured "Invoke this skill when..." or "Use this skill when..." block have that block discarded or merged into the body during LLM rewriting, removing the routing signal that agents use to select the skill.

**New hard constraint** (added to the Hard constraints list):

> **Invocation trigger preservation.** If either source skill opens with a block that states when to invoke the skill — recognisable by phrases such as "Invoke this skill when", "Use this skill when", "Call this skill when", "Trigger this skill when", or any block whose primary purpose is listing conditions that cause an agent to select this skill — the merged instructions must open with an equivalent block. Merge the trigger conditions from both sources (removing duplicates). Do not move this block into the body or omit it.

**New self-check item:**

> - If either source had an invocation trigger block, the merged instructions open with one.

### 4.2 Bug 4 — HITL review-gate preservation

**Problem:** Human-in-the-loop instructions (e.g. "do not send this email directly", "requires human approval before proceeding", "always present to the user for review") are rewritten away during merge, removing a critical safety constraint.

**New hard constraint:**

> **Human review gate preservation.** Any instruction that requires a human to approve, review, or confirm output before it is sent or acted on must be preserved verbatim. These are identifiable by phrases such as "do not send directly", "do not post without approval", "review before sending", "human approval required", "present to user for confirmation", or any sentence that explicitly prohibits the skill from taking an action without human sign-off. These phrases must survive the merge unchanged. They may be consolidated if both source skills contain equivalent gates, but neither may be softened or removed.

**New self-check item:**

> - All human-review-gate instructions from both sources are preserved verbatim.

### 4.3 Bug 5 — Pipeline dependency chain extraction

**Problem:** Backtick-wrapped skill references (e.g., `` `gather-context` ``, `` `send-email` ``) in either source skill represent explicit tool dependencies. These are silently dropped during rewriting, breaking the skill's documented invocation chain.

**New hard constraint:**

> **Tool reference preservation.** Any backtick-wrapped name that refers to another skill (e.g., `` `skill-name` ``, `` `tool-name` ``) in either source skill represents an explicit dependency. All such references must appear in the merged output. If the reference appears in a sentence that is being rewritten, rewrite the sentence to preserve the reference. Do not remove a tool reference in the name of de-duplication unless the identical reference already exists elsewhere in the merged output.

**New self-check item:**

> - Every backtick-wrapped tool/skill reference from both sources appears in the merged output.

### 4.4 Bug 7 — Output format template burial

**Problem:** Output format sections (describing the expected structure of the skill's response) are being inserted mid-instructions rather than at the canonical final position.

**Updated soft constraint** (replaces the existing section ordering rule):

Current text:
> **You may reorder sections** so the merged instructions follow a logical progression (context-gathering → how the skill works → execution → output).

Replace with:

> **Section ordering.** Reorder sections so the merged instructions follow this canonical sequence:
> 1. Invocation trigger / When to use (if present — must be first)
> 2. Context / Background / How the skill works
> 3. Step-by-step workflow / Execution
> 4. Examples (if present)
> 5. Output format / Response format / Template (if present — must be last before Related Skills)
> 6. Related Skills / See Also (if present — always last)
>
> Sections that do not fit cleanly into categories 2–4 should preserve their order relative to the base skill. "Output format" is any section whose primary content is a structural template or schema for the skill's response — it always goes in position 5 regardless of where it appeared in the source skills.

**New self-check item:**

> - The output format / template section (if present) is the last substantive section before Related Skills.

### 4.5 Bug 9 — Section ordering instability

This bug is fully addressed by the new explicit ordering rule in §4.4. No additional prompt change is required beyond the section ordering replacement above.

The final self-check block in the prompt should have this updated ordering assertion (replacing the existing vague "Section order follows a logical flow" item):

> - Section order follows the canonical sequence: trigger → context → workflow → examples → output format → related skills.

## 5. LLM Output Extension (Bug 6)

### 5.1 Problem

The LLM's `reasoning` field explains the classification decision (why PARTIAL_OVERLAP vs IMPROVEMENT) but says nothing about the merge decisions — which skill became the base, what was added from the non-base, what was dropped and why. Reviewers must reconstruct this from the diff, which is time-consuming and error-prone for large merges.

### 5.2 New field: `mergeRationale`

A new `mergeRationale` string is added to the `proposedMerge` object for PARTIAL_OVERLAP and IMPROVEMENT classifications. It is produced by the same Sonnet call — no extra API call.

**Prompt addition** (appended inside the "Additional task: produce a merged version" section, after the final self-check block):

> ### Merge rationale (required for PARTIAL_OVERLAP / IMPROVEMENT)
>
> After the self-check, write a `mergeRationale` string (2–5 sentences) that answers:
> 1. Which skill became the base and why (the one with richer instructions, or the incoming if it was substantially more comprehensive).
> 2. What unique content was added from the non-base skill.
> 3. What, if anything, was dropped during deduplication and the justification for dropping it.
>
> This field is shown to the human reviewer as a summary of the AI's merge decisions. Write it for a reviewer who needs to quickly assess whether the merge is trustworthy, not for the AI's internal reasoning.

**Updated output JSON schema** (PARTIAL_OVERLAP / IMPROVEMENT case):

```json
{
  "classification": "PARTIAL_OVERLAP" | "IMPROVEMENT",
  "confidence": 0.0-1.0,
  "reasoning": "...",
  "proposedMerge": {
    "name": "...",
    "description": "...",
    "definition": { ... },
    "instructions": "...",
    "mergeRationale": "..."
  }
}
```

### 5.3 TypeScript changes

**`server/services/skillAnalyzerServicePure.ts`** — extend `ProposedMerge`:

```typescript
export interface ProposedMerge {
  name: string;
  description: string;
  definition: object;
  instructions: string | null;
  mergeRationale?: string;   // new — optional for backward compat with legacy rows
}
```

**`isValidProposedMerge`** — no change needed. The field is optional; validator only checks required fields.

**`parseClassificationResponseWithMerge`** — after validating `proposedMerge`, extract the field if present:

```typescript
if (isValidProposedMerge(p.proposedMerge)) {
  proposedMerge = {
    ...p.proposedMerge,
    mergeRationale: typeof p.proposedMerge.mergeRationale === 'string'
      ? p.proposedMerge.mergeRationale
      : undefined,
  };
}
```

### 5.4 Storage

After parsing the LLM response in `skillAnalyzerJob.ts` Stage 5, extract `mergeRationale` from `proposedMerge` and write it to the new `merge_rationale` column separately from the `proposed_merged_content` JSONB. This keeps the DB columns orthogonal and avoids embedding the rationale inside the user-editable merge object.

```typescript
// After parseClassificationResponseWithMerge:
const mergeRationale = result.proposedMerge?.mergeRationale ?? null;
// Strip mergeRationale from the stored proposedMerge to keep proposed_merged_content clean:
const storedMerge = result.proposedMerge
  ? { ...result.proposedMerge, mergeRationale: undefined }
  : null;
```

The `merge_rationale` column is not user-editable. There is no PATCH endpoint for it. It is read-only after the job writes it.

### 5.5 Client type

`ProposedMergedContent` in `SkillAnalyzerWizard.tsx` does **not** gain a `mergeRationale` field — the rationale is stripped before storage in `proposedMergedContent`. It is instead added to `AnalysisResult.mergeRationale` (§3.5) and surfaced separately in the UI.

## 6. Post-Processing Validation (Bugs 1, 2, 8, 10)

### 6.1 Design principle

The LLM cannot reliably self-validate structural constraints. Rather than asking it to catch its own mistakes, a deterministic post-processing step reads both source skills and the proposed merge and raises structured warnings when constraints are violated. This runs in `skillAnalyzerJob.ts` after `parseClassificationResponseWithMerge`, before writing the result row.

### 6.2 New pure function: `validateMergeOutput`

**Location:** `server/services/skillAnalyzerServicePure.ts` (pure — no DB, no clock)

**Signature:**

```typescript
export function validateMergeOutput(
  base: { definition: object | null; instructions: string | null },
  nonBase: { definition: object | null; instructions: string | null },
  merged: ProposedMerge,
  allLibraryNames: ReadonlySet<string>,   // all library skill names except the matched one
  allLibrarySlugs: ReadonlySet<string>,   // all library skill slugs except the matched one
): MergeWarning[]
```

The function returns an array of zero or more `MergeWarning` objects. An empty array means no issues were detected.

### 6.3 Bug 1 — Required field demotion check

The merged `required` array must be a superset of the union of required fields from **both** source skills. Checking only base → merged (as originally written) misses cases where a required field from the non-base is silently dropped.

**Check:**
```typescript
const baseRequired: string[] = (base.definition as any)?.input_schema?.required ?? [];
const nonBaseRequired: string[] = (nonBase.definition as any)?.input_schema?.required ?? [];
const mergedRequired: string[] = (merged.definition as any)?.input_schema?.required ?? [];

// Check base → merged
const demotedFromBase = baseRequired.filter(f => !mergedRequired.includes(f));
if (demotedFromBase.length > 0) {
  warnings.push({
    code: 'REQUIRED_FIELD_DEMOTED',
    severity: 'critical',
    message: `${demotedFromBase.length} required field(s) from the base skill were made optional or removed.`,
    detail: demotedFromBase.join(', '),
  });
}

// Check non-base → merged
const demotedFromNonBase = nonBaseRequired.filter(f => !mergedRequired.includes(f));
if (demotedFromNonBase.length > 0) {
  warnings.push({
    code: 'REQUIRED_FIELD_DEMOTED',
    severity: 'critical',
    message: `${demotedFromNonBase.length} required field(s) from the secondary skill were dropped.`,
    detail: demotedFromNonBase.join(', '),
  });
}
```

**Prompt reinforcement** (replaces the existing `input_schema.required` rule with the tighter wording):

> The merged `required` array must preserve all required fields from **both** source skills unless you explicitly justify dropping one in `mergeRationale`. You may not silently demote a required field to optional. This applies to base and non-base equally.

### 6.4 Bug 2 — Capability overlap detection

The original design checked name/slug string equality against the library. The reviewer correctly identified this as an insufficient fix: the real failure mode is functional overlap between skills with different names (e.g. a merged `ad-copy-generator` that duplicates the responsibility of `facebook-ads-specialist`). String collision alone won't catch this.

**Approach: description bigram overlap (no embeddings, no hardcoded keywords)**

Extract significant word bigrams from each skill's `description` (descriptions are short and focused, unlike instructions). If the merged skill's description bigrams overlap substantially with another library skill's description bigrams, it is likely covering the same capability.

```typescript
/** Extract non-trivial word bigrams from a short text (e.g. skill description).
 *  Stopwords and single-character tokens are excluded. Returns lowercase bigrams. */
function extractDescriptionBigrams(text: string): Set<string> {
  const STOPWORDS = new Set(['a','an','the','and','or','for','to','of','in',
    'on','with','that','this','is','are','be','it','as','by','at','from']);
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i+1]}`);
  }
  return bigrams;
}
```

**Generic bigram filter:**

Common marketing/strategy terms appear in many skill descriptions and would produce constant false positives if treated as capability signals. Filter them before comparing:

```typescript
const GENERIC_BIGRAMS = new Set([
  'email marketing', 'content strategy', 'lead generation', 'social media',
  'marketing strategy', 'brand voice', 'target audience', 'content creation',
  'digital marketing', 'conversion rate',
]);

function isGenericBigram(bigram: string): boolean {
  return GENERIC_BIGRAMS.has(bigram);
}
```

**Check:**

```typescript
const mergedBigrams = extractDescriptionBigrams(merged.description);

for (const skill of allLibrarySkills) {
  if (skill.id === excludedId) continue;
  const otherBigrams = extractDescriptionBigrams(skill.description);
  const overlap = [...mergedBigrams]
    .filter(b => otherBigrams.has(b))
    .filter(b => !isGenericBigram(b));
  // Require at least 2 non-generic overlapping bigrams AND a meaningful
  // overlap ratio relative to the smaller description. This prevents long or
  // verbose descriptions from matching simply due to sheer bigram volume.
  // Guard: if either description produces 0 non-stopword bigrams (e.g. a
  // one-word description), Math.min is 0 → division by zero → Infinity.
  // Safe-default: treat as no overlap (0).
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
```

**Invocation in `skillAnalyzerJob.ts`:**

`validateMergeOutput` signature gains a third library parameter:

```typescript
export function validateMergeOutput(
  base: { definition: object | null; instructions: string | null },
  nonBase: { definition: object | null; instructions: string | null },
  merged: ProposedMerge,
  allLibraryNames: ReadonlySet<string>,
  allLibrarySlugs: ReadonlySet<string>,
  allLibrarySkills: ReadonlyArray<{ id: string | null; name: string; description: string }>,
  excludedId: string | null,
): MergeWarning[]
```

The `allLibrarySkills` array is already loaded in the job for the embedding stage — no extra DB query needed. The `allLibraryNames`/`allLibrarySlugs` sets remain for a cheap name collision check that runs first (fast-exit before bigram extraction).

**Name collision still checked** (fast pre-check before bigram loop):

```typescript
const mergedNameLower = merged.name.toLowerCase();
if (allLibraryNames.has(mergedNameLower) || allLibrarySlugs.has(mergedNameLower)) {
  warnings.push({
    code: 'CAPABILITY_OVERLAP',
    severity: 'critical',
    message: `The merged name "${merged.name}" already exists in the skill library.`,
    detail: merged.name,
  });
}
```

Name collision uses `CAPABILITY_OVERLAP` with `critical` severity (it is the strongest possible overlap signal).

### 6.5 Bug 8 — Scope expansion warning

The merged instructions should not substantially exceed the richer of the two source skills. Two severity thresholds apply: >30% longer is an amber warning, >60% longer is a critical warning.

```typescript
function wordCount(text: string | null): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const baseWords = wordCount(base.instructions);
const nonBaseWords = wordCount(nonBase.instructions);
const richerSourceWords = Math.max(baseWords, nonBaseWords);
const mergedWords = wordCount(merged.instructions);

if (richerSourceWords > 0) {
  const pct = Math.round((mergedWords / richerSourceWords - 1) * 100);
  if (pct > 60) {
    warnings.push({
      code: 'SCOPE_EXPANSION_CRITICAL',
      severity: 'critical',
      message: `Merged instructions are ${pct}% longer than the richer source skill — likely out-of-scope content was imported.`,
      detail: `richer source: ${richerSourceWords} words, merged: ${mergedWords} words`,
    });
  } else if (pct > 30) {
    warnings.push({
      code: 'SCOPE_EXPANSION',
      severity: 'warning',
      message: `Merged instructions are ${pct}% longer than the richer source skill. Review for scope creep.`,
      detail: `richer source: ${richerSourceWords} words, merged: ${mergedWords} words`,
    });
  }
}
```

**Scope thresholds:** >30% is AMBER (`SCOPE_EXPANSION`), >60% is RED (`SCOPE_EXPANSION_CRITICAL`). A flat 20% threshold (original spec) was confirmed too aggressive and would cause reviewer fatigue.

**Prompt reinforcement** (addition to the existing "Scope discipline" hard constraint):

> Additionally: the merged instructions must not substantially exceed the length of the richer source skill. If the merged output is more than 30% longer than the richer source, you have likely imported out-of-scope content. Revisit and trim.

### 6.6 Bug 10 — Table completeness validation

A markdown table in either source that loses rows in the merged output is a data integrity issue (e.g. a 4-row platform specs table merged into a 2-row table). The check extracts all markdown tables from each source and the merge, then compares row counts by table position.

**Table extraction helper (pure) — header-aware:**

Index-based matching (first table ↔ first table) is fragile: if the merged output reorders tables, index matching produces false positives. Match by column headers instead.

```typescript
interface ExtractedTable {
  headerKey: string;   // normalized first-row header, used as the match key
  rowCount: number;    // data rows only (header + separator excluded)
}

/** Extract markdown tables from text, keyed by their header row.
 *  headerKey is the pipe-separated header cells lowercased and trimmed.
 *  rowCount counts only data rows (not the header or separator). */
function extractTables(text: string | null): ExtractedTable[] {
  if (!text) return [];
  const lines = text.split('\n');
  const tables: ExtractedTable[] = [];
  let inTable = false;
  let headerKey: string | null = null;
  let rowCount = 0;
  let lineIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|')) {
      if (!inTable) {
        inTable = true;
        // First pipe-delimited line is the header
        headerKey = trimmed.replace(/^\||\|$/g, '').split('|')
          .map(c => c.trim().toLowerCase()).join('|');
        rowCount = 0;
        lineIndex = 0;
      } else {
        lineIndex++;
        // Skip separator rows (line 1 after header: |---|---|)
        if (lineIndex === 1 && /^\|[\s\-:|]+\|/.test(trimmed)) continue;
        rowCount++;
      }
    } else if (inTable) {
      if (headerKey !== null) tables.push({ headerKey, rowCount });
      inTable = false;
      headerKey = null;
      rowCount = 0;
      lineIndex = 0;
    }
  }
  if (inTable && headerKey !== null) tables.push({ headerKey, rowCount });
  return tables;
}
```

**Check logic:**

```typescript
const baseTables = extractTables(base.instructions);
const nonBaseTables = extractTables(nonBase.instructions);
const mergedTables = extractTables(merged.instructions);

// Build lookup: headerKey → rowCount for the merged output
const mergedByHeader = new Map(mergedTables.map(t => [t.headerKey, t.rowCount]));

// Check both sources — use whichever has the richer set of tables
const allSourceTables = [...baseTables, ...nonBaseTables];
// Deduplicate by headerKey, keeping the higher row count
const sourceLookup = new Map<string, number>();
for (const t of allSourceTables) {
  const existing = sourceLookup.get(t.headerKey) ?? 0;
  if (t.rowCount > existing) sourceLookup.set(t.headerKey, t.rowCount);
}

for (const [headerKey, sourceRows] of sourceLookup) {
  const mergedRows = mergedByHeader.get(headerKey) ?? 0;
  if (mergedRows < sourceRows) {
    warnings.push({
      code: 'TABLE_ROWS_DROPPED',
      severity: 'warning',
      message: `Table "${headerKey}" has ${mergedRows} rows in the merge but ${sourceRows} in the source.`,
      detail: `header: ${headerKey}, source rows: ${sourceRows}, merged rows: ${mergedRows}`,
    });
  }
}
```

Header matching is more reliable than index matching: if the LLM reorders tables, source rows are still found correctly. If a table is renamed, it shows as both dropped and added — which is correct behaviour (the reviewer should check it).

### 6.7 Invocation point in `skillAnalyzerJob.ts`

After `parseClassificationResponseWithMerge` returns a valid result with `proposedMerge`, and before writing the DB row:

```typescript
// wordCount is the same module-level helper defined in §6.5 — not redefined here.

if (parsed.proposedMerge && (parsed.classification === 'PARTIAL_OVERLAP' || parsed.classification === 'IMPROVEMENT')) {
  // Determine base vs non-base using richnessScore — consistent with §6.11.
  // Do NOT use wordCount here: the prompt also uses richness logic (step 1),
  // so all three layers (prompt, validator, job) must agree on which skill is
  // the base. Using wordCount in the job while the validator uses richnessScore
  // causes non-deterministic base selection and mismatched warnings.
  const candidateScore = richnessScore(candidate.instructions);
  const libraryScore = richnessScore(librarySkill.instructions);
  const baseSkill = candidateScore >= libraryScore ? candidate : librarySkill;
  const nonBaseSkill = candidateScore >= libraryScore ? librarySkill : candidate;

  // Build library name/slug sets excluding the matched skill
  const excludedId = result.matchedSkillId;
  const allLibraryNames = new Set(
    librarySkills.filter(s => s.id !== excludedId).map(s => s.name.toLowerCase())
  );
  const allLibrarySlugs = new Set(
    librarySkills.filter(s => s.id !== excludedId).map(s => s.slug.toLowerCase())
  );

  mergeWarnings = validateMergeOutput(baseSkill, nonBaseSkill, parsed.proposedMerge, allLibraryNames, allLibrarySlugs);
}
```

**Defensive cap and logging** — at the end of `validateMergeOutput`, before returning:

```typescript
// Safety cap: malformed input or cascading upstream failures could produce
// an unbounded warning list, causing DB bloat and UI rendering issues.
// Truncate to 10 and add a marker warning so the reviewer knows truncation occurred.
const MAX_WARNINGS = 10;
if (warnings.length > MAX_WARNINGS) {
  warnings.splice(MAX_WARNINGS);
  warnings.push({
    code: 'SCOPE_EXPANSION',  // reuse an existing code — no schema change needed
    severity: 'warning',
    message: `Additional warnings were truncated (more than ${MAX_WARNINGS} issues detected).`,
  });
}
return warnings;
```

After `validateMergeOutput` returns in the job, log the warning codes for post-launch calibration:

```typescript
if (mergeWarnings.length > 0) {
  console.info('[SkillAnalyzer] merge_warnings_summary', {
    resultId: result.id,
    candidateSlug: candidate.slug,
    codes: mergeWarnings.map(w => w.code),
  });
}
```

This log answers three key calibration questions after launch: are `CAPABILITY_OVERLAP` warnings too noisy, are `HITL_LOST` cases still slipping through, and are the scope thresholds correctly set.

The `mergeWarnings` array (capped at 10, possibly empty) is written to `merge_warnings` in the same DB insert/update that writes `proposed_merged_content`.

### 6.8 Bug 3 post-check — Invocation block not preserved (deterministic)

The prompt rule in §4.1 shapes LLM behaviour but cannot be enforced. The post-processing step provides a deterministic backstop.

**Pre-extraction helper (runs before the LLM call, stored in a local variable):**

```typescript
// Multiline + case-insensitive. Leading whitespace is allowed so the block
// is detected even if the LLM adds a blank line or leading newline before it.
// Matches from the first invocation keyword through the next blank line.
const INVOCATION_TRIGGER_RE = /^\s*(Invoke|Use|Call|Trigger)\s+this\s+skill\b.+?(?:\n\n|\z)/ims;

/** Extract the opening invocation trigger block from skill instructions, if present.
 *  Returns the trimmed block text, or null if no trigger block is found. */
export function extractInvocationBlock(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(INVOCATION_TRIGGER_RE);
  return match?.[0]?.trim() ?? null;
}
```

**Check in `validateMergeOutput`:**

The function receives pre-extracted invocation blocks as optional parameters (extracted in the job before calling the LLM):

```typescript
export function validateMergeOutput(
  base: { definition: object | null; instructions: string | null; invocationBlock?: string | null },
  nonBase: { definition: object | null; instructions: string | null; invocationBlock?: string | null },
  merged: ProposedMerge,
  ...
): MergeWarning[]
```

```typescript
const sourceHasInvocation = !!(base.invocationBlock || nonBase.invocationBlock);
if (sourceHasInvocation && merged.instructions) {
  // Use the same relaxed regex (leading whitespace ok, case-insensitive, multiline).
  // Position check: verify the match starts at the very beginning of the
  // trimmed instructions (same trimStart().startsWith() test used by
  // extractInvocationBlock). A trigger block buried mid-document does not satisfy
  // this check even if the regex matches it.
  const triggerMatch = merged.instructions.match(INVOCATION_TRIGGER_RE);
  const mergedHasInvocationAtTop = triggerMatch !== null
    && merged.instructions.trimStart().startsWith(triggerMatch[0].trimStart());
  if (!mergedHasInvocationAtTop) {
    warnings.push({
      code: 'INVOCATION_LOST',
      severity: 'critical',
      message: 'One or both source skills had an invocation trigger block that is missing or not at the top of the merged output.',
    });
  }
}
```

Note: the check verifies presence at the top of the merged instructions using the same regex, not exact string equality (the LLM may legitimately consolidate two trigger blocks into one).

### 6.9 Bug 4 post-check — HITL gate phrase not preserved (deterministic)

**Helper:**

```typescript
const HITL_PHRASES = [
  /do not send (this|the|it)\b.*?directly/i,
  /do not post without approval/i,
  /review before sending/i,
  /human approval required/i,
  /present to (the )?user for (review|confirmation|approval)/i,
  /requires? (human|manual) (review|approval|sign-?off)/i,
];

/** Returns true if the text contains any HITL gate phrase. */
export function containsHitlGate(text: string | null): boolean {
  if (!text) return false;
  return HITL_PHRASES.some(re => re.test(text));
}
```

**Check:**

```typescript
const sourceHasHitl = containsHitlGate(base.instructions) || containsHitlGate(nonBase.instructions);
if (sourceHasHitl && !containsHitlGate(merged.instructions)) {
  warnings.push({
    code: 'HITL_LOST',
    severity: 'critical',
    message: 'A human review gate instruction from a source skill is missing from the merged output.',
  });
}
```

The `HITL_PHRASES` regex list is maintained in `skillAnalyzerServicePure.ts`. It should be extended as new patterns are observed in production.

**Semantic-lite fallback for paraphrased gates:**

LLMs frequently paraphrase HITL instructions ("requires approval" → "needs user confirmation"). The strict phrase list catches exact matches; the fallback catches intent-equivalent rewrites:

```typescript
/** Returns true if the text contains any approval/review intent signal,
 *  regardless of exact phrasing. Used as a fallback after containsHitlGate. */
export function containsApprovalIntent(text: string | null): boolean {
  if (!text) return false;
  return /\b(approval|review|confirm|sign-?off)\b/i.test(text);
}
```

**Updated check** — flag only when both the strict list AND the intent fallback miss:

```typescript
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
```

### 6.10 Bug 7 post-check — Output format block not present

The prompt rule in §4.4 instructs the LLM to place output format sections last. The post-check verifies a format specification exists when the source had one.

**Helper:**

```typescript
const OUTPUT_FORMAT_HEADING_RE = /^#{1,4}\s+(output\s+format|response\s+format|format|template)\b/im;

/** Returns true if the text contains an output format heading or a fenced code block
 *  (the two canonical ways skills specify their response structure). */
export function hasOutputFormatBlock(text: string | null): boolean {
  if (!text) return false;
  // A heading match alone is sufficient (explicit output format section).
  if (OUTPUT_FORMAT_HEADING_RE.test(text)) return true;
  // A fenced code block only counts when the output-related keyword appears
  // within the same fence token or the immediately surrounding context (within
  // ~200 chars). A distant "output" mention elsewhere in the document should
  // not make an unrelated code example count as an output format block.
  const fenceRe = /```(?:json|yaml|markdown|text|html)?\s*\n[\s\S]{0,200}?\b(output|response|format|template|result)\b/i;
  return fenceRe.test(text) || /\b(output|response|format|template|result)\b[\s\S]{0,100}?```/i.test(text);
}
```

**Check:**

```typescript
const sourceHasFormat = hasOutputFormatBlock(base.instructions) || hasOutputFormatBlock(nonBase.instructions);
if (sourceHasFormat && !hasOutputFormatBlock(merged.instructions)) {
  warnings.push({
    code: 'OUTPUT_FORMAT_LOST',
    severity: 'warning',
    message: 'Source skill(s) had an output format or code block specification that is not present in the merged output.',
  });
}
```

### 6.11 Base selection: richnessScore

The original spec used raw word count to determine which skill is the base (the richer one) — both for the prompt's Step 1 heuristic and the post-processing validator. Word count alone disadvantages short-but-dense skills (e.g. a skill with a detailed example JSON block but few prose words).

**Replace `wordCount` with `richnessScore` throughout:**

```typescript
/** Richness score used to identify the base skill for merging.
 *  Weights section headings and code blocks heavily over raw word count,
 *  since structured skills are harder to reconstruct if used as the non-base. */
export function richnessScore(text: string | null): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const headings = (text.match(/^#{1,4}\s/gm)?.length ?? 0) * 50;
  const codeBlocks = (text.match(/```/g)?.length ?? 0) * 100; // each fence token
  return words + headings + codeBlocks;
}
```

Update all three call sites:
- §6.5 scope expansion: replace `wordCount(base.instructions)` / `wordCount(nonBase.instructions)` with `richnessScore(...)` for the base/non-base determination, but keep `wordCount` for the word-count comparison itself (scope expansion is a word-count concept, not a richness concept).
- §6.7 invocation point: use `richnessScore(...)` for base/non-base determination (already reflected in §6.7 code snippet — do NOT use `wordCount` here).
- `wordCount` is still used in §6.5 for the actual word count arithmetic — it is not removed.

## 7. UI Changes

All UI changes are in `MergeReviewBlock.tsx`. No changes are needed to `SkillAnalyzerResultsStep.tsx` or the wizard.

### 7.1 Warning banner (Bugs 1, 2, 8, 10)

When `result.mergeWarnings` is a non-empty array, render a warning section between the header row ("Recommended changes" / "Reset to AI suggestion") and the diff legend.

**Design:**
- Amber background panel (`bg-amber-50 border border-amber-200 rounded`)
- Header: "AI merge warnings" with a warning icon
- Each warning is one line: `[badge] message`
- Badge color by code:
  - `REQUIRED_FIELD_DEMOTED` → red badge ("Required field removed")
  - `CAPABILITY_OVERLAP` → orange badge ("Capability overlap")
  - `SCOPE_EXPANSION` → amber badge ("Scope expansion")
  - `SCOPE_EXPANSION_CRITICAL` → red badge ("Scope expansion — critical")
  - `TABLE_ROWS_DROPPED` → amber badge ("Table rows dropped")
  - `INVOCATION_LOST` → red badge ("Invocation block lost")
  - `HITL_LOST` → red badge ("Review gate lost")
  - `OUTPUT_FORMAT_LOST` → amber badge ("Output format lost")
- If `warning.detail` is set, render it as a smaller `text-slate-500` line below the message

```tsx
{result.mergeWarnings && result.mergeWarnings.length > 0 && (
  <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-xs">
    <p className="font-semibold text-amber-800 mb-1.5">AI merge warnings</p>
    {result.mergeWarnings.map((w, i) => (
      <div key={i} className="mb-1">
        <span className={`mr-1.5 px-1 py-0.5 rounded text-[10px] font-medium ${warningBadgeClass(w.code)}`}>
          {warningLabel(w.code)}
        </span>
        <span className="text-amber-900">{w.message}</span>
        {w.detail && <div className="ml-1 text-slate-500 text-[10px]">{w.detail}</div>}
      </div>
    ))}
  </div>
)}
```

Helper functions (co-located in `MergeReviewBlock.tsx`):

```typescript
function warningLabel(code: MergeWarningCode): string {
  switch (code) {
    case 'REQUIRED_FIELD_DEMOTED':   return 'Required field removed';
    case 'CAPABILITY_OVERLAP':       return 'Capability overlap';
    case 'SCOPE_EXPANSION':          return 'Scope expansion';
    case 'SCOPE_EXPANSION_CRITICAL': return 'Scope expansion — critical';
    case 'TABLE_ROWS_DROPPED':       return 'Table rows dropped';
    case 'INVOCATION_LOST':          return 'Invocation block lost';
    case 'HITL_LOST':                return 'Review gate lost';
    case 'OUTPUT_FORMAT_LOST':       return 'Output format lost';
  }
}

function warningBadgeClass(code: MergeWarningCode): string {
  switch (code) {
    case 'REQUIRED_FIELD_DEMOTED':   return 'bg-red-100 text-red-800';
    case 'CAPABILITY_OVERLAP':       return 'bg-orange-100 text-orange-800';
    case 'SCOPE_EXPANSION':          return 'bg-amber-100 text-amber-800';
    case 'SCOPE_EXPANSION_CRITICAL': return 'bg-red-100 text-red-800';
    case 'TABLE_ROWS_DROPPED':       return 'bg-amber-100 text-amber-800';
    case 'INVOCATION_LOST':          return 'bg-red-100 text-red-800';
    case 'HITL_LOST':                return 'bg-red-100 text-red-800';
    case 'OUTPUT_FORMAT_LOST':       return 'bg-amber-100 text-amber-800';
  }
}
```

### 7.2 Merge rationale section (Bug 6)

When `result.mergeRationale` is a non-null string, render a collapsible section below the warning banner and above the diff legend.

**Design:**
- Collapsed by default; a disclosure triangle expands it
- Header: "Merge rationale" in `text-slate-500` style — unobtrusive, optional reading
- Body: prose text, `text-xs text-slate-600`

```tsx
const [showRationale, setShowRationale] = useState(false);

{result.mergeRationale && (
  <div className="mb-3">
    <button
      type="button"
      onClick={() => setShowRationale(v => !v)}
      className="text-[11px] text-slate-500 hover:text-slate-700 flex items-center gap-1"
    >
      <span>{showRationale ? '▾' : '▸'}</span> Merge rationale
    </button>
    {showRationale && (
      <p className="mt-1 text-xs text-slate-600 leading-relaxed pl-3 border-l border-slate-200">
        {result.mergeRationale}
      </p>
    )}
  </div>
)}
```

### 7.3 Merge confidence score

Computed client-side from the `mergeWarnings` array — no new DB column required.

**Scoring logic** (in `mergeTypes.ts`, exported as a pure function):

```typescript
export function computeMergeConfidence(warnings: MergeWarning[] | null | undefined): number {
  if (!warnings || warnings.length === 0) return 1.0;
  const deductions: Partial<Record<MergeWarningCode, number>> = {
    REQUIRED_FIELD_DEMOTED:   0.3,
    CAPABILITY_OVERLAP:       0.2,
    SCOPE_EXPANSION:          0.1,
    SCOPE_EXPANSION_CRITICAL: 0.2,
    INVOCATION_LOST:          0.3,
    HITL_LOST:                0.3,
    OUTPUT_FORMAT_LOST:       0.1,
    TABLE_ROWS_DROPPED:       0.1,
  };
  // Deduplicate by code — one deduction per code even if raised multiple times
  const seen = new Set<MergeWarningCode>();
  let score = 1.0;
  for (const w of warnings) {
    if (!seen.has(w.code)) {
      seen.add(w.code);
      score -= deductions[w.code] ?? 0;
    }
  }
  // Floor: never go below 0.2 — even a heavily-warned merge is reviewable.
  // Critical cap: if any critical warning is present, score is capped at 0.5
  // regardless of deductions, so critical issues always produce amber or red.
  const hasCritical = warnings.some(w => w.severity === 'critical');
  const floored = Math.max(0.2, score);
  return hasCritical ? Math.min(floored, 0.5) : floored;
}
```

**UI rendering in `MergeReviewBlock`** — displayed in the header row alongside "Recommended changes":

```tsx
const confidence = computeMergeConfidence(result.mergeWarnings);
const confidenceLabel = confidence >= 0.8 ? 'High confidence' : confidence >= 0.5 ? 'Review carefully' : 'Low confidence';
const confidenceClass = confidence >= 0.8
  ? 'text-emerald-700 bg-emerald-50'
  : confidence >= 0.5
  ? 'text-amber-700 bg-amber-50'
  : 'text-red-700 bg-red-50';

<span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${confidenceClass}`}>
  {confidenceLabel}
</span>
```

This appears in the header row, to the right of "Recommended changes" and left of the Reset button. It gives reviewers an immediate go/no-go signal without requiring them to read every warning.

### 7.4 Tool references artifact (Bug 5)

Bug 5 is addressed at the prompt level (§4.3). No dedicated UI surface is needed — the inline diff in the Recommended column makes preserved/dropped backtick references visible through the existing red/green diff highlight. No new UI component required.

### 7.5 Layout order within MergeReviewBlock

The final render order inside the component's outer `<div>`:

1. Header row (title + **confidence badge** (new — §7.3) + reset button)
2. Patch error (if any)
3. **Warning banner** (new — §7.1)
4. **Merge rationale collapsible** (new — §7.2)
5. Diff legend
6. Field rows (name, description, definition, instructions)

### 7.6 Blocking approval for critical warnings

Some warnings indicate a merge that must not be approved without manual correction. Rather than relying on reviewers to notice them, the Approve button is disabled when any blocking-code warning is present.

**Blocking codes:**

```typescript
// Defined in mergeTypes.ts (client-side), re-exported for use in the UI component.
export const BLOCKING_WARNING_CODES = new Set<MergeWarningCode>([
  'REQUIRED_FIELD_DEMOTED',
  'INVOCATION_LOST',
  'HITL_LOST',
]);
```

These three codes represent safety-critical regressions: a required field silently made optional, an agent routing trigger removed, or a human safety gate removed. Approving a merge with any of these without fixing it first would silently degrade the skill in production.

**UI implementation** — in `SkillAnalyzerResultsStep.tsx` (or wherever the Approve button lives):

```typescript
import { BLOCKING_WARNING_CODES } from './mergeTypes';

const hasBlockingWarning = result.mergeWarnings?.some(
  w => BLOCKING_WARNING_CODES.has(w.code)
) ?? false;

// Pass to the Approve button:
<button
  disabled={hasBlockingWarning}
  title={hasBlockingWarning ? 'Fix critical warnings before approving' : undefined}
  ...
>
  Approve
</button>
```

When blocked, the button shows a tooltip explaining why. The reviewer must manually edit the Recommended fields to resolve the issue before approving. There is no override mechanism — the fix must happen in the merge editor.

## 8. File Inventory, Migration Sequence & Testing

### 8.1 Files to create

| File | Purpose |
|------|---------|
| Migration file (auto-generated by `npm run db:generate`) | Adds `merge_warnings` and `merge_rationale` columns to `skill_analyzer_results` |
| `client/src/components/skill-analyzer/mergeTypes.ts` | Client-side `MergeWarning`, `MergeWarningCode`, `MergeWarningSeverity` types + `computeMergeConfidence` + `BLOCKING_WARNING_CODES` (duplicated from server — required by client/server boundary) |

### 8.2 Files to modify

| File | Changes |
|------|---------|
| `server/services/skillAnalyzerServicePure.ts` | Add `MergeWarning`, `MergeWarningCode`, `MergeWarningSeverity` exports; extend `ProposedMerge` with `mergeRationale?`; update `parseClassificationResponseWithMerge`; add `validateMergeOutput`, `extractTables`, `extractDescriptionBigrams`, `isGenericBigram`, `extractInvocationBlock`, `containsHitlGate`, `containsApprovalIntent`, `hasOutputFormatBlock`, `wordCount`, `richnessScore` pure helpers; update `validateMergeOutput` signature (§6.4); rewrite `CLASSIFICATION_WITH_MERGE_SYSTEM_PROMPT` with all prompt additions from §4 and §5 |
| `server/db/schema/skillAnalyzerResults.ts` | Add `mergeWarnings` and `mergeRationale` columns to Drizzle schema |
| `server/jobs/skillAnalyzerJob.ts` | Invoke `validateMergeOutput` after parse; pass warnings to DB write; extract and strip `mergeRationale` before storing `proposedMerge` |
| `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx` | Add `mergeWarnings` and `mergeRationale` to `AnalysisResult`; import from `mergeTypes.ts` |
| `client/src/components/skill-analyzer/MergeReviewBlock.tsx` | Add warning banner (§7.1), rationale collapsible (§7.2), confidence badge (§7.3), updated render order (§7.5); import from `mergeTypes.ts` |
| `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` | Import `BLOCKING_WARNING_CODES` from `mergeTypes.ts`; disable Approve button when any blocking warning is present (§7.6) |

### 8.3 Build sequence

Build in this order to avoid type errors at each stage:

1. **DB schema** — add `mergeWarnings` and `mergeRationale` column definitions to the Drizzle schema file; run `npm run db:generate` to produce the migration file
2. **Pure service** — add `MergeWarning`/`MergeWarningCode` exports, extend `ProposedMerge`, add `validateMergeOutput` + helpers, rewrite the prompt string; run `npm run typecheck`
3. **Job** — update `skillAnalyzerJob.ts` to invoke `validateMergeOutput` and write new columns to the DB
4. **Client types** — create `mergeTypes.ts`; extend `AnalysisResult` in `SkillAnalyzerWizard.tsx`
5. **UI** — update `MergeReviewBlock.tsx`
6. **Verification** — `npm run typecheck`, `npm run lint`, `npm test`

### 8.4 Tests

All new pure functions must have unit tests in `server/services/__tests__/skillAnalyzerServicePure.test.ts` (or a new co-located file following the `*Pure.test.ts` pattern).

**`validateMergeOutput` tests:**

| Test | Input | Expected |
|------|-------|----------|
| No warnings when merge is clean | Base required `['prompt']`, merged required `['prompt']`; name not in library | `[]` |
| Required field demotion | Base required `['prompt', 'tone']`, merged required `['prompt']` | `[{ code: 'REQUIRED_FIELD_DEMOTED', detail: 'tone' }]` |
| Name collision | Merged name = existing library skill name | `[{ code: 'CAPABILITY_OVERLAP', severity: 'critical' }]` |
| Slug collision | Merged name matches existing library slug | `[{ code: 'CAPABILITY_OVERLAP', severity: 'critical' }]` |
| Capability overlap | 2+ non-generic description bigrams match another skill | `[{ code: 'CAPABILITY_OVERLAP', severity: 'warning' }]` |
| Generic bigrams only | Overlap bigrams all in GENERIC_BIGRAMS set | `[]` |
| Scope expansion (amber) | Merged 145 words, richer source 100 words (45% over) | `[{ code: 'SCOPE_EXPANSION' }]` |
| Scope expansion (critical) | Merged 200 words, richer source 100 words (100% over) | `[{ code: 'SCOPE_EXPANSION_CRITICAL' }]` |
| Scope within 30% | Merged 125 words, richer source 100 words (25% over) | `[]` |
| Table row drop | Source table 4 rows, merged table 2 rows | `[{ code: 'TABLE_ROWS_DROPPED' }]` |
| Table rows preserved | Source 3 rows, merged 4 rows | `[]` |
| Multiple warnings | Both required demotion + scope expansion | 2-element array |

**`extractTables` tests:**

| Input | Expected |
|-------|----------|
| No tables | `[]` |
| Single 3-row table (1 header + 2 data) | `[{ headerKey: '...', rowCount: 2 }]` |
| Two tables with distinct headers | 2-element array, correct rowCounts |
| Separator row only | `[]` |
| Reordered tables (same headers, different order) | matched correctly by headerKey, not index |

**Prompt regression tests (manual):**

After deploying, re-run the skill analyzer on a known set of test skills and verify:
- Skills with invocation triggers still have trigger blocks in the merge
- Skills with HITL gate phrases preserve them verbatim
- Tool reference backticks survive merge
- Output format sections appear last before Related Skills
- `mergeRationale` field is populated on PARTIAL_OVERLAP / IMPROVEMENT results
- `mergeWarnings` array is written (empty or populated) for all PARTIAL_OVERLAP / IMPROVEMENT rows

### 8.5 Server-side blocking enforcement

The UI blocking rule (§7.6) prevents the Approve button from being clicked. However, the API endpoint that processes an approval is still callable directly (e.g. via bulk-action, future API clients, or a stale frontend). Server-side enforcement is required to make the guarantee durable.

**Location:** The route handler or service function that processes an `actionTaken = 'approved'` PATCH for a PARTIAL_OVERLAP or IMPROVEMENT result.

**Implementation:**

```typescript
// In the executeApproved path (or the PATCH /results/:id handler before setting actionTaken):
const BLOCKING_WARNING_CODES = new Set([
  'REQUIRED_FIELD_DEMOTED',
  'INVOCATION_LOST',
  'HITL_LOST',
] as const);

if (
  action === 'approved' &&
  (result.classification === 'PARTIAL_OVERLAP' || result.classification === 'IMPROVEMENT') &&
  result.mergeWarnings?.some(w => BLOCKING_WARNING_CODES.has(w.code as typeof BLOCKING_WARNING_CODES extends Set<infer T> ? T : never))
) {
  throw { statusCode: 422, message: 'Cannot approve: merge has critical warnings that must be resolved first.', errorCode: 'MERGE_CRITICAL_WARNINGS' };
}
```

The error code `MERGE_CRITICAL_WARNINGS` lets the client surface a specific message rather than a generic 422. The check runs after loading the result row (which includes `mergeWarnings`) and before any write. It does not affect DUPLICATE or DISTINCT approvals.

**Note:** This check is intentionally NOT in `executeApproved` (the bulk-execute path used in the Execute step) — that path runs after the Review step where warnings have already been addressed. It belongs in the per-result PATCH handler only.

### 8.6 What does not change

- **Execute (bulk) path** — `executeApproved` reads `proposedMergedContent` unchanged. The blocking check in §8.5 does not run here (individual results were already approved in the Review step).
- **Reset endpoint** — resets `proposedMergedContent` to `originalProposedMerge`; does not reset `mergeWarnings` or `mergeRationale` (they reflect the original LLM output, not user edits).
- **Stage 7b / Stage 8b** — no changes.
- **Classification-only path** (`buildClassificationPrompt` + `parseClassificationResponse`) — no changes.
- **Non-merge result types** (DUPLICATE, DISTINCT) — `mergeWarnings` and `mergeRationale` are null.
