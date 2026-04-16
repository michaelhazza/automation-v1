# Skill Analyzer v2 — Second-Pass Bug Fix Plan

**Branch:** `claude/fix-skill-analyzer-bugs-SQLUG`
**Date:** 2026-04-16
**Scope:** 7 fixes from the v2.0 brief (domain-agnostic). Config-driven thresholds.

## Contents

1. Fix-at-a-glance table
2. Data model changes (single migration)
3. New `MergeWarningCode` values
4. Warning tier system
5. Per-fix implementation (Fixes 1–7)
6. API additions
7. Execute step changes
8. Tests
9. Implementation order
10. Open decisions / defaults

---

## 1. Fix-at-a-glance

| # | Fix | Severity | Server | Client | DB |
|---|-----|----------|--------|--------|----|
| 1 | Classifier fallback → rule-based merge | high | yes | yes | yes |
| 2 | Required-field demotion decision gate | high | yes | yes | yes |
| 3 | Skill graph collision detection | medium | yes | yes | — |
| 4 | Table drop auto-recovery | medium | yes | — | — |
| 5 | Proposed new agent ↔ skill assignment coupling | high | yes | yes | yes |
| 6 | Critical-level warning approval gate | high | yes | yes | yes (config) |
| 7 | Name consistency (file name ↔ schema name) | high | yes | yes | yes |

---

## 2. Data model changes (single migration)

**Migration:** `migrations/0154_skill_analyzer_v2_fixes.sql`

### `skill_analyzer_results` adds:

- `warning_resolutions JSONB NOT NULL DEFAULT '[]'::jsonb` — append-only reviewer decisions.
  Each entry: `{ warningCode, resolution, resolvedAt, resolvedBy, details? }`.
  `resolution` is one of:
  `accept_removal | restore_required | use_library_name | use_incoming_name | scope_down | flag_other | accept_overlap | acknowledge_low_confidence | acknowledge_warning | confirm_critical_phrase`.
- `classifier_fallback_applied BOOLEAN NOT NULL DEFAULT false` — true when rule-based merger was used.
- `execution_resolved_name TEXT` — canonical name chosen by reviewer (Fix 7); used by Execute.

### `skill_analyzer_jobs` adds:

- `proposed_new_agents JSONB NOT NULL DEFAULT '[]'::jsonb` — array supporting N proposed agents.
  Entry shape: `{ id, slug, name, description, reasoning, skillSlugs: string[], status: 'proposed'|'confirmed'|'rejected', confirmedAt?, rejectedAt? }`.
  The scalar `agent_recommendation` column is preserved for backwards compat; single-agent writes populate both.

### New table `skill_analyzer_config`

Singleton row by unique `key='default'`:

```
key TEXT PRIMARY KEY DEFAULT 'default',
classifier_fallback_confidence_score REAL NOT NULL DEFAULT 0.30,
scope_expansion_standard_threshold REAL NOT NULL DEFAULT 0.40,
scope_expansion_critical_threshold REAL NOT NULL DEFAULT 0.75,
collision_detection_threshold REAL NOT NULL DEFAULT 0.40,
critical_warning_confirmation_phrase TEXT NOT NULL DEFAULT 'I accept this critical warning',
warning_tier_map JSONB NOT NULL DEFAULT '{...default map...}'::jsonb,
updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_by UUID
```

Default `warning_tier_map`:

```
REQUIRED_FIELD_DEMOTED     → decision_required
NAME_MISMATCH              → decision_required
SKILL_GRAPH_COLLISION      → decision_required
SCOPE_EXPANSION_CRITICAL   → critical
INVOCATION_LOST            → decision_required
HITL_LOST                  → decision_required
SCOPE_EXPANSION            → standard
CAPABILITY_OVERLAP         → standard
TABLE_ROWS_DROPPED         → informational
OUTPUT_FORMAT_LOST         → informational
CLASSIFIER_FALLBACK        → decision_required
WARNINGS_TRUNCATED         → informational
```

Seed one row with `key='default'` in the same migration.

---

## 3. New `MergeWarningCode` values

Add to both `server/services/skillAnalyzerServicePure.ts` and `client/src/components/skill-analyzer/mergeTypes.ts`:

- `CLASSIFIER_FALLBACK` — rule-based merger was used; reviewer must acknowledge low-confidence banner. Severity `warning`. Tier `decision_required`.
- `NAME_MISMATCH` — file `name` ≠ `definition.name` ≠ description/instructions references. Severity `critical`. Tier `decision_required`.
- `SKILL_GRAPH_COLLISION` — merged capabilities overlap another library/session skill above threshold. Severity `warning`. Tier `decision_required`.

Update `warningLabel()` and `warningBadgeClass()` in both files.

---

## 4. Warning tier system

Replaces the current static `BLOCKING_WARNING_CODES` set (in `mergeTypes.ts`).

### Tiers

- `informational` — displayed only, no approval gate.
- `standard` — Approve requires single-click acknowledgment (logs `acknowledge_warning`).
- `decision_required` — Approve requires a resolution specific to the warning code:
  - `REQUIRED_FIELD_DEMOTED` → `accept_removal` or `restore_required` (per field).
  - `NAME_MISMATCH` → `use_library_name` or `use_incoming_name`.
  - `SKILL_GRAPH_COLLISION` → `scope_down`, `flag_other`, or `accept_overlap` (with disambiguation note).
  - `INVOCATION_LOST`, `HITL_LOST` → `acknowledge_warning` after reviewer edits merge to restore the block; no skip path.
  - `CLASSIFIER_FALLBACK` → `acknowledge_low_confidence`.
- `critical` — Approve requires either (a) reviewer edits merge below the critical threshold OR (b) reviewer types the configurable confirmation phrase, logging `confirm_critical_phrase`.

### Helper function (server + client mirror)

```ts
function isApproveBlocked(
  warnings: MergeWarning[],
  resolutions: WarningResolution[],
  tierMap: Record<MergeWarningCode, WarningTier>,
): { blocked: boolean; reasons: BlockingReason[] }
```

Client uses it to disable/enable the Approve button. Server uses it in `PATCH /results/:resultId` (when action=approved) and at Execute to reject approvals with unresolved decision/critical warnings (409).

---

## 5. Per-fix implementation

### Fix 1 — Rule-based fallback merger

**Files:**
- `server/services/skillAnalyzerServicePure.ts` — add `buildRuleBasedMerge(candidate, library, allLibraryNames, config): { merge, warnings, mergeRationale }`.
- `server/jobs/skillAnalyzerJob.ts` — in the `classificationFallback` branch at Stage 5 (line ~491) call `buildRuleBasedMerge` instead of leaving `proposedMerge: null`. Also catch LLM failure at line ~761 and fall back similarly. Persist `classifier_fallback_applied=true` and emit a `CLASSIFIER_FALLBACK` warning.
- `server/services/__tests__/skillAnalyzerServicePureFallback.test.ts` — new.

**Algorithm (domain-agnostic):**
1. Choose dominant by: definition-bearing > `richnessScore` > fallback to library.
2. Copy dominant's `definition`. If non-dominant has `definition` and dominant doesn't, adopt non-dominant's.
3. Merge `instructions`: take dominant.instructions as base; if non-dominant has unique top-level sections (`##` headings not in dominant), append them. Preserve invocation block at top (via `extractInvocationBlock`). Preserve HITL gate phrasing if present in either source.
4. `description`: shorter of the two.
5. `name`: use the non-library (incoming) name if the library one is a generic tool name (all-lowercase with underscores) like `draft_sequence`; otherwise prefer library name. If uncertain, emit `NAME_MISMATCH` warning (Fix 7 handles resolution).
6. `mergeRationale`: deterministic text — "Rule-based merge applied. Classifier unavailable. Dominant source: {name}. Sections combined: {n}."
7. Emit warnings: always include `CLASSIFIER_FALLBACK`. Run full `validateMergeOutput` on the output as well.

**UI (`MergeReviewBlock`):**
- Red banner at top when any `CLASSIFIER_FALLBACK` warning is present.
- "I have reviewed the rule-based merge and accept the low-confidence state." acknowledgment checkbox. Disables Approve until checked.
- Confidence score displayed = `classifier_fallback_confidence_score` from config (default 0.30).

---

### Fix 2 — Required-field demotion decision gate

**Files:**
- `server/services/skillAnalyzerServicePure.ts` — `validateMergeOutput` changes `detail` on `REQUIRED_FIELD_DEMOTED` from plain string to JSON string `{ demotedFields: string[] }` so client can render per-field UI.
- `client/src/components/skill-analyzer/MergeReviewBlock.tsx` — renders list with Accept / Restore buttons per field.
  - Accept → `PATCH resolve-warning` body `{ warningCode, resolution:'accept_removal', details:{field} }`.
  - Restore → `PATCH resolve-warning` with `restore_required` AND `PATCH /merge` to add field back to `definition.input_schema.required`.
- `server/routes/skillAnalyzer.ts` — new endpoint `PATCH /results/:resultId/resolve-warning`.

**Approve gate:** blocked until every demoted field has an `accept_removal` or `restore_required` entry in `warning_resolutions`.

---

### Fix 3 — Skill graph collision detection

**Files:**
- `server/services/skillAnalyzerServicePure.ts` — new `detectSkillGraphCollision(mergedCandidate, libraryCatalog, sessionApprovedSkills, threshold): SkillGraphCollisionWarning[]`.
- `server/jobs/skillAnalyzerJob.ts` — call after `validateMergeOutput` (line ~813). Compare merged instructions split into capability fragments (by `##` heading) against library catalog (excluding matched skill) and session-approved set (other approved results in the same job). Fragment-level similarity via `cosineSimilarity` over fragment embeddings — reuse `skillEmbeddingService`.
- `server/services/skillAnalyzerService.ts` — `getJob()` already has live library lookup; add a helper that computes the session-approved set for a job. A library-only pass runs at job time; a final session-approved guard runs at Execute time.

**UI:** three resolution options via `PATCH resolve-warning`:
- `scope_down` — opens inline editor highlighting overlapping section.
- `flag_other` — marks `collidingSkillId` for future review (stored in `details`). Non-blocking on Execute.
- `accept_overlap` — text input for disambiguation note; stored in `details.disambiguationNote`.

**Config:** `collision_detection_threshold` (default 0.40).

---

### Fix 4 — Table drop auto-recovery

**Files:**
- `server/services/skillAnalyzerServicePure.ts` — new `remediateTables(mergedInstructions, baseInstructions, nonBaseInstructions): { instructions, autoRecoveredRows, skippedRowsFromIncompatibleSchemas }`.
- `server/jobs/skillAnalyzerJob.ts` — call **before** `validateMergeOutput` so warnings reflect remediated state.

**Algorithm:**
1. Parse markdown tables from all three texts (reuse `extractTables` but return full row content).
2. For each merged table, find source tables with matching `headerKey`.
3. Diff rows by first-column key.
4. Append missing rows with trailing marker: `[SOURCE: library]` or `[SOURCE: incoming]`.
5. Column mismatch → detection-only; emit `TABLE_ROWS_DROPPED` with `detail.autoRecoveredRows: 0`.

**Warning message update:** `TABLE_ROWS_DROPPED` reports recovered rows on success.

---

### Fix 5 — Proposed new agent ↔ skill assignment coupling

**Files:**
- `server/db/schema/skillAnalyzerJobs.ts` — add `proposedNewAgents: jsonb(...).notNull().default([])`.
- `server/jobs/skillAnalyzerJob.ts` — at Stage 8b (cluster recommendation), write to `proposedNewAgents`. For each DISTINCT result whose candidate slug appears in a proposed agent's `skillSlugs`, retro-inject a synthetic entry at the top of that result's `agentProposals`:
  ```
  { systemAgentId: null, slugSnapshot: proposedSlug, nameSnapshot: proposedName,
    score: 1.0, selected: true, isProposedNewAgent: true, proposedAgentIndex: i }
  ```
- `server/services/skillAnalyzerService.ts` — `updateAgentProposal()` accepts the new shape. `executeApproved()`:
  1. Before per-result skill creation, iterate `proposedNewAgents` with `status='confirmed'`, create each via `systemAgentService.createAgent`, record map `proposedAgentIndex → newAgentId`.
  2. When attaching a DISTINCT skill to a proposed agent (by `isProposedNewAgent: true` flag), use the freshly-created agent ID.
- `server/routes/skillAnalyzer.ts` — new `PATCH /jobs/:jobId/proposed-agents` body `{ proposedAgentIndex, action: 'confirm' | 'reject' }`.
- `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` — "New agent suggested" banner gains Confirm/Reject buttons; confirming surfaces agent in affected per-skill panels. AgentChipBlock labels proposed-new-agent chips with "Proposed".

---

### Fix 6 — Critical-level warning approval gate

**Files:**
- `server/services/skillAnalyzerConfigService.ts` — new service reading `skill_analyzer_config` singleton row with in-memory cache (invalidated on PATCH /config).
- `server/routes/skillAnalyzerConfig.ts` — new `GET/PATCH /api/system/skill-analyzer/config` (systemAdmin only).
- `client/src/components/skill-analyzer/MergeReviewBlock.tsx` — when any tier-`critical` warning is present AND reviewer hasn't edited merge below threshold:
  - Show text input labeled with the confirmation phrase.
  - Enable Approve only when input equals `critical_warning_confirmation_phrase`.
- `server/routes/skillAnalyzer.ts` — approve/execute routes check `warning_resolutions` has `confirm_critical_phrase` OR merge has been edited below `scope_expansion_critical_threshold * 100` percent.

**Scope thresholds:** `validateMergeOutput` takes thresholds as params (from config) instead of hardcoded 30/60.

---

### Fix 7 — Name consistency

**Files:**
- `server/services/skillAnalyzerServicePure.ts` — new `detectNameMismatch(merged): NameMismatch | null` comparing:
  - `merged.name` (top-level)
  - `(merged.definition as any).name` (schema)
  - References inside `merged.description` and `merged.instructions`.
- `validateMergeOutput` — emits `NAME_MISMATCH` when detected; `detail: JSON.stringify({ topLevel, schemaName, candidates })`.
- `client/src/components/skill-analyzer/MergeReviewBlock.tsx` — resolution picker: "Use library name throughout" / "Use incoming name throughout". On select: cascade edit across top-level, `definition.name`, and exact-match word boundaries in description/instructions. Save via `PATCH /merge` + `PATCH resolve-warning`.
- `server/services/skillAnalyzerService.ts` — `executeApproved()` reads `executionResolvedName` (from resolution) and ensures schema `name` matches file name on `updateSystemSkill` / `createSystemSkill`.

---

## 6. API additions

1. `GET /api/system/skill-analyzer/config`
2. `PATCH /api/system/skill-analyzer/config` — body: any subset of config fields.
3. `PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId/resolve-warning`
   ```json
   {
     "warningCode": "REQUIRED_FIELD_DEMOTED",
     "resolution": "accept_removal",
     "details": { "field": "voc_data" }
   }
   ```
   Appends one entry to `warning_resolutions`. Idempotent per (code, field) tuple.
4. `PATCH /api/system/skill-analyser/jobs/:jobId/proposed-agents`
   ```json
   { "proposedAgentIndex": 0, "action": "confirm" }
   ```

Existing `PATCH /results/:resultId` (set action) tightens server-side guard: rejects `action='approved'` when warning resolutions are incomplete or critical phrase not confirmed.

---

## 7. Execute step changes

1. **Atomic proposed-agent creation** (Fix 5): iterate `proposedNewAgents` with `status='confirmed'`, create each via `systemAgentService.createAgent`, record `proposedAgentIndex → newAgentId` map. Use inside per-result transaction when attaching skills.
2. **Name cascade** (Fix 7): on create/update, use `executionResolvedName` if present; overwrite `definition.name` and `name` field to match.
3. **Server-side approval guard:** re-run approval check at Execute entry; reject with 409 if any approved result has unresolved critical/decision warnings.

---

## 8. Tests

### New test files
- `server/services/__tests__/skillAnalyzerServicePureFallback.test.ts` — rule-based merger output shape, preservation of invocation/HITL blocks, dominant selection.
- `server/services/__tests__/skillAnalyzerServicePureNameConsistency.test.ts` — mismatch detection across all four locations, resolution cascade.
- `server/services/__tests__/skillAnalyzerServicePureTableRemediation.test.ts` — row recovery with source labels, incompatible-column fallback.
- `server/services/__tests__/skillAnalyzerServicePureCollision.test.ts` — fragment-level overlap detection above/below threshold.

### Updated
- `skillAnalyzerServicePureValidation.test.ts` — expectations for new warning codes and configurable thresholds.
- `mergeTypes.test.ts` (add if missing) — `isApproveBlocked` function.

---

## 9. Implementation order (ship order)

### Phase A — Foundation (ships alone)
1. Migration 0154 + Drizzle schema updates + `skillAnalyzerConfigService` + config routes.
2. Add new warning codes and types (server + client mirror).

### Phase B — Safety fixes (each ships independently)
3. Fix 7 — Name mismatch (detection + UI + Execute cascade).
4. Fix 2 — Required field decision gate (structured detail + UI + resolve-warning).
5. Fix 1 — Rule-based fallback merger (service + job handler + UI banner).
6. Fix 6 — Critical warning gate (confirmation phrase + config read).

### Phase C — Advanced fixes
7. Fix 5 — Proposed new agent coupling (schema update + retro-inject + atomic Execute).
8. Fix 4 — Table drop remediation (pure function + job wiring + message update).
9. Fix 3 — Skill graph collision (detection + UI + resolutions).

### Phase D — Verification
10. `npm run lint`, `npm run typecheck`, `npx tsx server/services/__tests__/skillAnalyzerServicePureValidation.test.ts`.
11. Commit. No automatic push.

---

## 10. Open decisions (deferred defaults chosen here)

1. **Config scope:** Singleton `key='default'` (system-wide). Per-org config deferred.
2. **Resolutions storage:** Append-only JSONB array on the result row (not a separate table). Simpler; no cascading FK.
3. **`proposedNewAgents` vs `agentRecommendation`:** Add new array column; keep scalar for backwards read compat. Writes populate both when there's exactly one proposed agent.
4. **Rule-based fallback flag:** New boolean `classifier_fallback_applied`; `classification_failed` stays reserved for API/parse failures.
5. **Collision "capability fragment":** `##` heading section boundary. Paragraph-level too noisy at this threshold.
6. **Execute-time name cascade:** file name, schema `name`, and exact-match word boundaries in description. Deep rewriting of prose deferred; reviewer sees diff before approval.

---

*Plan grounded in existing codebase (file paths/line refs verified 2026-04-16). No speculative abstractions.*




