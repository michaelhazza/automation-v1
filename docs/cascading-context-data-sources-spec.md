# Cascading Context Data Sources + Scheduled Task Instructions — Development Spec

**Status:** Ready for implementation
**Target branch:** `claude/reporting-agent-transcript-EfR3D`
**Target migration:** `0078_scheduled_task_data_sources.sql`
**Classification:** Significant — multiple domains, new patterns, touches context assembly
**Related docs:**
- [`docs/task-chat-feature.md`](./task-chat-feature.md) — future task-thread chat feature (level-3 attachments land there)
- [`docs/setup-42macro-reporting-agent.md`](./setup-42macro-reporting-agent.md) — current specialist-skill approach this spec generalises
- [`architecture.md`](../architecture.md) — three-tier agent model, skill system, context assembly

---

## 1. Summary

Today, context attachments (reference files, datasets, Google Docs) can only be attached to an **agent**. Every run of that agent loads every attached file. There is no way to attach reference material to a **specific recurring task** or to a **specific task instance**, which forces specialisation to happen at the agent level — either by creating one agent per project (unwieldy at 50+ projects) or by hard-coding reference content into purpose-built skills like `analyse_42macro_transcript` (not scalable by non-developers).

This spec introduces **cascading context data sources** across three scopes, plus a new unified retrieval skill:

1. **Agent scope** (existing) — cross-task knowledge attached to the agent itself.
2. **Scheduled task scope** (new) — project-equivalent files attached to a recurring task template. Applies to every fire of that scheduled task.
3. **Task instance scope** (new) — one-off uploads on a specific board task instance. Auto-injected into the agent run for that task.

Additionally, scheduled tasks gain a first-class role in the **system prompt layering**: the scheduled task's existing `description` field becomes an injected "Task Instructions" layer in the agent's system prompt when a run originates from a scheduled task. This lets non-developers create new report configurations entirely through configuration — no new skill files, no code changes.

Finally, a new `read_data_source` system skill provides a **unified manifest + on-demand fetch interface** across all three scopes. Data sources can be marked `eager` (rendered into the Knowledge Base block, current behaviour) or `lazy` (shown in the manifest, fetched on demand). This is the foundation for scaling past the ~5-file mental model without committing to vector retrieval now.

## 2. Motivation

### The current limitation

The existing `agentDataSources` table supports one relationship: `agentId → data sources`. The `fetchAgentDataSources(agentId)` function in `server/services/agentService.ts:316` loads all sources for an agent and renders them into the `## Your Knowledge Base` block in the system prompt via `buildSystemPrompt` in `server/services/llmService.ts:283`.

This works when an agent is a specialist. It breaks when you want one generalist agent to handle many distinct workstreams, each with its own reference material.

Concrete example from the Breakout Solutions / 42 Macro work:

- **Today:** The `analyse_42macro_transcript` skill (`server/skills/analyse_42macro_transcript.md`) hard-codes the 42 Macro A-Player Brain prompt in the skill's `instructions` section. The five reference files (glossary, training docs, KISS portfolio methodology) live in `docs/42macro-analysis-skill.md` and must be maintained by developers. Every new report type needs a new skill file and a docs update.
- **After this spec:** One generic "reporting agent" exists. An operator creates a scheduled task for "42 Macro weekly report", pastes the A-Player Brain prompt into the **Instructions** field, and uploads the 5 reference files as **scheduled task data sources**. Adding a second report type ("ATH meeting summary") is the same workflow — no new code, no new skills, no developer involvement.

### The cascading model

The user's mental model comes from Claude Projects: a project has instructions, reference files, and a chat. Mapping this to Automation OS:

| Claude Project concept | Automation OS equivalent (after this spec) |
|---|---|
| The project itself | A `scheduledTask` (the recurring template) |
| Project instructions | `scheduledTask.description` — becomes a system prompt layer |
| Project files | `agentDataSources` rows scoped to the scheduled task |
| Uploading a one-off file in chat | `taskAttachments` on the fired board task instance |
| The agent doing the work | A generic reporting agent, reused across projects |

The "level 3" tier — attachments uploaded during an interactive chat on a task — depends on a task-thread chat surface that does not yet exist. It is captured in [`docs/task-chat-feature.md`](./task-chat-feature.md) and is **out of scope for this spec**. `taskAttachments` auto-injection replaces it for the recurring-task case and is IN scope.

### Why now

Two forcing functions:

1. The 42 Macro reporting agent is the first real reporting workflow, and the current specialist-skill approach is already unsustainable (5 skills, 2 doc files, 1 seed script for one project). The second and third projects would double the mess.
2. The `agentDataSources` table already has an unused `subaccountAgentId` column for subaccount-level scoping (added but not wired into the fetch logic). Adding `scheduledTaskId` alongside it — and wiring all three scopes at once — is strictly cheaper than adding them separately.

## 3. Architecture overview

### 3.1 Data model

One table, three scoping axes. A single row on `agentDataSources` always has `agentId` set (required — the data source belongs to an agent) and optionally ONE of `subaccountAgentId` or `scheduledTaskId` (but not both) to narrow its applicability:

| Row shape | Meaning | Applies to runs where... |
|---|---|---|
| `agentId` set, others null | Agent-wide data source | ...the agent runs at all (any subaccount, any trigger) |
| `agentId` + `subaccountAgentId` set | Subaccount-specific | ...the agent runs via the specified subaccount-agent link |
| `agentId` + `scheduledTaskId` set | Scheduled-task-specific | ...the run was fired by the specified scheduled task |

`taskAttachments` is a separate existing table with its own shape. It remains separate — we do NOT migrate attachments into `agentDataSources`. Instead, the context-loading code reads from both tables and unifies them at the point of injection.

### 3.2 Context assembly — new flow

When an agent run starts, `agentExecutionService.executeRun` calls a new **unified loader** that pulls data from up to three sources and merges them:

```
  loadRunContextData(runRequest) → {
    eager:     [{ id, scope, name, content, contentType, tokenCount, priority }],
    manifest:  [{ id, scope, name, description, sizeBytes, loadingMode, contentType }],
  }

  Inputs considered:
    • agentDataSources WHERE agentId = X AND subaccountAgentId IS NULL AND scheduledTaskId IS NULL
    • agentDataSources WHERE agentId = X AND subaccountAgentId = Y                                 (if run has subaccountAgentId)
    • agentDataSources WHERE scheduledTaskId = Z                                                   (if run.triggerContext.scheduledTaskId)
    • taskAttachments  WHERE taskId       = T AND deletedAt IS NULL                                (if run.taskId set)

  Token budget precedence (highest to lowest):
    1. Task instance attachments        (most specific — this week's transcript)
    2. Scheduled task data sources      (project reference files)
    3. Subaccount-scoped data sources   (client-specific)
    4. Agent-scoped data sources        (cross-task background)

  Per-source loadingMode:
    • eager — content loaded, counted against the budget, rendered into "## Your Knowledge Base"
    • lazy  — only the manifest entry rendered; content fetched on demand via the read_data_source skill
```

The existing 60k-token `## Your Knowledge Base` budget is retained. Instance attachments fill the budget first; if they overflow it, lower-priority scopes are truncated to `[Content omitted — context window budget reached]` (existing behaviour from `llmService.ts:301`).

### 3.3 Scheduled task instructions layer

`scheduledTasks.description` is an existing `text` column that currently flows into `buildTaskContext` for the board task. After this spec it also flows into the **system prompt** as a new dedicated section, but only when the run originates from a scheduled task (detected via `request.triggerContext.scheduledTaskId`):

```
  [existing layers: masterPrompt, Core Capabilities, Organisation Instructions,
   Your Capabilities, Additional Instructions]

  ↓ NEW layer (only when triggerContext.source === 'scheduled_task')

  ---
  ## Task Instructions
  You are executing a recurring task. Follow these instructions precisely:

  {scheduledTask.description}

  ---

  [existing layers continue: team roster, workspace memory, knowledge base, ...]
```

This is conceptually identical to the existing prompt inheritance chain — just a new layer, placed between "Additional Instructions" and the team roster. No new schema field: we re-use the existing `description` column.

### 3.4 Unified read_data_source skill

A new system skill lives at `server/skills/read_data_source.md`. It exposes two operations the agent can call mid-loop:

- **list** — returns the current run's data source manifest (all three scopes + task attachments, keyed by opaque id, with name, description, contentType, size, scope label, and whether it's eager or lazy). Eager sources appear with a `[already loaded in Knowledge Base]` marker so the agent doesn't re-fetch them.
- **read(id)** — returns the full content of a specific source by id. Enforces per-source token limits, handles binary-format rejection (text formats only in v1), and increments a per-run `read_data_source` call counter for cost tracking.

The handler lives in `server/services/skillExecutor.ts` and has access to the run context via the existing processor hook pattern.

### 3.5 UI surface

Three UI changes:

1. **Scheduled Tasks** — the create/edit form gains an **Instructions** textarea (bound to the existing `description` field, relabeled) and a **Data Sources** section that reuses the uploader pattern from `AdminAgentEditPage.tsx`.
2. **Scheduled Task Detail page** gets an edit mode so existing tasks can have instructions and data sources added without deletion/recreation.
3. **Agent run detail** (where it exists) gains a "Context Sources" panel showing which data sources were loaded for this run, labelled by scope, so operators can debug why a run had or didn't have specific context.

### 3.6 Conflict resolution — same name across scopes

When multiple sources across the resolved scope set share the same `name` (case-insensitive match, with leading/trailing whitespace trimmed), the **highest-precedence scope wins** and lower-precedence entries are **suppressed as an explicit override**.

This is a policy, not a content check. The assumption is operator intent: attaching a `glossary.md` to a scheduled task means "use THIS glossary for this project, not the agent-level one." Two files named `glossary.md` at different scopes with different content are treated as a deliberate override, not an accident.

Precedence for override resolution matches the token budget precedence:

```
task_instance > scheduled_task > subaccount > agent
```

Suppressed sources are:

- **Not** rendered into the system prompt (neither eager nor manifest).
- **Not** retrievable via the `read_data_source` skill.
- **Persisted** to the `contextSourcesSnapshot` column on the agent run with `includedInPrompt: false` and `suppressedByOverride: true`, so the debugging UI can show the operator what was overridden and why.

This deliberately does NOT do content-based deduplication. Two sources with different names but byte-identical content will both be loaded — content hashing is a future optimisation listed in §17 out of scope.

**Implementation note:** matching is on `name.toLowerCase().trim()`. The skill handler and the UI must both treat the matched group as a set keyed by normalised name for display purposes.

## 4. Acceptance criteria

This spec is complete when all of the following are true:

### Schema
- [ ] Migration `0078_scheduled_task_data_sources.sql` adds `scheduled_task_id` and `loading_mode` columns to `agent_data_sources`, plus a CHECK constraint enforcing mutual exclusion of `subaccount_agent_id` and `scheduled_task_id`, plus a partial unique index preventing duplicate source names within the same scope.
- [ ] `_down/0078_scheduled_task_data_sources.sql` reverses the migration.
- [ ] `server/db/schema/agentDataSources.ts` reflects the new columns with TypeScript types.

### Context assembly
- [ ] `agentExecutionService.executeRun` calls a new `loadRunContextData` helper instead of the direct `fetchAgentDataSources(agentId)` call at line 409.
- [ ] When `request.triggerContext?.source === 'scheduled_task'`, the scheduled task's `description` is fetched and injected as a `## Task Instructions` layer in the system prompt.
- [ ] When `request.taskId` is set, `taskAttachments` for that task (text formats only) are loaded into the context pool with task-instance priority.
- [ ] Token budget precedence is enforced: instance → scheduled task → subaccount → agent. Verified by a unit test.
- [ ] Same-name conflict resolution: when multiple sources share a normalised name across scopes, only the highest-precedence scope is included. Suppressed sources are persisted in the snapshot with `suppressedByOverride: true`. Verified by a unit test.
- [ ] **Pre-prompt budget enforcement**: `loadRunContextData` walks the eager pool and marks sources with `includedInPrompt: true/false` upstream of `buildSystemPrompt`. Sources that don't fit are excluded deterministically rather than silently character-truncated by the downstream renderer. Verified by a unit test.
- [ ] Eager sources that were `includedInPrompt: true` are rendered into `## Your Knowledge Base` (existing block). Lazy sources are rendered into a new `## Available Context Sources` manifest block and NOT loaded into the base prompt.
- [ ] Lazy manifest rendered into the system prompt is capped at `MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT` (default 25); excess items are elided with a summary line and still accessible via `read_data_source op='list'`.

### Read skill
- [ ] `server/skills/read_data_source.md` exists with frontmatter, tool definition (list + read operations), and instructions.
- [ ] `skillExecutor.ts` has a handler that resolves against the current run's loaded context pool.
- [ ] The skill respects the `loadingMode` field — reading a lazy source fetches it fresh; reading an eager source returns the already-loaded content.
- [ ] Binary content types (non-text MIME) return a structured error, not raw bytes.
- [ ] `read` op accepts optional `offset` (default 0) and `limit` (default `MAX_READ_DATA_SOURCE_TOKENS_PER_CALL`) and returns the requested slice.
- [ ] The effective `limit` is **clamped** to `MAX_READ_DATA_SOURCE_TOKENS_PER_CALL` — a caller passing a larger explicit value is silently reduced to the cap, NOT rejected with an error. Clamped slicing is the contract.
- [ ] When a source is larger than the effective `limit` at the current `offset`, the response returns the slice with `nextOffset` set (non-null) and `truncated: true`, so the agent can walk the source in chunks. Only `offset < 0` or unknown `id` return structured errors.

### Routes
- [ ] New CRUD endpoints under `/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources` for create (URL and file upload), list, update, delete, and test-fetch.
- [ ] Existing `/api/agents/:id/data-sources` endpoints are unchanged.
- [ ] Scheduled task CRUD routes accept and persist the `description` field (currently supported in the service but not exposed prominently in the UI form).

### Permissions
- [ ] New org permission key `ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE = 'org.scheduled_tasks.data_sources.manage'`.
- [ ] Seed entry in `server/lib/permissions.ts` permission catalogue.
- [ ] Granted by default to any permission set that already grants `AGENTS_EDIT` (documented in the seed).
- [ ] New data source routes check this permission.

### UI
- [ ] `ScheduledTasksPage.tsx` create modal includes an **Instructions** textarea (multi-line, bound to `description`) — the existing "Brief / Instructions" field is renamed to "Brief" and becomes a short summary only.
- [ ] `ScheduledTaskDetailPage.tsx` gains an edit mode: editable title, description, brief, priority, rrule, timezone, scheduleTime, and a data sources management panel.
- [ ] Data sources panel supports: upload file, add URL source, edit source, delete source, test fetch, toggle eager/lazy.
- [ ] Agent run detail view surfaces the "Context Sources" panel with scope labels.

### Verification
- [ ] Unit tests for `loadRunContextData` covering all precedence combinations.
- [ ] Unit tests for the CHECK constraint (inserting a row with both `subaccountAgentId` and `scheduledTaskId` fails).
- [ ] Unit tests for the `read_data_source` skill handler (list, read, binary rejection, unknown id).
- [ ] Integration test: create a scheduled task with instructions + 2 data sources, fire it, assert the agent run's system prompt contains the instructions layer and the knowledge base block contains both sources.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` all green.

### Documentation
- [ ] `architecture.md` updated with a new "Context Data Sources" section documenting the three scopes, precedence rules, and the unified loader.
- [ ] `docs/setup-42macro-reporting-agent.md` marked as superseded (or updated to show the new config-driven approach).
- [ ] A short "how to configure a new recurring report" doc added to `docs/` with a worked example.

---

## 5. Schema changes

### 5.1 Migration `0078_scheduled_task_data_sources.sql`

**Path:** `migrations/0078_scheduled_task_data_sources.sql`

```sql
-- 0078_scheduled_task_data_sources.sql
--
-- Adds scheduled-task scoping and loading-mode support to agent_data_sources.
--
-- Context: agent_data_sources already has an (unused) subaccount_agent_id column
-- for subaccount-level scoping. This migration adds a parallel scheduled_task_id
-- column for scheduled-task-level scoping, plus a loading_mode column that
-- controls whether a source is stuffed into the system prompt (eager) or only
-- surfaced in the manifest for on-demand retrieval via read_data_source (lazy).
--
-- A CHECK constraint enforces that a row cannot be both subaccount-scoped and
-- scheduled-task-scoped — the two scopes are orthogonal and mutually exclusive.
--
-- A partial unique index prevents two data sources with the same name from
-- existing within the same scope (per-agent, per-subaccount-link, or
-- per-scheduled-task).

ALTER TABLE agent_data_sources
  ADD COLUMN IF NOT EXISTS scheduled_task_id UUID
    REFERENCES scheduled_tasks(id) ON DELETE CASCADE;

ALTER TABLE agent_data_sources
  ADD COLUMN IF NOT EXISTS loading_mode TEXT NOT NULL DEFAULT 'eager';

-- Enforce loading_mode enum shape
ALTER TABLE agent_data_sources
  ADD CONSTRAINT agent_data_sources_loading_mode_check
  CHECK (loading_mode IN ('eager', 'lazy'));

-- Mutual exclusion of scoping columns
ALTER TABLE agent_data_sources
  ADD CONSTRAINT agent_data_sources_scope_exclusive_check
  CHECK (
    NOT (subaccount_agent_id IS NOT NULL AND scheduled_task_id IS NOT NULL)
  );

-- Index for scheduled-task-scoped lookups
CREATE INDEX IF NOT EXISTS agent_data_sources_scheduled_task_idx
  ON agent_data_sources (scheduled_task_id)
  WHERE scheduled_task_id IS NOT NULL;

-- Uniqueness per scope: the triple (agent_id, scope_key, name) must be unique
-- where scope_key is effectively:
--   agent-scoped          → (NULL, NULL)
--   subaccount-scoped     → (subaccount_agent_id, NULL)
--   scheduled-task-scoped → (NULL, scheduled_task_id)
CREATE UNIQUE INDEX IF NOT EXISTS agent_data_sources_unique_per_scope_idx
  ON agent_data_sources (
    agent_id,
    COALESCE(subaccount_agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(scheduled_task_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name
  )
  WHERE name IS NOT NULL;
```

**Down migration** — `migrations/_down/0078_scheduled_task_data_sources.sql`:

```sql
-- Reverse 0078_scheduled_task_data_sources.sql

DROP INDEX IF EXISTS agent_data_sources_unique_per_scope_idx;
DROP INDEX IF EXISTS agent_data_sources_scheduled_task_idx;

ALTER TABLE agent_data_sources
  DROP CONSTRAINT IF EXISTS agent_data_sources_scope_exclusive_check;
ALTER TABLE agent_data_sources
  DROP CONSTRAINT IF EXISTS agent_data_sources_loading_mode_check;

ALTER TABLE agent_data_sources DROP COLUMN IF EXISTS loading_mode;
ALTER TABLE agent_data_sources DROP COLUMN IF EXISTS scheduled_task_id;
```

### 5.2 Drizzle schema update

**File:** `server/db/schema/agentDataSources.ts`

Additions (keeping the rest of the file unchanged):

```typescript
// Add import
import { scheduledTasks } from './scheduledTasks';

// Inside pgTable column definitions, after subaccountAgentId:
scheduledTaskId: uuid('scheduled_task_id')
  .references(() => scheduledTasks.id, { onDelete: 'cascade' }),

// Loading mode: eager = stuffed into Knowledge Base block (default, current behaviour)
//              lazy  = manifest only, agent fetches on demand via read_data_source skill
loadingMode: text('loading_mode')
  .notNull()
  .default('eager')
  .$type<'eager' | 'lazy'>(),

// Inside the index builder callback, add:
scheduledTaskIdx: index('agent_data_sources_scheduled_task_idx')
  .on(table.scheduledTaskId),
```

**Note on the CHECK constraint:** Drizzle's `pgTable` builder supports CHECK constraints via the table configuration callback. Add:

```typescript
import { check } from 'drizzle-orm/pg-core';

// Inside the table config callback:
scopeExclusiveCheck: check(
  'agent_data_sources_scope_exclusive_check',
  sql`NOT (${table.subaccountAgentId} IS NOT NULL AND ${table.scheduledTaskId} IS NOT NULL)`
),
loadingModeCheck: check(
  'agent_data_sources_loading_mode_check',
  sql`${table.loadingMode} IN ('eager', 'lazy')`
),
```

If the installed Drizzle version does not support `check()` in the config callback, the SQL migration is the source of truth — the Drizzle schema just needs to reflect the columns, and the constraint lives in the migration.

### 5.3 No new columns on `scheduledTasks`

**Important design decision:** We deliberately do NOT add an `instructions` column to `scheduledTasks`. The existing `description` (`text` nullable) column already exists at `server/db/schema/scheduledTasks.ts:24` and is already copied to the board task at `scheduledTaskService.ts:324`. This spec promotes it to a first-class **system prompt layer** and relabels it in the UI as "Instructions", but the underlying column stays the same.

This avoids schema churn and keeps the existing service layer untouched.

### 5.4 No changes to `taskAttachments`

The `taskAttachments` table at `server/db/schema/taskAttachments.ts` is used as-is. The context loader will query it directly. No migration needed.

---

## 6. Service layer — data source changes

### 6.1 Extend `fetchAgentDataSources`

**File:** `server/services/agentService.ts`
**Current function:** `export async function fetchAgentDataSources(agentId: string)` at line 316

Rename to `fetchDataSourcesByScope` and generalise:

```typescript
export interface DataSourceScope {
  agentId: string;
  subaccountAgentId?: string | null;   // when run is within a subaccount agent link
  scheduledTaskId?: string | null;     // when run was fired by a scheduled task
}

export interface LoadedDataSource {
  id: string;
  scope: 'agent' | 'subaccount' | 'scheduled_task' | 'task_instance';
  name: string;
  description: string | null;
  content: string;              // empty string for lazy sources until fetched
  contentType: string;
  tokenCount: number;
  sizeBytes: number;
  loadingMode: 'eager' | 'lazy';
  priority: number;
  fetchOk: boolean;
  maxTokenBudget: number;

  // ─── Decisions made by loadRunContextData ────────────────────────────────
  //
  // These fields are **optional at the type level** because `fetchDataSourcesByScope`
  // and `loadTaskAttachmentsAsContext` return `LoadedDataSource` values with
  // none of them set — they hand back a raw pool for the caller to process.
  //
  // After `loadRunContextData` runs its full pipeline (sort → assign
  // orderIndex → suppress by override → split eager/lazy → budget walk),
  // every source returned in `runContextData.eager`, `runContextData.manifest`,
  // or `runContextData.suppressed` is **guaranteed** to have `orderIndex`,
  // `includedInPrompt`, and (where applicable) `suppressedByOverride` set.
  // Downstream code — the snapshot serialiser, the skill handler, the UI —
  // can treat them as present.
  //
  // Rationale for keeping them optional on the type instead of splitting into
  // `LoadedDataSource` + `ProcessedLoadedDataSource`: the two types would share
  // 100% of their non-decision fields, and the split would force trivial
  // casts at every boundary. The optional-with-invariant approach trades a
  // small amount of type laxity for a much simpler call graph.

  /**
   * Deterministic position in the full sorted pool (0 = first).
   *
   * - **Before `loadRunContextData`**: undefined.
   * - **After `loadRunContextData`**: always a non-negative integer. Assigned
   *   in §7.1 step 5 on the full sorted pool BEFORE override suppression,
   *   so every entry — winners, suppressed losers, eager, lazy, binary —
   *   carries a stable index. The debug UI sorts by this field.
   *
   * Never null. Never -1. Never undefined after loader processing.
   */
  orderIndex?: number;

  /**
   * True when this source was rendered into the `## Your Knowledge Base`
   * block of the system prompt.
   *
   * - **Before `loadRunContextData`**: undefined.
   * - **After `loadRunContextData`**: always a boolean. False for lazy
   *   sources (by definition), sources suppressed by same-name override,
   *   and eager sources that exceeded `MAX_EAGER_BUDGET`.
   */
  includedInPrompt?: boolean;

  /**
   * True when the downstream character-level safety net in `buildSystemPrompt`
   * truncated this source. Normally false once the upstream budget walk is
   * in place — kept as an observability signal for the rare case where
   * token estimation was off and the source rendered larger than predicted.
   *
   * - **Before `loadRunContextData`**: undefined.
   * - **After `loadRunContextData`**: defaults to false. May be flipped to
   *   true by the §7.4 post-render hook.
   */
  truncated?: boolean;

  /**
   * True when another higher-precedence source with the same normalised name
   * won the override resolution (see §3.6). Mutually exclusive with
   * `includedInPrompt: true`.
   *
   * - **Before `loadRunContextData`**: undefined.
   * - **After `loadRunContextData`**: always a boolean. Entries in
   *   `runContextData.suppressed` have this set to true.
   */
  suppressedByOverride?: boolean;

  /**
   * When `suppressedByOverride` is true, the id of the source that won the
   * override. Used by the debug UI to link the suppressed row to its winner.
   * Undefined when `suppressedByOverride` is false.
   */
  suppressedBy?: string;
}

export async function fetchDataSourcesByScope(
  scope: DataSourceScope
): Promise<LoadedDataSource[]> {
  // Build a single query with OR conditions for each scope, so we hit the
  // DB once per run. Use the agent_data_sources_scheduled_task_idx and
  // agent_data_sources_agent_priority_idx indexes.
  const conditions = [
    // 1. Agent-wide: agentId matches, no subaccount or scheduled task scope
    and(
      eq(agentDataSources.agentId, scope.agentId),
      isNull(agentDataSources.subaccountAgentId),
      isNull(agentDataSources.scheduledTaskId),
    ),
  ];

  if (scope.subaccountAgentId) {
    conditions.push(
      and(
        eq(agentDataSources.agentId, scope.agentId),
        eq(agentDataSources.subaccountAgentId, scope.subaccountAgentId),
      )
    );
  }

  if (scope.scheduledTaskId) {
    conditions.push(
      eq(agentDataSources.scheduledTaskId, scope.scheduledTaskId),
    );
  }

  const rows = await db
    .select()
    .from(agentDataSources)
    .where(or(...conditions))
    .orderBy(asc(agentDataSources.priority));

  // Fetch content for eager sources only. Lazy sources get placeholder content
  // until read_data_source is called.
  const results: LoadedDataSource[] = [];
  for (const source of rows) {
    const resolvedScope: LoadedDataSource['scope'] =
      source.scheduledTaskId ? 'scheduled_task'
      : source.subaccountAgentId ? 'subaccount'
      : 'agent';

    if (source.loadingMode === 'lazy') {
      results.push({
        id: source.id,
        scope: resolvedScope,
        name: source.name,
        description: source.description,
        content: '',
        contentType: source.contentType,
        tokenCount: 0,
        sizeBytes: estimateSizeFromPath(source),  // optional; use 0 if unknown
        loadingMode: 'lazy',
        priority: source.priority,
        fetchOk: true,
        maxTokenBudget: source.maxTokenBudget,
      });
      continue;
    }

    // Eager: reuse the existing fetchSourceContent + formatContent pipeline
    // and cache behaviour from the current fetchAgentDataSources function
    // (server/services/agentService.ts:341–396). Extract that block into a
    // shared helper loadSourceContent(source) so both this function and the
    // read skill handler can call it.
    const { content, fetchOk, tokenCount } = await loadSourceContent(source);
    results.push({
      id: source.id,
      scope: resolvedScope,
      name: source.name,
      description: source.description,
      content,
      contentType: source.contentType,
      tokenCount,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      loadingMode: 'eager',
      priority: source.priority,
      fetchOk,
      maxTokenBudget: source.maxTokenBudget,
    });
  }

  return results;
}
```

**Backwards compatibility:** Keep the existing `fetchAgentDataSources(agentId)` as a thin wrapper that calls `fetchDataSourcesByScope({ agentId })`. This preserves the call site in `conversationService.ts:179` (which hits data sources outside the agent-run path, for the agent-chat surface) without forcing a broader refactor.

### 6.2 Extract `loadSourceContent`

Lift the eager-fetch block (currently inline at lines 341–396 of `agentService.ts`) into a named helper:

```typescript
async function loadSourceContent(
  source: typeof agentDataSources.$inferSelect
): Promise<{ content: string; fetchOk: boolean; tokenCount: number }> {
  // Preserves existing cache, silent-fallback-to-last-good-content, and
  // maybeSendDataSourceAlert behaviour. Pure extraction — no logic change.
}
```

Both `fetchDataSourcesByScope` and the new `read_data_source` skill handler will call this helper. This guarantees they use the same fetching/caching/error-handling path.

### 6.3 Task attachment loader

**New function:** `loadTaskAttachmentsAsContext(taskId, organisationId)`

**Location:** Either `server/services/taskService.ts` or a new `server/services/taskAttachmentContextService.ts`. Lean toward the latter for clear separation.

```typescript
// server/services/taskAttachmentContextService.ts
import { taskAttachments } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { LoadedDataSource } from './agentService.js';

const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml'];
const TEXT_EXTENSIONS = ['.md', '.txt', '.json', '.csv', '.xml', '.yaml', '.yml'];

function isTextReadable(mime: string, fileName: string): boolean {
  if (TEXT_MIME_PREFIXES.some(p => mime.startsWith(p))) return true;
  return TEXT_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext));
}

export async function loadTaskAttachmentsAsContext(
  taskId: string,
  organisationId: string
): Promise<LoadedDataSource[]> {
  const rows = await db
    .select()
    .from(taskAttachments)
    .where(
      and(
        eq(taskAttachments.taskId, taskId),
        eq(taskAttachments.organisationId, organisationId),
        isNull(taskAttachments.deletedAt),
      )
    );

  const results: LoadedDataSource[] = [];
  for (const att of rows) {
    const readable = isTextReadable(att.fileType, att.fileName);
    if (!readable) {
      // Surface in manifest only — do not attempt to load binary content.
      results.push({
        id: `task_attachment:${att.id}`,
        scope: 'task_instance',
        name: att.fileName,
        description: `[${att.fileType}, binary — not readable in v1]`,
        content: '',
        contentType: 'text',
        tokenCount: 0,
        sizeBytes: att.fileSizeBytes,
        loadingMode: 'lazy',
        priority: 0,                // scope precedence drives ordering; priority is per-scope
        fetchOk: false,
        maxTokenBudget: 0,
      });
      continue;
    }

    // Text-readable: fetch content from storage (local or S3 based on
    // att.storageProvider). Reuse the existing storage helpers from
    // agentService's fetchSourceContent (extract them into a shared
    // storage module if not already done).
    const content = await readAttachmentFromStorage(att);
    results.push({
      id: `task_attachment:${att.id}`,
      scope: 'task_instance',
      name: att.fileName,
      description: null,
      content,
      contentType: 'text',
      tokenCount: approxTokens(content),
      sizeBytes: att.fileSizeBytes,
      loadingMode: 'eager',
      priority: 0,
      fetchOk: true,
      maxTokenBudget: 8000,        // default, matching agent_data_sources default
    });
  }

  return results;
}
```

**Scope labelling:** task instance attachments use the formal `'task_instance'` scope value (one of the four values in the `LoadedDataSource.scope` union — see §6.1). This is the scope value referenced throughout the loader, the snapshot, the debug UI, and the `read_data_source` skill. Precedence ordering: `task_instance > scheduled_task > subaccount > agent`, enforced by `scopeOrder` in §7.1 — the scope itself drives precedence, not the `priority` field. `priority: 0` on task attachments is intentional: priority is only consulted WITHIN a scope to break ties, never ACROSS scopes.

### 6.4 CRUD service methods for scheduled-task data sources

Extend `agentService` with methods that mirror the existing agent-level CRUD but scope to a scheduled task:

```typescript
// In server/services/agentService.ts, alongside addDataSource/updateDataSource/etc.

async addScheduledTaskDataSource(
  scheduledTaskId: string,
  organisationId: string,
  data: { name, description?, sourceType, sourcePath, sourceHeaders?, contentType?, priority?, maxTokenBudget?, cacheMinutes?, loadingMode? }
): Promise<AgentDataSource> {
  // 1. Resolve the scheduled task, verify it belongs to this org
  // 2. Derive agentId from scheduledTask.assignedAgentId
  // 3. Insert the row with agentId + scheduledTaskId set, subaccountAgentId null
  // 4. Return the created row
}

async listScheduledTaskDataSources(scheduledTaskId, organisationId): Promise<AgentDataSource[]>
async updateScheduledTaskDataSource(sourceId, scheduledTaskId, organisationId, patch)
async deleteScheduledTaskDataSource(sourceId, scheduledTaskId, organisationId)
async testScheduledTaskDataSource(sourceId, scheduledTaskId, organisationId)
async uploadScheduledTaskDataSourceFile(scheduledTaskId, organisationId, file)
```

Each method must verify the scheduled task belongs to `organisationId` before any write — protect against cross-org tampering via guessed ids.

**Invariant to enforce:** when a scheduled task's `assignedAgentId` is changed, orphaned data sources on that task are... what? Two options:

- **(a)** Cascade-update `agentId` on the data sources to match the new agent. This keeps the data sources alive and tied to the new agent.
- **(b)** Reject the update with a clear error: "this scheduled task has data sources attached; detach them first or create a new scheduled task for the new agent."

Recommendation: **(a)** for ergonomics, but emit an audit event when the cascade happens. A user editing the assigned agent is usually just fixing an assignment, not intending to break their reference material. Implement in `scheduledTaskService.update` when the new payload contains a different `assignedAgentId` than the existing row.

---

## 7. Context assembly changes

This is the hub of the feature. Everything else (schema, services, UI, skill) supports what happens here: the moment a run starts, the system prompt is assembled with layered context from all applicable scopes.

### 7.1 New unified loader

**New function:** `loadRunContextData(request, run)`
**Location:** `server/services/runContextLoader.ts` (new file)

This replaces the single `fetchAgentDataSources(request.agentId)` call at `agentExecutionService.ts:409`.

```typescript
// server/services/runContextLoader.ts
import { fetchDataSourcesByScope, type LoadedDataSource } from './agentService.js';
import { loadTaskAttachmentsAsContext } from './taskAttachmentContextService.js';
import { db } from '../db/index.js';
import { scheduledTasks } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

export interface RunContextData {
  // Fully-fetched sources, ready to render into the Knowledge Base block
  eager: LoadedDataSource[];

  // Manifest entries for lazy sources (and binary task attachments)
  // — agent fetches these via read_data_source skill
  manifest: LoadedDataSource[];

  // The scheduled task's instructions, if the run was fired by a scheduled task
  // — rendered as the "## Task Instructions" system prompt layer
  taskInstructions: string | null;
}

export async function loadRunContextData(
  request: AgentRunRequest,
  run: { id: string }
): Promise<RunContextData> {
  const pool: LoadedDataSource[] = [];

  // 1. Load agentDataSources across all applicable scopes
  const triggerScheduledTaskId = resolveScheduledTaskId(request);
  const scopedSources = await fetchDataSourcesByScope({
    agentId: request.agentId,
    subaccountAgentId: request.subaccountAgentId ?? null,
    scheduledTaskId: triggerScheduledTaskId,
  });
  pool.push(...scopedSources);

  // 2. Load task instance attachments if the run targets a specific task
  if (request.taskId) {
    const taskAttachments = await loadTaskAttachmentsAsContext(
      request.taskId,
      request.organisationId,
    );
    pool.push(...taskAttachments);
  }

  // 3. Resolve scheduled task instructions (the "Task Instructions" layer)
  let taskInstructions: string | null = null;
  if (triggerScheduledTaskId) {
    const [st] = await db
      .select({ description: scheduledTasks.description })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, triggerScheduledTaskId));
    if (st?.description && st.description.trim().length > 0) {
      taskInstructions = st.description.trim();
    }
  }

  // 4. Sort the full pool by scope precedence then source priority
  //    (done BEFORE dedupe so the override rule always picks the
  //    highest-precedence winner deterministically).
  //    Precedence: task_instance before scheduled_task before subaccount before agent.
  //    Within each scope, lower priority number wins.
  const scopeOrder: Record<LoadedDataSource['scope'], number> = {
    task_instance: 0,
    scheduled_task: 1,
    subaccount: 2,
    agent: 3,
  };
  const sorter = (a: LoadedDataSource, b: LoadedDataSource) => {
    const scopeDiff = scopeOrder[a.scope] - scopeOrder[b.scope];
    if (scopeDiff !== 0) return scopeDiff;
    return a.priority - b.priority;
  };
  pool.sort(sorter);

  // 5. Assign orderIndex to the full sorted pool — BEFORE suppression
  //    or eager/lazy splitting. This guarantees every source (winners,
  //    losers, eager, lazy, binary) carries a stable, deterministic
  //    orderIndex through to the snapshot. The debug UI sorts by this
  //    field, so determinism here is a user-visible property.
  pool.forEach((source, idx) => {
    source.orderIndex = idx;
  });

  // 6. Same-name override resolution (§3.6)
  //    When multiple sources across scopes share the same normalised name,
  //    the first one in sort order (highest precedence) wins. Others are
  //    marked suppressedByOverride: true and included in the snapshot but
  //    excluded from both the prompt and the read_data_source skill.
  //    orderIndex is preserved on both winners and losers from step 5.
  const normaliseName = (n: string) => n.toLowerCase().trim();
  const winnersByName = new Map<string, LoadedDataSource>();
  const suppressed: LoadedDataSource[] = [];
  for (const source of pool) {
    const key = normaliseName(source.name);
    const winner = winnersByName.get(key);
    if (!winner) {
      winnersByName.set(key, source);
      continue;
    }
    // Mark as suppressed; winner keeps its slot
    source.suppressedByOverride = true;
    source.suppressedBy = winner.id;
    source.includedInPrompt = false;
    suppressed.push(source);
  }
  const activePool = pool.filter(s => !s.suppressedByOverride);

  // 7. Split eager vs lazy from the active (post-dedupe) pool
  const eager = activePool.filter(s => s.loadingMode === 'eager');
  const manifest = activePool.filter(s => s.loadingMode === 'lazy');

  // 8. Pre-prompt budget enforcement — walk the eager list, accumulating
  //    tokenCount against MAX_EAGER_BUDGET. Sources that fit are marked
  //    includedInPrompt: true. Sources that don't fit stay in the list
  //    with includedInPrompt: false (so the snapshot sees them) but are
  //    excluded from the system prompt render in agentExecutionService.
  //
  //    orderIndex is NOT reassigned here — it was set on the full pool
  //    in step 5 and is preserved through all subsequent filtering.
  //
  //    This replaces the old reliance on buildSystemPrompt's character-level
  //    truncation as the primary budget mechanism. The downstream truncation
  //    remains as a belt-and-braces safety net.
  const { MAX_EAGER_BUDGET } = await import('../config/limits.js');
  let accumulatedTokens = 0;
  for (const source of eager) {
    if (accumulatedTokens + source.tokenCount <= MAX_EAGER_BUDGET) {
      source.includedInPrompt = true;
      accumulatedTokens += source.tokenCount;
    } else {
      source.includedInPrompt = false;
    }
  }

  // Manifest entries are never included in the Knowledge Base block (by
  // definition — they're the lazy manifest), but they do appear in the
  // system prompt as the "Available Context Sources" list. Tag them for
  // the snapshot so debugging shows why each entry was there. Again,
  // orderIndex is preserved from step 5.
  for (const source of manifest) {
    source.includedInPrompt = false;  // not in the Knowledge Base block
  }

  // 9. Cap the manifest length rendered INTO the prompt
  //    (the full manifest is still available via read_data_source op='list').
  const { MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT } = await import('../config/limits.js');
  const manifestForPrompt = manifest.slice(0, MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT);
  const manifestElidedCount = Math.max(0, manifest.length - manifestForPrompt.length);

  return {
    eager,                      // full list — caller filters by includedInPrompt
    manifest,                   // full list — used by read_data_source
    manifestForPrompt,          // capped subset for system prompt render
    manifestElidedCount,        // count of manifest entries omitted from prompt
    suppressed,                 // for snapshot persistence only
    taskInstructions,
  };
}

function resolveScheduledTaskId(request: AgentRunRequest): string | null {
  const ctx = request.triggerContext as { source?: string; scheduledTaskId?: string } | undefined;
  if (!ctx) return null;
  if (ctx.source === 'scheduled_task' && ctx.scheduledTaskId) return ctx.scheduledTaskId;
  return null;
}
```

**Updated `RunContextData` interface** (replaces the version above):

```typescript
export interface RunContextData {
  /** Eager sources, full list. Filter by `includedInPrompt` to get the render set. */
  eager: LoadedDataSource[];
  /** Lazy sources, full list. Used by the read_data_source skill handler. */
  manifest: LoadedDataSource[];
  /** Capped subset of the manifest rendered into the system prompt. */
  manifestForPrompt: LoadedDataSource[];
  /** How many manifest entries were omitted from the prompt (for the elision note). */
  manifestElidedCount: number;
  /** Sources suppressed by same-name override — snapshot only. */
  suppressed: LoadedDataSource[];
  /** Scheduled task description, when the run was fired by a scheduled task. */
  taskInstructions: string | null;
}
```

### 7.2 Wire the loader into `agentExecutionService.executeRun`

**File:** `server/services/agentExecutionService.ts`
**Current call site:** line 409 (`const dataSourceContents = await agentService.fetchAgentDataSources(request.agentId);`)

Replace that line with:

```typescript
// ── 3. Load run context data (cascading scopes + task attachments + instructions) ──
const { loadRunContextData } = await import('./runContextLoader.js');
const runContextData = await loadRunContextData(request, run);

// Only eager sources flagged includedInPrompt: true are rendered into the
// Knowledge Base block. Sources excluded by the upstream budget walk or by
// same-name override resolution stay in runContextData (for snapshot
// persistence) but do not appear in the prompt.
const dataSourceContents = runContextData.eager
  .filter(s => s.includedInPrompt)
  .map(s => ({
    name: s.name,
    description: s.description,
    content: s.content,
    contentType: s.contentType,
  }));
```

Then, after the existing system prompt assembly block (around line 534 where "Additional Instructions" is appended), inject the new "Task Instructions" layer **conditionally**:

```typescript
// Layer 3.5: Task Instructions — only when run originates from a scheduled task
if (runContextData.taskInstructions) {
  systemPromptParts.push(
    `\n\n---\n## Task Instructions\nYou are executing a recurring task. Follow these instructions precisely:\n\n${runContextData.taskInstructions}`
  );
}
```

Placement matters: this layer must come **after** "Additional Instructions" (so agent-level customisation is established first) but **before** the team roster and workspace memory (so the task briefing is prominent and not buried). This matches the user's mental model: "just another inheritance layer, scoped to this specific recurring task."

### 7.3 Render the lazy manifest

After the Knowledge Base block is rendered by `buildSystemPrompt`, append a new block listing the lazy sources. Use `runContextData.manifestForPrompt` (the capped subset) — NOT the full `manifest` — so runs with 50+ lazy sources don't bloat the system prompt:

```typescript
if (runContextData.manifestForPrompt.length > 0) {
  const manifestLines = runContextData.manifestForPrompt.map(s => {
    const scopeLabel = {
      task_instance: 'task attachment',
      scheduled_task: 'scheduled task',
      subaccount: 'subaccount',
      agent: 'agent',
    }[s.scope];
    const sizeHint = s.sizeBytes > 0 ? ` (~${Math.round(s.sizeBytes / 1024)}KB)` : '';
    const unreadable = !s.fetchOk ? ' [binary — not readable]' : '';
    const desc = s.description ? ` — ${s.description}` : '';
    return `- **${s.name}** [${scopeLabel}]${sizeHint}${unreadable}${desc} (id: \`${s.id}\`)`;
  }).join('\n');

  const elidedNote = runContextData.manifestElidedCount > 0
    ? `\n\n_${runContextData.manifestElidedCount} additional source(s) are available but not listed here to keep the prompt compact. Call \`read_data_source\` with \`op: 'list'\` to see the full inventory._`
    : '';

  systemPromptParts.push(
    `\n\n---\n## Available Context Sources\nThe following additional reference materials are available. Use the \`read_data_source\` tool to fetch any of them on demand:\n\n${manifestLines}${elidedNote}`
  );
}
```

This block is the "menu" the `read_data_source` skill acts on. Keep it short — just name, scope, size, id. No content. The full list (including any elided entries) is always accessible through the skill's `list` op — the prompt cap only affects discoverability at prompt-render time.

### 7.4 `buildSystemPrompt` — safety net only

**File:** `server/services/llmService.ts`
**Current function:** `buildSystemPrompt` at line 283

No signature change — it already takes `dataSourceContents` as the eager list. The lazy manifest is rendered outside of `buildSystemPrompt`, directly by `agentExecutionService` via `systemPromptParts.push(...)`. This keeps `buildSystemPrompt` focused and means the conversation service (`conversationService.ts:179`) doesn't need to know about the new manifest concept.

**Budget enforcement has moved upstream.** The pre-prompt budget walk in `loadRunContextData` (§7.1, step 7) is now the **primary** mechanism — it decides which sources are `includedInPrompt: true` based on `MAX_EAGER_BUDGET`, and `agentExecutionService` filters to that set before calling `buildSystemPrompt`. The existing 60k `maxDataTokens` character-level budget inside `buildSystemPrompt` remains as a **safety net only** — it should almost never trigger in practice, because the upstream walk has already stayed under `MAX_EAGER_BUDGET` (which equals the same 60k ceiling).

If the safety net does trigger (e.g. token estimation was off and a source actually rendered larger than its `approxTokens` suggested), `buildSystemPrompt` will still truncate character-by-character and emit the existing `[Content omitted — context window budget reached]` marker. In that case, the spec expects the caller (`agentExecutionService`) to detect the truncation and set `truncated: true` on the affected `LoadedDataSource` entries so the snapshot reflects reality. Implementation-wise:

```typescript
// After the LLM call, or after buildSystemPrompt returns, inspect the
// returned prompt for the truncation marker and flag any source whose
// rendered length was less than its pre-walk tokenCount implied.
// This is a safety-net observability hook, not the primary mechanism.
```

For the acceptance-criteria unit test: assert that when `MAX_EAGER_BUDGET` is set artificially low in a test fixture, the upstream walk drops the correct sources and the safety-net is NOT triggered.

### 7.5 Agent run persistence — what was loaded

To make the "Context Sources" panel possible in the run detail UI (acceptance criterion for §4 UI), the set of sources loaded for a run must be persisted.

**Option A:** Serialise the loaded source manifest to a JSONB column on `agentRuns` (e.g. `contextSourcesSnapshot`). Pros: single round trip to render the UI. Cons: schema change to `agentRuns`, potentially large column on big runs.

**Option B:** Reconstruct on-demand by re-running `loadRunContextData` with the original request. Pros: no schema change. Cons: expensive (re-fetches content from S3), results may drift if sources changed after the run completed.

**Recommendation: Option A**, but snapshot only the manifest — NOT the full content. That's a small JSONB blob (~2KB per run with 10 sources) and gives the UI everything it needs to display the panel without re-fetching.

**Snapshot shape** (expanded per review feedback to capture the full decision record — ordering, inclusion, truncation, and override suppression):

```typescript
interface ContextSourceSnapshotEntry {
  id: string;
  scope: 'agent' | 'subaccount' | 'scheduled_task' | 'task_instance';
  name: string;
  description: string | null;
  contentType: string;
  loadingMode: 'eager' | 'lazy';
  sizeBytes: number;
  tokenCount: number;
  fetchOk: boolean;

  /**
   * Position in the resolved order (0 = first). Assigned on the full sorted
   * pool in §7.1 step 5, BEFORE override suppression, so every entry
   * including suppressed losers carries a stable deterministic index.
   * The debug UI sorts by this field. Always present — never -1 or null.
   */
  orderIndex: number;

  /** True if this source contributed to the "## Your Knowledge Base" block */
  includedInPrompt: boolean;

  /** True if the downstream character-level safety net truncated this source */
  truncated: boolean;

  /** True if this source was suppressed because a higher-precedence scope had the same name */
  suppressedByOverride: boolean;

  /** When suppressedByOverride is true, the id of the source that won */
  suppressedBy?: string;

  /** Reason for exclusion, for debugging */
  exclusionReason?:
    | 'budget_exceeded'       // dropped by the pre-prompt budget walk
    | 'override_suppressed'   // lost same-name override resolution
    | 'lazy_not_rendered'     // normal for manifest entries
    | null;
}
```

Add a migration step to `0078_scheduled_task_data_sources.sql`:

```sql
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS context_sources_snapshot JSONB;
```

Populate it at the end of the `loadRunContextData` call in `agentExecutionService`:

```typescript
const allForSnapshot = [
  ...runContextData.eager,
  ...runContextData.manifest,
  ...runContextData.suppressed,
];

const snapshot: ContextSourceSnapshotEntry[] = allForSnapshot.map(s => ({
  id: s.id,
  scope: s.scope,
  name: s.name,
  description: s.description,
  contentType: s.contentType,
  loadingMode: s.loadingMode,
  sizeBytes: s.sizeBytes,
  tokenCount: s.tokenCount,
  fetchOk: s.fetchOk,
  // orderIndex is assigned on the full sorted pool in loadRunContextData
  // (§7.1 step 5) BEFORE override suppression, so every entry — winners,
  // suppressed, lazy, and binary — carries a stable numeric index.
  // Non-null assertion is safe here: the loader guarantees it.
  orderIndex: s.orderIndex!,
  includedInPrompt: s.includedInPrompt ?? false,
  truncated: s.truncated ?? false,
  suppressedByOverride: s.suppressedByOverride ?? false,
  suppressedBy: s.suppressedBy,
  exclusionReason: (() => {
    if (s.suppressedByOverride) return 'override_suppressed';
    if (s.loadingMode === 'lazy') return 'lazy_not_rendered';
    if (s.loadingMode === 'eager' && !s.includedInPrompt) return 'budget_exceeded';
    return null;
  })(),
}));

await db.update(agentRuns).set({
  contextSourcesSnapshot: snapshot,
}).where(eq(agentRuns.id, run.id));
```

No update after the run starts — the snapshot reflects what was considered at run-start time, matching the existing `executionSnapshot` pattern at `agentExecutionService.ts:396`. The one exception is the safety-net truncation hook in §7.4, which may flip `truncated: true` on a specific entry after `buildSystemPrompt` returns but before the run proceeds.

### 7.6 Scheduled task service updates

**File:** `server/services/scheduledTaskService.ts`

One meaningful change to `fireOccurrence` at line 281: nothing. The existing flow already passes `triggerContext.scheduledTaskId` through to the agent run request at line 369, which is exactly what the new loader keys off. **No change needed to `fireOccurrence`.**

One additive change to `scheduledTaskService.update`: handle the cascade when `assignedAgentId` is changed, as described in §6.4. Pseudocode:

```typescript
async update(stId, orgId, patch) {
  const [existing] = await db.select().from(scheduledTasks).where(
    and(eq(scheduledTasks.id, stId), eq(scheduledTasks.organisationId, orgId))
  );
  if (!existing) throw { statusCode: 404, message: 'Scheduled task not found' };

  const agentChanged =
    patch.assignedAgentId && patch.assignedAgentId !== existing.assignedAgentId;

  await db.transaction(async (tx) => {
    await tx.update(scheduledTasks).set({ ...patch, updatedAt: new Date() }).where(eq(scheduledTasks.id, stId));

    if (agentChanged) {
      // 1. Load the scheduled task's current data sources
      const taskSources = await tx.select()
        .from(agentDataSources)
        .where(eq(agentDataSources.scheduledTaskId, stId));

      if (taskSources.length > 0) {
        // 2. COLLISION DETECTION — the partial unique index in §5.1 covers
        //    (agentId, subaccountAgentId, scheduledTaskId, name). Since
        //    subaccountAgentId stays null and scheduledTaskId stays the
        //    same across the cascade, we need to check whether the NEW
        //    agentId combined with the existing scheduledTaskId + name
        //    would collide with an existing row. In practice the
        //    scheduled-task-scoped sources remain anchored to this
        //    scheduledTaskId, so the unique index check is effectively
        //    on the name set within this task.
        //
        //    The real collision risk is at the AGENT scope: if the new
        //    agent has its OWN agent-level data source with the same name
        //    as one of our scheduled-task sources, there's no unique-index
        //    violation (different scheduledTaskId), but the override
        //    resolution at runtime (§3.6) would now suppress the agent-level
        //    version. Emit a warning event so the operator knows.
        const newAgentOwnSources = await tx.select({
          name: agentDataSources.name,
        })
          .from(agentDataSources)
          .where(
            and(
              eq(agentDataSources.agentId, patch.assignedAgentId),
              isNull(agentDataSources.subaccountAgentId),
              isNull(agentDataSources.scheduledTaskId),
            )
          );
        const newAgentNames = new Set(
          newAgentOwnSources.map(s => s.name.toLowerCase().trim())
        );
        const taskSourceNames = new Set(
          taskSources.map(s => s.name.toLowerCase().trim())
        );
        const willOverride = [...taskSourceNames].filter(n => newAgentNames.has(n));

        // 3. Cascade the agentId update
        await tx.update(agentDataSources)
          .set({ agentId: patch.assignedAgentId, updatedAt: new Date() })
          .where(eq(agentDataSources.scheduledTaskId, stId));

        // 4. Rename any scheduled-task-scoped sources whose name would
        //    overlap with another scheduled-task-scoped source attached
        //    to the SAME task under a different canonical id. This guards
        //    the edge case where the partial unique index would trip.
        //    In the default case (one scoping axis at a time) this is
        //    a no-op.
        //    (Implementation: grouping by name and keeping the oldest
        //    row unchanged, renaming the rest with a suffix.)

        // 5. Audit event with both the simple cascade count and the
        //    override-warning list
        await tx.insert(auditEvents).values({
          organisationId: orgId,
          action: 'scheduled_task.assigned_agent_changed',
          resourceType: 'scheduled_task',
          resourceId: stId,
          metadata: {
            oldAgentId: existing.assignedAgentId,
            newAgentId: patch.assignedAgentId,
            cascadedDataSourceCount: taskSources.length,
            willOverrideNewAgentSources: willOverride,   // names whose new-agent copies will be suppressed
          },
        });
      }
    }
  });

  return await this.getDetail(stId, orgId);
}
```

**Collision handling summary:**

| Collision type | Detection | Resolution |
|---|---|---|
| Same name within the same scheduled task (rare — would fail the unique index on insert, so should never exist at migration time) | Group by `normaliseName(name)` pre-cascade, keep oldest row, rename others with ` (migrated)` suffix | Auto-rename + audit |
| Scheduled task source name matches new agent's OWN agent-level source | Pre-cascade intersection check (code above) | No DB change needed — the override rule at runtime (§3.6) now applies, suppressing the agent-level source during any run fired by this scheduled task. Audit event records the list so operators can verify intent. |
| Scheduled task source name matches new agent's OTHER scheduled-task-scoped source on a DIFFERENT task | Not possible at runtime — different `scheduledTaskId` means they never appear in the same run context | No action |

**UI confirmation:** when the operator changes `assignedAgentId` on a scheduled task via the detail page edit form (§11.3), show a confirmation dialog with the cascade preview:

> "This will move 5 attached data sources from **Old Agent** to **New Agent**. 2 of them share names with existing data sources on the new agent and will override them during runs of this scheduled task:
> - `glossary.md` (was on New Agent, will be overridden here)
> - `style-guide.md` (was on New Agent, will be overridden here)
>
> Continue?"

The override preview is computed by calling a new endpoint `GET /api/subaccounts/:subaccountId/scheduled-tasks/:stId/reassignment-preview?newAgentId=...` which returns the collision list without making any changes.

### 7.7 Conversation service compatibility

**File:** `server/services/conversationService.ts:179`

This is the agent-chat surface (click on agent → chat). It currently calls `fetchAgentDataSources(agentId)`. After the rename, it calls `fetchAgentDataSources(agentId)` too (the thin wrapper). Behaviour unchanged. Conversations do not have a scheduled task context, so scheduled-task-scoped data sources do not surface here — which is correct (a chat on the agent should see the agent's own knowledge, not project-specific knowledge from an unrelated scheduled task).

### 7.8 Token budget clarification — what the 60k actually caps

This section exists to head off a common misconception surfaced in review: the 60k `MAX_EAGER_BUDGET` (matching the existing `maxDataTokens` in `buildSystemPrompt`) is NOT a global context window cap. It caps **one specific block** — `## Your Knowledge Base` inside the system prompt — and nothing else.

The relevant token ceilings at run time are:

| Ceiling | Scope | Source of truth | What it limits |
|---|---|---|---|
| `MAX_EAGER_BUDGET` (default 60000) | The `## Your Knowledge Base` block only | `server/config/limits.ts` (new constant in this spec) | Eager data source content rendered into the system prompt |
| Model context window (e.g. Claude Sonnet 4.6: 200000) | Entire conversation (system prompt + message history + tool results) | Model provider | Total tokens the LLM can process |
| `scheduledTask.tokenBudgetPerRun` (default 30000) | Per run, cumulative output | `scheduledTasks` table | Cumulative output tokens consumed during a single agent run |
| Per-agent / per-subaccount cost ceilings | Per run, cumulative cost | `server/config/limits.ts` + agent/subaccount overrides | Dollar cost |

**Implication for lazy reads:** when the agent calls `read_data_source` mid-loop, the returned content appears in the conversation as a `tool_result` message — NOT inside the system prompt's Knowledge Base block. It does not consume `MAX_EAGER_BUDGET`. It consumes:

- The **model context window** (e.g. if the run already has 150k tokens of conversation history and the agent reads a 60k lazy source, total context is 210k — overflow).
- The **output/cost budgets** via the LLM input token cost on the next turn.

**Mitigations for lazy read context pressure:**

1. **`MAX_READ_DATA_SOURCE_TOKENS_PER_CALL` (default 15000)** — the per-read size cap in §8.3. Prevents any single read from blowing context.
2. **`MAX_READ_DATA_SOURCE_CALLS_PER_RUN` (default 20)** — the per-run call count limit in §8.3.
3. **`offset` / `limit` on the `read` op** — the agent can walk a large source in chunks (§8.1).

We do NOT reserve a portion of `MAX_EAGER_BUDGET` for lazy reads because lazy reads don't live in that budget in the first place. The right lever is the per-read cap, not budget subdivision.

**Unit test invariant:** a scheduled task with one 50k lazy source does NOT reduce the effective `MAX_EAGER_BUDGET` — the full 60k remains available for eager sources. Verify by asserting `accumulatedTokens` in the budget walk is unaffected by lazy entries.

---

## 8. The `read_data_source` skill

A new system skill exposes the context pool to the agent mid-loop, so agents can pull lazy sources on demand and re-read eager sources when they need exact quoting. It's the single retrieval interface across all four scopes.

### 8.1 Skill definition file

**Path:** `server/skills/read_data_source.md`

```markdown
---
name: Read Data Source
description: List and read context data sources (agent-wide, scheduled-task-scoped, or task-instance attachments) attached to the current run.
isActive: true
visibility: full
---

\`\`\`json
{
  "name": "read_data_source",
  "description": "Access the context data sources attached to this run. Use op='list' to see what's available (including sources already loaded in the Knowledge Base and lazy sources you haven't read yet). Use op='read' with a source id to fetch content. For sources larger than the per-call token cap, use the offset and limit parameters to walk the content in chunks. Lazy sources are only loaded into your context when you explicitly read them — use this to pull in large reference files on demand without bloating the system prompt.",
  "input_schema": {
    "type": "object",
    "properties": {
      "op": {
        "type": "string",
        "enum": ["list", "read"],
        "description": "Operation to perform. 'list' returns the manifest of available sources. 'read' fetches the content of a single source by id."
      },
      "id": {
        "type": "string",
        "description": "Required when op='read'. The opaque id of the source to read (obtained from op='list')."
      },
      "offset": {
        "type": "integer",
        "minimum": 0,
        "description": "Optional when op='read'. Starting character offset into the source content (default 0). Use with 'limit' to walk large sources in chunks."
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "description": "Optional when op='read'. Maximum number of tokens to return in a single read (default is the system per-read cap, approximately 15000 tokens). If the source is larger than this at the current offset, the response includes 'nextOffset' so you can continue."
      }
    },
    "required": ["op"]
  }
}
\`\`\`

## Instructions

Use this tool to access reference materials attached to the current run. There are four scopes of sources:

- **agent** — cross-task reference material attached to the agent itself (policies, brand guidelines)
- **subaccount** — client-specific reference material for this subaccount
- **scheduled_task** — project-specific reference material for the recurring task that fired this run
- **task_instance** — one-off files uploaded to this specific board task

### When to use `op: 'list'`

- At the start of a run, to see what reference material is available before deciding how to approach the work
- When you're unsure whether a specific reference file exists for this project

### When to use `op: 'read'`

- You need the full content of a source that's marked as lazy in the manifest
- You need to re-check an exact quote from a source already loaded into your Knowledge Base
- You need a source that was skipped due to token budget pressure

### Handling large sources

Sources larger than the per-read cap return a truncated slice plus a `nextOffset` field. To read the next chunk, call `read` again with `offset: nextOffset`. Continue until `nextOffset` is null.

For most sources under 15k tokens you can ignore `offset` and `limit` entirely — just use `op: 'read'` with the source id. The slicing machinery only matters for very large sources.

### Rules

- **Eager sources are already in your Knowledge Base.** You don't usually need to re-read them. Check your system prompt first.
- **Lazy sources are NOT loaded by default.** You must explicitly read them. The manifest shows their name, scope, and approximate size — use this to decide whether to pull them.
- **Binary attachments cannot be read in v1.** If the manifest shows `[binary — not readable]`, the file exists but you cannot access its contents through this skill. Tell the user if the binary attachment is critical.
- **Be conservative with large sources.** If a lazy source is over 20KB, consider whether you really need it before fetching — it will consume your context budget.
- **Per-read size limit enforced.** A single `read` call returns at most `~15000` tokens. Larger sources require multiple reads via `offset` + `limit`, or a smarter approach (skim the list first, read only the most relevant source).

## Methodology

### Phase 1: Discovery

On any run that might need reference material, call `op: 'list'` once at the start to see what's available. Note which sources are already in your Knowledge Base (marked eager) and which are lazy.

### Phase 2: Selective retrieval

For each piece of work, ask yourself:
1. Do I already have the reference material I need in my Knowledge Base?
2. If not, which lazy source(s) would give me the context I need?
3. Can I answer without reading all of them?

Read only the sources you need. This keeps the loop efficient and avoids burning tokens on irrelevant context.

### Phase 3: Iterative lookup

If you partially answer and realise you need more context, call `op: 'read'` again with a different source id. The pool is stable across the run — the same id returns the same source every time.
```

### 8.2 Handler in `skillExecutor.ts`

**File:** `server/services/skillExecutor.ts` (~2500 lines; add a new handler block alongside the existing skill handlers)

The handler needs access to `runContextData` for the current run. Two implementation options:

- **Option A:** Pass `runContextData` through as part of the skill execution context (cleanest — follows the existing pattern where run metadata is threaded through). This means `skillExecutor.execute(...)` or similar gains a `runContext?: RunContextData` parameter.
- **Option B:** Re-query from the DB on each `read` call using the run's `contextSourcesSnapshot` column. Simpler for the executor but means re-fetching content from S3 on every read call.

**Recommendation: Option A.** Thread it through. The agent execution service already builds `runContextData` at start-time; stash it in the skill execution context for the duration of the run. This mirrors how `orgProcesses` and other run-scoped data are passed through today.

Handler skeleton:

```typescript
// In the skill registry / dispatch map in skillExecutor.ts
case 'read_data_source': {
  const {
    MAX_READ_DATA_SOURCE_CALLS_PER_RUN,
    MAX_READ_DATA_SOURCE_TOKENS_PER_CALL,
  } = await import('../config/limits.js');

  const {
    op,
    id,
    offset = 0,
    limit = MAX_READ_DATA_SOURCE_TOKENS_PER_CALL,
  } = input as { op: 'list' | 'read'; id?: string; offset?: number; limit?: number };

  const runContext = ctx.runContextData;  // passed in from agentExecutionService
  if (!runContext) {
    return {
      ok: false,
      error: 'No run context available — this skill must be called within an agent run.',
    };
  }

  if (op === 'list') {
    // All sources across the four scopes, including the winners in the
    // override resolution. Suppressed sources are NOT listed — they've
    // been overridden by an intentional operator decision, so exposing
    // them would confuse the agent.
    const activeSources = [...runContext.eager, ...runContext.manifest];
    return {
      ok: true,
      sources: activeSources.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        scope: s.scope,
        sizeBytes: s.sizeBytes,
        tokenCount: s.tokenCount,
        contentType: s.contentType,
        loadingMode: s.loadingMode,
        alreadyInKnowledgeBase: s.loadingMode === 'eager' && !!s.includedInPrompt && s.fetchOk,
        excludedByBudget: s.loadingMode === 'eager' && !s.includedInPrompt,
        readable: s.fetchOk,
      })),
    };
  }

  if (op === 'read') {
    if (!id) return { ok: false, error: "'id' is required when op='read'" };
    if (offset < 0) return { ok: false, error: "'offset' must be >= 0" };

    // Per-run call count limit
    if ((ctx.readDataSourceCallCount ?? 0) >= MAX_READ_DATA_SOURCE_CALLS_PER_RUN) {
      return {
        ok: false,
        error: `read_data_source call limit (${MAX_READ_DATA_SOURCE_CALLS_PER_RUN}) exceeded for this run`,
      };
    }
    ctx.readDataSourceCallCount = (ctx.readDataSourceCallCount ?? 0) + 1;

    // Per-read token cap — cannot exceed the system ceiling even if the
    // caller passes a larger explicit limit
    const effectiveLimit = Math.min(limit, MAX_READ_DATA_SOURCE_TOKENS_PER_CALL);

    // Resolve the source (active pool only — suppressed sources are invisible)
    const activeSources = [...runContext.eager, ...runContext.manifest];
    const source = activeSources.find(s => s.id === id);
    if (!source) return { ok: false, error: `Source with id '${id}' not found in current run context` };

    if (!source.fetchOk) {
      return {
        ok: false,
        error: `Source '${source.name}' is not readable (binary content type or previous fetch failure)`,
      };
    }

    // Step 1: ensure content is loaded (lazy fetch on first read)
    let fullContent: string;
    if (source.loadingMode === 'eager' && source.content) {
      fullContent = source.content;
    } else if (source.id.startsWith('task_attachment:')) {
      const attachmentId = source.id.slice('task_attachment:'.length);
      fullContent = await readTaskAttachmentContent(attachmentId, ctx.organisationId);
      // Cache the read — subsequent reads of the same source are free
      source.content = fullContent;
      source.tokenCount = approxTokens(fullContent);
    } else {
      const [row] = await db.select().from(agentDataSources).where(eq(agentDataSources.id, source.id));
      if (!row) return { ok: false, error: 'Source row missing from database' };
      const { content, fetchOk, tokenCount } = await loadSourceContent(row);
      if (!fetchOk) return { ok: false, error: `Failed to fetch source '${source.name}'` };
      fullContent = content;
      source.content = content;
      source.tokenCount = tokenCount;
    }

    // Step 2: apply offset/limit slicing.
    //
    // Token counts are approximate (~4 chars per token), so convert the
    // token limit to a character budget for slicing. We slice by character
    // offset (not token offset) because character offsets are stable and
    // the LLM only cares about byte boundaries for next-chunk continuity.
    const APPROX_CHARS_PER_TOKEN = 4;
    const charLimit = effectiveLimit * APPROX_CHARS_PER_TOKEN;
    const start = Math.min(offset, fullContent.length);
    const end = Math.min(start + charLimit, fullContent.length);
    const slice = fullContent.slice(start, end);
    const nextOffset = end < fullContent.length ? end : null;
    const sliceTokenCount = approxTokens(slice);

    return {
      ok: true,
      source: {
        id: source.id,
        name: source.name,
        scope: source.scope,
        contentType: source.contentType,
        content: slice,
        tokenCount: sliceTokenCount,
        offset: start,
        nextOffset,
        totalSizeChars: fullContent.length,
        truncated: nextOffset !== null,
      },
    };
  }

  return { ok: false, error: `Unknown op: ${op}` };
}
```

**Design notes on the handler:**

1. **Suppressed sources are invisible.** Same-name override winners push the losing source out of both `runContext.eager` and `runContext.manifest` at load time (§7.1 step 6), so `activeSources` naturally excludes them. The agent never sees a suppressed source in either `list` or `read`.
2. **Per-read cap is a hard ceiling, not a soft default.** Even if the caller passes `limit: 50000`, the effective limit is clamped to `MAX_READ_DATA_SOURCE_TOKENS_PER_CALL`. This prevents the agent from attempting to dump a massive file into context in one go.
3. **`nextOffset` continuation.** When a source is larger than the slice, the response includes `nextOffset`. The agent can make follow-up calls with that offset to walk the file in chunks. When `nextOffset` is null, the full content has been returned.
4. **Lazy content cache.** First `read` of a lazy source populates `source.content` in the shared `runContext`. Subsequent calls (for offset walking, or for re-reading) do NOT re-fetch from storage — they slice the cached content. This matters for the call-count budget: walking a large file via multiple reads still consumes multiple `read` calls against `MAX_READ_DATA_SOURCE_CALLS_PER_RUN`, but each call only costs one S3 fetch for the first read.

### 8.3 Cost tracking and safety limits

Each `read_data_source` call with `op: 'read'` counts as one skill invocation in the existing skill cost tracking. No special handling needed — the existing `llmRequests`/`agentRuns` cost pipeline captures tool calls already.

If a lazy source is large and the agent reads it into context, the content flows into the next LLM turn as tool_result, which is billed at the model's input token rate. This is normal — the agent is paying for what it pulled.

**New constants** — add to `server/config/limits.ts` alongside other skill limits:

```typescript
// ── Context data source retrieval limits ─────────────────────────────────
/**
 * Maximum number of read_data_source `op: 'read'` calls allowed per agent run.
 * Prevents runaway loops and caps the cumulative tool-call cost of context
 * retrieval. The list op is unlimited because it's cheap.
 */
export const MAX_READ_DATA_SOURCE_CALLS_PER_RUN = 20;

/**
 * Maximum tokens returned by a single read_data_source `op: 'read'` call.
 * Enforced as a hard ceiling: even if the caller passes a larger `limit`,
 * the response is clamped to this value. Sources larger than this must be
 * walked via the offset/limit continuation pattern.
 *
 * Chosen to be well under the smallest typical context window so a single
 * read never blows the conversation.
 */
export const MAX_READ_DATA_SOURCE_TOKENS_PER_CALL = 15000;

/**
 * Maximum tokens rendered into the "## Your Knowledge Base" block via the
 * pre-prompt budget walk in loadRunContextData. Matches the existing
 * maxDataTokens default in llmService.buildSystemPrompt — the upstream walk
 * is the primary enforcement, the downstream truncation is a safety net.
 */
export const MAX_EAGER_BUDGET = 60000;

/**
 * Maximum number of lazy manifest entries rendered INTO the system prompt's
 * "## Available Context Sources" block. Entries beyond this cap are still
 * accessible via read_data_source op='list' — the cap only affects inline
 * visibility in the prompt to keep runs with large manifests compact.
 */
export const MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT = 25;
```

**Enforcement summary:**

| Limit | Where enforced | Response on breach |
|---|---|---|
| `MAX_READ_DATA_SOURCE_CALLS_PER_RUN` | Skill handler, top of `op: 'read'` branch | `{ ok: false, error: 'read_data_source call limit exceeded' }` |
| `MAX_READ_DATA_SOURCE_TOKENS_PER_CALL` | Skill handler, clamps `effectiveLimit` | Slice is capped; response includes `nextOffset` for continuation |
| `MAX_EAGER_BUDGET` | `loadRunContextData` budget walk (§7.1 step 8) | Sources beyond the budget get `includedInPrompt: false` in the snapshot |
| `MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT` | `loadRunContextData` (§7.1 step 9) | Excess entries elided from the prompt with an elision note; still accessible via `op: 'list'` |

All four limits are system-wide constants in v1. Per-agent or per-scheduled-task overrides are out of scope and noted in §17.

### 8.4 Register the skill

No special registration is needed — system skills are auto-discovered from `server/skills/*.md` by `systemSkillService.loadSkills()` at `systemSkillService.ts:40`. The file-based source of truth means creating the .md file is enough for it to be discoverable.

**However**, the new skill needs to be enabled on specific agents. Options:

- **Manual per-agent:** An operator enables `read_data_source` in the agent's skill selector in the admin UI.
- **Auto-enable on all agents that have data sources:** When the first data source is created for an agent or scheduled task, the skill is added to the agent's default skill slugs if not already present.
- **Default-on for all agents:** The skill slug is added to a global default list.

**Recommendation: default-on for all agents.** The skill is read-only, cheap, and only useful when data sources are attached. Adding it to `DEFAULT_SYSTEM_SKILL_SLUGS` in `server/config/limits.ts` (or wherever the default skill list lives) means every agent can use it without any operator action. Document this in the seed notes.

If default-on is not acceptable (e.g. because the skill call-count limit could be abused), fall back to auto-enable-on-first-data-source.

---

## 9. Routes

Six new routes for scheduled-task data source CRUD. They mirror the existing agent-level routes at `server/routes/agents.ts:72–107` and live in the existing `server/routes/scheduledTasks.ts` file.

**File:** `server/routes/scheduledTasks.ts`

```typescript
import { agentService } from '../services/agentService.js';
import { validateBody, validateMultipart } from '../middleware/validation.js';
import { createDataSourceBody, updateDataSourceBody } from '../lib/validators/dataSource.js';

// ─── List data sources for a scheduled task ────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const list = await agentService.listScheduledTaskDataSources(
      req.params.stId,
      req.orgId!
    );
    res.json(list);
  })
);

// ─── Upload a file as a data source ────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources/upload',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE),
  validateMultipart,
  asyncHandler(async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }
    const result = await agentService.uploadScheduledTaskDataSourceFile(
      req.params.stId,
      req.orgId!,
      files[0]
    );
    res.status(201).json(result);
  })
);

// ─── Create a data source from a URL or other remote source ───────────────

router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE),
  validateBody(createDataSourceBody, 'warn'),
  asyncHandler(async (req, res) => {
    const result = await agentService.addScheduledTaskDataSource(
      req.params.stId,
      req.orgId!,
      req.body
    );
    res.status(201).json(result);
  })
);

// ─── Update a data source ─────────────────────────────────────────────────

router.patch(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources/:sourceId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE),
  validateBody(updateDataSourceBody, 'warn'),
  asyncHandler(async (req, res) => {
    const result = await agentService.updateScheduledTaskDataSource(
      req.params.sourceId,
      req.params.stId,
      req.orgId!,
      req.body
    );
    res.json(result);
  })
);

// ─── Delete a data source ─────────────────────────────────────────────────

router.delete(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources/:sourceId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE),
  asyncHandler(async (req, res) => {
    await agentService.deleteScheduledTaskDataSource(
      req.params.sourceId,
      req.params.stId,
      req.orgId!
    );
    res.json({ success: true });
  })
);

// ─── Test fetch a data source ─────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources/:sourceId/test',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE),
  asyncHandler(async (req, res) => {
    const result = await agentService.testScheduledTaskDataSource(
      req.params.sourceId,
      req.params.stId,
      req.orgId!
    );
    res.json(result);
  })
);
```

**Existing scheduled task routes** (`POST/PATCH` at lines 23 and 70) already accept `description` in the body — no change needed. The UI change (§10) populates that field from the new Instructions textarea.

**Shared validators:** the `createDataSourceBody` and `updateDataSourceBody` validators should be extracted from the existing agent data source routes (currently inline) into `server/lib/validators/dataSource.ts` so both agent-level and scheduled-task-level routes use the same schema. Add `loadingMode` to the schema:

```typescript
// server/lib/validators/dataSource.ts
import { z } from 'zod';

export const createDataSourceBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  sourceType: z.enum(['r2', 's3', 'http_url', 'google_docs', 'dropbox', 'file_upload']),
  sourcePath: z.string().min(1),
  sourceHeaders: z.string().optional(),  // JSON string — will be encrypted server-side
  contentType: z.enum(['json', 'csv', 'markdown', 'text', 'auto']).optional(),
  priority: z.number().int().optional(),
  maxTokenBudget: z.number().int().min(100).max(60000).optional(),
  cacheMinutes: z.number().int().min(1).max(10080).optional(),
  loadingMode: z.enum(['eager', 'lazy']).optional().default('eager'),
});

export const updateDataSourceBody = createDataSourceBody.partial();
```

---

## 10. Permissions

### 10.1 New permission key

**File:** `server/lib/permissions.ts`

Add to the `ORG_PERMISSIONS` object (around line 53, alongside the existing `AGENTS_*` entries):

```typescript
// AI Agents
AGENTS_VIEW: 'org.agents.view',
AGENTS_CREATE: 'org.agents.create',
AGENTS_EDIT: 'org.agents.edit',
AGENTS_DELETE: 'org.agents.delete',
AGENTS_CHAT: 'org.agents.chat',
// ── NEW: Scheduled task data sources ─────────────────────────────────────
SCHEDULED_TASKS_DATA_SOURCES_MANAGE: 'org.scheduled_tasks.data_sources.manage',
```

Add to the permission catalogue (around line 123):

```typescript
{
  key: ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE,
  description: 'Manage data sources (reference files, URLs) attached to scheduled tasks',
  groupName: 'org.agents',  // group with agent-level perms, not processes
},
```

### 10.2 Default grant

In the permission seed file (find it by searching for `AGENTS_EDIT` in seed scripts — likely `scripts/seed-permissions.ts` or within the migration that seeded permission sets), add `SCHEDULED_TASKS_DATA_SOURCES_MANAGE` to every permission set that already has `AGENTS_EDIT`:

- Org Admin
- Workspace Manager (if exists)
- Any role with `AGENTS_EDIT`

**Rationale:** today, scheduled task CRUD routes use `AGENTS_EDIT` as the gate. Anyone who can edit agents can edit scheduled tasks. It follows that they should also be able to attach reference files to those scheduled tasks. Separating the two permissions gives us future flexibility (e.g. a "read-only reporter" role that can't edit agents but can update reference docs) without a schema change.

### 10.3 Scheduled task base routes — no change

The existing scheduled task CRUD (`POST/PATCH/DELETE /api/subaccounts/:subaccountId/scheduled-tasks/...`) continues to use `AGENTS_EDIT`. Do not introduce a separate permission for base scheduled task CRUD — out of scope and unrelated to this spec.

### 10.4 System admin bypass

System admins bypass all permission checks via the existing middleware in `server/middleware/auth.ts`. No changes needed.

### 10.5 Audit events

Emit audit events for:

- `scheduled_task.data_source.created`
- `scheduled_task.data_source.updated`
- `scheduled_task.data_source.deleted`
- `scheduled_task.assigned_agent_changed` (with cascade count, as described in §7.6)

Reuse the existing `auditEvents` table and the pattern used by other services.

---

## 11. UI changes

Three surfaces change. Wherever possible, we reuse the data source management components from `AdminAgentEditPage.tsx` rather than duplicating the uploader, form, and list UI.

### 11.1 Extract reusable DataSourceManager component

**New file:** `client/src/components/DataSourceManager.tsx`

Today `AdminAgentEditPage.tsx` (2221 lines) contains the full data source management UI inline: interfaces (`DataSource`, `DataSourceForm`, `PendingDataSource`) around line 51–81, state hooks around line 301–316, upload/edit/delete handlers around line 404–550, and the rendered form + list. Extract these into a reusable component so the same UI works in both places.

**Component signature:**

```typescript
interface DataSourceManagerProps {
  // Scope: either an agent or a scheduled task. Exactly one must be provided.
  scope:
    | { type: 'agent'; agentId: string }
    | { type: 'scheduled_task'; scheduledTaskId: string; subaccountId: string };

  // Whether the current user can edit (disables upload/edit/delete UI if false)
  canEdit: boolean;

  // Optional — lets the parent intercept changes (e.g. to enable a "Save" button)
  onChange?: (sources: DataSource[]) => void;

  // Optional — render mode. Default 'full' shows the full uploader + list.
  // 'readonly' shows the list only.
  mode?: 'full' | 'readonly';
}
```

**Internal URL construction:**

```typescript
const baseUrl = scope.type === 'agent'
  ? `/api/agents/${scope.agentId}/data-sources`
  : `/api/subaccounts/${scope.subaccountId}/scheduled-tasks/${scope.scheduledTaskId}/data-sources`;
```

All fetch/create/update/delete/upload calls use `baseUrl` as the prefix. The backend routes were designed to match so that only the URL prefix differs.

**New field in the form:** add a `loadingMode` toggle (Eager / Lazy) alongside the existing priority, token budget, and cache minutes fields. Default: `eager`. Include a short inline explainer: "Eager sources are loaded into every run. Lazy sources only load when the agent explicitly requests them."

**Refactor rather than duplicate:** after the extraction, `AdminAgentEditPage.tsx` should delete its inline data source code and render `<DataSourceManager scope={{ type: 'agent', agentId }} canEdit={canEditAgent} />`. The existing behaviour must be preserved — this is a refactor, not a rewrite.

### 11.2 Scheduled Tasks create modal — Instructions field

**File:** `client/src/pages/ScheduledTasksPage.tsx`

The current create form at lines 111–158 has a single textarea labelled **"Brief / Instructions"** bound to `form.brief`. This conflates two concepts. Split them:

1. Rename the existing textarea to **"Brief"** (short summary shown in the task list and board card). Keep it as a 2-line textarea.
2. Add a new, larger textarea labelled **"Instructions"** bound to a new `form.description` field. 8 rows, resize-vertical. Add a help text:

   > *Detailed instructions the agent follows every time this task runs. Paste the full briefing, steps, and any context the agent needs. This content is injected into the agent's system prompt at run time.*

3. Update `INITIAL_FORM` at line 26 to include `description: ''`.

4. The existing `handleCreate` function already passes the whole form as the POST body — `description` will flow through unchanged since the service layer accepts it.

The new form layout:

```
Title *
Agent *
Brief                    (2-line textarea, short summary)
Instructions             (8-line textarea, full briefing document)
Recurrence
Time / Timezone
[Cancel]  [Create]
```

No data source management in the create modal — that happens on the detail page after creation. Keeps the modal simple.

### 11.3 ScheduledTaskDetailPage — edit mode + data sources panel

**File:** `client/src/pages/ScheduledTaskDetailPage.tsx`

This page is currently read-only (162 lines). It needs:

1. An **Edit** button in the header that flips the page into edit mode.
2. Editable form fields in edit mode: title, brief, instructions (description), priority, rrule (via `RecurrencePicker`), timezone, scheduleTime. All bound to existing fields.
3. A **Data Sources** panel (always visible, edit-gated).
4. A **Run History** table (existing, unchanged).
5. Save / Cancel buttons in edit mode. Save calls `PATCH /api/subaccounts/:subaccountId/scheduled-tasks/:stId`.

**Edit mode state:**

```typescript
const [editing, setEditing] = useState(false);
const [editForm, setEditForm] = useState<EditForm | null>(null);

function startEdit() {
  if (!detail) return;
  setEditForm({
    title: detail.title,
    brief: detail.brief ?? '',
    description: detail.description ?? '',  // requires description in the API response
    priority: detail.priority,
    rrule: detail.rrule,
    timezone: detail.timezone,
    scheduleTime: detail.scheduleTime,
  });
  setEditing(true);
}

async function saveEdit() {
  try {
    await api.patch(
      `/api/subaccounts/${subaccountId}/scheduled-tasks/${stId}`,
      editForm
    );
    setEditing(false);
    await load();
  } catch { setError('Failed to save'); }
}
```

**Data sources panel** — renders below the stat cards, above the run history:

```tsx
<section className="mb-8">
  <h2 className="text-[16px] font-semibold text-slate-800 mb-3">Data Sources</h2>
  <p className="text-[13px] text-slate-500 mb-4">
    Reference files attached to this scheduled task. These are loaded into the
    agent's context every time this task runs, in addition to any data sources
    attached to the agent itself.
  </p>
  <DataSourceManager
    scope={{
      type: 'scheduled_task',
      scheduledTaskId: stId!,
      subaccountId: subaccountId!,
    }}
    canEdit={canEdit}
  />
</section>
```

`canEdit` comes from a new permission check: either the user has `ORG_PERMISSIONS.SCHEDULED_TASKS_DATA_SOURCES_MANAGE`, or they're an org admin. Load via the existing `/api/my-permissions` endpoint at page mount.

**API response shape update:** the detail endpoint at `server/services/scheduledTaskService.getDetail` needs to return `description` in its response (it already has access to the row — just needs to be included in the returned JSON). Verify and add if missing.

### 11.4 ScheduledTaskDetailPage — Instructions preview block

In read mode, render the instructions below the title/brief block so operators can see at a glance what the agent is being told to do. Collapsed by default if longer than ~10 lines, with a "Show all" toggle:

```tsx
{detail.description && (
  <section className="mb-6">
    <h2 className="text-[14px] font-semibold text-slate-800 mb-2">Instructions</h2>
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
      <pre className="text-[13px] text-slate-700 whitespace-pre-wrap font-sans m-0">
        {showFullInstructions ? detail.description : truncateLines(detail.description, 10)}
      </pre>
      {lineCount(detail.description) > 10 && (
        <button onClick={() => setShowFullInstructions(v => !v)}
                className="mt-2 text-[12px] text-indigo-600 hover:underline">
          {showFullInstructions ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  </section>
)}
```

In edit mode, this block is replaced by an editable textarea.

### 11.5 Agent run detail — Context Sources panel

**File:** the existing agent run detail page (locate via Glob for `AgentRun*Page.tsx` or similar — if one doesn't exist, add this to the most prominent run-view surface; if it truly doesn't exist yet, capture as a follow-up and skip in v1).

Add a new panel below the run metadata (before or after the tool call timeline). The panel surfaces the full snapshot shape from §7.5 — including the new decision fields — so operators can debug not just "what was attached" but "what actually ended up in the prompt and why":

```tsx
<section className="mb-6">
  <div className="flex items-center justify-between mb-2">
    <h2 className="text-[14px] font-semibold text-slate-800">Context Sources</h2>
    {snapshot.length > 0 && (
      <div className="text-[11px] text-slate-500">
        {includedCount} in prompt · {excludedCount} excluded · {suppressedCount} overridden
      </div>
    )}
  </div>
  {snapshot.length > 0 ? (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-3 py-2 text-[12px] font-semibold text-slate-500 uppercase">#</th>
            <th className="text-left px-3 py-2 text-[12px] font-semibold text-slate-500 uppercase">Name</th>
            <th className="text-left px-3 py-2 text-[12px] font-semibold text-slate-500 uppercase">Scope</th>
            <th className="text-left px-3 py-2 text-[12px] font-semibold text-slate-500 uppercase">Mode</th>
            <th className="text-left px-3 py-2 text-[12px] font-semibold text-slate-500 uppercase">Size</th>
            <th className="text-left px-3 py-2 text-[12px] font-semibold text-slate-500 uppercase">Tokens</th>
            <th className="text-left px-3 py-2 text-[12px] font-semibold text-slate-500 uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {snapshot
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((s) => (
              <tr key={s.id} className={rowBgClass(s)}>
                <td className="px-3 py-2 text-[12px] text-slate-400 font-mono">
                  {/* orderIndex is guaranteed ≥ 0 on snapshot entries (§7.1 step 5) */}
                  {s.orderIndex + 1}
                </td>
                <td className="px-3 py-2 text-[13px] text-slate-700">
                  {s.name}
                  {s.suppressedBy && (
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      overridden by <code>{s.suppressedBy.slice(0, 8)}</code>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={SCOPE_BADGE[s.scope]}>{SCOPE_LABEL[s.scope]}</span>
                </td>
                <td className="px-3 py-2 text-[12px] text-slate-600">{s.loadingMode}</td>
                <td className="px-3 py-2 text-[12px] text-slate-600">{formatBytes(s.sizeBytes)}</td>
                <td className="px-3 py-2 text-[12px] text-slate-600">
                  {s.tokenCount > 0 ? `~${s.tokenCount.toLocaleString()}` : '—'}
                </td>
                <td className="px-3 py-2 text-[12px]">
                  {statusLabel(s)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="text-[13px] text-slate-400">No context sources were loaded for this run.</p>
  )}
</section>

// Helpers
function rowBgClass(s: ContextSourceSnapshotEntry): string {
  if (s.suppressedByOverride) return 'bg-amber-50 hover:bg-amber-100';
  if (s.loadingMode === 'eager' && !s.includedInPrompt) return 'bg-red-50 hover:bg-red-100';
  if (s.truncated) return 'bg-yellow-50 hover:bg-yellow-100';
  return 'hover:bg-slate-50';
}

function statusLabel(s: ContextSourceSnapshotEntry): JSX.Element {
  if (s.suppressedByOverride) {
    return <span className="text-amber-700">overridden</span>;
  }
  if (!s.fetchOk) {
    return <span className="text-red-600">failed / binary</span>;
  }
  if (s.loadingMode === 'eager' && !s.includedInPrompt) {
    return (
      <span className="text-red-700" title={s.exclusionReason ?? 'budget exceeded'}>
        excluded (budget)
      </span>
    );
  }
  if (s.loadingMode === 'lazy') {
    return <span className="text-slate-600">manifest (lazy)</span>;
  }
  if (s.truncated) {
    return <span className="text-amber-700">truncated</span>;
  }
  return <span className="text-green-700">in prompt</span>;
}

const SCOPE_BADGE = {
  task_instance:  'bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-[11px] font-semibold',
  scheduled_task: 'bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded text-[11px] font-semibold',
  subaccount:     'bg-blue-100  text-blue-800  px-2 py-0.5 rounded text-[11px] font-semibold',
  agent:          'bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px] font-semibold',
} as const;

const SCOPE_LABEL = {
  task_instance:  'Task attachment',
  scheduled_task: 'Scheduled task',
  subaccount:     'Subaccount',
  agent:          'Agent',
} as const;
```

**Visual encoding:**

| Row state | Background colour | Status label |
|---|---|---|
| In prompt, untruncated | default | green `in prompt` |
| In prompt, truncated by safety net | yellow | amber `truncated` |
| Eager but excluded by budget | red | red `excluded (budget)` |
| Lazy manifest entry | default | grey `manifest (lazy)` |
| Suppressed by same-name override | amber | amber `overridden` with source id of winner |
| Fetch failed or binary | default | red `failed / binary` |

The header summary (`X in prompt · Y excluded · Z overridden`) gives operators a single-glance view of whether the run saw what they expected.

This panel reads from the `context_sources_snapshot` JSONB column on `agentRuns` added by the migration in §5.1. The snapshot is frozen at run-start time and never updated — it shows what the agent actually received.

**If an agent run detail page does not already exist:** check by searching for `agent-runs/:runId` or `AgentRun*Page` client-side. If it exists, add the panel. If it doesn't, note it as a follow-up — the backend snapshot still gets persisted and can be surfaced later.

### 11.6 Scheduled Tasks list page — no functional change

`ScheduledTasksPage.tsx` list view (lines 167–210) does not need changes. Consider a tiny enhancement: show a small indicator next to the title if the scheduled task has data sources attached (e.g. a paperclip icon and a count). This is nice-to-have, not required.

### 11.7 Reused components

The UI work reuses these existing components:

- `client/src/components/Modal.tsx` — wraps the create modal
- `client/src/components/RecurrencePicker.tsx` — rrule editor
- `client/src/lib/api.ts` — HTTP client
- Tailwind classes (project uses Tailwind CSS utility classes directly — no design system component library)

No new third-party dependencies.

### 11.8 Lazy loading & routing

`ScheduledTaskDetailPage` and `ScheduledTasksPage` are already lazy-loaded in `client/src/App.tsx` per the existing pattern. The new `DataSourceManager` component is imported statically by both pages — it's small enough and used on both high-traffic surfaces that lazy loading it individually is not worth the complexity.

### 11.9 Accessibility and keyboard

Follow the existing page patterns:

- All form inputs have associated `<label>` elements
- Edit mode buttons are keyboard-focusable and have visible focus states
- Data source upload area responds to drag-and-drop AND click-to-browse
- Modal form can be dismissed with Escape

### 11.10 No changes to Layout nav

The existing left nav is permission-driven. Since scheduled tasks already appear there for anyone with `AGENTS_VIEW`, no nav changes are needed. The new permission `SCHEDULED_TASKS_DATA_SOURCES_MANAGE` only gates the data source CRUD buttons inside the detail page — users without it see the sources in read-only mode.

---

## 12. Testing and verification

All verification happens against the checks listed in `CLAUDE.md`: `npm run lint`, `npm run typecheck`, `npm test`, and targeted integration where relevant. No task is complete until the relevant checks pass.

### 12.1 Unit tests

**New test file:** `server/services/__tests__/runContextLoader.test.ts`

Cover:

1. **Agent-only scope** — a run with no scheduled task, no subaccount agent link, loads only agent-level sources.
2. **Subaccount scope** — a run with a subaccountAgentId loads both agent-wide and subaccount-scoped sources; the ordering puts subaccount before agent.
3. **Scheduled task scope** — a run with `triggerContext.scheduledTaskId` loads scheduled-task-scoped sources and injects the task's `description` as `taskInstructions`.
4. **Task instance attachments** — a run with `request.taskId` and text attachments on that task loads them with `task_instance` scope and highest precedence.
5. **Precedence ordering** — a run that has sources across all four scopes returns them sorted by `scopeOrder` then by `priority`.
6. **Eager vs lazy split** — sources with `loadingMode: 'lazy'` appear in `manifest`, not in `eager`.
7. **Binary attachments** — a task attachment with `fileType: 'application/pdf'` appears in the manifest with `fetchOk: false`, not in eager.
8. **No scheduled task description** — when the scheduled task exists but `description` is null or empty, `taskInstructions` is null (no empty layer is rendered).
9. **Trigger context absent** — when `request.triggerContext` is undefined, `taskInstructions` is null and scheduled-task-scoped sources are not loaded.
10. **Same-name override — basic case** — an agent-level `glossary.md` and a scheduled-task-level `glossary.md` resolve with the scheduled-task version winning. The agent-level source appears in `runContextData.suppressed` with `suppressedByOverride: true` and `suppressedBy` set to the winner's id. Only one `glossary.md` appears in `eager`.
11. **Same-name override — case/whitespace normalisation** — `Glossary.MD` and ` glossary.md ` are treated as the same name. The higher-precedence scope wins and the other is suppressed.
12. **Same-name override — across three scopes** — agent + subaccount + scheduled task all have `styleguide.md`. Only the scheduled-task version survives; the other two are in `suppressed`. Verify `suppressedBy` points to the scheduled-task id.
13. **Same-name override — lazy vs eager** — if both sources are lazy, the winner is still lazy (manifest entry); the loser is suppressed.
14. **Pre-prompt budget walk — everything fits** — three small sources totalling 5k tokens all get `includedInPrompt: true`, `accumulatedTokens` stops at 5k.
15. **Pre-prompt budget walk — partial fit** — five sources of 20k tokens each, with `MAX_EAGER_BUDGET` set to 50k via dependency injection: the first two are marked `includedInPrompt: true` (40k total), the third attempts 60k total, doesn't fit, gets `includedInPrompt: false`. The fourth and fifth also stay false. The full list is still present in `runContextData.eager` (not dropped, just tagged).
16. **Pre-prompt budget walk — precedence preserved under pressure** — task_instance source (10k) + scheduled_task source (40k) + agent source (20k), with `MAX_EAGER_BUDGET` = 60k: task_instance and scheduled_task fit (50k total), agent does not (would be 70k). Verify agent source has `includedInPrompt: false` even though it would fit in isolation.
17. **Lazy doesn't consume eager budget** — a scheduled task with one 50k lazy source does NOT reduce `accumulatedTokens`. A 50k eager source added alongside still fits inside the 60k budget.
18. **Lazy manifest cap** — with `MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT` set to 5 via DI and 10 lazy sources attached, `manifestForPrompt.length === 5` and `manifestElidedCount === 5`. The full `manifest` still has all 10.
19. **Snapshot shape completeness** — after `loadRunContextData` runs for a mixed scenario (eager in prompt, eager excluded, lazy, lazy elided, suppressed, binary failed), assert the snapshot includes entries for ALL of them with correct `includedInPrompt`, `suppressedByOverride`, `exclusionReason`, and `orderIndex` values.
20. **Order index stability across runs** — run the loader twice with the same inputs and verify the `orderIndex` on each source is identical. (Determinism check.)
21. **Order index assigned before suppression** — build a scenario with three sources at different scopes sharing the name `glossary.md`. Verify that all three appear in the combined snapshot (winner + two suppressed losers), and that each has a distinct, sequential `orderIndex` corresponding to its position in the full sorted pool (not just the post-suppression pool). Assert no entry has `orderIndex` undefined or -1. Assert the suppressed losers' orderIndex values are greater than the winner's.
22. **Order index for lazy and binary entries** — verify that a mixed run with eager, lazy, and binary-unreadable task attachments assigns `orderIndex` values to all of them, with the task-instance binary attachment getting orderIndex 0 (highest precedence scope, first position in the sorted pool).

**New test file:** `server/services/__tests__/agentDataSourcesScope.test.ts`

Cover the database-level invariants:

1. **CHECK constraint: scope exclusivity** — inserting a row with both `subaccountAgentId` and `scheduledTaskId` set fails with a constraint error.
2. **CHECK constraint: loading mode enum** — inserting a row with `loadingMode: 'streaming'` fails.
3. **Partial unique index: same name, same scope** — inserting two rows with the same `(agentId, scheduledTaskId, name)` fails with a unique violation.
4. **Partial unique index: same name, different scope** — inserting two rows with the same `name` but different scopes (one agent-level, one scheduled-task-level) succeeds. Runtime override resolution (§3.6) is what decides precedence; the DB index only prevents duplicates within a single scope.
5. **Cascade delete** — deleting a scheduled task cascades to its scoped data sources (via `ON DELETE CASCADE`).

**New test file:** `server/services/__tests__/readDataSourceSkill.test.ts`

Cover the skill handler:

1. **list — returns active sources only** — sources in `runContext.suppressed` do NOT appear in the list response. Winner sources do.
2. **list — excludedByBudget flag** — an eager source that didn't fit the budget has `excludedByBudget: true` in the list response.
3. **list — alreadyInKnowledgeBase flag** — only eager sources that are `includedInPrompt: true` have this flag set.
4. **read eager** — returns the in-memory content without re-fetching. Response includes `offset: 0`, `nextOffset: null`, `totalSizeChars`.
5. **read lazy agent source** — fetches via `loadSourceContent`, returns content, updates the pool cache, increments call count.
6. **read lazy task attachment** — fetches via `readTaskAttachmentContent`, returns content.
7. **read unknown id** — returns a structured error, does not throw.
8. **read binary attachment** — returns `{ ok: false, error: ... }`, does not attempt to decode.
9. **read call count limit** — after `MAX_READ_DATA_SOURCE_CALLS_PER_RUN` successful reads, subsequent calls return an error. The failed call does NOT increment the counter further.
10. **read per-call token cap — clamp** — caller passes `limit: 50000` on a 10k-token source with `MAX_READ_DATA_SOURCE_TOKENS_PER_CALL = 15000`: the full 10k content returns successfully (well under the clamp), `nextOffset: null`.
11. **read per-call token cap — slicing** — a 40k-token source with default limit returns ~15k tokens and `nextOffset` set. A follow-up read with `offset: nextOffset` returns the next slice.
12. **read walks to completion** — three successive reads of a ~40k source with default limit return chunks totalling the full content; the final response has `nextOffset: null`.
13. **read invalid offset** — `offset: -1` returns a structured error.
14. **read offset past end** — `offset: 999999` on a 1k source returns an empty string with `nextOffset: null`.
15. **read suppressed source is invisible** — attempting to read a source that was suppressed by same-name override returns `Source not found` (not "suppressed" — the agent should never know about it).
16. **missing run context** — when the handler is called outside a run, returns an error with no DB access.

**Updated test file:** `server/services/__tests__/scheduledTaskService.test.ts` (if exists; else create)

Cover the cascade behaviour in `update`:

1. **Change assignedAgentId** — scheduled-task-scoped data sources have their `agentId` updated in the same transaction.
2. **Change assignedAgentId emits audit event** — an `auditEvents` row is created with the old agent id, new agent id, cascade count, and the `willOverrideNewAgentSources` list.
3. **Change assignedAgentId with collision** — when the new agent already has an agent-level source with the same normalised name as one of the scheduled-task sources, the cascade succeeds (no DB error) AND the audit event's `willOverrideNewAgentSources` list includes that name.
4. **Change assignedAgentId with multiple collisions** — three colliding names all appear in the audit event.
5. **Reassignment preview endpoint** — a new `GET /api/subaccounts/:subaccountId/scheduled-tasks/:stId/reassignment-preview?newAgentId=...` returns the collision list without making any DB changes.
6. **Update other fields** — when `assignedAgentId` is unchanged, data sources are untouched and no audit event is emitted.

### 12.2 Integration tests

**New test file:** `server/__tests__/cascadingContextSources.integration.test.ts`

End-to-end flow that seeds the DB, fires a scheduled task, and inspects the resulting agent run:

1. Seed an org, subaccount, agent, and scheduled task with:
   - `description`: "Write a weekly summary using the glossary and style guide."
   - Two eager data sources on the scheduled task (`glossary.md`, `style-guide.md`)
   - One lazy data source on the scheduled task (`historical-reports.md`)
   - One agent-level data source (`company-brand.md`)
2. Call `scheduledTaskService.fireOccurrence(scheduledTaskId)`.
3. Assert the resulting `agentRuns` row has a `contextSourcesSnapshot` with all four entries and correct scope labels.
4. Fetch the system prompt used for the run (mock the LLM call and capture the prompt) and assert:
   - It contains `## Task Instructions` with the full description text
   - It contains `## Your Knowledge Base` with the glossary, style guide, and brand content
   - It contains `## Available Context Sources` with the historical-reports lazy manifest entry
   - Scheduled-task sources appear before the agent-level brand source (precedence)
5. Simulate a `read_data_source` skill call for the lazy historical-reports source — assert it returns the content.
6. Simulate a test with a task instance attachment (upload a markdown file to the fired board task before the run executes) and assert the attachment is included with `task_instance` scope at the highest precedence.

### 12.3 Manual QA checklist

Run through these by hand in local dev after landing the change, before opening the PR:

- [ ] Create a new scheduled task via the UI. The Instructions textarea is present, 8 rows tall. Paste a ~2 page briefing. Save. Re-open the detail page and verify the instructions display correctly in the read-only view.
- [ ] Edit an existing scheduled task. Change the instructions. Save. Verify the change persists.
- [ ] On the scheduled task detail page, upload a markdown file as a data source. Verify it appears in the list.
- [ ] Add a URL data source (e.g. a raw.githubusercontent.com markdown file). Use the **Test** button. Verify it fetches successfully.
- [ ] Set a data source to `lazy`. Verify the UI shows the Lazy badge.
- [ ] Click **Run Now** to fire the scheduled task immediately. Open the generated agent run detail page. Verify:
  - The Context Sources panel shows all sources with correct scopes.
  - The run completed successfully (or failed only for LLM/tool reasons, not context loading).
- [ ] Create a data source on an agent directly (via `AdminAgentEditPage`). Verify existing behaviour is preserved — the source still loads into runs that don't originate from scheduled tasks.
- [ ] As a user WITHOUT `SCHEDULED_TASKS_DATA_SOURCES_MANAGE`, open a scheduled task detail page. Verify the data sources panel shows in read-only mode (no upload/edit/delete buttons).
- [ ] Change the `assignedAgentId` on a scheduled task that has data sources. Verify the sources remain attached and now belong to the new agent (check via DB or via the new agent's data source list).
- [ ] Delete a scheduled task that has data sources. Verify the data sources are cascade-deleted.
- [ ] Upload a PDF as a task attachment on a board task assigned to the scheduled task's agent. Fire a run. Verify the PDF appears in the Context Sources panel with `[binary]` marker, and the agent was NOT given the binary content.

### 12.4 Verification commands (per `CLAUDE.md`)

Run after each meaningful change, per the project's verification policy:

```bash
npm run lint          # lint all changed files
npm run typecheck     # TypeScript check
npm test              # run relevant suites (at minimum: runContextLoader, agentDataSourcesScope, readDataSourceSkill)
npm run build         # client build to catch JSX/TSX errors not caught by tsc
npm run migrate       # apply migration 0078 locally to a test DB
```

If any check fails, fix it and re-run. After 3 failed fix attempts on the same check, STOP and escalate per the stuck detection protocol.

---

## 13. Implementation order

Recommended sequence. Each step is independently testable and leaves the system in a working state.

### Step 1 — Schema foundation (small, unblocks everything)
1. Write migration `0078_scheduled_task_data_sources.sql` and its down version.
2. Update `server/db/schema/agentDataSources.ts` with new columns and Drizzle types.
3. Run `npm run migrate` locally, verify the columns exist, re-run the existing agent data source tests to confirm no regression.

**Verify:** migration applies cleanly, `npm run typecheck` passes, existing tests still pass.

### Step 2 — Service layer (data loading + CRUD)
4. Extract `loadSourceContent` helper from the existing `fetchAgentDataSources` block.
5. Write `fetchDataSourcesByScope` and keep `fetchAgentDataSources` as a thin wrapper.
6. Write `loadTaskAttachmentsAsContext` in a new file (text MIME filtering, binary manifest, storage read).
7. Add `addScheduledTaskDataSource`, `listScheduledTaskDataSources`, `updateScheduledTaskDataSource`, `deleteScheduledTaskDataSource`, `testScheduledTaskDataSource`, `uploadScheduledTaskDataSourceFile` to `agentService`.
8. Unit tests for each CRUD method.

**Verify:** unit tests pass, `conversationService` still works (smoke test agent chat surface).

### Step 3 — Context loader (the hub)
9. Create `server/services/runContextLoader.ts` with `loadRunContextData`.
10. Unit tests for all precedence combinations (§12.1).

**Verify:** unit tests pass, no other code touched yet — this is a standalone module.

### Step 4 — Wire into agent execution
11. Replace the `fetchAgentDataSources` call at `agentExecutionService.ts:409` with `loadRunContextData`.
12. Add the "Task Instructions" layer conditional to the prompt assembly.
13. Add the "Available Context Sources" manifest block after the Knowledge Base block.
14. Add the `contextSourcesSnapshot` write to `agentRuns`.
15. Integration test: full fire-scheduled-task flow with prompt capture.

**Verify:** integration test passes, manual smoke test of an existing agent run to confirm no regression.

### Step 5 — Read skill
16. Create `server/skills/read_data_source.md`.
17. Add handler case in `skillExecutor.ts`.
18. Thread `runContextData` through the skill execution context (may need small signature update on the skill executor).
19. Add `MAX_READ_DATA_SOURCE_CALLS_PER_RUN` to `server/config/limits.ts`.
20. Enable the skill on agents (add to default skill slugs or per-agent).
21. Unit tests for the handler.

**Verify:** unit tests pass, manual smoke test of a run that calls `read_data_source` (can be triggered by a simple test agent).

### Step 6 — Routes
22. Extract shared validators to `server/lib/validators/dataSource.ts`.
23. Add the six new routes to `server/routes/scheduledTasks.ts`.
24. Test each route with curl / REST client against local dev.

**Verify:** routes respond correctly, permission check rejects unauthorised users.

### Step 7 — Permissions seed
25. Add the new permission key to `server/lib/permissions.ts`.
26. Update the permission seed script / migration to grant the new key to every permission set that has `AGENTS_EDIT`.
27. Re-seed local DB and verify the new permission appears in the admin UI.

**Verify:** `GET /api/my-permissions` returns the new key for an org admin.

### Step 8 — UI refactor (extract DataSourceManager)
28. Create `client/src/components/DataSourceManager.tsx` by extracting the inline code from `AdminAgentEditPage.tsx`.
29. Replace the inline code in `AdminAgentEditPage.tsx` with `<DataSourceManager scope={{ type: 'agent', agentId }} canEdit={canEditAgent} />`.
30. Add the `loadingMode` toggle to the form.
31. Manual QA: agent edit page still works as before, eager/lazy toggle works.

**Verify:** `npm run build` passes, agent edit page visually identical.

### Step 9 — UI: scheduled task create modal
32. Update `ScheduledTasksPage.tsx` create form: add Instructions textarea, rename Brief, update INITIAL_FORM.
33. Manual QA: create a scheduled task with instructions and verify the description persists.

### Step 10 — UI: scheduled task detail edit mode + data sources panel
34. Add edit mode state and handlers to `ScheduledTaskDetailPage.tsx`.
35. Add the read-only Instructions block.
36. Add the Data Sources panel via `<DataSourceManager scope={{ type: 'scheduled_task', scheduledTaskId, subaccountId }} />`.
37. Update the detail API response to include `description` (check if it already does, add if missing).
38. Manual QA: full round-trip from creation to run, verify context sources appear in the fired run.

### Step 11 — Agent run detail Context Sources panel
39. Locate the agent run detail page (if exists). Add the Context Sources panel using the `contextSourcesSnapshot` JSONB.
40. If no run detail page exists, skip and note as follow-up.

### Step 12 — Docs and cleanup
41. Update `architecture.md` with a new "Context Data Sources" section.
42. Update `docs/setup-42macro-reporting-agent.md` with a note that the config-driven approach is now preferred.
43. Add a new `docs/how-to-configure-a-recurring-report.md` with a worked example.
44. Run the full verification suite (`lint`, `typecheck`, `test`, `build`).
45. Invoke `pr-reviewer` for independent review.
46. Address any review findings.
47. Invoke `dual-reviewer` for the second-phase Codex loop.
48. Open the PR.

**Total estimated scope:** ~12 implementation steps spanning schema, backend services, a new skill, routes, permissions, and three UI surfaces. Each step is independently testable. The critical path is Steps 1→4 (schema through context wiring); everything else can be parallelised or deferred if needed.

---

## 14. Documentation updates

Per CLAUDE.md rule #10: "If a code change invalidates something described in a doc, update that doc in the same session and the same commit as the code change." The following docs must be updated as part of this work, not as a follow-up.

### 14.1 `architecture.md`

Add a new section **"Context Data Sources"** placed after the Skill System section (around line 241). It should cover:

- The three scoping axes (agent, subaccount, scheduled task) and the fourth ephemeral layer (task instance attachments).
- The `loading_mode` field (eager vs lazy) and what it means for the system prompt.
- The precedence rule (task_instance → scheduled_task → subaccount → agent).
- The 60k token budget for the Knowledge Base block and how it interacts with precedence.
- The `read_data_source` skill as the unified retrieval interface.
- The `contextSourcesSnapshot` column on `agentRuns` for debugging runs.
- The CHECK constraint on `agent_data_sources` (scope exclusivity).
- A link to this spec for the full details.

Target length: ~60 lines. Use the existing doc style (tables where helpful, code blocks for schema excerpts).

### 14.2 `docs/setup-42macro-reporting-agent.md`

Add a banner at the top:

> **Note (2026-04-08):** This document describes the first iteration of the 42 Macro reporting agent, which uses a custom `analyse_42macro_transcript` skill and a purpose-built seed script. The newer, recommended approach is to configure reporting agents via scheduled task instructions and data sources — see [`cascading-context-data-sources-spec.md`](./cascading-context-data-sources-spec.md) and [`how-to-configure-a-recurring-report.md`](./how-to-configure-a-recurring-report.md). This document is retained as a reference for the paywall + transcription + Slack pipeline, which is still the right pattern for that workflow.

Do not delete the existing document — the paywall/transcription/Slack skills it documents are still in use. Only the specialist-skill-per-report approach is being superseded.

### 14.3 New: `docs/how-to-configure-a-recurring-report.md`

A worked example that an operator can follow end-to-end. Should cover:

1. Pick or create a generic reporting agent (with generic master prompt like "You are a reporting agent. Read your task briefing and produce a report in the requested format.").
2. Ensure the agent has `read_data_source` in its default skill slugs (auto if §8.4 option is chosen).
3. Create a scheduled task, fill in the Instructions field with the full briefing text, set schedule and agent.
4. Open the scheduled task detail page, upload reference files as data sources, set `eager` or `lazy` as appropriate.
5. Click **Run Now** to test, inspect the Context Sources panel on the resulting run.
6. Adjust instructions or data sources as needed, then enable the schedule.

Use the 42 Macro report as the concrete worked example, with screenshots if practical. Target length: ~2–3 pages.

### 14.4 Inline code documentation

Add JSDoc comments to:

- `loadRunContextData` — explain the return shape and precedence rules
- `fetchDataSourcesByScope` — explain the scope resolution
- `loadTaskAttachmentsAsContext` — explain the text-only filter
- The `read_data_source` skill handler case — explain the eager/lazy distinction

Keep them brief — one paragraph each. The spec document is the source of truth for the design; the code comments just help a reader orient themselves without leaving their editor.

---

## 15. Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Token budget exhaustion — a scheduled task with 10 eager 8KB files could blow past the 60k Knowledge Base budget and cause silent truncation of agent-level sources | Medium | Low | **Mitigated by upstream budget walk (§7.1 step 8)**. `loadRunContextData` walks the eager list deterministically, marks sources `includedInPrompt: true/false`, and persists the decision in the snapshot. Silent character-level truncation no longer happens in practice — the downstream `buildSystemPrompt` safety net is documented but rarely triggers. UI surfaces total size in the Data Sources panel and the run detail Context Sources panel shows which sources were excluded by budget. |
| R2 | Binary attachments mislabeled as text — a `.md` file with binary content, or a misconfigured MIME type, could crash the loader | Low | Medium | Wrap `loadTaskAttachmentsAsContext` content reads in try/catch. On any decode error, mark the attachment as `fetchOk: false` and surface it in the manifest only. Never propagate raw bytes into the prompt. |
| R3 | Circular schema reference between `scheduledTasks.ts` and `agentDataSources.ts` | Medium | Low | The schema files already import each other transitively via the main `index.ts`. Use type-only imports where needed (`import type { ... }`) to avoid runtime circularity. |
| R4 | Cascade-delete surprises when a scheduled task is deleted — operators may lose reference material they thought was agent-level | Low | Medium | Data source rows scoped to a scheduled task are, by definition, tied to that task's lifecycle. Cascade is correct. UI shows a confirmation dialog on scheduled task delete that explicitly lists the attached data sources ("Deleting this scheduled task will also remove 5 data sources."). |
| R5 | `read_data_source` abuse — a runaway agent could call `read` in a loop and exhaust context window | Low | Low | **Three layers of defence**: (1) `MAX_READ_DATA_SOURCE_CALLS_PER_RUN` caps the total number of read ops per run; (2) `MAX_READ_DATA_SOURCE_TOKENS_PER_CALL` caps the size of any single read (with offset/limit slicing for large sources — §8.3); (3) existing agent run max cost limit is the final backstop. Even a perfectly adversarial agent can only consume `MAX_CALLS × MAX_TOKENS_PER_CALL` ≈ 300k tokens from this skill before the call limit trips. |
| R6 | The extracted `DataSourceManager` component changes behaviour on `AdminAgentEditPage` during refactor | Medium | Medium | Refactor is line-for-line, not a rewrite. Visual regression is caught by manual QA. The `loadingMode` field is additive with a default of `eager` — existing agents are unaffected. |
| R7 | Concurrent fires of the same scheduled task could trigger the cascade update race | Low | Low | Already gated by the existing `fireOccurrence` idempotency and the database transaction wrapping the cascade. `updatedAt` is the only field touched on the data source row. |
| R8 | The new `context_sources_snapshot` JSONB column on `agentRuns` bloats table size | Low | Low | Snapshots are ~1KB per run. At 100k runs per month, that's 100MB additional storage. Acceptable. If it becomes an issue, introduce a TTL-based archival strategy (out of scope). |
| R9 | The `scheduledTaskId` cascade on `assignedAgentId` change could silently break for users who expected the data sources to stay with the old agent, OR cause unexpected override suppression on the new agent's existing data sources | Medium | Medium | **Two-part mitigation (§7.6)**: (1) Pre-cascade collision detection — compare the scheduled-task source names against the new agent's own agent-level source names and include the overlap in the audit event's `willOverrideNewAgentSources` field. (2) UI confirmation dialog via the new `/reassignment-preview` endpoint, showing the operator exactly which data sources will be affected and which will override the new agent's existing ones. Cascade still proceeds — the partial unique index tolerates this because `scheduledTaskId` remains set on the moved rows. |
| R13 | Same-name override resolution silently hides a source from the agent, causing confusion when the agent claims it can't find a file the operator attached | Medium | Low | The snapshot persists all suppressed sources with `suppressedByOverride: true` and `suppressedBy` pointing to the winner. The run detail Context Sources panel (§11.5) shows suppressed rows in amber with an "overridden by X" indicator, so operators can quickly see why a source wasn't used. Add a note to the §14.3 "how to configure a recurring report" doc warning about name collisions. |
| R14 | Snapshot JSONB size grows as runs accumulate many sources across scopes | Low | Low | Typical snapshot per run: ~200 bytes per entry × ~15 entries = ~3KB. At 1M runs that's 3GB — acceptable for a system with this scale. If it ever becomes a problem, the snapshot can be moved to a separate `agent_run_context_snapshots` table keyed by `agentRunId`. Not in scope for v1. |
| R10 | Conversation service (`agent-chat`) unexpectedly starts pulling scheduled-task sources | None | High | Not possible — `conversationService.ts:179` calls `fetchAgentDataSources(agentId)` (the thin wrapper with no scheduled task scope), not `loadRunContextData`. Explicit test asserts chat context is unchanged. |
| R11 | The permission key rename or addition breaks existing permission sets in production | Low | Medium | Additive only — new key, existing keys untouched. Seed grants it to everyone who already has `AGENTS_EDIT`, so no user loses access. Verify with a pre-deploy check against the staging DB. |
| R12 | Drizzle's `check()` constraint helper may not be supported in the installed version, forcing the CHECK to live only in SQL | Medium | Low | Already noted in §5.2. The SQL migration is the source of truth regardless. Drizzle schema only needs to reflect columns, not constraints, for the ORM to work correctly. |

---

## 16. Open questions

Decisions that should be made before Step 1 of implementation, or explicitly deferred with a written reason.

### Q1. `read_data_source` default-on or opt-in?

**Recommendation:** default-on for every agent (§8.4). The skill is read-only and harmless when there are no data sources.

**Alternative:** auto-enable when the first data source is added to an agent or scheduled task.

**Needs decision before Step 5.**

### Q2. Should binary file parsing be added in v1?

**Recommendation:** no. V1 surfaces binaries in the manifest with a `[binary]` marker and rejects them from the `read` op. PDF / image / docx parsing is a larger feature (needs parsing library choice, error handling, extraction quality).

**Deferred** to a follow-up ticket. Captured in §17 (out of scope).

### Q3. Should we surface total data source size in the UI?

Related to R1. A small size indicator on the scheduled task detail page ("5 sources, 23KB, ~6k tokens") would help operators manage budgets.

**Recommendation:** add a tiny size total to the Data Sources panel header. Low cost, high value.

**Decision:** in scope.

### Q4. Cascade-update vs block on `assignedAgentId` change?

Already decided in §6.4: cascade, with audit event. The spec notes that R9 may also benefit from a UI confirmation dialog — this is a nice-to-have, not required.

**Decision:** cascade with audit + optional UI confirmation.

### Q5. Should `task_instance` scope become a formal scope value on `LoadedDataSource`?

**Decision:** yes (already written into §6.3). The alternative — using negative priority on the existing 3-scope union — is confusing and leaks implementation into the UI. Four scope values: `task_instance | scheduled_task | subaccount | agent`.

### Q6. What happens if `scheduledTask.description` is edited while a run is in flight?

The run captured `runContextData.taskInstructions` at start-time. A mid-run edit would not affect the in-flight run. This is correct behaviour — the run is locked to what it saw when it started.

**Decision:** no action needed. The current flow already produces the right result.

### Q7. Should the lazy manifest be visible in the system prompt at all, or only accessible through the tool?

**Recommendation:** visible as a short list in the `## Available Context Sources` block, so the agent knows what's available without having to call `list` first. This costs ~50 tokens per source, which is negligible.

**Decision:** visible in prompt (matches §7.3).

### Q8. What happens to the existing `analyse_42macro_transcript` skill?

**Decision:** leave it alone. It's working and in use. The new config-driven approach is the path for NEW reports, not a mandatory migration for existing ones. Document this in the `setup-42macro-reporting-agent.md` banner update.

---

## 17. Out of scope (explicitly)

These are deferred to future work. Capturing them here so they're not lost and so the reviewer knows what NOT to expect.

| Item | Reason | Captured in |
|---|---|---|
| Task-thread chat surface | Different feature entirely. Large implementation effort. | `docs/task-chat-feature.md` |
| Level-3 chat attachments (files uploaded inside a task conversation) | Depends on task-thread chat | `docs/task-chat-feature.md` |
| Binary file parsing (PDF, DOCX, images) | Needs parser library choice, v1 surfaces via manifest only | Q2 above |
| Vector retrieval / RAG underneath `read_data_source` | Interface is forward-compatible; add later if needed | §8, §15 R1 |
| **Content-hash based deduplication** — if two sources have identical content (different names, different scopes), load only one | Pure optimisation; §3.6 override policy handles same-name collisions. Hashing adds complexity (when to hash? S3 objects don't expose server-side hash in all configurations) and the token savings are marginal in practice. Add later if telemetry shows real waste. | §3.6 note, review feedback |
| **Content hashing for cross-run cache reuse** — cache `loadSourceContent` results by content hash across runs, so multiple scheduled tasks sharing a glossary only fetch it once | Same reasoning as above. The existing per-source in-memory cache (`getCachedContent` at `agentService.ts:26`) already covers the common case of back-to-back runs. | Review feedback |
| **`lastUsedAt` tracking on data sources** — track when a source was last actually read by an agent | Useful for analytics and identifying dead weight. Not critical for v1 — the `contextSourcesSnapshot` already captures per-run usage indirectly. If it becomes important, add a `last_used_at` column and update it from the skill handler. | Review feedback |
| **Per-agent / per-scheduled-task override of `MAX_READ_DATA_SOURCE_CALLS_PER_RUN` and `MAX_READ_DATA_SOURCE_TOKENS_PER_CALL`** | System-wide constants are sufficient for v1. Per-scope overrides add config surface and complicate the handler with a precedence lookup. Add later if specific agents hit the limits legitimately. | §8.3 note |
| **Soft warning when adding a data source would push the scheduled task's total eager budget over `MAX_EAGER_BUDGET`** | Nice UX but not required for correctness — the budget walk at run time is deterministic and the snapshot surfaces what was excluded. Add as a follow-up UI polish ticket. | §15 R1 |
| Playbook data sources | Same `agentDataSources` shape will support it when needed | §5.1 note on scope exclusion |
| Renaming `agentDataSources` → `contextDataSources` | Cosmetic; high file-touch cost, no functional benefit | User decision — do not rename |
| Seed script for the 42 Macro config via the new approach | User will handle as a follow-up configuration task | User decision |
| Auto-migration of existing specialist skills (`analyse_42macro_transcript`) into config | Existing skill works and is in use; coexistence is fine | Q8 |
| Full-text search over data source content within a run | Low priority; agent can grep manually if needed | — |
| Real-time data source "sync now" from the UI for scheduled-task sources | The existing test-fetch button covers the manual use case | — |
| Versioning of data sources | Out of scope; if content changes, the next run sees the new content | — |
| Cross-scheduled-task shared data sources (e.g. "this glossary applies to 5 reports") | Would require many-to-many linkage. For now, duplicate the file or attach it at the agent level. | — |
| Cross-agent shared data sources | Same — agent-level data sources already scoped per agent. | — |
| UI for auditing `read_data_source` call history per run | Part of the Context Sources panel can show which sources were actually read during the run — nice-to-have, can be added later by extending the snapshot | — |

---

## 18. Review checklist

For `pr-reviewer` and `dual-reviewer`. Use this to keep review scope focused.

### Schema correctness
- [ ] Migration `0078` applies forward cleanly on a DB at `0077`
- [ ] Down migration reverses it cleanly
- [ ] CHECK constraints fire on invalid inserts (manually tested)
- [ ] Partial unique index does not cause false positives on distinct scopes
- [ ] `ON DELETE CASCADE` wired correctly on both `scheduled_task_id` and `subaccount_agent_id`
- [ ] Drizzle schema in `agentDataSources.ts` matches the migration exactly (column types, nullability, defaults)

### Service layer
- [ ] `fetchAgentDataSources(agentId)` backwards-compatible wrapper preserved (for `conversationService`)
- [ ] `loadSourceContent` extraction is a pure refactor — no behaviour change
- [ ] `loadTaskAttachmentsAsContext` handles binary MIME safely
- [ ] `loadRunContextData` precedence matches the spec's §3.2 ordering
- [ ] Cascade update on `assignedAgentId` change is transactional

### Context assembly
- [ ] "Task Instructions" layer is only injected when trigger context has `scheduledTaskId`
- [ ] Layer is placed between "Additional Instructions" and team roster
- [ ] `contextSourcesSnapshot` is written before the LLM call, never updated afterward (except for the optional `truncated: true` safety-net hook in §7.4)
- [ ] Same-name override resolution (§3.6) is applied AFTER sorting, BEFORE the budget walk. Suppressed sources appear in the snapshot but not in `eager`/`manifest`.
- [ ] Pre-prompt budget walk sets `includedInPrompt: true/false` on each eager source deterministically. Sources beyond `MAX_EAGER_BUDGET` are NOT dropped from the array — they stay with `includedInPrompt: false` for snapshot persistence.
- [ ] `agentExecutionService` filters to `includedInPrompt === true` before passing sources to `buildSystemPrompt`.
- [ ] Lazy manifest rendered into the prompt uses `manifestForPrompt` (capped subset), not the full `manifest`.
- [ ] Elision note is appended when `manifestElidedCount > 0`.
- [ ] `buildSystemPrompt` signature and `conversationService` call site unchanged.
- [ ] The downstream 60k character-level truncation in `buildSystemPrompt` is retained as a safety net but is NOT the primary mechanism — assert via test that setting `MAX_EAGER_BUDGET` low causes upstream exclusion, not downstream truncation.

### Read skill
- [ ] `read_data_source.md` frontmatter is valid and the JSON tool definition parses
- [ ] Input schema includes optional `offset` and `limit` parameters with correct types
- [ ] Handler handles all four scopes and both loading modes
- [ ] Binary sources return structured errors, not exceptions
- [ ] Per-run call count limit (`MAX_READ_DATA_SOURCE_CALLS_PER_RUN`) enforced and tested
- [ ] Per-call token cap (`MAX_READ_DATA_SOURCE_TOKENS_PER_CALL`) clamps explicit `limit` values
- [ ] Offset/limit slicing returns `nextOffset` for continuation walks
- [ ] Suppressed sources are invisible to both `list` and `read` ops (§3.6)
- [ ] `list` op exposes `excludedByBudget` and `alreadyInKnowledgeBase` flags correctly
- [ ] Skill respects `ctx.runContextData` — no DB lookup needed for eager sources
- [ ] Lazy source content is cached in `runContext` after first read — subsequent reads for offset walks do not re-fetch from storage

### Routes & permissions
- [ ] Six new routes follow the `authenticate + asyncHandler` pattern
- [ ] All write routes check `SCHEDULED_TASKS_DATA_SOURCES_MANAGE`
- [ ] Read route uses `AGENTS_VIEW` (consistent with existing scheduled task routes)
- [ ] Validators extracted and reused between agent-level and scheduled-task-level routes
- [ ] Permission seed updated
- [ ] No direct `db` access in routes — all calls go through `agentService`

### UI
- [ ] `DataSourceManager` is a true extraction — no behaviour regression on `AdminAgentEditPage`
- [ ] Scheduled task create modal has the new Instructions field
- [ ] Scheduled task detail has edit mode + read-only instructions display + data sources panel
- [ ] `canEdit` gating is enforced
- [ ] Agent run detail shows Context Sources panel (or skip is documented)
- [ ] All form inputs are labelled and accessible

### Tests
- [ ] Unit tests cover §12.1 scenarios
- [ ] Integration test covers §12.2 end-to-end flow
- [ ] Existing tests still pass
- [ ] `lint`, `typecheck`, `build` all clean

### Docs
- [ ] `architecture.md` updated with the new section
- [ ] `setup-42macro-reporting-agent.md` has the superseded banner
- [ ] `how-to-configure-a-recurring-report.md` exists with a worked example
- [ ] JSDoc comments on the key new functions

### Architectural rules (from `CLAUDE.md`)
- [ ] Routes call services only; no direct `db` in routes
- [ ] `asyncHandler` wraps every async handler
- [ ] Service errors shaped as `{ statusCode, message, errorCode? }`
- [ ] `resolveSubaccount` called in any route with `:subaccountId` (verify — add if missing)
- [ ] Org scoping via `req.orgId`
- [ ] Soft-delete filters (`isNull(deletedAt)`) on `taskAttachments` query

---

## 19. Sign-off

When this spec is implemented, verified, and reviewed, append a sign-off block here:

```
Implemented: <date>
Migration: 0078_scheduled_task_data_sources
Branch: claude/reporting-agent-transcript-EfR3D
PR: <link>
pr-reviewer: pass / blockers addressed
dual-reviewer: pass / blockers addressed
Notes: <any deferred items from this spec that landed in follow-up PRs>
```
