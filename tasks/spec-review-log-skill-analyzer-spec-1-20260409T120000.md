# Spec Review Log — Iteration 1

## Mechanical Findings — Accepted

[ACCEPT] Overview — DUPLICATE meaning stale ("different words" vs exact hash match)
  Fix applied: Updated DUPLICATE meaning to "Equivalent skill already in library (exact match or semantically identical)"

[ACCEPT] Overview — DISTINCT meaning overstated ("no existing equivalent" vs "no close match to best match")
  Fix applied: Updated DISTINCT meaning to "No close match found in the existing library (similarity below threshold to best match)"

[ACCEPT] Processing Pipeline Stage 1 / Database Schema — parsed_candidates contradiction (both input and output)
  Fix applied: Clarified lifecycle: paste/upload parsed synchronously at job creation, GitHub parsed in Stage 1. JSONB column comment updated.

[ACCEPT] Processing Pipeline Stage 1 — Upload file persistence not guaranteed for background worker
  Fix applied: Clarified that parsing happens in route handler for paste/upload before enqueueing; only GitHub defers to background.

[ACCEPT] AD7 / Service Layer — GitHub URL edge cases under-specified
  Fix applied: Added supported/unsupported URL patterns list and error handling notes.

[ACCEPT] Service Layer — ParsedSkill.definition shape unspecified
  Fix applied: Added comment clarifying Anthropic tool JSON schema shape with field names.

[ACCEPT] Service Layer — Paste splitting ambiguity with --- frontmatter
  Fix applied: Clarified splitting heuristic distinguishing multi-skill separator from YAML frontmatter.

[ACCEPT] Service Layer / Migration Plan — Stale .gz references
  Fix applied: Removed .gz alternative text from zip handling and Migration Plan sections.

[ACCEPT] Research Summary — "No vector database needed" conflated with "no vector persistence"
  Fix applied: Clarified that pgvector is a cache, not used for DB-side similarity queries.

[ACCEPT] Processing Pipeline Stage 3 — Embedding API fallback sequencing bug
  Fix applied: Changed failure mode from "skip to Stage 5" to "fail the job" since Stage 4 requires embeddings.

[ACCEPT] Service Layer — computeBestMatches output missing system/org type
  Fix applied: Added `type` to input and `libraryType` to output of computeBestMatches.

[ACCEPT] Service Layer — Cosine similarity normalization assumption undocumented
  Fix applied: Added documentation that OpenAI text-embedding-3-small returns L2-normalized vectors.

[ACCEPT] Job Handler — Idempotency timing (delete at end vs start)
  Fix applied: Changed to delete results at START of processing. Updated Stage 6 and job handler comment.

[ACCEPT] API Design / Service Layer — createJob return type mismatch
  Fix applied: Updated createJob return type to match API response shape.

[ACCEPT] API Design — Multer fileSize is per-file not total
  Fix applied: Changed "max 50 MB total" to "max 50 MB per file" in validation section and zip handling.

[ACCEPT] API / Execution / Schema — DUPLICATE approved semantics overlap with skipped
  Fix applied: Added clarifying note distinguishing action_taken='skipped' from execution_result='skipped'.

[ACCEPT] Processing Pipeline Stage 2/4 — Non-LLM results missing classification_reasoning
  Fix applied: Added default reasoning text for exact duplicates (Stage 2) and distinct candidates (Stage 4).

[ACCEPT] File Inventory — SkillAnalyzerDiffView.tsx missing
  Fix applied: Added to New Files table, updated count from 17 to 19 (also added verify script).

[ACCEPT] File Inventory — package.json missing from Modified Files
  Fix applied: Added package.json to Modified Files, updated count from 6 to 7.

[ACCEPT] Migration Plan — "non-tenant-data" stale justification
  Fix applied: Replaced stale language with accurate description of tenant-scoped tables using service-layer filtering.

[ACCEPT] Migration Plan — Results org scoping via join not documented
  Fix applied: Added explicit statement that result queries must join through jobs and filter by organisation_id.

[ACCEPT] Testing Strategy / File Inventory — verify script missing from inventory
  Fix applied: Added verify-skill-analyzer-service-pattern.sh to New Files table.

[ACCEPT] Execution logic — IMPROVEMENT merge contract under-specified
  Fix applied: Specified full field replacement preserving id/slug/orgId/createdAt, with Zod validation.

[ACCEPT] Database Schema / Service — parsed_candidates shape and candidate_index stability
  Fix applied: Added Notes section documenting immutability, index stability, and UI reconstruction pattern.

## Mechanical Findings — Rejected

[REJECT] Database Schema — skill_embeddings source_type/source_identifier misleading
  Reason: The spec already explicitly documents these as "debugging/provenance only" with a clear warning not to use for source-filtered queries. Codex missed the existing documentation.

[REJECT] AD6 / API / Client — Permission identifier inconsistency
  Reason: Standard codebase convention. org.agents.edit is the permission string, ORG_PERMISSIONS.AGENTS_EDIT is the TypeScript constant, /api/my-permissions is the client endpoint. All existing routes use this pattern consistently.

[REJECT] Database Schema / API — organisation_id vs organisationId naming inconsistency
  Reason: Standard codebase convention — snake_case in DB schema, camelCase in TypeScript services and API. Universal across the entire codebase.

[REJECT] Chunks / File Inventory — Layout.tsx assumption unstated
  Reason: Layout.tsx is explicitly named in the Modified Files table with its purpose. The codebase uses Layout.tsx for navigation. The connection is clear from context.

[REJECT] Testing / Service — "no direct db import" vs "handles CRUD" contradiction
  Reason: Codex misread the static gate. The gate checks that ROUTES don't import db directly (routes call services). Services DO access db — this is the standard codebase pattern documented in architecture.md.

## Directional Findings — Sent to HITL

See checkpoint file: tasks/spec-review-checkpoint-skill-analyzer-spec-1-20260409T120000.md

1. System skill IMPROVEMENT execution path undefined (Codex #1)
2. Single best match per candidate vs multi-match (Codex #6)
3. No tests for IMPROVEMENT against system skills (Codex #30, blocked by #1)
4. Intra-batch deduplication not defined (Codex #31)

## Iteration 1 Summary

- Mechanical findings accepted:  24
- Mechanical findings rejected:  5
- Directional findings:          4
- Ambiguous findings:            0
- Reclassified to directional:   0
- HITL checkpoint path:          tasks/spec-review-checkpoint-skill-analyzer-spec-1-20260409T120000.md
- HITL status:                   pending
