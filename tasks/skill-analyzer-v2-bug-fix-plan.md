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
11. Review response — refinements incorporated

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

- `warning_resolutions JSONB NOT NULL DEFAULT '[]'::jsonb` — reviewer decisions, deduped under row-level lock.
  Composite dedup key: `(warningCode, details.field ?? null)`. See §11.2.
  Each entry: `{ warningCode, resolution, resolvedAt, resolvedBy, details? }`.
  `resolution` is one of:
  `accept_removal | restore_required | use_library_name | use_incoming_name | scope_down | flag_other | accept_overlap | acknowledge_low_confidence | acknowledge_warning | confirm_critical_phrase`.
- `classifier_fallback_applied BOOLEAN NOT NULL DEFAULT false` — true when rule-based merger was used.
- `execution_resolved_name TEXT` — canonical name chosen by reviewer (Fix 7); used by Execute.
- `approved_at TIMESTAMPTZ` — set on approve; locks result against further edits (see §11.11.2).
- `approval_decision_snapshot JSONB` — captures `evaluateApprovalState` output at approve time for debug traces (§11.11.12).

**Invariant:** any write to `proposed_merged_content` (PATCH /merge or reset) clears `warning_resolutions`, `approved_at`, and `approval_decision_snapshot` in the same transaction — a fresh merge re-triggers review from scratch (§11.11.1).

### `skill_analyzer_jobs` adds:

- `proposed_new_agents JSONB NOT NULL DEFAULT '[]'::jsonb` — array supporting N proposed agents.
  Entry shape: `{ id, slug, name, description, reasoning, skillSlugs: string[], status: 'proposed'|'confirmed'|'rejected', confirmedAt?, rejectedAt? }`.
  The scalar `agent_recommendation` column is preserved for backwards compat; single-agent writes populate both.
- `config_snapshot JSONB` — full config row captured at job start. Used by validator, collision detector, and Execute guards for the job's lifetime. Replaces the version-number-only approach (§11.11.4).
- `config_version_used INTEGER` — derived from `config_snapshot.config_version`; kept for UI display.
- `execution_lock BOOLEAN NOT NULL DEFAULT false` — atomic Execute guard (§11.11.3).
- `execution_started_at TIMESTAMPTZ` — set atomically when Execute takes the lock.
- `execution_finished_at TIMESTAMPTZ` — set in Execute's `finally` block.

### New table `skill_analyzer_config`

Singleton row by unique `key='default'`:

```
key TEXT PRIMARY KEY DEFAULT 'default',
config_version INTEGER NOT NULL DEFAULT 1,
classifier_fallback_confidence_score REAL NOT NULL DEFAULT 0.30,
scope_expansion_standard_threshold REAL NOT NULL DEFAULT 0.40,
scope_expansion_critical_threshold REAL NOT NULL DEFAULT 0.75,
collision_detection_threshold REAL NOT NULL DEFAULT 0.40,
collision_max_candidates INTEGER NOT NULL DEFAULT 20,
max_table_growth_ratio REAL NOT NULL DEFAULT 1.5,
execution_lock_stale_seconds INTEGER NOT NULL DEFAULT 600,
critical_warning_confirmation_phrase TEXT NOT NULL DEFAULT 'I accept this critical warning',
warning_tier_map JSONB NOT NULL DEFAULT '{...default map...}'::jsonb,
updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_by UUID
```

`skill_analyzer_jobs` also gains `config_version_used INTEGER` (nullable) recorded at job start. See §11.8.

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

### Canonical approval evaluator (single source of truth)

The function lives in `server/services/skillAnalyzerServicePure.ts` and is imported verbatim by the client via a browser-safe build:

```ts
export function evaluateApprovalState(
  result: ResultWithWarnings,
  config: SkillAnalyzerConfig,
): { blocked: boolean; reasons: BlockingReason[]; requiredResolutions: RequiredResolution[] }
```

**Authority:** the server is authoritative at `PATCH /results/:resultId` (action=approved) and at `POST /execute`; both call `evaluateApprovalState` and reject with 409 + `reasons[]` when `blocked=true`. The client uses the same function as an optimistic UI preview only — staleness is tolerated because the server re-checks.

Client parity is enforced by a shared snapshot test on fixture cases so the two callers never drift. See §11.1.

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
5. `name`: default to the library name so the DB slug lookup is stable. **Always emit `NAME_MISMATCH`** when candidate and library names differ (case-insensitive); Fix 7's UI handles resolution. No heuristic "generic name" detection. See §11.4.
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
- `server/jobs/skillAnalyzerJob.ts` — call after `validateMergeOutput` (line ~813). Compare merged instructions split into capability fragments (by `##` heading) against library catalog (excluding matched skill) and session-approved set.
- **Performance caps (see §11.5):** pre-filter to top-K skills by skill-level similarity (default K=20 via `collision_max_candidates`), then cheap bigram-overlap pre-filter, then fragment-level `cosineSimilarity`. Hard budget: 200 fragment-pair comparisons per candidate. Library fragment embeddings are cached on `skill_embeddings` with a new `fragment_index` column.
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
5. **Guards (see §11.6):**
   - Column mismatch → detection-only; `detail.autoRecoveredRows: 0`.
   - First-column key conflicts across sources → keep the dominant source's row (by `richnessScore`), emit warning with `detail.conflictedKeys: [...]`, do **not** append the conflicting variant.
   - Rows already containing `[SOURCE: ...]` markers are skipped (prevents recursion on retry).

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
- `server/services/skillAnalyzerService.ts` — `updateAgentProposal()` accepts the new shape. `executeApproved()` uses the **three-phase staged pipeline** (see §11.3):
  1. **Phase 1 — soft-create.** For each `proposedNewAgents` entry with `status='confirmed'`, look up existing agent by slug; if absent, `createAgent` with DB `status='draft'`. Record `proposedAgentIndex → agentId`. Idempotent on retry.
  2. **Phase 2 — per-result skill transactions.** Existing flow unchanged; attaches skills to the (draft) agents.
  3. **Phase 3 — promote drafts.** For each proposed agent with at least one successful skill attach, flip `status='draft' → 'active'`.
  Partial-failure contract: any agent whose skills all failed stays `'draft'`; the Execute response lists them under `pendingDraftAgents[]` for manual review.
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
- `server/services/skillAnalyzerService.ts` — `executeApproved()` reads `execution_resolved_name` as the canonical name source when set (see §11.7). Writing a `NAME_MISMATCH` resolution cascades the chosen name into `proposedMergedContent.name`, `definition.name`, and exact-match word boundaries in `description`/`instructions` inside one transaction, so `execution_resolved_name` and merge content stay in sync.

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

Existing `PATCH /results/:resultId` (set action) tightens server-side guard: calls `evaluateApprovalState` and rejects `action='approved'` with 409 + `reasons[]` when blocked. See §11.1.

**Idempotency keys (see §11.3):**
- `resolve-warning`: (`resultId`, `warningCode`, `details.field ?? null`). Upsert under row-level lock. **`If-Unmodified-Since` is required** — missing → 400, mismatch → 409 (§11.11.5).
- `proposed-agents`: (`jobId`, `proposedAgentIndex`). Last write wins.
- Agent creation at Execute: keyed by slug via `systemAgentService.getAgentBySlug`; reuses existing drafts on retry.
- Skill creation at Execute: on slug collision, `contentHash`-compare existing vs proposed. Match → idempotent skip. Mismatch → hard fail (§11.11.7).

**Concurrency invariants:**
- `PATCH /merge` and `POST /merge/reset` clear `warning_resolutions`, `approved_at`, and `approval_decision_snapshot` in the same transaction (§11.11.1).
- Any result with `approved_at IS NOT NULL` rejects `PATCH /merge`, `PATCH /resolve-warning`, `POST /merge/reset` with 409 (§11.11.2). Unapprove via `PATCH /results/:resultId` with `action=null`.
- `POST /execute` takes the job-level lock atomically; concurrent Execute → 409 (§11.11.3). Stale lock recovery via `POST /jobs/:jobId/execute/unlock` (systemAdmin only).

---

## 7. Execute step changes

1. **Lock acquisition** (§11.11.3): atomic `UPDATE jobs SET execution_lock=true WHERE id=:id AND execution_lock=false RETURNING id`. Zero rows → 409. Lock always released in `finally`. Stale-lock unlock endpoint: systemAdmin only, min-age gate via `execution_lock_stale_seconds` config.
2. **Config source:** read `jobs.config_snapshot` (not live config) for all thresholds during Execute (§11.11.4).
3. **Three-phase staged pipeline** (Fix 5 / §11.3):
   - Phase 1 — soft-create proposed agents with DB `status='draft'`, idempotent via slug lookup.
   - Phase 2 — existing per-result skill transactions; attach skills to draft agents.
     - Slug collision: hash-compare (§11.11.7) — idempotent skip if identical, hard fail if diverged.
   - Phase 3 — promote agents whose skills succeeded to `status='active'`. Any agent with zero successful attachments stays `'draft'` and is listed under `pendingDraftAgents[]` in the Execute response.
4. **Name cascade** (Fix 7): `executionResolvedName` is the canonical source when set. `updateSystemSkill` / `createSystemSkill` overwrite both top-level `name` and `definition.name` to match. Drift in `proposedMergedContent` is ignored when `executionResolvedName` is present.
5. **Server-side approval guard:** at Execute entry (after lock acquisition), re-run `evaluateApprovalState` for every `approved_at IS NOT NULL` result; reject with 409 + `reasons[]` if any result is still blocked. See §11.1.
6. **Session-approved collision pass:** runs after Phase 2, writes `skill_analyzer.collision_detected_at_execute` log events and populates the Execute response's `warnings[]` array. **Does NOT block.** See §11.11.6.
7. **Run tracing:** per-Execute `runId` (UUID) minted at the top of `executeApproved`; threaded into every structured log event (§11.11.11).

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

---

## 11. Review response — refinements incorporated

A post-draft review flagged seven consistency / robustness risks. Each item was vetted against the codebase; the following changes are now part of this plan. Items marked **DEFERRED** are acknowledged but out of scope for this fix cycle.

### 11.1 Centralised approval evaluation (ACCEPTED)

The canonical implementation of approval state lives in `server/services/skillAnalyzerServicePure.ts`:

```ts
export function evaluateApprovalState(
  result: ResultWithWarnings,
  config: SkillAnalyzerConfig,
): { blocked: boolean; reasons: BlockingReason[]; requiredResolutions: RequiredResolution[] }
```

Authority model:

- **Server is authoritative.** `PATCH /results/:resultId` (action=approved) and `POST /execute` both call `evaluateApprovalState` and reject with 409 + `reasons` if `blocked=true`.
- **Client is optimistic preview only.** `client/src/components/skill-analyzer/mergeTypes.ts` imports a browser-safe build of the same pure function (no DB imports; config comes from `GET /jobs/:jobId`'s inlined config snapshot). Client parity is enforced by a shared snapshot test asserting identical behaviour on fixtures.
- Every error returned by the approve/execute endpoints includes `reasons[]` so the client can render the same blocking messaging even if its cached state is stale.

### 11.2 `warning_resolutions` JSONB dedup + concurrency (ACCEPTED)

Resolution storage stays on `skill_analyzer_results.warning_resolutions` (JSONB array) for the reasons in §10 point 2 (scale is bounded — a job has ≤ a few hundred rows; a separate table would add cascading-FK friction with no query benefit for review-time reads). But:

- **Composite dedup key** on the array: `(warningCode, details.field ?? null)`. `PATCH resolve-warning` server-side logic does an atomic read-modify-write inside a row-level `SELECT ... FOR UPDATE` transaction, dropping any prior entry with the same key before appending.
- **Optimistic concurrency:** the endpoint accepts `If-Unmodified-Since: <mergeUpdatedAt>` (reusing the pattern from `PATCH /merge`). 409 on mismatch.
- **Audit:** every entry carries `resolvedAt` and `resolvedBy`; the array itself is append-only from the reviewer's perspective (newest wins per composite key, but old rows are preserved in the row's DB history via standard logical backups; dedup happens in the visible array state).

A separate `skill_analyzer_warning_resolutions` table is **DEFERRED** — revisit if we grow to tens of thousands of rows per job.

### 11.3 Execute staged idempotency (ACCEPTED)

The current `executeApproved` already uses per-result transactions + pre-mutation backup (`configBackupService`). Fix 5 (proposed agents) extends it to a **three-phase staged pipeline**, each phase idempotent:

1. **Phase 1 — Proposed agents, soft-create.** Iterate `proposedNewAgents` with `status='confirmed'`. For each, call `systemAgentService.getAgentBySlug(slug)`; if not present, `createAgent` with DB `status='draft'`. Record `proposedAgentIndex → agentId`. Outside per-result transactions (agents must exist before any skill attachment). Idempotent via slug lookup — re-runs pick up existing drafts.

2. **Phase 2 — Per-result skill create/update.** Existing per-result transactions. Unchanged semantics. Attaches created skills to (possibly draft) agents.

3. **Phase 3 — Promote drafts.** After Phase 2 completes, for every proposed agent whose full `skillSlugs` list has at least one successfully-created skill, flip `status='draft' → 'active'` via `systemAgentService.updateAgent`.

**Partial-failure contract:** On any Phase 2 failure, the remaining proposed agents stay `status='draft'`. They are listed in the Execute response under `pendingDraftAgents[]` with their IDs so the admin can activate or delete them manually. No automatic rollback (the backup already handles skill-level rollback).

**Idempotency keys:**
- Agents keyed by slug.
- Skills keyed by slug (existing behaviour — `createSystemSkill` already errors on slug collision, which we treat as a "skip" on retry).
- `resolve-warning` keyed by (`resultId`, `warningCode`, `details.field`).
- `proposed-agents` keyed by (`jobId`, `proposedAgentIndex`).

### 11.4 Remove rule-based name heuristic (ACCEPTED)

Fix 1 (`buildRuleBasedMerge`) no longer makes a name choice. Behaviour:

- If `candidate.name === library.name` (case-insensitive), use that name and **do not** emit `NAME_MISMATCH`.
- Otherwise, pick the library name for the `name` field (so DB slug lookup is stable during rule-based output) BUT always emit a `NAME_MISMATCH` warning. The reviewer resolves via the Fix 7 UI.

This makes Fix 1 and Fix 7 composable and removes the fragile "generic tool name" heuristic.

### 11.5 Collision detection performance constraints (ACCEPTED)

Fix 3 operates under strict caps:

- **Library fragment embeddings are cached** on `skill_embeddings` at fragment granularity (new sub-record with `fragment_index` column), populated lazily during the first collision check of a job and reused for every candidate in that job.
- **Two-stage filter:**
  1. Skill-level cosine similarity (already computed in Stage 4) ranks candidates; only the **top-K skills** (default 20, new config key `collision_max_candidates`) enter fragment-level comparison.
  2. Of those, apply a cheap **keyword-overlap pre-filter** (existing `extractDescriptionBigrams` reused on fragment text); skip skill pairs with zero significant shared bigrams.
- **Fragment granularity = `##` heading section** (as §10 point 5). Paragraph-level deferred.
- **Budget:** hard cap of 200 fragment-pair similarity calls per candidate (logged + metric counter); exceeding the cap short-circuits with a telemetry event — collision detection is best-effort, not exhaustive.

### 11.6 Table remediation row-conflict guard (ACCEPTED)

Fix 4's `remediateTables` refuses to auto-merge when:

- Header columns don't match exactly (already planned).
- **First-column keys conflict** across sources — e.g., base table has row `foo | X | Y` and non-base has `foo | X | Z`. Row is kept only from the **dominant** source (by `richnessScore`); a `TABLE_ROWS_DROPPED` warning is emitted with `detail.conflictedKeys: ['foo']` instead of appending the conflicting row.
- Rows from either source containing `[SOURCE: ...]` markers are skipped (prevents recursion on retry).

When a table cannot be merged safely, the warning detail includes `autoRecoveredRows: 0` and the existing "Review for scope creep" path carries the reviewer through an inline editor.

### 11.7 `executionResolvedName` canonical (ACCEPTED)

Fix 7 makes `execution_resolved_name` the single canonical name source at Execute time:

- When a `NAME_MISMATCH` resolution is applied (either `use_library_name` or `use_incoming_name`), the server writes `execution_resolved_name` AND cascades the chosen name into `proposedMergedContent.name`, `proposedMergedContent.definition.name`, and exact-match word boundaries in `description` / `instructions` via a single transaction.
- `executeApproved` reads `execution_resolved_name` first; if non-null, it overrides any drift in `proposedMergedContent` that might have occurred between resolution and execute (e.g., via a later merge edit).
- If `execution_resolved_name` is null (no name mismatch was flagged), `proposedMergedContent.name` is canonical as before.

### 11.8 Config versioning + job config snapshot (ACCEPTED)

- `skill_analyzer_config` gains `config_version INTEGER NOT NULL DEFAULT 1`, bumped atomically on every `PATCH /config`.
- `skill_analyzer_jobs` gains `config_version_used INTEGER` (nullable; set at job start).
- Every new job records the current `config_version` so replays and audits can trace which thresholds applied.

### 11.9 Metrics / observability (ACCEPTED, minimal)

Structured log events on each code path (not a full metrics export in this cycle):

- `skill_analyzer.fallback_applied { jobId, resultId, candidateSlug }`
- `skill_analyzer.warning_emitted { code, severity, tier }`
- `skill_analyzer.approval_blocked { code, reason }`
- `skill_analyzer.collision_budget_exhausted { candidateSlug, fragmentPairsExamined }`

A proper metrics backend wire-up is **DEFERRED** to a follow-up.

### 11.10 Retry behaviour documented (ACCEPTED)

- **Rule-based fallback + retry interaction:** `retryClassification` and `retryFailedClassifications` re-enter the classify stage. If the retry succeeds, `classifier_fallback_applied` is reset to `false` and `mergeWarnings` is recomputed from scratch (dropping the `CLASSIFIER_FALLBACK` warning). If retry still fails, `classifier_fallback_applied` stays `true` and the same rule-based output is regenerated deterministically.
- **Partial embedding failures:** collision detection treats missing embeddings as "pre-filter miss" rather than "collision" — conservative. Missing embedding is logged but does not block approval.
- **Execute retries:** idempotent per §11.3. Re-running Execute after partial failure only processes results whose `executionResult` is null or `'failed'`.

---

### Pre-implementation acceptance checklist

Before starting code changes:

- [x] Approval evaluation centralized in one pure function; client imports it for preview only.
- [x] `warning_resolutions` writes are atomic + deduped by composite key under row-lock.
- [x] Execute staged as soft-create → per-result txn → promote; draft agents persist on partial failure.
- [x] Rule-based merger never auto-selects names; always emits `NAME_MISMATCH` when names differ.
- [x] Collision detection: top-K + keyword pre-filter + hard pair budget.
- [x] Table remediation refuses on column mismatch OR first-column key conflict.
- [x] `execution_resolved_name` is canonical at Execute.
- [x] Config carries `config_version`; jobs record `config_version_used`.
- [x] Structured log events on fallback / warning / block / budget-exhausted paths.
- [x] Retry semantics documented for fallback, embedding failure, and Execute re-runs.

All items must be reflected in code + tests before their fix's todo is marked complete.

---

## 11.11 Second-review refinements (post-review round 2)

A second architectural review flagged remaining edge-condition integrity and concurrency risks. Twelve items accepted, four deferred.

### 11.11.1 Resolution invalidation on merge edit (ACCEPTED — wipe approach)

`PATCH /merge` (or reset) clears `warning_resolutions` to `[]` atomically. Rationale: old resolutions can't satisfy a new merge's demoted-field set; simpler than tracking `merge_version` on every resolution entry. Client UI re-prompts for decisions after any merge edit — which matches the correct UX anyway.

Implementation: inside the existing `mergeUpdatedAt`-updating transaction in `patchMergeFields` and `resetMergeToOriginal`, also set `warning_resolutions = '[]'::jsonb`.

### 11.11.2 Result freeze on approval (ACCEPTED — lock approach)

`skill_analyzer_results` adds `approved_at TIMESTAMPTZ` (nullable) set by `setResultAction` when `action='approved'`.

- After approval, `PATCH /merge`, `PATCH /resolve-warning`, and `POST /merge/reset` return **409 — Result locked**; the client must first call `PATCH /results/:resultId` with `action=null` (unapprove) to edit.
- `executeApproved` reads only results with `actionTaken='approved' AND approved_at IS NOT NULL`.

### 11.11.3 Execute lock (ACCEPTED)

`skill_analyzer_jobs` adds:
- `execution_lock BOOLEAN NOT NULL DEFAULT false`
- `execution_started_at TIMESTAMPTZ`
- `execution_finished_at TIMESTAMPTZ`

`POST /execute` does an atomic:
```sql
UPDATE skill_analyzer_jobs
SET execution_lock = true, execution_started_at = now()
WHERE id = :jobId AND execution_lock = false
RETURNING id;
```
Zero rows → reject 409 "Execution already in progress". On completion (success or failure), set `execution_lock=false, execution_finished_at=now()` in a `finally` block.

Re-runs after a crash: a separate `POST /jobs/:jobId/execute/unlock` (systemAdmin only) clears a stale lock older than `EXECUTION_LOCK_STALE_SECONDS` (default 600).

### 11.11.4 Config snapshot at job start (ACCEPTED)

Replaces `config_version_used INTEGER` (from §11.8) with `config_snapshot JSONB`. The full config row is captured at job start and re-used by the validator, collision detector, and Execute guards for the lifetime of the job. Live config changes mid-job do not apply.

`config_version` on the config row is still useful for UI display ("this job used config v3"), so keep it — the job now stores both `config_snapshot` and `config_version_used` (derived from the snapshot).

### 11.11.5 Strict `If-Unmodified-Since` enforcement (ACCEPTED)

`PATCH /resolve-warning` **requires** the `If-Unmodified-Since` header (reuses the existing pattern from `PATCH /merge` at `skillAnalyzerService.ts:620`). Missing → 400. Mismatch → 409. This closes the silent-overwrite race on `warning_resolutions`.

`PATCH /merge` already enforces it; the plan now mandates the same for resolve-warning and for `PATCH /results/:resultId` when transitioning to `action=approved` (so approval doesn't race with a merge edit).

### 11.11.6 Execute-time collision detection is log-only (ACCEPTED)

The session-approved collision pass at Execute (planned in §5 Fix 3) becomes **non-blocking**. It runs and writes structured log events (`skill_analyzer.collision_detected_at_execute`) plus an entry in the Execute response's `warnings[]` array, but does NOT block the Execute. Rationale: introducing a new blocking condition at Execute that the reviewer never saw is bad UX; the reviewer already approved under the job-time collision state, and the backup covers rollback if needed.

### 11.11.7 Skill slug collision: hash-compare retry (ACCEPTED)

`executeApproved` treats `createSystemSkill` slug-collision (caught at `systemSkillService.ts:308`) as follows:
- Fetch existing skill by slug.
- Compute `contentHash` of existing vs proposed (reuse `contentHash()` from `skillParserServicePure.ts`).
- Identical hash → treat as idempotent retry; mark result `executionResult='skipped'` with reason `slug_collision_idempotent`.
- Different hash → hard error; `executionResult='failed'` with reason `slug_collision_conflict`.

### 11.11.8 Fragment embedding cache invalidation (ACCEPTED)

The new `skill_embeddings` fragment sub-records (from §11.5) carry `content_hash TEXT NOT NULL` and `skill_updated_at TIMESTAMPTZ NOT NULL`. Cache read logic:
- Compute current `contentHash` of the skill's instructions.
- If any fragment row's `content_hash` doesn't match, delete all rows for that skill and recompute. Atomic under row lock.

### 11.11.9 Table remediation growth cap (ACCEPTED)

New config `max_table_growth_ratio REAL NOT NULL DEFAULT 1.5`. `remediateTables` tracks post-remediation word count vs pre-remediation; if `> max_table_growth_ratio × pre`, aborts auto-recovery for that candidate and emits `TABLE_ROWS_DROPPED` with `detail.growthRatioExceeded: true`.

### 11.11.10 Warnings hard cap (DOCUMENTED)

`validateMergeOutput` already enforces `MAX_MERGE_WARNINGS = 10` with a `WARNINGS_TRUNCATED` sentinel (see `skillAnalyzerServicePure.ts:772`). Plan retains the cap but adds severity-ordered truncation so critical warnings are never dropped in favour of informational ones (see §11.12.3). Raising the cap itself is unnecessary — UI rendering tests assume ≤10.

### 11.11.11 Correlation IDs on log events (ACCEPTED)

Every log event introduced in §11.9 includes `{ jobId, resultId?, runId?, candidateSlug? }` as structured fields. A per-Execute `runId` (UUID) is minted at the top of `executeApproved` and threaded through all Execute-time logs.

### 11.11.12 Approval decision snapshot (ACCEPTED)

`skill_analyzer_results` adds `approval_decision_snapshot JSONB` (nullable). On `setResultAction(action='approved')`, the result of `evaluateApprovalState` at that moment is captured — including config snapshot hash, warning codes seen, and the resolutions that satisfied each gate. Useful for post-hoc debugging of "why was this allowed to approve?".

### 11.11.13 API naming consistency (ACCEPTED — British)

Existing routes use `skill-analyser` (British). The plan standardizes on that everywhere. New routes: `/api/system/skill-analyser/config`, `/api/system/skill-analyser/jobs/:jobId/proposed-agents`, etc. Any reference to `skill-analyzer` in the plan is a typo; code uses `skill-analyser`.

### 11.11.14 Deferred items

- **Full merge_version tracking on each resolution:** not needed given §11.11.1 (wipe-on-edit).
- **Version field on warning_resolutions:** `If-Unmodified-Since` already solves the concurrent-write race (§11.11.5).
- **Raising MAX_MERGE_WARNINGS to 20:** UI assumes 10; no user-visible benefit (§11.11.10).
- **Separate `skill_analyzer_warning_resolutions` table:** deferred per §11.2.

### Updated pre-implementation acceptance checklist

- [x] Wipe `warning_resolutions` on any merge edit or reset.
- [x] Lock result on approval (`approved_at` + 409 on merge writes); explicit unapprove required.
- [x] Execute lock with atomic UPDATE guard; stale-lock unlock endpoint.
- [x] Full `config_snapshot` on jobs (not just version).
- [x] Strict `If-Unmodified-Since` enforcement on resolve-warning and PATCH /merge.
- [x] Execute-time collision detection logs + warns; never blocks.
- [x] Slug collision hash-compare for idempotent retry.
- [x] Fragment embedding cache invalidated by `content_hash`.
- [x] `max_table_growth_ratio` cap on auto-recovery.
- [x] Correlation IDs on all new log events.
- [x] `approval_decision_snapshot` persisted at approve.
- [x] API paths use `skill-analyser` (British) consistently.

---

## 11.12 Third-review refinements (diminishing-returns polish)

A third review raised ten ultra-edge items. Six accepted, two already covered, two deferred. The plan is now feature-complete — further review rounds will deliver diminishing returns.

### 11.12.1 Approval drift detection (ACCEPTED — non-blocking)

`skill_analyzer_results.approval_decision_snapshot` (§11.11.12) gains a `snapshotHash TEXT` sibling column computed from the stable-stringified snapshot at approve time. At Execute, `evaluateApprovalState` runs again; if the new snapshot hashes differently, the Execute response gets a structured log event `skill_analyzer.approval_drift_detected { runId, resultId, approvedHash, currentHash }` and a non-blocking entry in the response's `warnings[]`. **Execute does not abort** — drift is audit signal, not gate.

### 11.12.2 Post-approval edit state (ACCEPTED — simple flag)

`skill_analyzer_results` adds `was_approved_before BOOLEAN NOT NULL DEFAULT false`. Set `true` on the first approval; never reset. When a result is later unapproved (via `PATCH /results/:resultId` with `action=null`), `was_approved_before` stays `true` and UI renders a "⚠️ Modified after previous approval — re-review required" badge.

No new state enum needed; the existing `actionTaken` triplet (`approved | rejected | skipped | null`) plus `was_approved_before` covers all UX cases.

### 11.12.3 Warning severity ordering before truncation (ACCEPTED)

`validateMergeOutput` in `skillAnalyzerServicePure.ts` currently truncates by insertion order (lines ~929–937). Change to sort by severity priority **before** applying `MAX_MERGE_WARNINGS = 10`:

```
critical > warning
```

Within the same severity, sort by tier (`decision_required > standard > informational`) using the `warning_tier_map` snapshot. The `WARNINGS_TRUNCATED` sentinel (lowest priority) is always appended last and never itself truncated. Prevents a flood of low-priority `TABLE_ROWS_DROPPED` from crowding out critical codes.

### 11.12.4 Canonical content hashing for slug collision (ACCEPTED)

`§11.11.7` hash compare at Execute uses a **canonical form** before hashing, not raw strings:
- Trim trailing whitespace; normalize line endings to `\n`.
- Collapse runs of blank lines to exactly one.
- Stable JSON stringify for `definition` (sorted keys; array order preserved).
- Strip `[SOURCE: ...]` markers from table cells (so Fix 4 auto-recovery doesn't cause false hash mismatch).

A new pure helper `canonicalContentHash(content): string` lives in `skillParserServicePure.ts` next to the existing `contentHash`. Tests compare the two on equivalent-with-whitespace fixtures.

### 11.12.5 Merge-wipe UI banner (ACCEPTED)

When `PATCH /merge` or `POST /merge/reset` returns and the previous state had non-empty `warning_resolutions`, the response includes `resolutionsCleared: true`. Client renders a toast: "Review decisions reset because the merge changed. Re-review required before approval." Banner persists until the reviewer interacts with any warning resolution UI.

### 11.12.6 Formalized Execute response shape (ACCEPTED)

`executeApproved` already returns `{ created, updated, failed, errors, backupId }`. Plan formalizes the full response:

```ts
interface ExecuteResponse {
  runId: string;                           // §11.11.11
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    warnings: number;                      // non-blocking warnings accumulated
  };
  errors: Array<{ resultId: string; error: string }>;
  pendingDraftAgents: Array<{ agentId: string; slug: string; name: string }>;
  approvalDriftDetected: Array<{ resultId: string; approvedHash: string; currentHash: string }>;
  backupId: string | null;
}
```

### 11.12.7 Config snapshot immutability (ACCEPTED — code invariant)

`jobs.config_snapshot` and `jobs.config_version_used` are written **only at job row INSERT** (first persistence of the job) and never again. Documented as a comment on the column. No endpoint exposes an update path. Enforcement: a unit test asserts that no code path under `server/jobs/` or `server/services/skillAnalyzer*` issues an UPDATE touching these columns. A DB CHECK constraint is considered but not enforced (Postgres CHECK can't compare old-vs-new; a trigger is overkill at this scale).

### 11.12.8 Per-result retry already covered (DOCUMENTED)

Item 3 on the review list (`execution_state` per result, retry only failed/pending) is already in code at `skillAnalyzerService.ts:832`:

```ts
const approvedResults = results.filter(
  (r) => r.actionTaken === 'approved' && (!r.executionResult || r.executionResult === 'failed'),
);
```

`executionResult` already provides the state enum (`created | updated | skipped | failed | null`). Plan documents this; no change needed.

### 11.12.9 Auto-unlock stale execution lock (ACCEPTED — opt-in)

New config flag `execution_auto_unlock_enabled BOOLEAN NOT NULL DEFAULT false`. When enabled, `POST /execute` on a job whose `execution_lock=true` AND `execution_started_at < now() - execution_lock_stale_seconds` atomically reclaims the lock rather than 409-ing.

Default **off** because auto-unlock is the classic "zombie process" risk — a slow DB or paused container could still be executing and we'd happily start a second run. Manual unlock via `POST /jobs/:jobId/execute/unlock` (§11.11.3) stays as the recovery default.

### 11.12.10 Deferred

- **Collision-cache TTL / retention:** at current library size (<1000 skills × ~10 fragments each = 10k rows), the fragment cache is small. Revisit when library exceeds 5000 skills.

### Updated pre-implementation acceptance checklist

- [x] `approval_hash` + drift detection at Execute (non-blocking).
- [x] `was_approved_before` flag for post-approval-edit UX.
- [x] Sort warnings by severity before truncation.
- [x] `canonicalContentHash` for slug-collision idempotency.
- [x] Merge-wipe UI banner signals resolution reset.
- [x] Formalized `ExecuteResponse` shape.
- [x] `config_snapshot` immutable after job INSERT.
- [x] Auto-unlock gated behind explicit config flag (default off).




