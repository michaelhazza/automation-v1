---
title: Skill Analyzer v2 — System Scope + Agent Proposals + Merge View
date: 2026-04-11
status: draft
supersedes: docs/skill-analyzer-spec.md (extends, does not replace)
revision: 2 (post spec-reviewer iteration 1 HITL decisions)
---

# Skill Analyzer v2

## Table of contents

1. Summary
2. Motivation
3. Current state
4. Goals / non-goals
5. Data model
6. Pipeline
7. Review UI
8. Execute step
9. Edge cases
10. Build phases
11. Open items for the implementation plan

## 1. Summary

Four linked changes to the Skill Analyzer, landing as a single coherent feature:

1. **Migrate system skills to a DB-backed store (Phase 0).** Today `systemSkillService` is file-based — it loads `server/skills/*.md` into memory and exposes no create/update methods. The `system_skills` DB table exists but is dormant. Phase 0 backfills every markdown file into `system_skills`, rewrites `systemSkillService` to be DB-backed while preserving its full existing API surface (`invalidateCache`, `listSkills`, `listActiveSkills`, `listVisibleSkills`, `getSkill`, `getSkillBySlug`, `updateSkillVisibility`, `resolveSystemSkills`, `stripBodyForBasic` — see §10 Phase 0 for the authoritative method list) and adds two new methods `createSystemSkill` and `updateSystemSkill`, replaces the HTTP 405 handler on `POST /api/system/skills` with a create route wired to `createSystemSkill` (the `DELETE /api/system/skills/:id` 405 handler stays — this feature introduces no delete primitive), and retains file-based loading only as a seed path for fresh environments. Phase 0 is a prerequisite for everything that follows.
2. **Rescope the analyzer to system-only.** Once system skills are DB-backed, the analyzer reads and writes `system_skills` and operates on `system_agents`. The current org-skill write path in `executeApproved()` and the "Cannot update a system skill" rejection are removed. No org-level behaviour remains.
3. **Agent proposals for new skills.** During Processing, for every DISTINCT-classified candidate, the analyzer proposes the top-K=3 system agents by embedding cosine similarity. Pre-selection is based on a similarity threshold (default 0.50) so the default path is "Approve all" with zero clicks per card.
4. **Three-column merge view for partial overlaps.** The classify-stage LLM call is extended to also return a `proposedMerge` — a cherry-picked "best of both" version of the skill. The Review UI shows Current / Incoming / Recommended side-by-side per changed field. The Recommended column is editable inline and is what gets written on execute.

## 2. Motivation

- The current "Show field differences" panel only renders pills like `~ definition` — you can see which fields changed, not what changed. Reviewers have no way to make an informed call on partial overlaps without manually cross-referencing files.
- The analyzer never touches agent assignments. After importing 20 new skills, a human still has to go into every system agent and hand-attach each skill. This is tedious and error-prone for the thing the feature is meant to automate.
- The org-vs-system mismatch in `executeApproved()` means the tool as shipped cannot actually do what its URL and permissions suggest — it lives at `/api/system/skill-analyser/` with `requireSystemAdmin` but silently writes org skills.
- File-based system skills cap the feature's value. The whole point of the analyzer is letting system admins bulk-import and review skills through a browser UI. As long as system skills are markdown files in the repo, a system admin can stage changes in the analyzer but cannot commit them without an engineer in the loop. Phase 0 removes that cap.

## 3. Current state

### Skill Analyzer

- Routes: `server/routes/skillAnalyzer.ts` — `POST /api/system/skill-analyser/jobs`, `GET /api/system/skill-analyser/jobs`, `GET /api/system/skill-analyser/jobs/:jobId`, `PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId`, `POST /api/system/skill-analyser/jobs/:jobId/results/bulk-action`, `POST /api/system/skill-analyser/jobs/:jobId/execute`.
- Services: `server/services/skillAnalyzerService.ts` (impure) and `server/services/skillAnalyzerServicePure.ts` (pure).
- Background job: `server/jobs/skillAnalyzerJob.ts` — six-stage pipeline (parse → hash → embed → compare → classify → write).
- Classify stage: exact-duplicate matches are assigned `DUPLICATE` by hash match without an LLM call, low-similarity candidates are assigned `DISTINCT` by band without an LLM call, and **both** the `likely_duplicate` and `ambiguous` similarity bands go through the Claude Haiku classifier which returns `{ classification, confidence, reasoning }`. When `ANTHROPIC_API_KEY` is unset, all LLM-bound candidates fall back to `PARTIAL_OVERLAP` for human review.
- `executeApproved()` at `server/services/skillAnalyzerService.ts:174` writes to the `skills` table (org-scoped) via `skillService.createSkill()` / `updateSkill()`. Line ~228 actively rejects candidates that match a system skill with "Cannot update a system skill — approve as DISTINCT to create an org-level override instead".
- Client: `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` renders per-result cards with `DiffView` showing added/removed/changed field pills.

### System skills and system agents

- **System skills are file-based today.** `server/services/systemSkillService.ts` loads `server/skills/*.md` into an in-memory cache. Exports `invalidateCache`, `listSkills`, `listActiveSkills`, `listVisibleSkills`, `getSkill`, `getSkillBySlug`, `updateSkillVisibility` (rewrites markdown frontmatter), `resolveSystemSkills`, and `stripBodyForBasic`. **There is no `createSystemSkill` or `updateSystemSkill` method.**
- `server/routes/systemSkills.ts` explicitly returns HTTP 405 on `POST /api/system/skills` and `DELETE /api/system/skills/:id` with the message "System skills are managed as files in server/skills/. Use the codebase to add or modify skills."
- `server/db/schema/systemSkills.ts` defines a `system_skills` DB table with `id`, `slug`, `name`, `description`, `definition` (jsonb), `instructions` (text), `isActive`, `createdAt`, `updatedAt`. **A grep across `server/` shows no code currently reads from or writes to that table.** It is a dormant schema definition.
- System agents live in a separate `system_agents` table with two skill slots: `defaultSystemSkillSlugs` (locked from org admins) and `defaultOrgSkillSlugs` (exposed to orgs when they install the agent). This feature writes to `defaultSystemSkillSlugs`.
- `systemAgentService.updateAgent()` at `server/services/systemAgentService.ts:109-112` rewrites the agent's `slug` whenever its `name` changes via `slugify(data.name)`. The slug is therefore not a stable identity key across the analysis-to-execute window — this is why agent proposals are keyed by `systemAgentId`, not slug (see §5.2).
- `skill_analyzer_results` (schema file `server/db/schema/skillAnalyzerResults.ts` lines 32–34) currently has THREE match-pointer columns: `matchedSkillId: uuid`, `matchedSystemSkillSlug: text`, `matchedSkillName: text`. This feature collapses them to a single `matchedSkillId` pointing at `system_skills.id` (see §5.3).

### What this feature adds

- New table `agent_embeddings` (§5.1).
- New columns on `skill_analyzer_results`: `agentProposals`, `proposedMergedContent`, `originalProposedMerge`, `userEditedMerge` (§5.2).
- New columns on `system_skills`: `visibility`, `handlerKey` (§5.5, Phase 0).
- Drops columns on `skill_analyzer_results`: `matchedSystemSkillSlug`, `matchedSkillName` (§5.3).
- New service `server/services/agentEmbeddingService.ts` (§10 Phase 2).
- New pure helpers in `skillAnalyzerServicePure.ts`: `rankAgentsForCandidate`, `buildClassifyPromptWithMerge`, `parseClassificationResponseWithMerge` (§10 Phase 2–3).
- DB-backed rewrite of `systemSkillService` preserving its full existing public API surface (see §10 Phase 0 for the complete method list) and adding two new methods `createSystemSkill` and `updateSystemSkill`.
- Phase 0 also ships these load-bearing artifacts (full contracts in §10 Phase 0): backfill script `scripts/backfill-system-skills.ts`, startup validator `server/services/systemSkillHandlerValidator.ts` exporting `validateSystemSkillHandlers()`, handler-registry refactor in `server/services/skillExecutor.ts` (switch → `SKILL_HANDLERS` constant), bootstrap wiring in `server/index.ts` to call the validator before `httpServer.listen()`, replacement of the 405 handler on `POST /api/system/skills` in `server/routes/systemSkills.ts` with a `createSystemSkill`-wired create route, and a `server/skills/README.md` note clarifying markdown files are now a seed source.

## 4. Goals / non-goals

**Goals**
- System skills are DB-backed. `systemSkillService` preserves its full existing public API surface with DB-backed implementations (complete method list in §10 Phase 0) and adds two new methods `createSystemSkill` and `updateSystemSkill` (both accept an optional `{ tx }` for transaction threading — see §8.1). The `server/skills/*.md` files become a seed source for fresh environments and are no longer the runtime source of truth.
- Analyzer reads the library from `system_skills` and writes approved outcomes back to `system_skills`.
- Every DISTINCT result ships with up to three pre-computed system agent proposals, keyed by stable `systemAgentId`. Proposals with score ≥ threshold are pre-selected, so "Approve all new" applies them without further clicks.
- Every PARTIAL_OVERLAP / IMPROVEMENT result ships with an LLM-proposed merged version. The Review UI shows Current, Incoming, and Recommended side-by-side. The Recommended column is editable. Executing an approved partial overlap writes the (possibly edited) Recommended content back to the library skill.
- Correctness: executing cannot half-commit. For each approved DISTINCT result, the skill write and the agent assignments for every still-existing selected agent either all happen or all roll back together per result. Atomicity is possible because both writes are now DB operations wrappable in a single transaction. Missing (deleted between analysis and execute) selected agents are logged and silently skipped, not treated as a rollback condition — see §8 and §9 for the full contract.

**Non-goals**
- No org-level analyzer flow. The analyzer is system-only after this feature. If a future requirement exists for an org-level analyzer, it will be a separate spec.
- No subaccount-tier agent proposals.
- No LLM-generated reasoning text on agent proposals — similarity score only, keeps cost flat.
- No partial-overlap agent reassignment UI. If a skill already exists, its existing agent attachments are not touched.
- No in-session admin UI for editing system skills outside the analyzer. Phase 0 makes `createSystemSkill` and `updateSystemSkill` exist on the service, but a separate CRUD UI is a follow-on concern.
- Phase 0 does NOT delete the markdown files under `server/skills/`. They remain in the repo as the seed source. A later cleanup task can decide whether to retire them once the DB has been the source of truth for long enough.

## 5. Data model

### 5.1 New table `agent_embeddings`

Mirrors `skill_embeddings`.

| Column | Type | Notes |
|---|---|---|
| `systemAgentId` | uuid PK | FK to `system_agents.id`, on delete cascade |
| `contentHash` | text not null | SHA-256 of the content used to embed |
| `embedding` | vector(1536) | OpenAI `text-embedding-3-small` (same model as `skill_embeddings`) |
| `updatedAt` | timestamptz default now() | |

Embedding content: `name + "\n" + description + "\n" + masterPrompt` joined. Recomputed lazily when the content hash differs from the stored hash. System agents have no `additionalPrompt` (that is an org-level concept), so it is not included.

### 5.2 New columns on `skill_analyzer_results`

| Column | Type | Notes |
|---|---|---|
| `agentProposals` | jsonb not null default `'[]'` | Array of `{ systemAgentId: uuid, slugSnapshot: string, nameSnapshot: string, score: number, selected: boolean }`, ordered by score desc. Populated only for DISTINCT results; stays `[]` for other classifications and also for DISTINCT results when no system agents exist. `systemAgentId` is the stable identity key because `systemAgentService.updateAgent()` rewrites the agent's slug when its name changes. `slugSnapshot` and `nameSnapshot` are display-only copies captured at analysis time; the execute path looks up the live `system_agents` row by `systemAgentId` (to confirm the agent still exists and to read its current `defaultSystemSkillSlugs` array) and then appends the newly created skill's slug to that array. The agent's own slug is never the thing being appended — `defaultSystemSkillSlugs` stores skill slugs, not agent slugs. |
| `proposedMergedContent` | jsonb | Nullable. Shape: `{ name: string, description: string, definition: object, instructions: string \| null }` where `definition` is the Anthropic tool-definition JSON object (matching `system_skills.definition`). Non-null only for PARTIAL_OVERLAP / IMPROVEMENT results where the LLM call succeeded. Editable via PATCH. |
| `originalProposedMerge` | jsonb | Nullable. Immutable after the Write stage. Stores the LLM's untouched merge so the UI's "Reset to AI suggestion" can revert `proposedMergedContent` to the original. |
| `userEditedMerge` | boolean not null default false | Set true when the user edits any field in `proposedMergedContent` via the Review UI. Used to display the "edited" indicator and to gate the "Reset to AI suggestion" link. |
| `candidateContentHash` | text not null | SHA-256 of the candidate's normalized content, computed during the Hash stage (§6 step 2) and persisted here during the Write stage. Enables the Phase 4 manual-add flow: when the `PATCH /agents` endpoint runs with `addIfMissing: true`, the server reads `candidateContentHash` from the result row and looks up the pre-computed embedding in `skill_embeddings` by `contentHash` **only** — the lookup must NOT filter on `sourceType`, because `skill_embeddings` is content-hash-keyed and upsert-on-hash, and its own schema note (`server/db/schema/skillEmbeddings.ts`) explicitly warns that `sourceType` reflects the last writer and must not be used for source-filtered reads. If a system/org skill later upserts the same hash, the row is still the correct embedding for this content; the hash is the identity key, not the source. Without this column, the manual-add flow would need to either recompute the candidate embedding synchronously (adding an OpenAI call to the hot path, violating the "keeps cost flat" non-goal) or maintain a cross-process in-memory cache (incompatible with the Express/pg-boss process split). The column is populated for every result row regardless of classification, because any DISTINCT row may later receive a manual-add PATCH. Pre-production framing: the NOT NULL constraint ships without a backfill because `skill_analyzer_results` has no live data that matters — same rationale as the §5.3 column-drop migration; see `docs/spec-context.md` for the pre-production no-live-data framing. |

One migration in `migrations/`, next free sequence number. No raw SQL — Drizzle-generated.

### 5.3 Match-pointer consolidation

Today `skill_analyzer_results` has three match-pointer columns: `matchedSkillId` (uuid), `matchedSystemSkillSlug` (text), and `matchedSkillName` (text). This feature collapses them to one.

**In the same migration as 5.1 / 5.2:**
- Keep `matchedSkillId`. Re-point it at `system_skills.id` (the DB PK). Soft foreign key — no FK constraint — because the analyzer uses it as a lookup hint.
- **Drop `matchedSystemSkillSlug`.** The new `matchedSkillContent` field in the GET jobs response (§7.4) provides the slug at read time via a live lookup on `system_skills.id`.
- **Drop `matchedSkillName`.** Same rationale — `matchedSkillContent` provides the name at read time.

Data migration: existing analyzer jobs that still have `matchedSystemSkillSlug` set and `matchedSkillId = null` are a pre-production concern only. Because this codebase has no live data in `skill_analyzer_results` that matters, the migration drops the columns outright without a backfill. If that assumption is wrong at implementation time, the architect's plan must add a Phase 0.5 to backfill `matchedSkillId` from the slug before the drop.

### 5.4 No scope column on `skill_analyzer_jobs`

The analyzer is system-only after this feature. Adding a `scope` column would imply future org-level support and invite the same mismatch again. Leave it out.

### 5.5 System skills schema additions (Phase 0)

Phase 0 extends `system_skills` with two new columns to close the "data refers to code" drift window that opens the moment skill rows become editable through the UI instead of via source-controlled markdown files.

| Column | Type | Notes |
|---|---|---|
| `visibility` | text not null default `'none'` | CHECK constraint `visibility IN ('none', 'basic', 'full')`. Preserves the three-state visibility cascade the current in-memory `SystemSkill` interface already uses (see §3). `isActive` and `visibility` are **two orthogonal flags**: `isActive` gates whether the skill is enabled at all; `visibility` gates which tier (basic/full) can see it. `listVisibleSkills` filters on `isActive = true AND visibility != 'none'`; `stripBodyForBasic` depends on the tri-state cascade; neither can be collapsed to a boolean. |
| `handlerKey` | text not null UNIQUE | The registry key that identifies which TypeScript handler function this skill row pairs with. Must resolve to a key in the `SKILL_HANDLERS` registry constant (see §10 Phase 0) at backfill time, at `createSystemSkill` call time, and at server startup via `validateSystemSkillHandlers()`. For backfilled rows from `server/skills/*.md`, `handlerKey` is set equal to `slug`. For new rows created via the analyzer, `handlerKey` is set equal to the candidate's `slug` at create time. `UNIQUE` matches the `handlerKey = slug` invariant — slug is already unique, and this constraint makes the invariant enforceable at the schema level. If aliasing (multiple skill rows pointing at the same handler) is ever needed, the constraint can be dropped in a follow-up migration; no current use case. |

**`handlerKey` is a write-time and boot-time validation key, not a runtime dispatch key.** Runtime dispatch in `skillExecutor.execute()` continues to key on the slug the agent passes in its tool call, unchanged from today. The invariant `handlerKey = slug` is enforced at three write-time gates — the Phase 0 backfill script, `createSystemSkill`, and the analyzer execute gate in §8 — and at one boot-time gate — `validateSystemSkillHandlers()`. `updateSystemSkill` does not accept a `handlerKey` patch (see §10 Phase 0 signature), so divergence is structurally impossible after row creation. Under this posture `slug` remains the single source of truth for runtime dispatch; `handlerKey` is the schema-level proof that every row has an engineer-written handler behind it.

Both columns ship in the same Phase 0 migration as the backfill from markdown files. The backfill script reads `visibility` from frontmatter (defaulting to `'none'` if absent) and sets `handlerKey = slug` for every imported row. See §10 Phase 0 for the full Phase 0 contract including the handler-registry refactor and the startup validator.

## 6. Pipeline

Stage layout after this feature (progress percentages in parentheses):

1. **Parse** (0 → 10) — unchanged.
2. **Hash** (10 → 20) — unchanged algorithm, library source switched to `system_skills` via the new DB-backed `systemSkillService`.
3. **Embed** (20 → 40) — unchanged algorithm, library source `system_skills`.
4. **Compare** (40 → 55) — unchanged algorithm, library source `system_skills`.
5. **Classify** (55 → 75) — extended prompt and response schema (see 6.1).
6. **Agent-embed** (75 → 80) — new. Refresh stale agent embeddings for all `system_agents` rows. No-op when everything is fresh.
7. **Agent-propose** (80 → 90) — new. For each DISTINCT result, compute cosine similarity against every system agent embedding, take the top-K=3 by score (regardless of threshold), write to `agentProposals` with `selected: (score >= AGENT_PROPOSAL_THRESHOLD)`. The top-K slice is always persisted in full; the threshold decides only which chips are pre-checked in the UI.
8. **Write** (90 → 100) — unchanged shape; writes the new columns too, including `candidateContentHash` (the SHA-256 computed during the Hash stage at step 2) which is persisted on every result row so the Phase 4 manual-add PATCH can look up the candidate's pre-computed embedding in `skill_embeddings`.

### 6.1 Extended classify prompt

The current prompt returns `{ classification, confidence, reasoning }`. Extend it to also produce, when classification is `PARTIAL_OVERLAP` or `IMPROVEMENT`, a `proposedMerge` object:

```json
{
  "classification": "PARTIAL_OVERLAP",
  "confidence": 0.72,
  "reasoning": "Incoming adds a concrete example block and tightens the definition. Instructions section is structurally similar but incoming is more specific.",
  "proposedMerge": {
    "name": "…",
    "description": "…",
    "definition": {
      "name": "…",
      "description": "…",
      "input_schema": { "type": "object", "properties": { /* … */ } }
    },
    "instructions": "…"
  }
}
```

Field types inside `proposedMerge`:

- `name`: string.
- `description`: string.
- `definition`: JSON object matching the Anthropic tool-definition shape stored in `system_skills.definition` (jsonb) — the same shape the backfill script produces and the same shape the analyzer's candidate parser already emits (`definition: object | null`). Never a string.
- `instructions`: string (markdown body). Can be null if the incoming candidate had no instructions section.

Prompt instruction: *"If classification is PARTIAL_OVERLAP or IMPROVEMENT, produce a proposedMerge that takes the best of both — preserve what works in the library version, incorporate genuine improvements from the incoming version. Do not hallucinate novel content. Each field must be grounded in either the library or incoming text. `definition` must be a JSON object in the Anthropic tool-definition shape, not a string."*

For DUPLICATE and DISTINCT, `proposedMerge` is omitted and both `proposedMergedContent` and `originalProposedMerge` stay null.

When the LLM returns a valid `proposedMerge`, the Write stage persists it into **both** `proposedMergedContent` (mutable, the user-editable copy) and `originalProposedMerge` (immutable, the baseline the Reset endpoint copies back from). The two are identical at write time and diverge only when the user edits the Recommended column.

### 6.2 Agent-propose edge cases

- **Zero system agents** → skip agent-embed and agent-propose entirely. `agentProposals` stays `[]` on every result.
- **One system agent** → still run. It gets a proposal row. It either scores ≥ threshold and appears pre-checked, or it scores below and appears unchecked.
- **Fewer than 3 system agents** → top-K is truncated to however many agents exist (K = min(3, agent_count)). No padding.
- **Similarity threshold** — named constant `AGENT_PROPOSAL_THRESHOLD = 0.50` in `skillAnalyzerServicePure.ts`, tunable in one place. Drives pre-selection only; it does not filter which proposals are persisted.
- **Top-K** — named constant `AGENT_PROPOSAL_TOPK = 3`.
- **Manual-add flow** (user picks a system agent not already in `agentProposals`): the server refreshes that agent's embedding if stale, computes live cosine similarity against the candidate, inserts `{ systemAgentId, slugSnapshot, nameSnapshot, score: computedScore, selected: true }` into `agentProposals`, and **re-sorts the full array by `score` descending** so the stored-order invariant from §5.2 holds after every write. Score is always real — never null — because the agent's embedding is guaranteed to exist after the refresh step.

### 6.3 LLM fallback

If the classify LLM call fails or is unavailable (API key missing, rate limit, network), **all LLM-bound results (both `likely_duplicate` and `ambiguous` similarity bands)** fall back to the existing "routed for human review" path — classification is set to `PARTIAL_OVERLAP` for human review, matching the current fallback behaviour. `proposedMergedContent` and `originalProposedMerge` stay null for every fallback row. The Review UI shows a "Proposal unavailable — re-run analysis after classifier is back online" message in place of the three-column diff. Execute rejects these rows with a clear error rather than guessing.

## 7. Review UI

### 7.1 Per-card layout

All cards keep the existing header: candidate name, slug, match info, reasoning, action buttons. Two additions below that, scoped by classification:

**New Skill cards** — "Assign to system agents" block:

```
Assign to system agents:
  [✓ marketing-agent 78%]  [✓ outreach-agent 61%]  [  content-agent 52%]
  [+ Add another system agent…]
```

- Chips render from `agentProposals` in the order stored (score desc). The chip label is the `nameSnapshot`; the score badge is `score`.
- Pre-checked chips are those with `selected: true` (i.e. score ≥ `AGENT_PROPOSAL_THRESHOLD` at analysis time, or manually added).
- Unchecked chips are the below-threshold top-K proposals — they are visible so the reviewer can promote them with one click if the AI under-scored an obvious fit.
- Click toggles `selected` on that proposal and PATCHes the row (see §7.3).
- "Add another…" opens a combobox of system agents not already in `agentProposals`, populated from the job's `availableSystemAgents` array. Picking an agent triggers a manual-add flow: the server refreshes that agent's embedding if stale, computes live similarity, and appends a fully-scored proposal with `selected: true` (see §6.2 manual-add flow).
- Chips display the `nameSnapshot` captured at analysis time, not the live name. The execute step uses `systemAgentId` for the actual attach, so a rename between analysis and execute does not break the assignment — it only makes the chip label slightly stale until the next analysis run.
- Scoped to New Skill cards only. Partial overlap cards have no agent block.

**New Skill cards — Handler status block** (rendered above the Assign-to-system-agents block):

```
Handler: ✓ registered          ← happy path, subtle green badge
  — or —
Handler: ✗ no handler registered for this skill
  An engineer must add an entry to SKILL_HANDLERS in
  server/services/skillExecutor.ts before this skill can be imported.
  [Approve] button is disabled.
```

- The job's `GET /jobs/:id` response shape is extended with `unregisteredHandlerSlugs: string[]` at the job level — a single live snapshot of which candidate slugs have no corresponding key in `SKILL_HANDLERS` at read time. Clients derive per-card state by checking `unregisteredHandlerSlugs.includes(result.candidateSlug)`.
- When a card's slug is unregistered: the card renders a red-bordered warning block above the agent block, the `Approve` button is visually disabled with an explanatory tooltip (*"No handler registered for this skill. An engineer must add an entry to SKILL_HANDLERS in server/services/skillExecutor.ts before this skill can be imported."*), the `Reject` and `Skip` buttons remain enabled (the reviewer can still dismiss the card), and the agent chip block is hidden entirely (there's no point assigning a broken skill to agents).
- When a card's slug IS registered: the card renders a subtle "Handler: ✓ registered" badge (small, muted colour) as reassurance, and the Approve button works normally. This is the happy path and should not dominate the card's visual weight.
- "Approve all new" bulk action respects the gate: it filters out cards with unregistered handler slugs before submitting the bulk-action request, client-side, and surfaces an info banner if any were excluded: *"Approved N, skipped M (no handler registered — engineer must wire up handlers first)"*. This mirrors the "Approve all partial overlaps (with proposal)" eligibility-filter pattern in §7.2.
- Partial overlap cards never show the handler warning in the Review UI — they update existing `system_skills` rows that are guaranteed (by the startup validator invariant) to have registered handlers for the `isActive = true` rows the validator checks. If an active existing row's `handlerKey` somehow drifted to an unregistered state, the server would have failed to boot; a running server implies every **active** existing row is paired. Inactive rows (`isActive = false`) are a known gap: the startup validator ignores them (see §10 Phase 0), and `listSkills()` returns all rows regardless of `isActive`, so the analyzer can match an incoming candidate against an inactive matched row whose `handlerKey` is no longer registered. **This edge case is handled server-side at execute time, not in the Review UI**: the §8 PARTIAL_OVERLAP branch re-reads the matched row and fails with a specific executionError if its slug is not in `SKILL_HANDLERS`, so the reviewer discovers the problem when they click Approve. The Review UI intentionally shows no warning for partial-overlap cards — the server is the authority here, and the execute-time failure path (parallel to the Phase 1→4 window for DISTINCT cards) is the single source of truth.

**Partial Overlap cards** — "Recommended changes" block (the three-column diff):

```
╭─ Current (library) ──╮  ╭─ Incoming ────────╮  ╭─ Recommended ★ ────╮
│ [ours as-is]         │  │ [theirs as-is]    │  │ [editable merge]   │
╰──────────────────────╯  ╰───────────────────╯  ╰────────────────────╯
```

- One row per changed field. Short fields (`name`, `description`) render as single-line inputs in the Recommended column. Long fields (`definition`, `instructions`) render as autosizing textareas.
- The Recommended column is visually primary — colored border, `★` marker, slightly wider. It shows inline diff highlighting against Current (green insertions, red strikethrough deletions) so reviewers can see at a glance what the merge changes.
- Current and Incoming render raw — no diff highlighting.
- On screens narrower than ~1100px, the three panels collapse to a tab strip `[Current] [Incoming] [Recommended ★]` with Recommended active by default.
- Long-field diffs use synced scrolling across the three columns so a reviewer can scan a specific section across all three sources.
- Top of the block shows the one-line reasoning from the classifier: "Incoming adds a concrete example section — preserved your output format."
- Edits to the Recommended column debounce (300ms) and PATCH to a new endpoint (7.3). Editing any field flips `userEditedMerge` to true and surfaces an "edited" marker next to the ★ header.
- "Reset to AI suggestion" link (right-aligned) copies `originalProposedMerge` into `proposedMergedContent` and clears `userEditedMerge`. Disabled when `userEditedMerge` is false.
- Validation: inherit whatever `systemSkillService.updateSystemSkill()` accepts (after the Phase 0 DB rewrite). The `definition` field is a tool-schema JSON object (see §6.1) — the Recommended column renders it as a JSON textarea, parses on blur, and shows an inline error on bad JSON. `name`, `description`, and `instructions` are plain text fields with no structured-parsing step.
- When `proposedMergedContent` is null (LLM fallback path) OR when `matchedSkillContent` is omitted from the response (the library skill was deleted after analysis — see §7.4), the three-column block is replaced by a single-line notice "Proposal unavailable — re-run analysis after classifier is back online" with a link to the Import step. The renderer never has to partially render the three-column view: either all three columns have content, or the fallback notice replaces the whole block. Execute-time handling for both cases is identical — the §8 PARTIAL_OVERLAP branch rejects the row with a clear error.

### 7.2 Bulk action behaviour

**"Approve all new"** — unchanged semantically: bulk-approve all DISTINCT results. `agentProposals` carries pre-selected suggestions, so approving all new also commits the suggested agent assignments per row. The user does not need to touch any card to get a sensible default — only to disagree.

**"Approve all partial overlaps (with proposal)"** — a new bulk button on the Partial Overlaps section. The contract:

- **Button state:** enabled when at least one row in the section has `classification IN (PARTIAL_OVERLAP, IMPROVEMENT)` AND `proposedMergedContent IS NOT NULL`. Disabled when no such rows exist. Label includes the eligible count, e.g. "Approve all partial overlaps (8 with proposals)".
- **Request:** client-side, the handler filters the rows to those matching the eligibility predicate above, then POSTs to the existing `POST /api/system/skill-analyser/jobs/:jobId/results/bulk-action` endpoint with `{ action: 'approved', resultIds: <filtered list> }`.
- **Rows with null `proposedMergedContent` are NOT included in the request.** They remain with `actionTaken = null` in the DB — they are not set to `'skipped'`. Conflating "user explicitly skipped" with "LLM could not produce a merge" would lose information.
- **Info banner:** if any rows were excluded, a transient banner appears above the section: "Approved 8, skipped 2 (proposal unavailable — re-run classifier to retry)". The banner is client-side only; it does not correspond to any DB state change.
- **Retry path:** rows with null `proposedMergedContent` stay eligible for a future analysis re-run. A reviewer who wants those rows to land must either wait for the LLM to come back and re-run the analysis, or manually set `actionTaken = 'skipped'` via the per-card Skip button to clear them out.

### 7.3 New endpoints

All three endpoints return the full updated `skill_analyzer_results` row (same shape as the per-result entries in `GET /api/system/skill-analyser/jobs/:jobId`) on success. `401` / `403` follow the existing `requireSystemAdmin` middleware contract. `404` is returned when the row does not exist.

- `PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId/agents` — body `{ systemAgentId: uuid, selected?: boolean, remove?: true, addIfMissing?: true }`. Three mutually exclusive modes:
  - **Toggle:** `{ systemAgentId, selected: boolean }` — flips the `selected` flag on an existing proposal with matching `systemAgentId`. Returns `404` with `{ error: 'proposal not found' }` if the `systemAgentId` is not already in `agentProposals`.
  - **Remove:** `{ systemAgentId, remove: true }` — drops the proposal from `agentProposals` entirely. Any proposal can be removed regardless of origin (auto-generated or manually-added). Removing an auto-generated proposal is equivalent to saying "don't show this suggestion on this card"; it will reappear on a fresh analysis run. Toggling `selected: false` is usually the more useful action for auto-generated proposals the user disagrees with. Returns `404` if not found.
  - **Manual-add:** `{ systemAgentId, addIfMissing: true }` — the manual-add flow. When the `systemAgentId` is not already in `agentProposals`, the server runs the flow described in §6.2: refresh that agent's embedding if stale, compute live cosine similarity against the candidate's embedding, and append `{ systemAgentId, slugSnapshot: <current>, nameSnapshot: <current>, score: <computed>, selected: true }` to `agentProposals`, then re-sort by score desc. When the `systemAgentId` is already present, `addIfMissing` is a no-op and the existing proposal is returned unchanged (the client can then follow up with a toggle PATCH if it wants to flip `selected`). This is the only endpoint that can grow `agentProposals` from the client side.
  - **Valid only for results with `classification = 'DISTINCT'`** (the §5.2 invariant says `agentProposals` is only populated for DISTINCT results). Returns `409 Conflict` with `{ error: 'agent proposals are only valid on DISTINCT results' }` when called against a non-DISTINCT row.
  - Exactly one of `selected`, `remove`, or `addIfMissing` must be present in the body. Returns `400 Bad Request` with `{ error: 'exactly one of selected, remove, or addIfMissing is required' }` otherwise.
- `PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId/merge` — body `{ name?: string; description?: string; definition?: object; instructions?: string | null }` — patch individual fields of `proposedMergedContent`, sets `userEditedMerge = true`. `instructions` may be explicitly `null` to clear the field. **`definition` is a parsed JSON object on the wire, never a string** — the Recommended column in the UI (§7.1) parses its textarea contents to an object on blur client-side and only PATCHes when the parse succeeds. The server rejects a PATCH whose `definition` is not a plain object (or whose structure does not match the Anthropic tool-definition shape stored in `system_skills.definition`) with `400 Bad Request` and `{ error: 'definition must be a tool-definition object' }`. **Valid only for results with `classification IN ('PARTIAL_OVERLAP', 'IMPROVEMENT')`** (the §5.2 invariant). Returns `409 Conflict` with `{ error: 'merge edits are only valid on PARTIAL_OVERLAP / IMPROVEMENT results' }` when called against a DISTINCT or DUPLICATE row, and `409` with `{ error: 'merge proposal unavailable — re-run analysis' }` when `proposedMergedContent` is null on an eligible row.
- `POST /api/system/skill-analyser/jobs/:jobId/results/:resultId/merge/reset` — copies `originalProposedMerge` into `proposedMergedContent` and clears `userEditedMerge`. **Valid only for results with `classification IN ('PARTIAL_OVERLAP', 'IMPROVEMENT')`** — returns `409 Conflict` with `{ error: 'merge reset is only valid on PARTIAL_OVERLAP / IMPROVEMENT results' }` on a DISTINCT or DUPLICATE row. Returns `409 Conflict` with `{ error: 'no original merge proposal to reset from' }` if `originalProposedMerge` is null on an eligible row.

### 7.4 Response shape change

`GET /api/system/skill-analyser/jobs/:id` currently returns job + results with `matchedSkillName` but not the full library content. After this feature:

- `matchedSkillContent: { id: uuid, slug: string, name: string, description: string, definition: object, instructions: string | null }` on each result where `matchedSkillId` is set and the live lookup on `system_skills.id` finds a row. `instructions` is nullable, matching the `system_skills.instructions` column and the `createSystemSkill` / `updateSystemSkill` contracts in §10 Phase 0. `definition` is the Anthropic tool-definition JSON object, matching `system_skills.definition` — never returned as a string. If `matchedSkillId` is set but the lookup returns no row (e.g. the library skill was deleted after analysis), `matchedSkillContent` is omitted from the response for that result. A PARTIAL_OVERLAP / IMPROVEMENT row with `matchedSkillContent` omitted follows the same review-and-execute path as a row with null `proposedMergedContent`: the Review UI renders the single-line "Proposal unavailable — re-run analysis after classifier is back online" notice in place of the three-column diff (§7.1), and `executeApproved()` fails the row with the existing `executionError: "library skill no longer exists — re-run analysis"` path (§8 PARTIAL_OVERLAP branch). The three-column renderer therefore never has to handle a partially-present match state. Replaces the old `matchedSkillName` and `matchedSystemSkillSlug` fields which are dropped from the schema in §5.3.
- All new columns on each result: `agentProposals`, `proposedMergedContent`, `originalProposedMerge`, `userEditedMerge`.
- On the job: an `availableSystemAgents` array `[{ systemAgentId, slug, name }]` for the "Add another…" combobox. Populated from a live read of `system_agents` at request time; it is the full system-agent inventory, not a cached snapshot.
- On the job: an `unregisteredHandlerSlugs: string[]` array computed at request time by diffing the set of candidate slugs in the job's results against the keys of `SKILL_HANDLERS` in the running server process. Any candidate slug whose handler is not registered appears in this array. Consumers (the Review UI) use it to render the "No handler registered" warning on affected New Skill cards (§7.1) and to filter the "Approve all new" bulk action. The array is a live snapshot — a subsequent deploy that adds missing handlers will make the same job's response return a shorter array without re-running the analyzer.

## 8. Execute step

**Note on handler identity.** Throughout this section the handler gate is stated in terms of `slug` (not `handlerKey`) because the §5.5 invariant `handlerKey = slug` — enforced at row-create time by `createSystemSkill`'s equality check (see §10 Phase 0), at backfill time, and on analyzer-created rows — makes the two keys provably identical for every row in `system_skills`. `slug NOT IN SKILL_HANDLERS` and `handlerKey NOT IN SKILL_HANDLERS` compute the same set. The boot-time validator `validateSystemSkillHandlers()` keys on `handlerKey` (because that is the column it reads); the analyzer gates below key on `slug` (because the candidate object is what the pipeline already holds). Both are correct under the invariant.

Revise `executeApproved()` (`server/services/skillAnalyzerService.ts:174`). Per approved result, dispatch on classification:

- **DISTINCT** → first validate that the candidate's slug resolves to a registered handler in `SKILL_HANDLERS` (the registry constant introduced in §10 Phase 0). The analyzer derives `handlerKey = candidate.slug` for newly imported skills (matching the backfill convention). If `candidate.slug` is not a key in `SKILL_HANDLERS`, fail this result with `executionResult: 'failed'` and `executionError: "No handler registered for skill '${candidate.slug}'. An engineer must add an entry to SKILL_HANDLERS in server/services/skillExecutor.ts before this skill can be imported."` and skip the rest of the DISTINCT path for this row. The transaction never opens for an unpaired row — this is the analyzer's hard gate against the "data refers to code" drift the startup validator also defends. Then validate that `candidate.definition` is a non-null JSON object (the analyzer's candidate parser emits `definition: object | null`, and `system_skills.definition` is NOT NULL). If `candidate.definition` is null, fail this result with `executionResult: 'failed'` and `executionError: "definition is required — candidate had no tool-definition block"`, and skip the rest of the DISTINCT path for this row. Then validate **slug uniqueness** — call `systemSkillService.getSkillBySlug(candidate.slug)`; if it returns a row, fail this result with `executionResult: 'failed'` and `executionError: "slug '${candidate.slug}' already exists in system_skills (row id ${existing.id}, isActive ${existing.isActive}) — approve this candidate as PARTIAL_OVERLAP / IMPROVEMENT against the existing row or rename the candidate before re-running analysis"`, and skip the rest of the DISTINCT path for this row. This gate covers the corner case where the classify stage marks a candidate DISTINCT on content-similarity grounds but its slug collides with an existing `system_skills` row — possible because the analyzer's library read includes inactive rows and because two candidates in the same job can share a slug. The transaction never opens for a colliding slug; the DB unique constraint never fires from this code path. Otherwise call `systemSkillService.createSystemSkill({ ...candidate, handlerKey: candidate.slug }, { tx })` (the new DB-backed method from Phase 0, running inside the per-result transaction). Then read `agentProposals`, filter `selected === true`. For each selected proposal:
  1. Call `systemAgentService.getAgentById(systemAgentId, { tx })`.
  2. If the agent no longer exists, log a warning and drop the attachment silently — proceed to the next proposal. This is NOT a transaction failure; a missing agent does not roll back the skill creation.
  3. Otherwise take the current `defaultSystemSkillSlugs` array off the returned row and compute the next array by appending the newly created skill's slug (de-duplicated if the slug is already present — the slug comes from the skill just created, not from the agent).
  4. Persist the next array via `systemAgentService.updateAgent(systemAgentId, { defaultSystemSkillSlugs: nextArray }, { tx })`.

  Wrap the entire per-result sequence (skill create + N agent updates) in a single Postgres transaction via `await db.transaction(async (tx) => { … })`. If any agent update throws, the transaction rolls back the skill creation and the result is marked `executionResult: 'failed'` with the failure reason in `executionError`. See §8.1 for the full transaction-threading contract.

- **PARTIAL_OVERLAP / IMPROVEMENT** → first validate that `matchedSkillId` is non-null. If null, fail this result with `executionError: "matchedSkillId is required for partial-overlap write"` and skip. Then validate that `proposedMergedContent` is non-null; if null, fail with `executionError: "merge proposal unavailable — re-run analysis"` and skip. Then validate the **matched library skill's handler pairing** — re-read the matched row via `systemSkillService.getSkill(matchedSkillId)` and check that its `slug` is a key in `SKILL_HANDLERS`. The startup validator guarantees every **active** row is paired, but the analyzer's library read includes inactive rows too (so an incoming candidate cannot accidentally duplicate a retired skill), and a matched inactive row may reference an unregistered handler without breaking boot. If the matched row's slug is not in `SKILL_HANDLERS`, fail with `executionError: "matched library skill has no registered handler — this is an inactive row; reactivation requires an engineer to add a handler to SKILL_HANDLERS in server/services/skillExecutor.ts"` and skip. This mirrors the Phase 1→4 window pattern and surfaces the problem at execute time rather than silently allowing the update. Otherwise call `systemSkillService.updateSystemSkill(matchedSkillId, proposedMergedContent, { tx })`. If the update affects zero rows (e.g. the library skill was deleted between analysis and execute), fail with `executionError: "library skill no longer exists — re-run analysis"` so the transaction rolls back and the row is marked `failed`. No agent reassignment — partial overlaps never touch agent attachments.

- **DUPLICATE** → skip. Duplicates are not writable; approving one is a no-op. Already how the current code behaves.

Remove the current "Cannot update a system skill" rejection at `skillAnalyzerService.ts:228` — it is now the primary happy path.

`executionResult` stays `created | updated | skipped | failed`. `executionError` carries the failure reason for the `failed` case.

**Per-proposal attachment outcomes are logged, not persisted.** Inside the DISTINCT per-result transaction, each selected proposal's outcome is emitted to the structured logger as `logger.info({ resultId, systemAgentId, outcome })` where `outcome ∈ { 'attached', 'skipped-missing' }`. The DB does not persist per-proposal outcomes — `skill_analyzer_results.executionResult` reflects only the row-level transaction success. This matches the pre-production framing in `docs/spec-context.md` where log scraping is an acceptable audit path. If post-first-agency operations need persisted per-proposal outcomes, that is a follow-on schema migration, not a prerequisite for this feature.

### 8.1 Transaction threading contract

The atomicity invariant in §4 ("Skill write + agent assignment either both happen or both roll back per result") requires a concrete transaction contract that the implementation can deliver. The contract:

- Phase 0 ships `createSystemSkill(input, opts?: { tx?: DrizzleTx })` and `updateSystemSkill(id, patch, opts?: { tx?: DrizzleTx })` on `systemSkillService`. When `opts.tx` is provided, the method runs against that transaction instead of the module-level `db` handle. When `opts.tx` is absent, it runs against `db` exactly as today. This is the standard Drizzle idiom already used elsewhere in the codebase.
- Phase 2 ships `systemAgentService.updateAgent(id, patch, opts?: { tx?: DrizzleTx })` and `systemAgentService.getAgentById(id, opts?: { tx?: DrizzleTx })` with the same optional-tx shape. This is a signature extension, not a rename — existing callers pass no second argument and see unchanged behaviour.
- `executeApproved()` wraps each per-result sequence in a single `await db.transaction(async (tx) => { … })` call and threads `tx` into every service method inside that block. If any call inside the block throws, the transaction rolls back automatically and the result is marked `executionResult: 'failed'` with the failure reason.
- Different results are processed in independent transactions — one failing result never rolls back a sibling result.
- Phase 0 ships the optional-`tx` surface on `createSystemSkill` and `updateSystemSkill` but has no caller using it yet. **Phase 1's `executeApproved()` rewrite is the first PR that actually exercises the tx path** — it wraps each per-result skill write in `db.transaction(async (tx) => { … })` even though there is only one operation inside, so the atomicity contract is already in place when Phase 2 adds the agent-attach step. **Phase 2 expands the tx block** to include N agent updates alongside the skill write, at which point the transaction is doing real multi-statement rollback work; Phase 2 is not the first PR to open a transaction, it is the first PR where the transaction protects more than one statement.

## 9. Edge cases

- **Zero system agents exist** → DISTINCT result, empty `agentProposals`, approve creates the skill with no attachments. Fine.
- **User approves a DISTINCT result and unchecks all agent chips** → skill is created, no agent attachments. This is intentional — user is saying "add to library, attach manually later".
- **User edits the Recommended merge into something the LLM did not suggest** → fine, `userEditedMerge: true`, execute writes the user's content.
- **LLM returns `proposedMerge` with fewer fields than expected** → the parser rejects the response as malformed, `proposedMergedContent` stays null, and the row follows the §6.3 LLM-fallback path: the Review UI shows "Proposal unavailable — re-run analysis after classifier is back online" in place of the three-column diff, and `executeApproved()` rejects the row with `executionError: "merge proposal unavailable — re-run analysis"`. The parser does not attempt field-level repair from the library skill — malformed merges are indistinguishable from missing merges, and falling through to the null-fallback path is the honest outcome. This keeps `parseClassificationResponseWithMerge()` a pure function with no library-row dependency.
- **Partial overlap bulk-approve with mixed availability** → the client filters eligible rows before the POST, skipped rows stay `actionTaken = null`, an info banner reports the skip count. See §7.2.
- **A system agent is renamed between analysis and execute** → the `slugSnapshot` and `nameSnapshot` on the proposal become stale, but `systemAgentId` is stable. The execute path resolves the live `system_agents` row by `systemAgentId` and appends the new skill's slug to its current `defaultSystemSkillSlugs` array, so the rename does not break the attachment. The chip label may show an outdated name until the next analysis.
- **A system agent is deleted between analysis and execute** → `systemAgentService.getAgentById` returns null, the attach step emits `logger.info({ resultId, systemAgentId, outcome: 'skipped-missing' })` and drops that attachment silently, and the rest of the per-result transaction proceeds. No hard failure at the row level — the row still succeeds with `executionResult = 'created'`. A DISTINCT result with 3 selected proposals where 1 agent was deleted between analysis and execute will land as: skill created + 2 agents attached + 1 `skipped-missing` logged event, with `executionResult = 'created'` and the attach skip visible only in structured logs (see §8 "Per-proposal attachment outcomes" note).
- **DISTINCT candidate whose slug collides with an existing `system_skills` row** → possible when two candidates in the same job share a slug, or when a low-similarity candidate matches the slug of an inactive library row (the analyzer's library read includes inactive rows). The §8 DISTINCT branch validates slug uniqueness via `getSkillBySlug` before opening the transaction and fails the colliding row with a clear actionable error pointing the reviewer at the existing row. The DB unique constraint is a second line of defence, not the primary enforcement.
- **Re-running analysis on the same candidates** → existing hashing logic already dedupes; the agent-propose stage re-runs cleanly because it reads live system agent state at each run.
- **Phase 0 partial-backfill recovery** → if the MD→DB backfill fails halfway, re-running the backfill must be idempotent: it should upsert by `slug`, not re-insert. The backfill script owns this invariant.

## 10. Build phases

Six phases now. Each ends green (lint, typecheck, relevant test suites, static gates) before the next begins. Phases are sequential except where noted.

### Phase 0 — System skill DB migration (server)

- Drizzle migration adds **two new columns** to `system_skills` (see §5.5 for full rationale):
  - **`visibility` text column** with CHECK constraint `visibility IN ('none', 'basic', 'full')` and default `'none'`. Preserves the three-state visibility cascade the current in-memory `SystemSkill` interface uses. `isActive` and `visibility` are two orthogonal flags — both are preserved because `listVisibleSkills` and `stripBodyForBasic` depend on the tri-state cascade.
  - **`handlerKey` text column, NOT NULL.** Pairs each skill row with a TypeScript handler function registered in `skillExecutor.ts`. See the "Handler registry refactor" and "Startup validator" bullets below for the full contract.
  - The rest of the `system_skills` schema (`id`, `slug`, `name`, `description`, `definition`, `instructions`, `isActive`, `createdAt`, `updatedAt`) is already defined at `server/db/schema/systemSkills.ts` and unchanged.
- Backfill script `scripts/backfill-system-skills.ts` that parses every `server/skills/*.md` file via the existing `systemSkillService` markdown parser and upserts each into the `system_skills` table by `slug`. The backfill:
  - Reads `visibility` from each file's frontmatter and writes it into the new DB column — if absent, defaults to `'none'` to match the column default.
  - Sets `handlerKey = slug` for every imported row. This matches the current implicit convention where the markdown filename slug maps to a switch case in the dispatcher. The backfill **must run after the handler-registry refactor** below, and **must fail fast** if any imported row's slug does not resolve to a key in `SKILL_HANDLERS` — if the script encounters an unregistered handler, it prints the offending slug(s) and exits non-zero without writing any rows. This is the first line of defence against shipping a DB with a broken pairing.
  - Idempotent — safe to re-run.
- **Handler registry refactor in `server/services/skillExecutor.ts`:** replace the existing 800+-line switch statement (currently at `skillExecutor.execute()` lines 328–1099) with a module-level registry constant:
  ```ts
  export const SKILL_HANDLERS: Record<string, SkillHandler> = {
    web_search: executeWebSearch,
    fetch_url: executeFetchUrl,
    // ...one entry per existing switch case, preserving exact behaviour...
    compute_health_score: executeComputeHealthScore,
  };
  ```
  where `SkillHandler` is the existing `(input, context) => Promise<SkillResult>` shape. The `execute()` method becomes:
  ```ts
  async execute({ skillName, input, context, toolCallId }) {
    const handler = SKILL_HANDLERS[skillName];
    if (!handler) return { success: false, error: `Unknown skill: ${skillName}` };
    return handler(input, context);
  }
  ```
  Every existing switch case becomes one registry entry. No runtime behaviour change for invocation paths — same handlers, same error on unknown skill. The `SKILL_HANDLERS` export becomes the **single source of truth for which handlers exist in code**, consumable by the startup validator and the analyzer execute gate below.

  **Leaf-module invariant.** `skillExecutor.ts` must remain a leaf from the perspective of the analyzer subsystem — it must not import from `skillAnalyzerService.ts`, `skillAnalyzerServicePure.ts`, `skillAnalyzerJob.ts`, or `server/routes/skillAnalyzer.ts`. This invariant holds today (grep-verified at spec-review time) and must be preserved by the Phase 0 refactor. The Phase 1 handler-gate bullet (§10 Phase 1) imports `SKILL_HANDLERS` from `skillExecutor.ts` into `skillAnalyzerService.ts`, which is a one-way edge — no cycle is created as long as the leaf invariant is honoured. If a future change needs `skillExecutor.ts` to reach into analyzer code, `SKILL_HANDLERS` must first be extracted to a dedicated leaf module (`server/services/skillHandlerRegistry.ts`) — but that extraction is out of scope for this feature.
- **Startup validator `validateSystemSkillHandlers()`** in a new file `server/services/systemSkillHandlerValidator.ts` (or co-located with `systemSkillService`, architect to decide). Signature: `async function validateSystemSkillHandlers(): Promise<void>`. Reads every row from `system_skills` where `isActive = true`, collects the `handlerKey` values, and asserts each one exists as a key in `SKILL_HANDLERS`. If any do not resolve, throws an error listing the missing keys:
  ```
  SystemSkillHandlerError: Active system_skills rows reference unregistered handlers: [foo, bar, baz].
    Either register handlers in server/services/skillExecutor.ts SKILL_HANDLERS or
    deactivate these skills via UPDATE system_skills SET isActive = false WHERE handlerKey IN (...).
  ```
  Called from the server bootstrap (`server/index.ts` or equivalent) **after** the DB connection is established but **before** the HTTP server starts accepting requests. The bootstrap sequence must `await validateSystemSkillHandlers()` before calling `httpServer.listen()` (currently at `server/index.ts:365`); if the validator throws, no socket is bound and the process exits non-zero. A missing-handler condition is fail-fast — the server refuses to boot. Inactive skill rows (`isActive = false`) are ignored so they can sit in the DB as staging rows without blocking startup.
- Rewrite `server/services/systemSkillService.ts` to be DB-backed, preserving the full existing public API surface so callers outside this feature are not affected. The complete set of methods on the service today (verified against `server/services/systemSkillService.ts` at spec-review time): `invalidateCache`, `listSkills`, `listActiveSkills`, `listVisibleSkills`, `getSkill`, `getSkillBySlug`, `updateSkillVisibility`, `resolveSystemSkills`, `stripBodyForBasic`.
  - **Existing methods — signatures unchanged, implementation switched to DB:** all nine methods above. `updateSkillVisibility(slug, visibility)` becomes `UPDATE system_skills SET visibility = $1 WHERE slug = $2` — no more markdown frontmatter rewriting. `listVisibleSkills()` becomes `SELECT * FROM system_skills WHERE isActive = true AND visibility != 'none'`. `listActiveSkills()` becomes `SELECT * FROM system_skills WHERE isActive = true`. `listSkills()` returns all rows regardless of either flag. `invalidateCache` becomes a no-op once the in-memory cache is removed (or is kept as a façade that clears any remaining query-result cache) — callers should continue to compile without change. `stripBodyForBasic` is a pure helper over the returned row shape and needs no behavioural change.
  - **New methods:**
    - `createSystemSkill(input: { slug: string; handlerKey: string; name: string; description: string; definition: object; instructions: string | null; visibility?: 'none' | 'basic' | 'full'; isActive?: boolean }, opts?: { tx?: DrizzleTx }): Promise<SystemSkill>` → INSERT into `system_skills` on `opts.tx ?? db`, returns the created row. `visibility` defaults to `'none'` and `isActive` defaults to `true` when omitted. `handlerKey` is required. The method throws with a clear error if `input.handlerKey !== input.slug` (enforcing the §5.5 `handlerKey = slug` invariant at every create call, whether the caller is the analyzer's execute path, the `POST /api/system/skills` admin route, or the Phase 0 backfill), AND throws with a clear error if `input.handlerKey` does not resolve to a key in `SKILL_HANDLERS`. These two checks are the second line of defence against shipping an unpaired row (after the Phase 0 backfill's fail-fast, before the server bootstrap validator). `definition` is the Anthropic tool-definition JSON object matching the `system_skills.definition` jsonb shape — never a string.
    - `updateSystemSkill(id: string, patch: Partial<{ name: string; description: string; definition: object; instructions: string | null; visibility: 'none' | 'basic' | 'full'; isActive: boolean }>, opts?: { tx?: DrizzleTx }): Promise<SystemSkill>` → UPDATE `system_skills` SET (only the fields present in `patch`) WHERE id = ... on `opts.tx ?? db`, returns the updated row. `patch` is a **partial** patch — any omitted field is left untouched on the row. **Neither `slug` nor `handlerKey` is patchable** — both are the stable write-time invariants (see §5.5 for why `handlerKey = slug` is locked after create). If the architect later needs a slug-rename path, that is a separate primitive that must also update `handlerKey` atomically to preserve the invariant.
    - Both methods accept the optional `tx` parameter as the Drizzle transaction handle; see §8.1 for the atomicity contract it enables.
  - The analyzer's library read uses `listSkills()`. The existing file-based `listSkills()` returns all skills regardless of visibility (verified at spec-review time; `listVisibleSkills` is the filtered variant). The DB-backed rewrite preserves this "all rows" semantic so the analyzer still compares candidates against the full library, including rows that are hidden from lower tiers. No new `listSystemSkills` method is needed.
- Replace the HTTP 405 handler on `POST /api/system/skills` in `server/routes/systemSkills.ts` with a create route wired to `systemSkillService.createSystemSkill`. The HTTP 405 handler on `DELETE /api/system/skills/:id` stays in place — this feature introduces no delete primitive on `systemSkillService`, so the DELETE route remains unsupported. The existing GET / GET-by-id / PATCH routes are rewired to the new DB-backed methods without signature changes.
- The `server/skills/*.md` files stay in the repo as a **seed source** only. Add a README note at `server/skills/README.md` explaining that markdown files are parsed on fresh-database setup by the backfill script; runtime reads/writes go to the DB.
- Update any caller of the old file-based service that depends on the removed in-memory cache semantics (expected: agent execution in `agentExecutionService.ts` which calls `resolveSystemSkills` — should be transparent because the signature is preserved, but confirm).
- **Tests for Phase 0:**
  - Pure-function unit tests following the `*Pure.ts` + `*.test.ts` convention for the markdown parser (which becomes seed-only code but still needs coverage) and for any new pure helpers extracted from the DB-backed service.
  - **Registry equivalence test** for the `skillExecutor.ts` refactor: a small pure-function / static check that asserts the set of keys in `SKILL_HANDLERS` exactly matches the set of case labels that used to live in the pre-refactor switch. Can be a simple `expect([...].sort()).toEqual([...].sort())` against a hard-coded list of the pre-refactor cases. Prevents a handler from accidentally disappearing during the refactor.
  - **Startup validator test** for `validateSystemSkillHandlers()`: a small integration-style test (either in the existing pg-boss integration harness or a dedicated one — architect's call) that seeds a `system_skills` row with an unregistered `handlerKey`, invokes the validator, and asserts the expected `SystemSkillHandlerError` is thrown with the offending keys in the message. Also test the happy path (all keys registered → no throw) and the inactive-row-ignored path (`isActive = false` with unregistered handler → no throw).
  - **`createSystemSkill` unregistered-handler test:** unit test that calls `createSystemSkill({ ...valid, handlerKey: 'totally_made_up_key' })` and asserts it throws the expected error before touching the DB.
- Gate: all server tests green, `npm run lint`, `npm run typecheck`, `npm run db:generate` produces exactly one new migration file that matches the schema diff. Manual smoke test: fresh DB + run backfill + start server + verify the validator passes on clean state.

### Phase 1 — Analyzer rescope (server)

- Drizzle migration adding `agent_embeddings` table, `agentProposals`, `proposedMergedContent`, `originalProposedMerge`, `userEditedMerge`, `candidateContentHash` columns on `skill_analyzer_results`, and dropping `matchedSystemSkillSlug` and `matchedSkillName` columns.
- Switch `skillAnalyzerJob.ts` library source from `skills` to `system_skills` via the existing `systemSkillService.listSkills()` (now DB-backed after Phase 0) in the Hash, Embed, and Compare stages.
- Switch `executeApproved()` **skill-write** path from `skillService.createSkill` / `updateSkill` to `systemSkillService.createSystemSkill` / `updateSystemSkill`, wrapping each per-result write in `db.transaction(async (tx) => { … })` so the §8.1 contract is already in place when Phase 2 adds the agent-attach step.
- **Add the handler gate to `executeApproved()` DISTINCT branch.** Import `SKILL_HANDLERS` from `server/services/skillExecutor.ts`. Before opening the transaction for a DISTINCT result, check that `candidate.slug in SKILL_HANDLERS`. If not, fail the result with the exact error message from §8 ("No handler registered for skill '${slug}'...") without opening the transaction. The gate lands in Phase 1 — not Phase 2 — because `systemSkillService.createSystemSkill` requires `handlerKey`, and every DISTINCT result approved after Phase 1 ships must pass through the gate to avoid throwing inside the transaction. See §8 DISTINCT branch for the full contract.
- **Extend `GET /api/system/skill-analyser/jobs/:jobId` response** with three new fields:
  - `matchedSkillContent` on each result (where `matchedSkillId` is set): a live `systemSkillService.getSkill(matchedSkillId)` lookup attached as `{ id, slug, name, description, definition, instructions }`. Ships in Phase 1 (same PR as the migration that drops `matchedSystemSkillSlug` / `matchedSkillName`) so there is no intermediate window where the Review UI receives neither the old match-metadata fields nor the new `matchedSkillContent`. The client-side consumption lands later in Phase 5's three-column renderer.
  - `unregisteredHandlerSlugs: string[]` on the job: computed at request time by diffing the set of candidate slugs in the job's results against the keys of `SKILL_HANDLERS` (imported from `server/services/skillExecutor.ts`). The handler gate is server-defined; the UI consumes this field to disable the Approve button and render the warning on affected cards (§7.1). Client-side consumption ships in Phase 4 with the agent-chip block and the no-handler warning.
  - `availableSystemAgents: { systemAgentId: uuid, slug: string, name: string }[]` on the job: a live `systemAgentService.listAgents()` read at request time providing the full system-agent inventory (§7.4). The "Add another…" combobox in Phase 4 reads this field to populate its options. Ships in Phase 1 alongside the other GET response extensions so all response-shape changes land in one PR; client-side consumption ships in Phase 4 with the agent-chip block.
- **Scope notes for Phase 1:**
  - The agent-attach logic described in §8 is added in Phase 2 once `agentProposals` is actually populated by the pipeline. In Phase 1, `agentProposals` exists as a column but stays `[]` — execute reads it, finds nothing, and takes no agent-attach action.
  - The PARTIAL_OVERLAP / IMPROVEMENT merge-write logic described in §8 is effectively dormant in Phase 1 because `proposedMergedContent` is only populated by Phase 3. Between Phase 1 and Phase 3 shipping, every execute attempt on a PARTIAL_OVERLAP row hits the `proposedMergedContent === null` guard in §8 and fails with `executionError: "merge proposal unavailable — re-run analysis"`. This is intentional — it is the null-guard path doing its job, not a bug. Reviewers cannot usefully approve PARTIAL_OVERLAP rows until Phase 3 ships; DISTINCT rows are approvable from Phase 1 onward. The Phase 1 test plan must cover the "null-guard rejection" path explicitly.
  - The handler-status UI affordance described in §7.1 (disabled Approve button, "Approve all new" client-side filter, red warning block) ships in Phase 4. Between Phase 1 and Phase 4, the handler gate is **server-only**: the existing Review UI does not yet disable Approve or filter bulk approve for unregistered-handler rows, and a reviewer who clicks Approve on an affected card will have the result fail at execute time with the §8 error `"No handler registered for skill '${candidate.slug}'..."`. This is accepted pre-production behaviour, parallel to the PARTIAL_OVERLAP null-guard window above — the gate is hard-enforced server-side from Phase 1 onward, and the UI catches up in Phase 4. The Phase 1 test plan must cover the "execute-time handler-gate rejection" path explicitly.
- Remove the "Cannot update a system skill" rejection at `skillAnalyzerService.ts:228`.
- Update existing unit tests for the rescope.
- Gate: all server tests green, `npm run lint`, `npm run typecheck`, `npm run db:generate` produces exactly one new migration file that matches the schema diff.

### Phase 2 — Agent embedding + propose pipeline + execute agent-attach (server)

- New agent embedding helper service at `server/services/agentEmbeddingService.ts` exporting three functions:
  - `refreshSystemAgentEmbeddings(): Promise<void>` — iterate all system agents, recompute embeddings for rows whose stored `contentHash` differs from the current content hash. Used by the Agent-embed pipeline stage.
  - `refreshSystemAgentEmbedding(systemAgentId: string): Promise<AgentEmbedding>` — refresh exactly one agent's embedding if its stored `contentHash` differs from the current content hash, otherwise read-through. Returns the fresh `agent_embeddings` row. Used by the Phase 4 manual-add flow so the live-similarity computation always runs against an up-to-date embedding.
  - `getAgentEmbedding(systemAgentId: string): Promise<AgentEmbedding | null>` — cache read only; returns null if no row exists. Used by the Agent-propose stage when iterating pre-refreshed embeddings.
- New Agent-embed and Agent-propose stages in `skillAnalyzerJob.ts` with progress reporting.
- `skillAnalyzerServicePure.ts`: top-K cosine-similarity helper with threshold — exported as `rankAgentsForCandidate(candidateEmbedding, agentEmbeddings, { topK, threshold }): AgentProposal[]`, following the `*Pure.ts` + `*.test.ts` convention.
- Extend `systemAgentService.updateAgent(id, patch, opts?: { tx?: DrizzleTx })` and `systemAgentService.getAgentById(id, opts?: { tx?: DrizzleTx })` with an optional `tx` parameter. When `opts.tx` is provided, the query runs on the transaction handle; when absent, existing callers see unchanged behaviour. Both methods are part of the §8.1 transaction-threading contract and must ship together in Phase 2.
- **Extend `executeApproved()` to apply agent attachments** for DISTINCT results. Wrap the per-result sequence in `await db.transaction(async (tx) => { … })`. Inside the transaction: create the skill via `systemSkillService.createSystemSkill({ ...candidate, handlerKey: candidate.slug }, { tx })` (matching the §8 DISTINCT branch contract and the Phase 0 `createSystemSkill` required-`handlerKey` signature); read `agentProposals`, filter `selected === true`; for each selected proposal, look up the live agent row by `systemAgentId` (inside the same `tx`), confirm it still exists, and append the newly created skill's slug to that agent's `defaultSystemSkillSlugs` array via `systemAgentService.updateAgent(id, { defaultSystemSkillSlugs: nextArray }, { tx })`. Any throw inside the block rolls back the whole result; see §8 and §8.1 for the full contract.
- Pure-function unit tests for `rankAgentsForCandidate` covering: threshold boundary, top-K truncation, tie-breaking, empty agent list, K > agent count.

### Phase 3 — Classify-stage merge proposal (server)

- Extend prompt to request `proposedMerge`.
- Extend response parser + validator — pure functions `buildClassifyPromptWithMerge()` and `parseClassificationResponseWithMerge()` in `skillAnalyzerServicePure.ts`.
- Persist `proposedMergedContent` and `originalProposedMerge` at the Write stage.
- Pure-function unit tests for the prompt builder, the parser, and the fallback when `proposedMerge` is missing or malformed.

### Phase 4 — Review UI: agent chips + PATCH endpoints (client + server)

Can run in parallel with Phase 5 on the client side.

- New PATCH endpoint for agent selection at `PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId/agents`, supporting all three modes defined in §7.3: toggle (`selected: boolean`), remove (`remove: true`), and manual-add (`addIfMissing: true`). No sibling POST endpoint — the manual-add flow is a mode on the same PATCH, triggered by the `addIfMissing` flag. When `addIfMissing: true` and the `systemAgentId` is not already in `agentProposals`, the handler calls `agentEmbeddingService.refreshSystemAgentEmbedding(systemAgentId)`, looks up the candidate's pre-computed embedding in `skill_embeddings` by reading `candidateContentHash` off the result row (the column persisted by the Write stage — see §5.2 and §6 step 8) and selecting the `skill_embeddings` row by `contentHash` alone (no `sourceType` filter — see the §5.2 `candidateContentHash` column notes for why `sourceType` is not a legal source-filtered read), computes live cosine similarity against that candidate embedding, and appends a fully-scored proposal with `selected: true`, then re-sorts `agentProposals` by score desc. No OpenAI call on the PATCH hot path — the candidate embedding was already written during the pipeline's Embed stage. See §6.2 and §7.3 for the full contract.
- Agent chip block on New Skill cards (renders from `agentProposals`, shows both pre-selected and below-threshold chips).
- "Add another…" combobox backed by `availableSystemAgents`.
- Pure-function helper(s) for chip state derivation (extracting any non-trivial selection logic into `*Pure.ts`) with unit tests. No frontend component tests — frontend tests are not part of the current testing envelope.

### Phase 5 — Review UI: three-column merge view + PATCH/reset endpoints (client + server)

- PATCH endpoint for merge field edits.
- POST endpoint for merge reset.
- Three-column renderer with responsive tab fallback below ~1100px.
- Inline-diff highlighting in the Recommended column.
- Synced scrolling for long fields.
- Client-side consumption of `matchedSkillContent` (the response-shape extension already landed in Phase 1). The three-column renderer reads `matchedSkillContent` for the Current column and the partial-overlap diff base.
- "Approve all partial overlaps (with proposal)" bulk button wired to the existing `POST .../bulk-action` endpoint with client-side eligibility filtering (see §7.2).
- Diff library selection (`diff`, `react-diff-view`, or `jsdiff`-backed custom) — decided in the implementation plan.
- Pure-function helper(s) for diff-row derivation in `*Pure.ts` with unit tests. No frontend component tests — frontend tests are not part of the current testing envelope.

### PR cut line

First reviewable PR: Phase 0. It is self-contained, unlocks everything else, and has an obvious rollback (revert the backfill, restore the 405 handlers, no data loss because the markdown files still exist).

Second reviewable PR: Phases 1–3. Server-only. The existing Review UI continues to run (no crashes, no broken routes), but because Phase 1 drops the legacy `matchedSkillName` / `matchedSystemSkillSlug` response fields and the client has not yet been rewired to consume the replacement `matchedSkillContent` field, the existing per-card "vs. &lt;library name&gt;" line silently stops rendering between this PR and the Phase 4–5 PR. The existing client's `{result.matchedSkillName && …}` guard in `SkillAnalyzerResultsStep.tsx` swallows the missing field without error. This is accepted pre-production behaviour per the iteration-3 directional decision — see §10 Phase 1 scope notes and §10 Phase 5 for the client-side restoration.

Third reviewable PR: Phases 4–5. Client-heavy, depends on the server work in the second PR.

## 11. Open items for the implementation plan

- Which diff library for the Recommended column renderer (`diff`, `react-diff-view`, `jsdiff`-backed custom). Defer to the architect agent.
- Whether `agent_embeddings` should be invalidated eagerly when a system agent's `masterPrompt` changes, or lazily at the next analyzer run. Lazy is simpler — propose lazy, confirm in plan.
- Exact JSON schema for `definition` validation on merge edits — inherits from the Phase 0 `updateSystemSkill` validator and does not need redesign, but the implementation plan should confirm no regressions.
- Whether the Phase 0 backfill should run automatically on server startup (idempotent upsert) or only as a one-shot script. Auto-on-startup is simpler for fresh environments; one-shot is safer for production. Recommend one-shot for Phase 0 and revisit once the DB is the source of truth.
- Whether to add an analyzer-side `isActive = false` filter on top of `listSkills()`. The spec's normative default (§10 Phase 0) is that `listSkills()` returns all rows regardless of `isActive` or `visibility` and the analyzer compares candidates against the full library, including retired skills — this is usually correct because it prevents re-importing a duplicate of a retired skill. This open item is narrowly about whether the architect wants to layer an analyzer-specific filter on top of that default (e.g. to suppress retired-skill matches from the Review UI) — not about changing the `listSkills()` contract itself.
