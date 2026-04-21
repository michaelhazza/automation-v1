# Spec Review Final Report

**Spec:** `docs/skill-analyzer-spec.md`
**Spec commit at start:** `b57fccd39eb0889e913fc527c4f32f6adb0aaac9`
**Spec commit at finish:** (unstaged local changes)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iterations run:** 3 of 5 (iteration 1 ran before this session; iterations 2-3 ran in this session)
**Exit condition:** two-consecutive-mechanical-only (iterations 2 and 3 both had zero directional/ambiguous findings)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|---|---|---|---|---|---|---|
| 1 | 31+ | 0 | 24 | 5 | 4 | 0 | resolved |
| 2 | 28 | 4 | 27 | 5 | 0 | 0 | none |
| 3 | 5 | 0 | 5 | 0 | 0 | 0 | none |

---

## Directional and ambiguous findings (resolved via HITL)

All from iteration 1, resolved by the human before this session began:

### Finding 1.1 — System skill IMPROVEMENT execution path
- **Classification:** directional
- **Decision:** apply-with-modification
- **Modification:** IMPROVEMENT against a system skill updates the `.md` file on disk and invalidates cache. Pure-function test for file-path resolution.

### Finding 1.2 — Multi-match for PARTIAL_OVERLAP
- **Classification:** directional
- **Decision:** apply-with-modification
- **Modification:** Expand to top-3 matches per candidate where similarity >= 0.60. One result row per pair. UI groups under candidate name. DUPLICATE/IMPROVEMENT keep top-1.

### Finding 1.3 — Tests for system skill IMPROVEMENT
- **Classification:** directional
- **Decision:** apply
- **Applied:** Added pure-function test coverage for system skill path resolution and improvement target decision logic.

### Finding 1.4 — Intra-batch deduplication
- **Classification:** directional
- **Decision:** apply-with-modification
- **Modification:** Detect during Stage 1 (not Stage 2) via content hash. Keep all indices, mark duplicates with `duplicateOfIndex`. Collapsed duplicates count toward `exact_duplicate_count`.

---

## Mechanical changes applied

Grouped by spec section:

### Database Schema
- Added `PersistedCandidate` type extending `ParsedSkill` with `duplicateOfIndex` and `occurrenceCount` fields
- Clarified that intra-batch duplicates are NOT stored in `skill_analyzer_results`
- Fixed `confidence` column to be nullable (null for deterministic stages: exact hash match, distinct band)
- Added `result_target_type`, `resulting_system_skill_slug` columns for system skill execution outcomes
- Specified `DiffSummary` type reference for `diff_summary` JSONB column
- Updated `content_hash` description to reference `normalizeForHash` spec instead of vague inline description
- Specified exact upsert semantics: `ON CONFLICT DO UPDATE` (last writer wins)
- Clarified `skill_analyzer_results` description for multi-match (one row per candidate-match pair)

### Service Layer — Shared Types
- Added `LibrarySkillSummary`, `ClassificationResult`, `DiffSummary`, `SkillAnalyzerJob`, `SkillAnalyzerResult`, and `SourceMetadata` type definitions
- Fixed `computeBestMatches` parameter to use `id: string | null` for system skills
- Fixed `computeBestMatches` doc to use band terminology (`likely_duplicate`/`ambiguous`) instead of classification terminology (`DUPLICATE`/`IMPROVEMENT`)
- Added `resolveUniqueSlug` pure function for slug conflict resolution
- Added `resolveSystemSkillPath` and `resolveImprovementTarget` pure functions
- Changed `generateDiffSummary` return type to `DiffSummary`
- Changed `createJob` input from `rawInput: string | Express.Multer.File[]` to discriminated union by `sourceType`

### Service Layer — skillAnalyzerService
- Added execution invariants: only processes `action_taken='approved' AND execution_result IS NULL`; repeat calls idempotent; action immutable after execution

### Service Layer — normalizeForHash
- Specified exact per-field normalization rules (case-preserved free text, JSON key sorting, null-byte field separator)

### API Design
- Added system skill execution path with `result_target_type`, `resulting_system_skill_slug`
- Added slug conflict resolution policy (`-imported`, `-imported-2`, etc.)
- Added action immutability after execution (409 on PATCH after execution)
- Added `systemSkillService.invalidateCache()` method contract
- Added PARTIAL_OVERLAP multi-match dedup during execution (only first approved row creates skill)
- Fixed GitHub URL validation to accept both `{owner}/{repo}` and `{owner}/{repo}/tree/{branch}/{path}`
- Added 500-candidate-per-job limit
- Expanded GET job response DTO to include `parsedCandidates` array
- Clarified Multer lifecycle: disk-backed with cleanup before enqueueing
- Specified prompt caching adapter contract (`cache_control: { type: 'ephemeral' }`)

### Processing Pipeline
- Moved intra-batch deduplication from Stage 2 to Stage 1 (before `parsed_candidates` freeze point)
- Added hash match precedence rule: prefer org skill over system skill
- Fixed Stage 4 distinct-band confidence to null (not similarity score)
- Added explicit reduction step between Stage 5 and Stage 6 for multi-match classification results
- Fixed failure handling to be candidate-scoped, not pair-scoped
- Added library skill content retention note (full `LibrarySkillSummary` map held in memory through Stages 3-5)
- Added parsing split clarification (sync for paste/upload, async for GitHub)
- Added execution guard preventing reprocessing after execution has occurred
- Added GitHub branch parsing contract (longest prefix matching against known branch names)

### Overview
- Fixed stale PARTIAL_OVERLAP recommended action from "merge, keep both, or pick one" to match actual approve/reject/skip workflow
- Marked cost model as non-normative research snapshot
- Marked "state of the art" claim with research date qualifier

### Architecture Decisions / Permissions
- Standardized all permission references to `ORG_PERMISSIONS.AGENTS_EDIT` with serialized form noted once

### Implementation Chunks / File Inventory
- Added `scripts/verify-skill-analyzer-service-pattern.sh` to Chunk 6
- Added `package.json` modification (yauzl) to Chunk 3
- Named `client/src/components/Layout.tsx` explicitly in Chunk 7

### Testing Strategy
- Added system skill path resolution and improvement target decision logic test coverage
- Changed ambiguous smoke test to normative "No smoke test changes in v1"

---

## Rejected findings

### Iteration 2

1. **Service Layer** — Stale numeric claims (53 system skills). Rejected: these are described as context, not implementation contracts. Marking the cost model as non-normative is sufficient without moving content to an appendix.

2. **Overview / Context** — "State of the art" language. Rejected as scope change (moving content to an appendix). Instead added a date qualifier.

3. **Processing Pipeline / Stage 1** — Move all parsing into the worker. Rejected: the sync-for-paste/upload pattern is intentional for UX (immediate 400 on bad input) and temp file cleanup. Clarification was added instead.

4. **Database Schema / source_metadata** — Add formal Zod schema for source_metadata. Rejected: the `SourceMetadata` type definition in Shared Types is sufficient for implementation. Runtime validation uses Zod at the route level, but the JSONB column does not need a Drizzle-level Zod contract.

5. **Service Layer / GitHub fetch flow** — Under-specified for slashed branch names. Applied as mechanical (added longest-prefix branch matching contract).

---

## Open questions deferred by `stop-loop`

None. All findings were resolved.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review. The human has adjudicated every directional finding that surfaced. However:

- The review did not re-verify the framing assumptions at the top of this document. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's Implementation philosophy / Execution model / Headline findings sections yourself before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.

**Recommended next step:** read the spec's framing sections (first ~200 lines) one more time, confirm the headline findings match your current intent, and then start implementation.
