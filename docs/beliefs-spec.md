# Agent Beliefs — Technical Specification

**Date:** 2026-04-13
**Status:** Final draft — ready for review
**Classification:** Significant
**Depends on:** Agent briefing service (Phase 2D, shipped)
**Precursor to:** anda-hippocampus state evolution patterns

---

## Table of Contents

- [1. Problem Statement](#1-problem-statement)
- [2. Design Principles](#2-design-principles)
- [3. Data Model](#3-data-model)
- [4. Write Path — Extraction and Merge](#4-write-path--extraction-and-merge)
- [5. Read Path — Prompt Injection](#5-read-path--prompt-injection)
- [6. User Override and Observability](#6-user-override-and-observability)
- [7. Migration Path to State Evolution](#7-migration-path-to-state-evolution)
- [8. Implementation Plan](#8-implementation-plan)
- [9. Verification Checklist](#9-verification-checklist)

---

## 1. Problem Statement

Agents accumulate knowledge across runs but have no structured way to represent **what they currently believe to be true** about a workspace. The existing infrastructure handles this partially:

| Layer | What it does | What it doesn't do |
|-------|-------------|-------------------|
| **Briefing** (Phase 2D) | Compact narrative summary, regenerated each run | Individual facts are compressed into prose — when one fact changes, the entire briefing is rewritten. No way to update a single belief without regenerating everything. |
| **Memory entries** | Verbatim observations with embeddings, searchable via RRF | Retrieval-dependent. Agent must ask the right question to find the right fact. No "here's what I know" at prompt start. Facts accumulate but are never reconciled. |
| **Entities** | Structured name/type/value triples with temporal validity | Only extracted entities — not agent-formed conclusions, preferences, or working assumptions. |

**The gap:** An agent on its 50th run has no persistent, structured set of beliefs it can inspect and update. It has a narrative (briefing) and a searchable archive (memories), but no discrete, addressable facts that survive individual updates. When "Client uses Shopify" becomes "Client migrated to WooCommerce", the briefing rewrites everything and the old memory entry stays in the archive unreconciled.

### What beliefs solve

Beliefs are **discrete, agent-maintained facts** — individually readable, updatable, and supersedable. Each belief is a key-value pair with a confidence level. The agent can see all its beliefs at prompt start without searching, update a single belief without regenerating the full set, and (in Phase 2) trace how beliefs changed over time.

### What beliefs are NOT

- Not a replacement for briefings. Briefings provide narrative context ("last run we resolved a billing issue"). Beliefs provide factual state ("Client uses WooCommerce").
- Not a replacement for memory entries. Memories are the raw archive. Beliefs are the agent's distilled understanding.
- Not a user-facing config surface. Users can correct beliefs, but the primary population path is automated.

## 2. Design Principles

1. **Agents write beliefs; users correct them.** Population is automated from run outcomes. User override is a correction mechanism, not the primary input.
2. **Individual addressability.** Each belief is a discrete unit with a stable key. Updating one belief never touches others.
3. **Confidence, not certainty.** Beliefs carry a confidence score (0-1). Low-confidence beliefs are included in context but flagged. This is the primitive that later enables state evolution.
4. **Token-budgeted.** The full belief set must fit within a fixed token budget. When beliefs exceed budget, lowest-confidence beliefs are dropped from prompt injection (but retained in storage).
5. **Additive to existing infrastructure.** Beliefs use the same prompt injection point as briefings, the same post-run job mechanism, and the same LLM routing. No new infrastructure.
6. **Designed for supersession.** The schema includes a `superseded_by` column from day one — nullable, unused in Phase 1, wired in Phase 2. Zero migration cost when state evolution lands.

## 3. Data Model

### New table: `agent_beliefs`

Migration: `0112_agent_beliefs.sql`

```sql
CREATE TABLE agent_beliefs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id   UUID NOT NULL REFERENCES subaccounts(id),
  agent_id        UUID NOT NULL REFERENCES agents(id),

  -- Belief content
  belief_key      TEXT NOT NULL,            -- stable slug, e.g. "client_platform"
  category        TEXT NOT NULL DEFAULT 'general',  -- domain grouping: general | preference | workflow | relationship | metric
  subject         TEXT,                     -- what the belief is about, e.g. "Client X"
  value           TEXT NOT NULL,            -- the belief itself, e.g. "Uses WooCommerce, migrated from Shopify in March 2026"
  confidence      REAL NOT NULL DEFAULT 0.7, -- 0.0–1.0

  -- Provenance
  source_run_id   UUID,                    -- run that created/last updated this belief
  evidence_count  INTEGER NOT NULL DEFAULT 1, -- how many runs have reinforced this belief
  source          TEXT NOT NULL DEFAULT 'agent', -- 'agent' | 'user_override'

  -- Supersession (Phase 2 — nullable in Phase 1)
  superseded_by   UUID REFERENCES agent_beliefs(id),
  superseded_at   TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ              -- soft delete
);

-- One active belief per key per agent-subaccount
CREATE UNIQUE INDEX agent_beliefs_active_key_uniq
  ON agent_beliefs (organisation_id, subaccount_id, agent_id, belief_key)
  WHERE deleted_at IS NULL AND superseded_by IS NULL;

-- Fast lookups for prompt injection
CREATE INDEX agent_beliefs_active_lookup
  ON agent_beliefs (organisation_id, subaccount_id, agent_id)
  WHERE deleted_at IS NULL AND superseded_by IS NULL;

-- RLS: tenant isolation (matches agent_briefings pattern)
ALTER TABLE agent_beliefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_beliefs_org_isolation ON agent_beliefs
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid);
```

### Drizzle schema: `server/db/schema/agentBeliefs.ts`

```typescript
export const agentBeliefs = pgTable(
  'agent_beliefs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    agentId: uuid('agent_id').notNull().references(() => agents.id),

    beliefKey: text('belief_key').notNull(),
    category: text('category').notNull().default('general'),
    subject: text('subject'),
    value: text('value').notNull(),
    confidence: real('confidence').notNull().default(0.7),

    sourceRunId: uuid('source_run_id'),
    evidenceCount: integer('evidence_count').notNull().default(1),
    source: text('source').notNull().default('agent'),

    supersededBy: uuid('superseded_by'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    activeKeyUniq: uniqueIndex('agent_beliefs_active_key_uniq')
      .on(table.organisationId, table.subaccountId, table.agentId, table.beliefKey)
      .where(sql`${table.deletedAt} IS NULL AND ${table.supersededBy} IS NULL`),
    activeLookup: index('agent_beliefs_active_lookup')
      .on(table.organisationId, table.subaccountId, table.agentId)
      .where(sql`${table.deletedAt} IS NULL AND ${table.supersededBy} IS NULL`),
  })
);
```

### Key design decisions

| Decision | Rationale |
|----------|-----------|
| Separate table, not JSONB on `agent_briefings` | Individual beliefs need independent CRUD, confidence scores, and supersession chains. JSONB would require read-modify-write for every update and can't enforce uniqueness per key. |
| `belief_key` as stable slug | Enables idempotent upsert: "if I already have a belief about `client_platform`, update it rather than creating a duplicate". The LLM generates the key during extraction. |
| `category` enum-like text column | Allows grouping beliefs in prompt injection ("Preferences:", "Metrics:", etc.) without a strict enum migration for each new category. |
| `confidence` from day one | Even in Phase 1 where we don't do contradiction detection, confidence lets us: (a) sort beliefs for token budget trimming, (b) flag low-confidence beliefs in the prompt, (c) weight evidence accumulation. |
| `superseded_by` nullable from day one | Zero-cost migration when Phase 2 lands. In Phase 1, all active beliefs have `superseded_by IS NULL`. |
| `evidence_count` | When the same belief is reinforced across multiple runs, increment rather than rewrite. Higher evidence = higher effective confidence. |
| Scoped per agent-subaccount | Same as briefings. A CRM Agent's beliefs about Client X are separate from a Reporting Agent's beliefs about Client X — they observe different things. |

## 4. Write Path — Extraction and Merge

### Trigger

Same as briefings: **post-run, fire-and-forget.** After a run completes, the `agentBriefingJob` fires. We extend this to also trigger belief extraction in the same job — one additional LLM call after the briefing update.

### Step-by-step flow

```
Run completes
  → agentBriefingJob fires (pg-boss, existing)
  → agentBriefingService.updateAfterRun()  ← existing
  → agentBeliefService.extractAndMerge()   ← NEW
```

### 4.1 Extraction — LLM call

**Input:** Handoff JSON + recent high-quality memory entries (same inputs as the briefing call — reuse, don't re-fetch).

**Prompt:**

```
You are a belief extractor for an AI agent. Given the outcome of the agent's
latest run and recent observations, extract discrete factual beliefs the agent
should retain about this workspace.

Latest run outcome:
<run-outcome-data>
{handoffJson}
</run-outcome-data>

Recent observations:
{recentEntries}

Current beliefs:
{existingBeliefs}

For each belief, output a JSON array. Each element:
{
  "key": "snake_case_slug",          // stable identifier, e.g. "client_platform"
  "category": "general|preference|workflow|relationship|metric",
  "subject": "what this is about",   // e.g. "Client X", nullable
  "value": "the belief statement",   // concise factual statement
  "confidence": 0.0-1.0,             // how confident based on evidence
  "action": "add|update|reinforce|remove"
}

Rules:
- "add": new belief not in current set
- "update": existing belief whose value has changed (key matches, value differs)
- "reinforce": existing belief confirmed by this run (increment evidence, keep value)
- "remove": belief that is no longer true based on this run's evidence
- Do not extract beliefs that are trivially obvious or already covered by existing beliefs with no change
- Maximum 10 beliefs per extraction (focus on highest-signal facts)
- Keys must be deterministic — same concept should always produce same key

Respond with only the JSON array. No preamble.
```

**LLM routing:** Same as briefing — `sourceType: 'system'`, `taskType: 'belief_extraction'`, `routingMode: 'ceiling'`.

**Max tokens:** `EXTRACTION_MAX_TOKENS` (reuse from limits.ts, currently 1024).

### 4.2 Merge — database operations

Parse the LLM response as JSON array. For each belief:

| Action | Database operation |
|--------|-------------------|
| `add` | `INSERT` new row. If key conflict (unique index), treat as `update`. |
| `update` | Load existing row by key. Update `value`, `confidence`, `source_run_id`, `updated_at`. Increment `evidence_count`. |
| `reinforce` | Load existing row by key. Increment `evidence_count`, update `source_run_id` and `updated_at`. Boost confidence by `min(1.0, confidence + 0.05)`. |
| `remove` | Soft-delete: set `deleted_at = now()`. Do NOT hard-delete — the record stays for audit. |

**Conflict handling:** If the LLM outputs a key that matches an existing belief but with `action: "add"`, treat it as `update`. The unique index enforces one active belief per key.

**Error handling:** Same as briefing — fire-and-forget. Parse failures, LLM errors, and DB errors are logged but never block run completion. If the JSON is malformed, skip the entire extraction for this run.

### 4.3 Limits

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max beliefs per extraction | 10 | Prevents unbounded growth per run |
| Max active beliefs per agent-subaccount | 50 | Token budget constraint — 50 beliefs at ~30 tokens each = ~1500 tokens |
| Max belief value length | 500 chars | Keeps individual beliefs concise |
| Confidence floor for retention | 0.1 | Below this, soft-delete on next extraction |
| Confidence boost per reinforcement | +0.05, capped at 1.0 | Gradual confidence growth with evidence |

Add to `server/config/limits.ts`:

```typescript
export const BELIEFS_MAX_PER_EXTRACTION = 10;
export const BELIEFS_MAX_ACTIVE = 50;
export const BELIEFS_MAX_VALUE_LENGTH = 500;
export const BELIEFS_CONFIDENCE_FLOOR = 0.1;
export const BELIEFS_CONFIDENCE_BOOST = 0.05;
export const BELIEFS_TOKEN_BUDGET = 1500;
```

## 5. Read Path — Prompt Injection

### Injection point

Beliefs are injected into the agent prompt in the dynamic parts section of `agentExecutionService.ts` (lines 665-750). The current dynamic section order and where beliefs slot in:

```
## Your Briefing              ← existing (line 675, Phase 2D)
## Your Beliefs                ← NEW — inject here
## Task Instructions           ← existing (line 684, conditional on scheduled tasks)
## Available Context Sources   ← existing (line 709, lazy manifest)
## Workspace Memory            ← existing (line 728, Phase 0A+)
## Known Workspace Entities    ← existing (line 736)
## Current Board               ← existing (line 740)
## Subaccount State Summary    ← existing (line 749)
```

Beliefs inject immediately after the briefing (after line 679) because the two sections form a natural pair: the briefing provides narrative orientation ("here's what happened recently") and beliefs provide factual state ("here's what I know to be true"). The agent reads the story first, then the facts. Task instructions and memory follow as the operational context.

### Query and formatting

```typescript
// In agentExecutionService.ts, after briefing injection:
const beliefs = await agentBeliefService.getActiveBeliefs(
  request.organisationId,
  request.subaccountId!,
  request.agentId,
);

if (beliefs.length > 0) {
  dynamicParts.push(`\n\n---\n## Your Beliefs\n${formatBeliefsForPrompt(beliefs)}`);
}
```

**`getActiveBeliefs()`** returns all active beliefs (not superseded, not deleted) for the agent-subaccount, ordered by category then confidence descending. Truncates to `BELIEFS_TOKEN_BUDGET` tokens — drops lowest-confidence beliefs first until the total fits.

**`formatBeliefsForPrompt()`** groups beliefs by category:

```
## Your Beliefs
These are facts you have formed from previous runs. Treat them as your
working knowledge — they may be updated or corrected over time.

**Preferences:**
- [0.9] Client prefers weekly reports delivered Monday morning
- [0.8] Client communication style: concise, data-driven

**Workflow:**
- [0.85] Monthly reporting cycle runs on the 1st, due by the 5th
- [0.7] Invoicing handled through Xero, synced weekly

**Metrics:**
- [0.75] Current MRR: $12,400 (as of March 2026)
- [0.6] Client satisfaction score: 8.2/10 (last surveyed Feb 2026)
```

The `[0.9]` prefix is the confidence score. Agents can see which beliefs are strong vs tentative. The category grouping makes scanning fast.

### Token budget enforcement

```typescript
function selectBeliefsWithinBudget(
  beliefs: AgentBelief[],
  tokenBudget: number
): AgentBelief[] {
  // Sort by confidence descending — highest confidence survives budget cuts
  const sorted = [...beliefs].sort((a, b) => b.confidence - a.confidence);
  const selected: AgentBelief[] = [];
  let tokens = 0;

  for (const belief of sorted) {
    const beliefTokens = estimateTokens(formatSingleBelief(belief));
    if (tokens + beliefTokens > tokenBudget) break;
    selected.push(belief);
    tokens += beliefTokens;
  }

  return selected;
}
```

### Interaction with briefing

The briefing prompt (in `agentBriefingService.ts`) should be updated to be aware of beliefs:

```
- Do NOT repeat facts that are already captured as beliefs
- Focus on narrative context: what happened recently, what's in progress, what changed
- Assume the agent will also see its belief set — you don't need to restate stable facts
```

This prevents duplication between the briefing and belief sections, keeping total token cost down.

## 6. User Override and Observability

### 6.1 User override API

Three routes in `server/routes/subaccountAgents.ts`, gated by org-level permissions (matches existing agent route pattern). All routes call `resolveSubaccount(subaccountId, req.orgId)` per architecture rules.

```
GET    /api/subaccounts/:subaccountId/agents/:linkId/beliefs
PUT    /api/subaccounts/:subaccountId/agents/:linkId/beliefs/:beliefKey
DELETE /api/subaccounts/:subaccountId/agents/:linkId/beliefs/:beliefKey
```

Middleware: `authenticate`, `requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW)` for GET, `requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT)` for PUT/DELETE.

**GET** returns all active beliefs for the agent-subaccount, ordered by category then confidence. Used by the UI to display what an agent believes.

**PUT** upserts a belief with `source: 'user_override'` and `confidence: 1.0`. User-set beliefs are always maximum confidence. The LLM extraction will see them in the current-beliefs context and should respect them (the prompt instructs: "do not override beliefs with source 'user_override' unless you have strong contradictory evidence").

**DELETE** soft-deletes a belief (`deleted_at = now()`).

Both PUT and DELETE return the updated/deleted belief row. The route uses `:linkId` (subaccount-agent link ID) rather than `:agentId` to match the existing route pattern — the handler resolves the agentId from the link row.

### 6.3 UI surface

Phase 1: add a "Beliefs" tab to the subaccount agent detail page (`AdminSubaccountDetailPage.tsx`). Simple table:

| Category | Subject | Belief | Confidence | Source | Last Updated |
|----------|---------|--------|------------|--------|-------------|

With inline edit (pencil icon → modal) and delete (trash icon). When a user edits, it hits the PUT endpoint with `source: 'user_override'`.

### 6.4 Observability

- Log belief extraction count per run in the existing run telemetry span
- Log belief merge operations (add/update/reinforce/remove counts)
- No separate dashboard — beliefs are visible in the UI table and in the agent's prompt (visible in run message history)

## 7. Migration Path to State Evolution

Phase 1 (this spec) lays the groundwork. Phase 2 adds anda-hippocampus-style state evolution.

### What Phase 1 ships

- `agent_beliefs` table with `superseded_by`/`superseded_at` columns (nullable, unused)
- LLM extraction with `add`/`update`/`reinforce`/`remove` actions
- `update` action overwrites the value in-place (no history)
- `remove` action soft-deletes (basic history)

### What Phase 2 adds (future, not in this spec)

| Capability | How it uses Phase 1 primitives |
|-----------|-------------------------------|
| **State evolution** | Instead of overwriting on `update`, create a new row and set `superseded_by` on the old one. The unique index already supports this (it filters `WHERE superseded_by IS NULL`). |
| **Contradiction detection** | During extraction, if the LLM detects a conflict, it outputs `action: "supersede"` with both old and new values. The merge logic creates the supersession chain. |
| **Belief timeline** | Query: `SELECT * FROM agent_beliefs WHERE belief_key = $1 ORDER BY created_at`. Returns the full evolution of a belief. |
| **Confidence decay** | A nightly job reduces confidence on beliefs that haven't been reinforced in N runs. Uses `evidence_count` and `updated_at` to compute staleness. |
| **Cross-agent belief sharing** | Read beliefs from other agents on the same subaccount during extraction. Enables: "The CRM Agent believes X — do you agree?" |

### Zero-migration boundary

Phase 2 requires **no schema changes**. Every column it needs (`superseded_by`, `superseded_at`, `evidence_count`, `confidence`) exists in Phase 1. The only changes are:

1. New merge logic branch for `supersede` action
2. New nightly job for confidence decay
3. Updated extraction prompt to detect contradictions
4. Updated read query to filter superseded beliefs (already filtered by unique index)

## 8. Implementation Plan

### Files changed/created

| File | Action | Description |
|------|--------|-------------|
| `migrations/0112_agent_beliefs.sql` | Create | Table, indexes, RLS policy |
| `server/db/schema/agentBeliefs.ts` | Create | Drizzle schema |
| `server/db/schema/index.ts` | Modify | Re-export `agentBeliefs` (after `agentBriefings` line) |
| `server/config/rlsProtectedTables.ts` | Modify | Add `agent_beliefs` entry (matches `agent_briefings` pattern) |
| `server/services/agentBeliefService.ts` | Create | Core service: `extractAndMerge()`, `getActiveBeliefs()`, `formatBeliefsForPrompt()`, `upsertUserOverride()`, `softDelete()` |
| `server/config/limits.ts` | Modify | Add belief limits constants |
| `server/jobs/agentBriefingJob.ts` | Modify | Add `agentBeliefService.extractAndMerge()` call after briefing update (same handler, same payload) |
| `server/services/agentExecutionService.ts` | Modify | Inject beliefs into dynamic prompt parts (after briefing, before memory) |
| `server/services/agentBriefingService.ts` | Modify | Update briefing prompt to avoid duplicating belief facts |
| `server/routes/subaccountAgents.ts` | Modify | Add GET/PUT/DELETE belief routes with `resolveSubaccount` + `requireOrgPermission` |
| `client/src/pages/AdminSubaccountDetailPage.tsx` | Modify | Add Beliefs tab (within agents section) with table + inline edit |
| `docs/capabilities.md` | Modify | Add beliefs to agent capabilities section |
| `architecture.md` | Modify | Document beliefs in agent system section |

**Note on job registration:** Belief extraction runs inside the existing `agent-briefing-update` job handler — no new pg-boss queue or `jobConfig.ts` entry needed. The handler in `agentBriefingJob.ts` calls briefing update first, then belief extraction. Both are fire-and-forget with independent error handling, so a failure in beliefs never affects briefings. The existing `expireInSeconds: 120` in `jobConfig.ts` accommodates the additional LLM call (both calls are <30s each under normal conditions).

### Phasing

**Phase 1a — Backend (2-3 days):**
1. Migration + schema + RLS entry in `rlsProtectedTables.ts`
2. `agentBeliefService.ts` (extract, merge, read, format)
3. Limits constants
4. Wire into briefing job handler
5. Wire into prompt injection (after briefing, before task instructions)
6. Update briefing prompt to deduplicate

**Phase 1b — API + UI (1-2 days):**
7. Belief routes (GET/PUT/DELETE)
8. Beliefs tab on subaccount agent detail page

**Phase 1c — Polish (0.5 day):**
9. Update briefing prompt to deduplicate
10. Doc updates (capabilities, architecture)
11. Verification

### Total effort: 3-5 days

## 9. Verification Checklist

- [ ] Migration applies cleanly: `npm run migrate`
- [ ] `npm run db:generate` produces no unexpected diff
- [ ] RLS policy active: `agent_beliefs` in `rlsProtectedTables.ts` and `verify-rls-coverage.sh` passes
- [ ] Agent run completes and beliefs are extracted (check `agent_beliefs` table)
- [ ] Subsequent run on same agent-subaccount merges correctly (update/reinforce, not duplicate)
- [ ] Beliefs appear in agent prompt (check `agent_run_messages` for "Your Beliefs" section)
- [ ] Beliefs inject after briefing, before task instructions (correct dynamic section order)
- [ ] Token budget respected: >50 beliefs → lowest-confidence beliefs dropped from prompt
- [ ] User override via PUT sets `source: 'user_override'` and `confidence: 1.0`
- [ ] User delete via DELETE sets `deleted_at`, belief disappears from prompt
- [ ] Belief routes use `resolveSubaccount` + `requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT)`
- [ ] Beliefs tab renders on subaccount agent detail page
- [ ] Briefing no longer duplicates facts that are in the belief set
- [ ] `test:gates` pass (no RLS/route violations, no job idempotency violations)
- [ ] Fire-and-forget: LLM extraction failure does NOT block run completion or briefing update
- [ ] `evidence_count` increments on reinforce, not just on add
