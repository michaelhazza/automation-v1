# Skill Analyzer — Development Spec

**Version:** 1.0
**Date:** April 2026
**Status:** Draft — pending spec review
**Scope:** New feature — import, compare, and deduplicate skills from external sources

---

## Table of Contents

1. [Overview](#overview)
2. [Context and Research Summary](#context-and-research-summary)
3. [Architecture Decisions](#architecture-decisions)
4. [Database Schema](#database-schema)
5. [Service Layer](#service-layer)
6. [API Design](#api-design)
7. [Processing Pipeline](#processing-pipeline)
8. [Client Architecture and UX](#client-architecture-and-ux)
9. [Implementation Chunks](#implementation-chunks)
10. [File Inventory](#file-inventory)
11. [Migration Plan](#migration-plan)
12. [Testing Strategy](#testing-strategy)

---

## Overview

The Skill Analyzer is a new feature that lets users import skills from external sources, automatically compares them against the existing skill library using a hybrid pipeline (content hash, embedding similarity, LLM classification), and presents actionable recommendations for human review and action.

### Problem

As the platform's skill library grows and users research external skill sources (marketplaces, GitHub repos, exported skill packs), there is no way to absorb new skills without manually checking for duplicates, identifying improvements, or spotting partial overlaps. This is unsustainable at scale and error-prone even at the current library size of 53 system skills.

### Solution

A four-phase feature delivering:

1. **Pipeline** — a service that parses, embeds, compares, and classifies incoming skills against the existing library
2. **API** — REST endpoints for creating import jobs, polling progress, reviewing results, and executing approved actions
3. **UI** — a wizard-style interface for import, progress monitoring, result review, and action execution
4. **Persistence** — embedding cache in pgvector for incremental comparisons as the skill library grows

### Input Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| **Paste** | Free-text input, one or more skill definitions | Quick single-skill check |
| **Upload** | Zip file or individual `.md`/`.json` files | Bulk import from a marketplace or downloaded skill pack |
| **GitHub URL** | Point at a public repo or directory | Importing from public skill libraries |

### Output Classifications

| Classification | Meaning | Recommended Action |
|----------------|---------|-------------------|
| `DUPLICATE` | Same skill, different words | Skip import |
| `IMPROVEMENT` | Incoming skill does everything the existing one does, but better | Replace existing |
| `PARTIAL_OVERLAP` | Shared purpose but different scope or approach | Human decision: merge, keep both, or pick one |
| `DISTINCT` | Genuinely novel skill with no existing equivalent | Import as new |

### Cost Model

| Scale | Embedding Cost | LLM Cost | Time | Total |
|-------|---------------|----------|------|-------|
| 50 incoming vs 53 existing | ~$0.001 | $1–3 | ~1 min | ~$3 |
| 300 incoming vs 300 existing | ~$0.003 | $12–25 | ~10 min | ~$25 |

---

## Context and Research Summary

### Existing Infrastructure

The platform already has the building blocks this feature needs:

- **53 system skills** defined as `.md` files in `server/skills/` with YAML frontmatter + JSON tool definition + markdown instructions/methodology
- **Org-level skills** in the `skills` database table with the same structure
- **`server/lib/embeddings.ts`** — wraps OpenAI `text-embedding-3-small` (1536 dims) with a single-text `generateEmbedding()` function
- **pgvector extension** already loaded (`db-init/01-extensions.sql`) and used by `workspace_memories` and `org_memories` tables
- **Vector custom type** defined in `server/db/schema/workspaceMemories.ts` — reusable pattern for `vector(1536)` columns
- **`systemSkillService.ts`** — parses `.md` skill files from disk, in-memory cache
- **`skillService.ts`** — DB CRUD for org-level skills
- **pg-boss** — already used for all async job processing in the system
- **Anthropic adapter** at `server/services/providers/anthropicAdapter.ts` — existing LLM call pattern
- **Multer** — already configured for file uploads in the codebase

### Key Research Findings

The following findings from the research phase directly shaped the architecture:

1. **Anthropic has no embedding API.** OpenAI `text-embedding-3-small` at $0.02/MTok is the right choice. Already integrated in `server/lib/embeddings.ts`.

2. **In-memory cosine similarity is sufficient.** 600 vectors of 1536 dimensions = 3.6 MB memory. 90,000 pairwise comparisons complete in under 2 seconds. No vector database needed for batch comparison.

3. **Three-band threshold minimises LLM calls.** Pairs above 0.92 similarity are likely duplicates (quick confirmation). Pairs between 0.60–0.92 are ambiguous (full analysis). Pairs below 0.60 are distinct (no LLM call). This cuts LLM usage by 60–80%.

4. **Prompt caching saves 90% on classification calls.** The system prompt, rubric, and few-shot examples are identical across all comparison calls. Only the two skill documents change. Anthropic's prompt caching reduces input cost to 0.1x on cache hits with a 5-minute TTL.

5. **No platform has solved skill deduplication.** LangChain Hub, OpenAI GPT Store, CrewAI — none do automated duplicate detection. The hybrid approach (content hash → embedding similarity → LLM judgment) is state of the art.

6. **Content-addressed embedding cache** avoids re-embedding unchanged skills. SHA-256 of normalized content as the cache key means the same skill content always maps to the same embedding, regardless of source.

---

## Architecture Decisions

### AD1: Separate tables for jobs, results, and embeddings

The analyzer has its own lifecycle (create job → process → review → execute) that does not belong on the existing `skills` or `system_skills` tables. Three new tables:

- `skill_analyzer_jobs` — tracks import jobs with status, progress, and source metadata
- `skill_analyzer_results` — per-pair comparison results with classification, confidence, and user action
- `skill_embeddings` — content-addressed embedding cache shared across all skill types

This follows the same pattern as playbook runs (parent job + child records).

**Rejected:** Adding columns to the `skills` table. The analyzer is a distinct workflow; mixing it in would create confusing nullable columns and violate single responsibility.

### AD2: Content-addressed embedding cache (not skill-table columns)

Embeddings are stored in a dedicated `skill_embeddings` table keyed by SHA-256 of normalized skill content. This works because:

- System skills are file-based with no table rows to add columns to
- Both imported candidates and existing library skills need embeddings
- Content-addressed caching avoids re-embedding identical content regardless of source (system, org, or candidate)
- The same cache serves both batch comparison and future incremental comparison

**Rejected:** Adding a `vector(1536)` column to the `skills` table. System skills have no table rows, so this would only cover half the library.

### AD3: Use existing `anthropicAdapter` and `embeddings.ts` (not Vercel AI SDK)

The codebase has zero Vercel AI SDK dependencies. It uses direct fetch calls to the Anthropic API through `anthropicAdapter.ts` and to OpenAI through `server/lib/embeddings.ts`. Adding `@ai-sdk/anthropic`, `@ai-sdk/openai`, and `ai` as new dependencies for a single feature is not justified.

- **Embeddings:** Extend `server/lib/embeddings.ts` with a `generateEmbeddings(texts[])` batch function using the same OpenAI fetch pattern
- **LLM classification:** Use `anthropicAdapter` for Claude Haiku calls. Structured output via JSON-mode system prompt + Zod validation on the response (same pattern used elsewhere in the codebase)

### AD4: pg-boss for async processing

The pipeline takes 1–10 minutes. pg-boss is already the standard for async work across the platform. Single queue, progress updates persisted to the job row.

### AD5: Polling for progress (not WebSocket)

The UI polls `GET /api/skill-analyzer/jobs/:id` every 2 seconds. The pipeline has 6 coarse phases — frequent real-time updates are unnecessary. This is consistent with how other wizard-style flows in the codebase handle async jobs. WebSocket rooms are reserved for multi-user real-time features (task boards, run viewers).

### AD6: Permission gated by existing `org.agents.edit`

The skill analyzer modifies the skill library. The existing `org.agents.edit` permission already gates skill management. No new permission needed.

### AD7: GitHub access via unauthenticated REST API

For public repos, the GitHub REST API requires no token. Rate limit is 60 requests/hour per IP, which is sufficient for fetching a directory of skill files. If authenticated access is needed later (private repos), the user can configure a GitHub integration connection — but that's a follow-up, not part of v1.

---

## Database Schema

### Table: `skill_analyzer_jobs`

Tracks import/analysis jobs. One row per import session.

```sql
CREATE TABLE skill_analyzer_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations(id),
  created_by            uuid NOT NULL REFERENCES users(id),

  -- Source metadata
  source_type           text NOT NULL CHECK (source_type IN ('paste', 'upload', 'github')),
  source_metadata       jsonb NOT NULL DEFAULT '{}',
  -- paste:  { charCount: number }
  -- upload: { fileName: string, fileType: string, fileSize: number }
  -- github: { url: string, branch?: string, path?: string }

  -- Processing state
  status                text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'parsing', 'hashing', 'embedding',
                       'comparing', 'classifying', 'completed', 'failed')),
  progress_pct          integer NOT NULL DEFAULT 0,
  progress_message      text,
  error_message         text,

  -- Counts (populated during processing)
  candidate_count       integer,
  exact_duplicate_count integer DEFAULT 0,
  comparison_count      integer DEFAULT 0,

  -- Raw parsed candidates (JSONB array for replay/debug)
  parsed_candidates     jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);

CREATE INDEX skill_analyzer_jobs_org_idx
  ON skill_analyzer_jobs (organisation_id);
CREATE INDEX skill_analyzer_jobs_active_idx
  ON skill_analyzer_jobs (status)
  WHERE status NOT IN ('completed', 'failed');
```

### Table: `skill_analyzer_results`

One row per candidate-to-library-skill comparison result. Child of `skill_analyzer_jobs`.

```sql
CREATE TABLE skill_analyzer_results (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                    uuid NOT NULL REFERENCES skill_analyzer_jobs(id) ON DELETE CASCADE,

  -- Candidate skill
  candidate_index           integer NOT NULL,
  candidate_name            text NOT NULL,
  candidate_slug            text NOT NULL,

  -- Matched existing skill (null for DISTINCT)
  matched_skill_id          uuid,
  matched_system_skill_slug text,
  matched_skill_name        text,

  -- Classification
  classification            text NOT NULL
    CHECK (classification IN ('DUPLICATE', 'IMPROVEMENT', 'PARTIAL_OVERLAP', 'DISTINCT')),
  confidence                real NOT NULL,
  similarity_score          real,
  classification_reasoning  text,

  -- Diff data for side-by-side UI
  diff_summary              jsonb,

  -- User action
  action_taken              text CHECK (action_taken IN ('approved', 'rejected', 'skipped')),
  action_taken_at           timestamptz,
  action_taken_by           uuid REFERENCES users(id),

  -- Execution outcome
  execution_result          text CHECK (execution_result IN ('created', 'updated', 'skipped', 'failed')),
  execution_error           text,
  resulting_skill_id        uuid,

  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX skill_analyzer_results_job_idx
  ON skill_analyzer_results (job_id);
CREATE INDEX skill_analyzer_results_classification_idx
  ON skill_analyzer_results (job_id, classification);
```

### Table: `skill_embeddings`

Content-addressed embedding cache. Shared across system skills, org skills, and import candidates.

```sql
CREATE TABLE skill_embeddings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_hash      text NOT NULL,
  source_type       text NOT NULL CHECK (source_type IN ('system', 'org', 'candidate')),
  source_identifier text NOT NULL,
  embedding         vector(1536) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX skill_embeddings_hash_idx
  ON skill_embeddings (content_hash);
CREATE INDEX skill_embeddings_source_idx
  ON skill_embeddings (source_type, source_identifier);
```

**Notes:**
- `content_hash` is SHA-256 of normalized skill content (lowercase, stripped whitespace, sorted JSON keys)
- `source_type` distinguishes system skills (slug-identified), org skills (UUID-identified), and import candidates (`job:{jobId}:idx:{n}`)
- The unique index on `content_hash` means identical content is never embedded twice
- The `vector(1536)` column uses the same Drizzle `customType` pattern as `workspace_memories`

### Drizzle Schema Patterns

Each table gets its own schema file following existing conventions:

- `server/db/schema/skillAnalyzerJobs.ts`
- `server/db/schema/skillAnalyzerResults.ts`
- `server/db/schema/skillEmbeddings.ts`

All three exported from `server/db/schema/index.ts`.

---

## Service Layer

### Service: `skillEmbeddingService`

**File:** `server/services/skillEmbeddingService.ts`

Content-addressed embedding cache CRUD. Wraps the `skill_embeddings` table.

```typescript
export const skillEmbeddingService = {
  /** Get cached embedding by content hash. Returns null if not cached. */
  getByContentHash(contentHash: string): Promise<{ embedding: number[] } | null>;

  /** Store an embedding. Upserts on content_hash conflict. */
  store(params: {
    contentHash: string;
    sourceType: 'system' | 'org' | 'candidate';
    sourceIdentifier: string;
    embedding: number[];
  }): Promise<void>;

  /** Batch get embeddings by content hashes. Returns Map<hash, embedding>. */
  getByContentHashes(hashes: string[]): Promise<Map<string, number[]>>;

  /** Batch store embeddings. Uses upsert on content_hash conflict. */
  storeBatch(entries: Array<{
    contentHash: string;
    sourceType: 'system' | 'org' | 'candidate';
    sourceIdentifier: string;
    embedding: number[];
  }>): Promise<void>;
};
```

### Service: `skillParserService`

**Files:**
- `server/services/skillParserServicePure.ts` — pure parsing logic (no I/O)
- `server/services/skillParserService.ts` — impure wrappers (file I/O, GitHub fetch)

```typescript
// Normalized skill shape — the common format all sources are parsed into
export interface ParsedSkill {
  name: string;
  slug: string;
  description: string;
  definition: object | null;   // Anthropic tool JSON schema
  instructions: string | null;
  methodology: string | null;
  rawSource: string;           // Original text for diff display
}

// Pure functions (skillParserServicePure.ts)
export const skillParserServicePure = {
  /** Parse free-text paste into one or more skills.
   *  Splits on '---' separators and attempts to parse each block. */
  parseFromText(text: string): ParsedSkill[];

  /** Parse a single .md file (YAML frontmatter + JSON definition + markdown body) */
  parseMarkdownFile(filename: string, content: string): ParsedSkill | null;

  /** Parse a JSON skill definition */
  parseJsonFile(filename: string, content: string): ParsedSkill | null;

  /** Generate a slug from a name (kebab-case) */
  slugify(name: string): string;

  /** Normalize skill content for hashing.
   *  Lowercase, strip whitespace, sort JSON keys deterministically. */
  normalizeForHash(skill: ParsedSkill): string;
};

// Impure functions (skillParserService.ts)
export const skillParserService = {
  /** Parse uploaded files (handles .md, .json, .zip) */
  parseUploadedFiles(files: Express.Multer.File[]): Promise<ParsedSkill[]>;

  /** Fetch and parse skills from a GitHub repo URL.
   *  Uses GitHub REST API (unauthenticated, 60 req/hr rate limit). */
  parseFromGitHub(url: string): Promise<ParsedSkill[]>;

  /** Parse pasted text (delegates to pure function) */
  parseFromPaste(text: string): ParsedSkill[];
};
```

**GitHub fetch flow:** Extract owner/repo/path from URL → `GET /repos/{owner}/{repo}/contents/{path}` → filter `.md` and `.json` files → fetch each file's `download_url` → parse with the appropriate pure function. Retries with exponential backoff on rate limits.

**Zip handling:** Use `yauzl` (or Node.js built-in `zlib` for `.gz`) to extract files → parse each → clean up temp files. Max upload size: 50 MB.

### Service: `skillAnalyzerServicePure`

**File:** `server/services/skillAnalyzerServicePure.ts`

Pure analysis logic — no DB, no API calls. Fully testable with the `*Pure.ts` convention.

```typescript
export const skillAnalyzerServicePure = {
  /** SHA-256 hash of normalized skill content */
  contentHash(normalizedContent: string): string;

  /** Cosine similarity (dot product for pre-normalized OpenAI embeddings).
   *  Returns 0.0–1.0. */
  cosineSimilarity(a: number[], b: number[]): number;

  /** Classify similarity score into a comparison band.
   *  >0.92 → 'likely_duplicate'
   *  0.60–0.92 → 'ambiguous'
   *  <0.60 → 'distinct' */
  classifyBand(similarity: number): 'likely_duplicate' | 'ambiguous' | 'distinct';

  /** Build the LLM classification prompt for a candidate/library pair.
   *  Returns { system, userMessage } for the Anthropic API call.
   *  System prompt includes rubric + few-shot examples (cacheable). */
  buildClassificationPrompt(
    candidate: ParsedSkill,
    librarySkill: LibrarySkillSummary,
    band: 'likely_duplicate' | 'ambiguous'
  ): { system: string; userMessage: string };

  /** Parse LLM classification response. Validates with Zod.
   *  Returns null if response is unparseable. */
  parseClassificationResponse(response: string): ClassificationResult | null;

  /** Compute all pairwise similarities between candidates and library.
   *  Returns sorted by similarity (highest first).
   *  For each candidate, only the best match is returned. */
  computeBestMatches(
    candidateEmbeddings: Array<{ index: number; embedding: number[] }>,
    libraryEmbeddings: Array<{ id: string; slug: string; name: string; embedding: number[] }>
  ): Array<{
    candidateIndex: number;
    libraryId: string | null;
    librarySlug: string | null;
    libraryName: string | null;
    similarity: number;
    band: 'likely_duplicate' | 'ambiguous' | 'distinct';
  }>;

  /** Generate a structural diff summary between two skills.
   *  Used for the side-by-side UI view. */
  generateDiffSummary(
    candidate: ParsedSkill,
    librarySkill: LibrarySkillSummary
  ): { addedFields: string[]; removedFields: string[]; changedFields: string[] };
};
```

### Service: `skillAnalyzerService`

**File:** `server/services/skillAnalyzerService.ts`

Orchestrates the full pipeline. Creates pg-boss jobs. Handles CRUD for jobs and results.

```typescript
export const skillAnalyzerService = {
  /** Create a new analysis job and enqueue for background processing. */
  createJob(params: {
    organisationId: string;
    userId: string;
    sourceType: 'paste' | 'upload' | 'github';
    sourceMetadata: Record<string, unknown>;
    rawInput: string | Express.Multer.File[];
  }): Promise<{ jobId: string }>;

  /** Get job status and results. */
  getJob(jobId: string, organisationId: string): Promise<{
    job: SkillAnalyzerJob;
    results: SkillAnalyzerResult[];
  }>;

  /** List jobs for an org (most recent first, paginated). */
  listJobs(organisationId: string, limit?: number, offset?: number):
    Promise<SkillAnalyzerJob[]>;

  /** Set action on a single result. */
  setResultAction(params: {
    resultId: string;
    jobId: string;
    organisationId: string;
    userId: string;
    action: 'approved' | 'rejected' | 'skipped';
  }): Promise<void>;

  /** Bulk set action on multiple results. */
  bulkSetResultAction(params: {
    resultIds: string[];
    jobId: string;
    organisationId: string;
    userId: string;
    action: 'approved' | 'rejected' | 'skipped';
  }): Promise<void>;

  /** Execute all approved actions (create/update skills in the library). */
  executeApproved(params: {
    jobId: string;
    organisationId: string;
    userId: string;
  }): Promise<{
    created: number;
    updated: number;
    failed: number;
    errors: Array<{ resultId: string; error: string }>;
  }>;
};
```

### Extension: `server/lib/embeddings.ts`

Add a batch embedding function to the existing file:

```typescript
/** Generate embeddings for multiple texts in batches.
 *  Returns array parallel to input; null for any that failed.
 *  Uses OpenAI batch embedding API (up to 2048 inputs per call).
 *  Splits into batches of batchSize (default 100). */
export async function generateEmbeddings(
  texts: string[],
  options?: { batchSize?: number }
): Promise<(number[] | null)[]>;
```

### Job Handler: `server/jobs/skillAnalyzerJob.ts`

pg-boss job handler. Registered at server boot alongside existing workers.

```typescript
/** Process a skill analyzer job through all pipeline stages.
 *  Idempotent: deletes existing results before re-processing on retry.
 *  Updates job status and progress_pct at each stage transition.
 *  Max 1 retry with 5-minute delay on crash. */
export async function processSkillAnalyzerJob(jobId: string): Promise<void>;
```

---

## API Design

**Router file:** `server/routes/skillAnalyzer.ts`
**Mount point:** `/api/skill-analyzer`
**Auth:** All routes require `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT)`

### Endpoints

#### `POST /api/skill-analyzer/jobs` — Create analysis job

Creates a new job and enqueues it for background processing.

**Content types:**
- `application/json` — for paste and GitHub sources
- `multipart/form-data` — for file uploads

**Request bodies:**

```jsonc
// Paste
{ "sourceType": "paste", "text": "---\nname: My Skill\n..." }

// GitHub
{ "sourceType": "github", "url": "https://github.com/org/repo/tree/main/skills" }

// Upload: multipart/form-data with sourceType="upload" field + files
```

**Response:** `201 Created`
```json
{ "id": "uuid", "status": "pending", "createdAt": "2026-04-10T..." }
```

**Validation:**
- Paste: minimum 10 characters
- GitHub: valid URL matching `github.com/{owner}/{repo}` pattern
- Upload: `.md`, `.json`, `.zip` files only, max 50 MB total

#### `GET /api/skill-analyzer/jobs` — List jobs

**Query params:** `?limit=20&offset=0`

**Response:** `200 OK`
```json
{
  "jobs": [
    {
      "id": "uuid",
      "sourceType": "paste",
      "status": "completed",
      "progressPct": 100,
      "candidateCount": 12,
      "exactDuplicateCount": 2,
      "comparisonCount": 10,
      "createdAt": "...",
      "completedAt": "..."
    }
  ]
}
```

#### `GET /api/skill-analyzer/jobs/:jobId` — Get job with results

**Response:** `200 OK`
```json
{
  "job": { /* full job object */ },
  "results": [
    {
      "id": "uuid",
      "candidateName": "My Skill",
      "candidateSlug": "my-skill",
      "matchedSkillName": "Existing Skill",
      "matchedSkillId": "uuid-or-null",
      "matchedSystemSkillSlug": "slug-or-null",
      "classification": "IMPROVEMENT",
      "confidence": 0.87,
      "similarityScore": 0.84,
      "classificationReasoning": "The candidate has better...",
      "diffSummary": { "addedFields": [...], "removedFields": [...], "changedFields": [...] },
      "actionTaken": null,
      "executionResult": null
    }
  ]
}
```

#### `PATCH /api/skill-analyzer/jobs/:jobId/results/:resultId` — Set action

**Request:**
```json
{ "action": "approved" }
```

**Response:** `200 OK` `{ "ok": true }`

#### `POST /api/skill-analyzer/jobs/:jobId/results/bulk-action` — Bulk action

**Request:**
```json
{ "resultIds": ["uuid1", "uuid2"], "action": "approved" }
```

**Response:** `200 OK` `{ "ok": true, "count": 2 }`

#### `POST /api/skill-analyzer/jobs/:jobId/execute` — Execute approved actions

Applies all approved recommendations to the skill library.

**Response:** `200 OK`
```json
{
  "created": 5,
  "updated": 3,
  "failed": 0,
  "errors": []
}
```

**Execution logic per classification:**
- `DISTINCT` (approved) → `skillService.createSkill()` with candidate data as a new org skill
- `IMPROVEMENT` (approved) → `skillService.updateSkill()` on the matched skill with candidate's improved fields
- `PARTIAL_OVERLAP` (approved) → `skillService.createSkill()` as a new skill (keeps both)
- `DUPLICATE` (approved) → no-op (skip import, logged as `skipped`)

### Multer Configuration

For file upload endpoint:
```typescript
multer({
  dest: 'data/uploads/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.md', '.json', '.zip'];
    cb(null, allowed.some(ext => file.originalname.endsWith(ext)));
  }
})
```

---

## Processing Pipeline

The `processSkillAnalyzerJob` handler executes six sequential stages. Each stage updates the job's `status`, `progress_pct`, and `progress_message`.

### Stage 1: Parse (0% → 10%)

**Status:** `parsing`

1. Load the raw input from `parsed_candidates` (stored at job creation) or from the source (file/GitHub)
2. Call the appropriate parser: `parseFromPaste()`, `parseUploadedFiles()`, or `parseFromGitHub()`
3. Normalize each parsed skill into the `ParsedSkill` shape
4. Store `parsed_candidates` as JSONB on the job row
5. Update `candidate_count`

**Failure mode:** If zero skills are parsed, set status to `failed` with message "No valid skill definitions found in the provided input."

### Stage 2: Hash (10% → 20%)

**Status:** `hashing`

1. For each candidate, compute `contentHash(normalizeForHash(skill))`
2. Load all existing library skills (system via `systemSkillService.listActiveSkills()` + org via `skillService.listSkills(orgId)`)
3. Compute content hashes for library skills
4. Compare: any candidate whose hash matches a library skill is classified as `DUPLICATE` with confidence 1.0 immediately
5. Update `exact_duplicate_count`

**Output:** Two lists — exact-match duplicates (done) and remaining candidates (proceed to embedding).

### Stage 3: Embed (20% → 40%)

**Status:** `embedding`

1. Compute normalized content strings for all remaining candidates and all library skills
2. Check `skillEmbeddingService.getByContentHashes()` for cached embeddings
3. For uncached content, call `generateEmbeddings()` in batches of 100
4. Store new embeddings via `skillEmbeddingService.storeBatch()`
5. Progress updates at each batch completion

**Failure mode:** If the OpenAI API is unavailable, log a warning and classify all remaining candidates as needing LLM review (skip to Stage 5 with all pairs in the `ambiguous` band).

### Stage 4: Compare (40% → 60%)

**Status:** `comparing`

1. Call `computeBestMatches(candidateEmbeddings, libraryEmbeddings)`
2. For each candidate, find the single best-matching library skill
3. Classify each pair into a band: `likely_duplicate` (>0.92), `ambiguous` (0.60–0.92), `distinct` (<0.60)
4. Candidates in the `distinct` band are classified as `DISTINCT` with the similarity score as confidence
5. Update `comparison_count`

**Output:** Pairs to send to LLM (`likely_duplicate` + `ambiguous` bands) and pairs already classified (`distinct` band).

### Stage 5: Classify (60% → 90%)

**Status:** `classifying`

1. For each pair in the `likely_duplicate` or `ambiguous` band:
   a. Build the classification prompt via `buildClassificationPrompt()`
   b. Call Claude Haiku via `anthropicAdapter` with prompt caching enabled
   c. Parse the response via `parseClassificationResponse()`
   d. Generate `diffSummary` via `generateDiffSummary()`
2. Concurrency: `p-limit(5)` — max 5 parallel LLM calls
3. Progress updates: increment proportionally per completed classification

**LLM prompt structure:**
- **System prompt** (cached): classification rubric with explicit definitions for DUPLICATE/IMPROVEMENT/PARTIAL_OVERLAP/DISTINCT, 2-3 few-shot examples per category, instruction to return JSON
- **User message** (not cached): the two skill definitions side by side

**Expected response shape (validated with Zod):**
```typescript
z.object({
  classification: z.enum(['DUPLICATE', 'IMPROVEMENT', 'PARTIAL_OVERLAP', 'DISTINCT']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})
```

**Failure mode:** If an individual LLM call fails after retry, classify that pair as `DISTINCT` with confidence 0.3 and note "Classification failed — manual review recommended" in the reasoning field.

### Stage 6: Write Results (90% → 100%)

**Status:** `completed`

1. Delete any existing results for this job (idempotent retry support)
2. Insert all `skill_analyzer_results` rows (exact duplicates from Stage 2 + distinct from Stage 4 + LLM-classified from Stage 5)
3. Set job status to `completed`, `progress_pct` to 100, `completed_at` to now

---

## Client Architecture and UX

### Route

`/admin/skill-analyzer` — lazy-loaded page, gated by `org.agents.edit` permission.

### Component Structure

```
SkillAnalyzerPage.tsx              — page wrapper, job list + "New Analysis" button
  └── SkillAnalyzerWizard.tsx      — wizard container, manages step state
        ├── SkillAnalyzerImportStep.tsx     — source selection + input
        ├── SkillAnalyzerProcessingStep.tsx — progress bar + phase indicator
        ├── SkillAnalyzerResultsStep.tsx    — categorised results + actions
        │     └── SkillAnalyzerDiffView.tsx — side-by-side skill comparison
        └── SkillAnalyzerExecuteStep.tsx    — execution summary
```

### Step 1: Import

Three tabs: **Paste**, **Upload**, **GitHub URL**.

- **Paste tab:** Textarea (min 10 chars). Accepts one or more skill definitions separated by `---`. Placeholder text shows the expected `.md` format.
- **Upload tab:** File dropzone accepting `.md`, `.json`, `.zip`. Shows file list with names and sizes after selection. Max 50 MB total.
- **GitHub tab:** URL input with validation feedback. Accepts URLs in the format `https://github.com/{owner}/{repo}` or `https://github.com/{owner}/{repo}/tree/{branch}/{path}`.

Submit button creates the job via `POST /api/skill-analyzer/jobs`. On success, transitions to Step 2.

### Step 2: Processing

Polls `GET /api/skill-analyzer/jobs/:id` every 2 seconds.

Displays:
- Progress bar (0–100%) with animated fill
- Current phase name (Parsing → Hashing → Embedding → Comparing → Classifying → Complete)
- Phase-specific message from `progress_message`
- Candidate count when available ("Found 47 skills in the uploaded files")

On `failed` status: error banner with the error message and a "Start New Analysis" button.
On `completed` status: auto-transitions to Step 3.

Polling stops on `completed`, `failed`, or component unmount.

### Step 3: Results

Four collapsible sections, one per classification, each with a count badge:

| Section | Colour | Default State |
|---------|--------|---------------|
| DUPLICATE | Red/muted | Collapsed (low priority — usually skip) |
| IMPROVEMENT | Blue | Expanded (high value — usually approve) |
| PARTIAL_OVERLAP | Amber | Expanded (needs human judgment) |
| DISTINCT (New) | Green | Expanded (usually approve) |

Each result card shows:
- Candidate name and slug
- Matched skill name (if any) with similarity score and confidence
- Classification reasoning (1–3 sentences from the LLM)
- Expandable diff view (side-by-side comparison of candidate vs matched skill)
- Action buttons: Approve / Reject / Skip (toggleable, persisted immediately via PATCH)

**Bulk action bar** (sticky at top when results are visible):
- "Approve All Improvements" — bulk-approves all IMPROVEMENT results
- "Approve All New" — bulk-approves all DISTINCT results
- "Reject All Duplicates" — bulk-rejects all DUPLICATE results
- Custom bulk: checkbox selection + action dropdown

**Diff view** (`SkillAnalyzerDiffView.tsx`):
- Two-column layout: Candidate (left) vs Existing (right)
- Sections: Name, Description, Definition (JSON, syntax-highlighted), Instructions, Methodology
- Changed fields highlighted. Added/removed fields marked with green/red indicators.
- For DISTINCT results (no match), shows candidate only with "New skill — no existing match" label.

### Step 4: Execute

Shows summary of approved actions:
- N skills to create (DISTINCT + PARTIAL_OVERLAP approved)
- N skills to update (IMPROVEMENT approved)
- N skipped (DUPLICATE approved or any rejected)

"Execute" button calls `POST /api/skill-analyzer/jobs/:id/execute`.

Results display after execution:
- Success: "Created 5 skills, updated 3 skills"
- Partial failure: success count + error details inline
- Full failure: error banner

"Return to Skills" button navigates to the main skills page.

### State Management

Local React state within the wizard. No global store needed — this is a self-contained workflow.

Job ID stored in URL query parameter (`?jobId=xyz`) so the page survives browser refresh. On page load with a `jobId` param, the wizard resumes at the appropriate step based on job status.

### Navigation Entry Point

Add "Skill Analyzer" to the admin navigation under the Skills section, gated by `org.agents.edit` permission from `/api/my-permissions`. Visible as a secondary action alongside the existing skill management page.

### Loading, Empty, and Error States

| State | Display |
|-------|---------|
| Loading job data | Skeleton cards |
| No previous jobs | "No analyses yet. Start by importing skills." with prominent CTA |
| Zero candidates parsed | "No skill definitions found in the input. Check the format and try again." |
| All distinct | Results step shows only DISTINCT section: "All imported skills are new." |
| All duplicates | Results step shows only DUPLICATE section: "All imported skills already exist." |
| Pipeline failure | Full-width error banner with details and "Start New Analysis" button |
| Partial LLM failure | Results display normally; affected items show "Classification uncertain — manual review recommended" |

---

## Implementation Chunks

Seven chunks, ordered so each is independently buildable and testable.

### Chunk 1: Schema and Migration

**Create:**
- `server/db/schema/skillAnalyzerJobs.ts`
- `server/db/schema/skillAnalyzerResults.ts`
- `server/db/schema/skillEmbeddings.ts`
- `migrations/0092_skill_analyzer.sql`

**Modify:**
- `server/db/schema/index.ts` — add 3 new schema exports

**Verify:** `npm run db:generate` produces the expected migration. `npm run typecheck` passes.

**Depends on:** Nothing.

### Chunk 2: Embedding Infrastructure

**Create:**
- `server/services/skillEmbeddingService.ts`

**Modify:**
- `server/lib/embeddings.ts` — add `generateEmbeddings()` batch function

**Verify:** Batch splitting works (250 texts with batchSize=100 → 3 API calls). Content-hash dedup works (store, then get returns cached value without API call).

**Depends on:** Chunk 1.

### Chunk 3: Skill Parser Service

**Create:**
- `server/services/skillParserServicePure.ts`
- `server/services/skillParserService.ts`

**Verify:** Parses existing `server/skills/*.md` files correctly. Handles multi-skill paste (separated by `---`). Handles malformed input (skips, doesn't crash). Slug generation handles edge cases.

**Depends on:** Nothing (standalone parsing logic).

### Chunk 4: Skill Analyzer Pure Service

**Create:**
- `server/services/skillAnalyzerServicePure.ts`

**Verify:** Cosine similarity with known vectors. Band threshold boundaries (0.60 and 0.92 exactly). Hash determinism. Prompt construction produces valid format.

**Depends on:** Nothing (pure logic).

### Chunk 5: Skill Analyzer Service + Job Handler

**Create:**
- `server/services/skillAnalyzerService.ts`
- `server/jobs/skillAnalyzerJob.ts`

**Modify:**
- `server/index.ts` — register pg-boss worker for `skill-analyzer` queue

**Add dependency:** `p-limit` to `package.json`

**Verify:** Full pipeline with mock data. Idempotent retry (run twice, same results). Partial failure (embedding API down, some LLM calls fail). Progress updates at each phase.

**Depends on:** Chunks 1, 2, 3, 4.

### Chunk 6: API Routes

**Create:**
- `server/routes/skillAnalyzer.ts`

**Modify:**
- `server/index.ts` — import and mount router at `/api/skill-analyzer`

**Verify:** Auth gate (401 without token). Permission gate (403 without AGENTS_EDIT). Org scoping (user from org A cannot access org B's jobs). File upload with valid/invalid types. GitHub URL validation.

**Depends on:** Chunk 5.

### Chunk 7: Client Pages and Components

**Create:**
- `client/src/pages/SkillAnalyzerPage.tsx`
- `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx`
- `client/src/components/skill-analyzer/SkillAnalyzerImportStep.tsx`
- `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx`
- `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx`
- `client/src/components/skill-analyzer/SkillAnalyzerDiffView.tsx`
- `client/src/components/skill-analyzer/SkillAnalyzerExecuteStep.tsx`

**Modify:**
- `client/src/App.tsx` — add lazy import + route for `/admin/skill-analyzer`
- Navigation component — add nav item gated by `org.agents.edit`

**Verify:** Lazy loading works. Permission gating hides nav item for unprivileged users. Polling stops on unmount. Diff view handles null fields.

**Depends on:** Chunk 6.

---

## File Inventory

### New Files (16)

| File | Purpose |
|------|---------|
| `server/db/schema/skillAnalyzerJobs.ts` | Drizzle schema — analysis jobs |
| `server/db/schema/skillAnalyzerResults.ts` | Drizzle schema — comparison results |
| `server/db/schema/skillEmbeddings.ts` | Drizzle schema — embedding cache |
| `migrations/0092_skill_analyzer.sql` | Database migration |
| `server/services/skillEmbeddingService.ts` | Embedding cache CRUD |
| `server/services/skillParserService.ts` | Impure parsing (file I/O, GitHub fetch) |
| `server/services/skillParserServicePure.ts` | Pure parsing logic |
| `server/services/skillAnalyzerServicePure.ts` | Pure analysis logic (hashing, similarity, prompts) |
| `server/services/skillAnalyzerService.ts` | Pipeline orchestration + job/result CRUD |
| `server/jobs/skillAnalyzerJob.ts` | pg-boss job handler |
| `server/routes/skillAnalyzer.ts` | REST endpoints |
| `client/src/pages/SkillAnalyzerPage.tsx` | Main page |
| `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx` | Wizard container |
| `client/src/components/skill-analyzer/SkillAnalyzerImportStep.tsx` | Import step |
| `client/src/components/skill-analyzer/SkillAnalyzerProcessingStep.tsx` | Processing step |
| `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` | Results + diff + execute |

### Modified Files (4)

| File | Change |
|------|--------|
| `server/db/schema/index.ts` | Add 3 new schema exports |
| `server/lib/embeddings.ts` | Add `generateEmbeddings()` batch function |
| `server/index.ts` | Mount router + register pg-boss worker |
| `client/src/App.tsx` | Add lazy import + route |

---

## Migration Plan

**Single migration:** `migrations/0092_skill_analyzer.sql`

Contains:
1. `CREATE TABLE skill_analyzer_jobs` with indexes
2. `CREATE TABLE skill_analyzer_results` with indexes and ON DELETE CASCADE
3. `CREATE TABLE skill_embeddings` with unique index on `content_hash`

**Prerequisites:** pgvector extension already loaded (`db-init/01-extensions.sql`).

**No RLS policies** for v1 — these tables are org-scoped via service-layer filtering, consistent with other non-tenant-data tables like `playbook_templates`.

**New dependency:** `p-limit` — lightweight concurrency limiter for parallel LLM calls. Zero transitive dependencies.

**Environment variables:** None new. Uses existing `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.

---

## Testing Strategy

Following the project's testing conventions (`docs/testing-conventions.md`), testing investment is weighted toward static gates and pure-function unit tests.

### Static Gates

| Gate Script | What It Checks |
|-------------|---------------|
| `verify-skill-analyzer-service-pattern.sh` | `skillAnalyzerService.ts` does not import `db` directly (service-only pattern). Routes in `skillAnalyzer.ts` use `asyncHandler` and `authenticate`. |

### Pure Function Unit Tests

Following the `*Pure.ts` + `*.test.ts` convention:

| Test File | Covers |
|-----------|--------|
| `server/services/__tests__/skillParserServicePure.test.ts` | Markdown parsing, JSON parsing, multi-skill paste splitting, slug generation, content normalization |
| `server/services/__tests__/skillAnalyzerServicePure.test.ts` | Cosine similarity, band classification thresholds, content hashing determinism, LLM prompt construction, classification response parsing, diff summary generation |

### Smoke Test Extension

Add one assertion to the existing `agentExecution.smoke.test.ts` if the skill analyzer service is used by agents. Otherwise, no smoke test changes — the analyzer is a user-facing feature, not part of the agent execution pipeline.

### Manual Testing Checklist

For the wizard UI (not automated in the current phase per testing conventions):

- [ ] Paste a single skill → correct classification
- [ ] Paste multiple skills (separated by `---`) → all parsed correctly
- [ ] Upload a `.zip` of skill `.md` files → all parsed
- [ ] Enter a public GitHub repo URL → skills fetched and parsed
- [ ] Progress bar advances through all phases
- [ ] Results display in correct categories with correct colours
- [ ] Diff view shows side-by-side comparison
- [ ] Approve/reject actions persist (survive page refresh)
- [ ] Bulk actions work correctly
- [ ] Execute creates/updates skills in the library
- [ ] Permission gate hides the feature from unprivileged users
- [ ] Invalid inputs show appropriate error messages
