# Sprint 4+5 Combined Implementation Plan

Build contract for Sprints 4 and 5 of `docs/improvements-roadmap-spec.md`.
Branch: `claude/sprints-4-5-development-iZCCA`. Sprints 1-3 merged to main.

---

## Table of Contents

1. [P3.1 Playbook multi-execution-mode toggle](#1-p31-playbook-multi-execution-mode-toggle)
2. [P3.2 Portfolio Health as bulk playbook](#2-p32-portfolio-health-as-bulk-playbook)
3. [P3.3 Structural trajectory comparison](#3-p33-structural-trajectory-comparison)
4. [P4.1 Topics-to-actions filter](#4-p41-topics-to-actions-filter)
5. [P4.2 Shared memory blocks](#5-p42-shared-memory-blocks)
6. [P4.3 Plan-then-execute](#6-p43-plan-then-execute)
7. [P4.4 Semantic critique gate](#7-p44-semantic-critique-gate)
8. [Baseline cleanup pass](#8-baseline-cleanup-pass)
9. [Sprint 4+5 gates and tests](#9-sprint-45-gates-and-tests)
10. [Build order and dependencies](#10-build-order-and-dependencies)

---

## 1. P3.1 Playbook multi-execution-mode toggle

**Dependencies:** None (first item in Sprint 4).

### 1.1 Migration 0086

**File:** `migrations/0086_playbook_run_mode.sql`

```sql
-- P3.1 — playbook multi-execution-mode toggle
-- Adds run_mode, parent_run_id, target_subaccount_id to playbook_runs.
-- Widens the status CHECK to include 'partial'.

ALTER TABLE playbook_runs
  ADD COLUMN IF NOT EXISTS run_mode text NOT NULL DEFAULT 'auto'
    CHECK (run_mode IN ('auto', 'supervised', 'background', 'bulk'));

ALTER TABLE playbook_runs
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES playbook_runs(id);

ALTER TABLE playbook_runs
  ADD COLUMN IF NOT EXISTS target_subaccount_id uuid REFERENCES subaccounts(id);

-- Widen the status CHECK. Drop the existing constraint first (Drizzle
-- does not manage CHECK constraints natively, so this is explicit SQL).
-- The existing statuses in schema: pending, running, awaiting_input,
-- awaiting_approval, completed, completed_with_errors, failed,
-- cancelling, cancelled. We ADD 'partial'.
-- The constraint is named playbook_runs_status_chk (from migration 0076).
ALTER TABLE playbook_runs
  DROP CONSTRAINT IF EXISTS playbook_runs_status_chk;

ALTER TABLE playbook_runs
  ADD CONSTRAINT playbook_runs_status_chk
    CHECK (status IN (
      'pending', 'running', 'awaiting_input', 'awaiting_approval',
      'completed', 'completed_with_errors', 'failed',
      'cancelling', 'cancelled', 'partial'
    ));

-- Index for bulk parent lookups: find all children of a given parent.
CREATE INDEX IF NOT EXISTS playbook_runs_parent_run_id_idx
  ON playbook_runs (parent_run_id)
  WHERE parent_run_id IS NOT NULL;

-- Idempotency key for bulk child creation: (parent_run_id, target_subaccount_id).
CREATE UNIQUE INDEX IF NOT EXISTS playbook_runs_bulk_child_unique_idx
  ON playbook_runs (parent_run_id, target_subaccount_id)
  WHERE parent_run_id IS NOT NULL AND target_subaccount_id IS NOT NULL;
```

**Risk:** The constraint name `playbook_runs_status_chk` is confirmed from migration 0076 (line 130). The `DROP CONSTRAINT IF EXISTS` + re-add pattern is safe. No further verification needed.

### 1.2 Schema changes

**File:** `server/db/schema/playbookRuns.ts`

Add `'partial'` to the `PlaybookRunStatus` union type:

```typescript
export type PlaybookRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'partial';
```

Add three new columns to the `playbookRuns` table definition, after the `startedByUserId` field:

```typescript
    // Sprint 4 P3.1 -- playbook multi-execution-mode toggle
    runMode: text('run_mode').notNull().default('auto')
      .$type<'auto' | 'supervised' | 'background' | 'bulk'>(),
    parentRunId: uuid('parent_run_id').references(() => playbookRuns.id),
    targetSubaccountId: uuid('target_subaccount_id').references(() => subaccounts.id),
```

Add a new export type for the run mode:

```typescript
export type PlaybookRunMode = 'auto' | 'supervised' | 'background' | 'bulk';
```

### 1.3 Engine branching

**File:** `server/services/playbookEngineService.ts`

The tick handler (starting at approximately line 250) currently computes a ready set then dispatches. Modify the dispatch section to branch on `run.runMode`:

**Branch insertion point:** Inside the `tick()` method, after the ready-set computation and before the dispatch loop. Add a function `dispatchWithMode(run, def, readySteps, liveStepRuns)` that does:

1. **`auto`** (default): No change. Existing dispatch behaviour.

2. **`supervised`**: Before calling `this.dispatchStep(...)`, call `playbookStepReviewService.requireApproval(sr)`. If the step run already has an approved review, proceed. If not, create a pending review and skip dispatching this step (set it to `awaiting_approval`). The review service handles the HITL gate.

3. **`background`**: Same execution as `auto`, but pass `suppressWebsocketUpdates: true` to the `emitPlaybookEvent` helper. Add an optional `options?: { suppressWs?: boolean }` parameter to `emitPlaybookEvent`.

4. **`bulk`**: At iteration 0 (first tick after run creation), read `contextJson.bulkTargets` (an array of subaccount IDs). For each target:
   - Create a child `playbookRuns` row with `parentRunId = run.id`, `targetSubaccountId = target`, `runMode = 'auto'`, same `templateVersionId`.
   - Use an ON CONFLICT DO NOTHING on the unique index `(parent_run_id, target_subaccount_id)` for idempotent retry.
   - Enqueue a tick for each child.
   - The parent run stays in `running` until all children reach a terminal state.
   - On subsequent ticks of the parent: query children, if all terminal, compute parent status:
     - All `completed` -> parent `completed`
     - Mix of `completed` and `failed` -> parent `partial`
     - All `failed` -> parent `failed`
   - Store aggregated child results in `contextJson.bulkResults`.

**Concurrency control for bulk:** The bulk dispatch loop must respect `organisations.ghl_concurrency_cap` (added in P3.2 migration 0087). Until P3.2 ships, use `MAX_PARALLEL_STEPS_DEFAULT` as the cap. After P3.2, read the org's `ghlConcurrencyC` and use `Math.min(MAX_PARALLEL_STEPS_DEFAULT, org.ghlConcurrencyC)`.

### 1.4 playbookStepReviewService

**File:** `server/services/playbookStepReviewService.ts` (NEW)

This service does NOT exist yet. Create it with:

```typescript
export const playbookStepReviewService = {
  /**
   * Check if a step run has an approved review. If not, create one
   * and transition the step to awaiting_approval.
   * Returns true if the step is approved and can proceed.
   */
  async requireApproval(stepRunId: string): Promise<boolean> {
    // 1. Check playbookStepReviews for an existing approved decision
    // 2. If approved, return true
    // 3. If no review exists, create a pending playbookStepReview
    //    and transition the step run to awaiting_approval
    // 4. Return false
  },
};
```

The service uses the existing `playbookStepReviews` table (already in schema at `server/db/schema/playbookRuns.ts` lines 158-177). It does NOT create `reviewItems` -- it uses the playbook-specific review table.

### 1.5 Emitter changes

**File:** `server/websocket/emitters.ts`

Add `suppressWebsocketUpdates` support to `emitPlaybookRunUpdate` at line 119. The simplest approach: add an optional `options` param:

```typescript
export function emitPlaybookRunUpdate(
  runId: string,
  event: string,
  data: Record<string, unknown>,
  options?: { suppress?: boolean }
): void {
  if (options?.suppress) return;
  emitToRoom(`playbook-run:${runId}`, event, runId, data);
}
```

Then modify the internal `emitPlaybookEvent` helper in `playbookEngineService.ts` to pass the suppress flag when `run.runMode === 'background'`.

### 1.6 Route changes

**File:** `server/routes/playbookRuns.ts`

Modify the POST create endpoint (line 36-62) to accept `runMode` and `bulkTargets`:

```typescript
const { templateId, systemTemplateSlug, input, runMode, bulkTargets } = req.body as {
  templateId?: string;
  systemTemplateSlug?: string;
  input?: Record<string, unknown>;
  runMode?: 'auto' | 'supervised' | 'background' | 'bulk';
  bulkTargets?: string[];
};
```

Pass `runMode` and `bulkTargets` through to `playbookRunService.startRun()`.

**File:** `server/services/playbookRunService.ts`

Extend `startRun()` to accept `runMode` (default `'auto'`) and write it to the `playbookRuns` row. If `runMode === 'bulk'` and `bulkTargets` is provided, store `bulkTargets` in `contextJson`.

### 1.7 Client changes

**File:** The start-run modal. Locate via grep for "Start Run" or similar in `client/src/`. Add a `<select>` dropdown with the four modes. When `bulk` is selected, show a subaccount picker (list of subaccounts for the org, checkboxes). Wire the selection into the POST body.

This is minimal client work -- just the form control and the API call parameter. No new pages.

### 1.8 Tests

- **Unit test:** `server/services/__tests__/playbookEngine.runModes.test.ts` (NEW)
  - Test `supervised` mode: mock step review service, assert dispatch is gated
  - Test `background` mode: assert WS emitter receives suppress flag
  - Test `bulk` mode: assert N child rows are created with correct parent/target fields
  - Test `bulk` idempotency: call fan-out twice, assert no duplicate children (ON CONFLICT)
  - Test `bulk` terminal aggregation: all completed -> completed, mixed -> partial

- **Integration test I3:** `server/services/__tests__/playbookBulk.parent-child-idempotency.test.ts` (NEW)
  - Full spec in roadmap-spec: fan-out, child retry idempotency, parent retry idempotency, concurrency cap, failure propagation.

- **Gate:** `scripts/gates/verify-playbook-run-mode-enforced.sh` (NEW)
  - Asserts `playbookEngineService.ts` contains branching on `runMode` in the tick handler.

### 1.9 Risk notes

- The status CHECK constraint widening is the riskiest part of the migration. Verify the existing constraint name first.
- Bulk mode's fan-out creates N rows in a single tick. For very large N, this could be slow. The `ghl_concurrency_cap` (P3.2) bounds in-flight children but not row creation. For Sprint 4, this is acceptable -- orgs typically have 10-50 subaccounts.
- The `background` mode suppression is shallow (just the emitter). If other code paths emit events outside `emitPlaybookRunUpdate`, they will not be suppressed. A grep for direct `getIO()` calls in the engine service is needed during implementation.

---

## 2. P3.2 Portfolio Health as bulk playbook

**Dependencies:** P3.1 must be complete (bulk mode).

### 2.1 Migration 0087

**File:** `migrations/0087_org_ghl_concurrency_cap.sql`

```sql
-- P3.2 -- GHL concurrency cap for bulk playbook fan-out.
-- Protects against thundering-herd API calls to GoHighLevel.

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS ghl_concurrency_cap integer NOT NULL DEFAULT 5;
```

### 2.2 Schema changes

**File:** `server/db/schema/organisations.ts`

Add after the `runRetentionDays` field (line ~28):

```typescript
    // Sprint 4 P3.2 -- GHL concurrency cap for bulk playbook fan-out.
    // Caps the number of in-flight bulk children that touch GHL.
    ghlConcurrencyCap: integer('ghl_concurrency_cap').notNull().default(5),
```

### 2.3 Seed script

**File:** `scripts/seed-portfolio-health-playbook.ts` (NEW)

Follows the pattern of `scripts/seed-42macro-reporting-agent.ts`. Creates a system playbook template with:

```typescript
{
  name: 'Portfolio Health Sweep',
  slug: 'portfolio-health-sweep',
  description: 'Runs health score + churn risk across all active subaccounts, then synthesises a portfolio report.',
  initialInputSchema: z.object({}),
  steps: [
    {
      id: 'enumerate_subaccounts',
      name: 'List active subaccounts',
      type: 'agent_call' as const,
      dependsOn: [],
      agentSlug: 'reporting-agent',  // resolved at run time
      skillSlug: 'list_active_subaccounts',
      sideEffectType: 'none' as const,
    },
    {
      id: 'synthesise',
      name: 'Generate portfolio report',
      type: 'agent_call' as const,
      dependsOn: [],  // dynamic: filled at runtime after bulk children complete
      agentSlug: 'reporting-agent',
      skillSlug: 'generate_portfolio_report',
      sideEffectType: 'none' as const,
    },
  ],
}
```

The seeder inserts into `systemPlaybookTemplates` and `systemPlaybookTemplateVersions`. Uses `top-level await` with `export {};` (per KNOWLEDGE.md).

Add `"seed:portfolio-health": "tsx scripts/seed-portfolio-health-playbook.ts"` to `package.json`.

### 2.4 Engine concurrency cap

**File:** `server/services/playbookEngineService.ts`

In the bulk dispatch path (added in P3.1), when dispatching child runs:

```typescript
const org = await db.select({ ghlConcurrencyCap: organisations.ghlConcurrencyCap })
  .from(organisations).where(eq(organisations.id, run.organisationId)).limit(1);
const cap = Math.min(MAX_PARALLEL_STEPS_DEFAULT, org[0]?.ghlConcurrencyCap ?? 5);

// Count in-flight children (status = 'running')
const inFlight = children.filter(c => c.status === 'running').length;
const slotsAvailable = Math.max(0, cap - inFlight);

// Only enqueue ticks for the next `slotsAvailable` pending children
const pendingChildren = children.filter(c => c.status === 'pending');
for (const child of pendingChildren.slice(0, slotsAvailable)) {
  await this.enqueueTick(child.id);
}
```

### 2.5 Skill: list_active_subaccounts

**File:** `server/skills/list_active_subaccounts.md` (NEW)

Skill definition:
- Name: `list_active_subaccounts`
- Description: Returns the list of active subaccount IDs for the current organisation.
- Input schema: `z.object({})` (no parameters)
- Output: `{ subaccountIds: string[] }`
- Gate level: `auto` (read-only)
- idempotencyStrategy: `read_only`

**File:** `server/config/actionRegistry.ts`

Add a new entry to `ACTION_REGISTRY`:

```typescript
list_active_subaccounts: {
  actionType: 'list_active_subaccounts',
  description: 'List all active subaccount IDs for the current organisation.',
  actionCategory: 'api',
  isExternal: false,
  defaultGateLevel: 'auto',
  createsBoardTask: false,
  payloadFields: [],
  parameterSchema: z.object({}),
  retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
  idempotencyStrategy: 'read_only',
  topics: ['reporting'],
},
```

**File:** `server/services/skillExecutor.ts` (or `intelligenceSkillExecutor.ts`)

Add a handler case that queries `subaccounts` where `organisationId = orgId` and `deletedAt IS NULL`, returning the IDs.

### 2.6 Tests

- Seed the template in a test org, verify the system template exists.
- Integration: dispatch a bulk run against 3 fixture subaccounts, assert 3 children created.
- Set `ghlConcurrencyCap = 2`, verify only 2 children are in-flight at any time.

---

## 3. P3.3 Structural trajectory comparison

**Dependencies:** P3.1 and P3.2 must be complete (Portfolio Health fixture for trajectory 4).

### 3.1 Zod schema

**File:** `shared/iee/trajectorySchema.ts` (NEW)

```typescript
import { z } from 'zod';

export const TrajectoryEventSchema = z.object({
  actionType: z.string(),
  argMatchers: z.record(z.unknown()).optional(),
});

export const ReferenceTrajectorySchema = z.object({
  name: z.string(),
  description: z.string(),
  fixtureRunId: z.string(),
  matchMode: z.enum(['exact', 'in-order', 'any-order', 'single-tool']),
  expected: z.array(TrajectoryEventSchema),
});

export const TrajectoryDiffSchema = z.object({
  pass: z.boolean(),
  matchMode: z.string(),
  expected: z.array(TrajectoryEventSchema),
  actual: z.array(TrajectoryEventSchema),
  missingSteps: z.array(TrajectoryEventSchema),
  extraSteps: z.array(TrajectoryEventSchema),
  orderViolations: z.array(z.object({
    expected: TrajectoryEventSchema,
    foundAtIndex: z.number(),
  })).optional(),
});

export type TrajectoryEvent = z.infer<typeof TrajectoryEventSchema>;
export type ReferenceTrajectory = z.infer<typeof ReferenceTrajectorySchema>;
export type TrajectoryDiff = z.infer<typeof TrajectoryDiffSchema>;
```

### 3.2 Pure service

**File:** `server/services/trajectoryServicePure.ts` (NEW)

Exports:

```typescript
export function compare(
  actual: TrajectoryEvent[],
  reference: ReferenceTrajectory,
): TrajectoryDiff;

export function formatDiff(diff: TrajectoryDiff): string;
```

**`compare` logic per match mode:**

- **`exact`**: actual length must equal expected length. Each position must match actionType. argMatchers checked per position.
- **`in-order`**: walk actual with two pointers. For each expected event, scan forward in actual until a match is found. If not found, it's missing. Extra events between matches are recorded as extras.
- **`any-order`**: for each expected event, find any match in actual (mark used). Unmatched expected = missing. Unmatched actual = extra.
- **`single-tool`**: pass if at least one actual event matches the expected actionType.

**`argMatchers` partial equality:** For each key in the matcher object, check that the actual event's args contain that key with an equal value (deep equality for objects, strict for primitives). Missing keys in matcher are ignored.

**`formatDiff` output:** Human-readable CI-friendly output:

```
PASS intake-triage-standard (in-order)
FAIL dev-patch-cycle (exact)
  Missing: [write_patch at position 3]
  Extra: [create_task at position 2]
```

### 3.3 Impure service

**File:** `server/services/trajectoryService.ts` (NEW)

```typescript
export const trajectoryService = {
  async loadTrajectory(runId: string): Promise<TrajectoryEvent[]> {
    // Query actions table: SELECT action_type, payload_json
    // FROM actions WHERE agent_run_id = runId
    // ORDER BY created_at ASC
    // Map to TrajectoryEvent[]
  },
};
```

### 3.4 CLI runner

**File:** `scripts/run-trajectory-tests.ts` (NEW)

```typescript
// Top-level await with export {};
export {};

// 1. Glob tests/trajectories/*.json
// 2. For each file: parse with ReferenceTrajectorySchema.parse()
// 3. Load the trajectory from fixture data (not live DB -- use
//    pre-captured JSON fixtures alongside the reference files)
// 4. Call compare(actual, reference)
// 5. Print formatDiff(diff) for each
// 6. Exit non-zero if any fail
```

**IMPORTANT:** The trajectory tests use pre-captured fixture data, not live DB queries. Each reference JSON file has a companion `*.actual.json` file containing the captured trajectory from a known-good run. The `loadTrajectory` DB path is for runtime use; the CLI runner reads fixtures directly.

Add to `package.json`:
```json
"test:trajectories": "tsx scripts/run-trajectory-tests.ts"
```

Wire into `npm test` by updating the `test` script.

### 3.5 Reference trajectories

**Directory:** `tests/trajectories/` (NEW)

Five reference + actual pairs:

1. `intake-triage-standard.json` + `intake-triage-standard.actual.json`
2. `dev-patch-cycle.json` + `dev-patch-cycle.actual.json`
3. `qa-review-blocked.json` + `qa-review-blocked.actual.json`
4. `portfolio-health-3-subaccounts.json` + `portfolio-health-3-subaccounts.actual.json`
5. `reporting-agent-morning.json` + `reporting-agent-morning.actual.json`

Each `.actual.json` is captured from a known-good run. The capture can be manual initially -- run an agent against fixtures, extract the actions from the DB, save as JSON.

The trajectory format:
```json
[
  { "actionType": "read_workspace", "args": { "key": "intake_queue" } },
  { "actionType": "triage_intake", "args": {} }
]
```

### 3.6 Tests

**File:** `server/services/__tests__/trajectoryService.test.ts` (NEW)

- Test each of the 4 match modes with synthetic data
- Test `argMatchers` partial equality (match, mismatch, missing key)
- Test `formatDiff` produces expected output
- Test edge cases: empty actual, empty expected, single-element

**Gate:** None specific to P3.3 -- the `test:trajectories` script IS the gate.

---

## 4. P4.1 Topics-to-actions filter

**Dependencies:** P2.3 (Sprint 3, already shipped -- provides `extractToolIntentConfidence`). P2.1 (Sprint 3, already shipped -- provides `agent-run-resume` for the clarify endpoint).

### 4.1 Topic registry

**File:** `server/config/topicRegistry.ts` (NEW)

Defines the topic taxonomy as a typed constant:

```typescript
export interface TopicRule {
  topic: string;
  description: string;
  keywords: RegExp[];
}

export const TOPIC_REGISTRY: readonly TopicRule[] = [
  { topic: 'email', description: 'Email composition and delivery', keywords: [/\bemail\b/i, /\binbox\b/i, /\bsend.*message\b/i] },
  { topic: 'calendar', description: 'Scheduling and calendar management', keywords: [/\bcalendar\b/i, /\bschedule\b/i, /\bmeeting\b/i, /\bappointment\b/i] },
  { topic: 'dev', description: 'Software development', keywords: [/\bcode\b/i, /\bpatch\b/i, /\bPR\b/, /\bbug\b/i, /\btest\b/i, /\bdeploy\b/i] },
  { topic: 'reporting', description: 'Analytics and reporting', keywords: [/\breport\b/i, /\bhealth.*score\b/i, /\bchurn\b/i, /\bmetric\b/i, /\banalytics\b/i] },
  { topic: 'intake', description: 'Work intake and triage', keywords: [/\bintake\b/i, /\btriage\b/i, /\bnew.*request\b/i] },
  { topic: 'gh-integration', description: 'GitHub integration', keywords: [/\bgithub\b/i, /\brepository\b/i, /\bissue\b/i, /\bpull.*request\b/i] },
  { topic: 'task', description: 'Task management', keywords: [/\btask\b/i, /\bboard\b/i, /\bkanban\b/i, /\btodo\b/i] },
  { topic: 'workspace', description: 'Workspace memory and context', keywords: [/\bworkspace\b/i, /\bmemory\b/i, /\bcontext\b/i] },
  { topic: 'page', description: 'Page/CMS operations', keywords: [/\bpage\b/i, /\bcms\b/i, /\bpublish\b/i, /\blanding\b/i] },
  { topic: 'support', description: 'Client support', keywords: [/\bsupport\b/i, /\bhelp\b/i, /\bbilling\b/i, /\bclient.*issue\b/i] },
] as const;

export function getTopicNames(): string[] {
  return TOPIC_REGISTRY.map(r => r.topic);
}
```

### 4.2 Classifier

**File:** `server/services/topicClassifierPure.ts` (NEW)

```typescript
import { TOPIC_REGISTRY } from '../config/topicRegistry.js';

export interface ClassificationResult {
  primaryTopic: string | null;
  secondaryTopic: string | null;
  confidence: number; // 0.0-1.0
}

/**
 * Pure keyword classifier. Scores each topic by the number of keyword
 * matches in the last user message. Returns top 1-2 topics with a
 * confidence score based on match density.
 *
 * Confidence heuristic:
 *   - 3+ keyword hits in one topic -> 0.9
 *   - 2 hits -> 0.75
 *   - 1 hit -> 0.5
 *   - 0 hits -> 0.0 (no classification)
 */
export function classifyTopics(
  messages: Array<{ role: string; content: string }>,
): ClassificationResult;
```

The function extracts the last user-role message, runs all `TOPIC_REGISTRY` keyword regexes against it, scores each topic, and returns the top 1-2.

**File:** `server/services/topicClassifier.ts` (NEW)

Thin impure wrapper:

```typescript
import { classifyTopics } from './topicClassifierPure.js';

export const topicClassifier = {
  classify(messages: Array<{ role: string; content: string }>): ClassificationResult {
    return classifyTopics(messages);
  },
};
```

### 4.3 Universal skills and action registry

**File:** `server/config/actionRegistry.ts`

**Changes:**

1. **Populate `topics` on all existing entries.** Walk through all ~30 entries and add the `topics: string[]` array. Examples:
   - `send_email`: `topics: ['email']`
   - `write_patch`: `topics: ['dev']`
   - `create_task`: `topics: ['task']`
   - `review_code`: `topics: ['dev']`
   - `compute_health_score`: `topics: ['reporting']`
   - `read_workspace`: `topics: ['workspace']` (plus `isUniversal: true`)
   - Skills with no clear topic: `topics: []` (unclassified, always visible)

2. **Mark 3 existing skills as universal:**
   ```typescript
   // On read_workspace entry:
   isUniversal: true,
   // On search_codebase entry:
   isUniversal: true,
   // On web_search entry:
   isUniversal: true,
   ```

3. **Add new `ask_clarifying_question` entry:**
   ```typescript
   ask_clarifying_question: {
     actionType: 'ask_clarifying_question',
     description: 'Ask the user a clarifying question when intent is unclear or tool confidence is low.',
     actionCategory: 'api',
     isExternal: false,
     defaultGateLevel: 'auto',
     createsBoardTask: false,
     payloadFields: [],
     parameterSchema: z.object({
       question: z.string().min(10).max(2000).describe('The clarifying question to ask the user.'),
       blocked_by: z.enum(['topic_filter', 'scope_check', 'no_relevant_tool', 'low_confidence']).optional()
         .describe('What triggered the clarification request.'),
     }),
     retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
     idempotencyStrategy: 'keyed_write',
     isUniversal: true,
     topics: [],
   },
   ```

4. **Add helper function** at the end of the file:
   ```typescript
   export function getUniversalSkillNames(): string[] {
     return Object.values(ACTION_REGISTRY)
       .filter(a => a.isUniversal === true)
       .map(a => a.actionType);
   }
   ```

**File:** `server/services/skillService.ts`

Extend `resolveSkillsForAgent` to merge universal skills into the effective allowlist:

```typescript
async resolveSkillsForAgent(
  skillSlugs: string[],
  organisationId: string
): Promise<{ tools: AnthropicTool[]; instructions: string[] }> {
  // Merge universal skills into the effective allowlist
  const universalSlugs = getUniversalSkillNames();
  const effectiveAllowlist = Array.from(new Set([...skillSlugs, ...universalSlugs]));
  // ... rest of existing logic using effectiveAllowlist instead of skillSlugs
```

### 4.4 ask_clarifying_question skill

**File:** `server/skills/ask_clarifying_question.md` (NEW)

Standard skill definition markdown file following the existing pattern (e.g. `server/skills/report_bug.md`).

**File:** `server/tools/internal/askClarifyingQuestion.ts` (NEW)

Handler:

```typescript
export async function handleAskClarifyingQuestion(
  runId: string,
  organisationId: string,
  args: { question: string; blocked_by?: string },
): Promise<{ success: boolean; status: string; question: string }> {
  // 1. Update agent_runs.summary with the question
  await db.update(agentRuns)
    .set({ summary: args.question, updatedAt: new Date() })
    .where(eq(agentRuns.id, runId));

  // 2. Append a tool_result message to agent_run_messages
  await agentRunMessageService.appendMessage(runId, organisationId, {
    role: 'tool_result',
    content: JSON.stringify({ question: args.question, blocked_by: args.blocked_by }),
  });

  // 3. Transition status to awaiting_clarification
  await db.update(agentRuns)
    .set({ status: 'awaiting_clarification', updatedAt: new Date() })
    .where(eq(agentRuns.id, runId));

  // 4. Emit WebSocket event
  emitAwaitingClarification(runId, args.question, args.blocked_by);

  return { success: true, status: 'awaiting_clarification', question: args.question };
}
```

**File:** `server/services/skillExecutor.ts`

Add a case for `ask_clarifying_question` that dispatches to the handler. Because `isMethodology: false` and `defaultGateLevel: 'auto'`, it flows through the standard `proposeAction` path.

### 4.5 Agent runs schema

**File:** `server/db/schema/agentRuns.ts`

Add `'awaiting_clarification'` to the status type. The status column is typed via `$type<>()`. Find the status field (approximately line 80-100) and widen it. No migration needed because agent_runs status is stored as `text` -- there is no CHECK constraint on agent_runs status (verified by examining the schema). The type is enforced only at the TypeScript level.

**Verify:** Grep for `CHECK.*status` in migrations related to agent_runs. If a CHECK constraint exists, a migration ALTER will be needed to widen it.

### 4.6 Clarify route and emitter

**File:** `server/routes/agentRuns.ts`

Add new endpoint after existing routes:

```typescript
router.post(
  '/api/agent-runs/:id/clarify',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { answer } = req.body as { answer: string };
    if (!answer || typeof answer !== 'string') {
      res.status(400).json({ error: 'answer is required' });
      return;
    }

    // 1. Load the run, assert status === 'awaiting_clarification'
    // 2. Append a user message to agent_run_messages
    // 3. Transition status back to 'pending'
    // 4. Enqueue agent-run-resume pg-boss job with singletonKey: `run:${id}`
    // Delegate to a service method for all of this.

    await agentExecutionService.clarifyAndResume(id, req.orgId!, answer);
    res.json({ ok: true });
  })
);
```

**File:** `server/services/agentExecutionService.ts`

Add method. **NOTE:** The `agent-run-resume` pg-boss job does NOT exist yet (Sprint 3B was deferred). P4.1 must either:
- (a) Add the `agent-run-resume` job + processor as a prerequisite, OR
- (b) Call `resumeAgentRun` directly in a fire-and-forget pattern.

**Recommended: option (a).** Add the job config and processor as part of P4.1 since the clarify endpoint needs async resume.

```typescript
async clarifyAndResume(runId: string, orgId: string, answer: string): Promise<void> {
  const [run] = await db.select().from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, orgId)));
  if (!run) throw { statusCode: 404, message: 'Run not found' };
  if (run.status !== 'awaiting_clarification') {
    throw { statusCode: 409, message: `Run status is ${run.status}, expected awaiting_clarification` };
  }

  // Append user answer as a message
  await agentRunMessageService.appendMessage(runId, orgId, {
    role: 'user',
    content: answer,
  });

  // Transition to pending
  await db.update(agentRuns)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(agentRuns.id, runId));

  // Enqueue resume job (see P4.1 prerequisite: agent-run-resume job)
  const boss = await getPgBoss();
  await boss.send('agent-run-resume', { runId, organisationId: orgId }, {
    ...getJobConfig('agent-run-resume'),
    singletonKey: `run:${runId}`,
  });
}
```

**P4.1 prerequisite: agent-run-resume job.**

This was originally Sprint 3B scope but is needed for P4.1. Add:

**File:** `server/config/jobConfig.ts` -- Add before the closing `as const`:

```typescript
  'agent-run-resume': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'agent-run-resume__dlq',
    idempotencyStrategy: 'singleton-key' as const, // singletonKey: run:${runId}
  },
```

**File:** `server/jobs/agentRunResumeProcessor.ts` (NEW)

```typescript
import { resumeAgentRun } from '../services/agentExecutionService.js';

export async function processAgentRunResume(
  job: { data: { runId: string; organisationId: string } },
): Promise<void> {
  await resumeAgentRun(job.data.runId, { useLatestConfig: false });
}
```

Register in the worker setup (wherever `createWorker` calls live).

**File:** `server/websocket/emitters.ts`

Add new emitter after the existing `emitPlaybookRunUpdate` section (line ~135):

```typescript
// -- Agent run clarification events (Sprint 5 P4.1) --------------------------

export function emitAwaitingClarification(
  runId: string,
  question: string,
  blockedBy?: string
): void {
  emitToRoom(`agent-run:${runId}`, 'agent:run:awaiting-clarification', runId, {
    runId,
    question,
    blockedBy,
  });
}
```

### 4.7 preCall middleware

**File:** `server/services/agentExecutionService.ts`

Add a new `preCall` middleware to the `pipeline.preCall` array. This middleware runs before each LLM call and filters `activeTools`:

```typescript
const topicFilterMiddleware: PreCallMiddleware = {
  name: 'topic_filter',
  execute(ctx) {
    // Only filter on iterations > 0 (let iteration 0 run unfiltered for planning)
    if (ctx.iteration === 0) return { action: 'continue' };

    const classification = classifyTopics(/* last user message from ctx */);

    if (classification.confidence === 0 || !classification.primaryTopic) {
      // No classification -- leave tools unfiltered
      return { action: 'continue' };
    }

    // Use mutateActiveToolsPreservingUniversal to narrow the tool set
    // This helper is on agentExecutionServicePure.ts
    // The middleware must have access to the full tool set and the current active set
    // Implementation detail: pass through ctx or store on the middleware context

    return { action: 'continue' };
  },
};
```

**File:** `server/services/agentExecutionServicePure.ts`

Add the `mutateActiveToolsPreservingUniversal` helper:

```typescript
import { getUniversalSkillNames } from '../config/actionRegistry.js';

export function mutateActiveToolsPreservingUniversal(
  current: ProviderTool[],
  transform: (tools: ProviderTool[]) => ProviderTool[],
  allAvailableTools: ProviderTool[],
): ProviderTool[] {
  const transformed = transform(current);
  const universalNames = new Set(getUniversalSkillNames());
  const universalTools = allAvailableTools.filter(t => universalNames.has(t.name));
  const transformedNames = new Set(transformed.map(t => t.name));
  const preserved = [...transformed];
  for (const ut of universalTools) {
    if (!transformedNames.has(ut.name)) preserved.push(ut);
  }
  return preserved;
}
```

**Implementation note:** The `preCall` middleware needs access to `activeTools` and the ability to mutate them. The current `PreCallMiddleware` interface returns `PreCallResult` but does not receive or return `activeTools`. The interface needs to be extended or the middleware needs to mutate a shared reference. The cleanest approach: extend `PreCallResult` with an optional `activeTools?: ProviderTool[]` field. When present, the loop uses it as the new tool set for the current iteration.

Alternatively, store `activeTools` on the `MiddlewareContext` and let middlewares mutate it in-place (through the helper). This is simpler and consistent with how `toolCallHistory` is already mutated on `ctx`. **Recommended approach: add `activeTools` and `allAvailableTools` to `MiddlewareContext`.** They are ephemeral (recomputed on resume per P2.1 Rule 6) and marked with `// ephemeral:` comments.

### 4.8 preTool confidence escape hatch

**File:** `server/services/agentExecutionService.ts`

In the existing `preTool` middleware pipeline, add a new branch before the `proposeAction` call:

```typescript
// P4.1 confidence escape hatch -- below MIN_TOOL_ACTION_CONFIDENCE, force clarification
const confidence = extractToolIntentConfidence(ctx.lastAssistantText, toolCall.name);
if (confidence !== undefined && confidence !== null && confidence < MIN_TOOL_ACTION_CONFIDENCE) {
  // Log telemetry
  return {
    action: 'skip',
    reason: `confidence_${confidence.toFixed(2)}_below_clarification_threshold`,
    injectMessage: `Your confidence for ${toolCall.name} was ${confidence.toFixed(2)}, below the ${MIN_TOOL_ACTION_CONFIDENCE} threshold required to execute. Call ask_clarifying_question to gather the information you need from the user before proceeding.`,
  };
}
```

**File:** `server/config/limits.ts`

Add at end of file:

```typescript
// -- Sprint 5 P4.1 -- Topics-to-actions filter --------------------------------

/**
 * Minimum self-reported confidence (from tool_intent block) below which
 * the preTool middleware blocks the tool call and forces the agent to
 * call ask_clarifying_question instead. See P4.1 confidence escape hatch.
 */
export const MIN_TOOL_ACTION_CONFIDENCE = 0.5;

/**
 * Confidence threshold above which the topic filter hard-removes
 * non-matching tools. Below this, soft narrowing (reorder only).
 */
export const HARD_REMOVAL_CONFIDENCE_THRESHOLD = 0.85;
```

### 4.9 Tests

**New unit tests:**

1. `server/services/__tests__/topicClassifier.test.ts` -- keyword classifier against 10+ representative messages including compound asks and mid-thread shifts.

2. `server/services/__tests__/mutateActiveToolsPreservingUniversal.test.ts` -- the mutation helper: transform that removes a universal skill (re-injected), transform that keeps everything, empty allAvailable.

3. `server/services/__tests__/askClarifyingQuestion.test.ts` -- handler status transitions, message append.

4. `server/config/__tests__/universalSkills.test.ts` -- assert `getUniversalSkillNames()` returns expected set, assert merge into allowlist works.

**New gate scripts:**

1. `scripts/gates/verify-universal-skills-preserved.sh` -- asserts no middleware directly mutates `activeTools` without calling `mutateActiveToolsPreservingUniversal`.

2. `scripts/gates/verify-confidence-escape-hatch-wired.sh` -- asserts the preTool middleware contains the escape-hatch branch and `MIN_TOOL_ACTION_CONFIDENCE` is in limits.ts.

---

## 5. P4.2 Shared memory blocks

**Dependencies:** None beyond P0.1 (Sprint 1). Can run in parallel with other Sprint 5 items.

### 5.1 Migration 0088

**File:** `migrations/0088_memory_blocks.sql`

```sql
-- P4.2 -- Shared memory blocks (Letta pattern).
-- Named memory blocks attachable to multiple agents with read/write permissions.

CREATE TABLE memory_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid REFERENCES subaccounts(id),  -- nullable for org-level blocks
  name text NOT NULL,
  content text NOT NULL,
  owner_agent_id uuid REFERENCES agents(id),
  is_read_only boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX memory_blocks_org_name_idx
  ON memory_blocks (organisation_id, name)
  WHERE deleted_at IS NULL;

CREATE INDEX memory_blocks_org_idx
  ON memory_blocks (organisation_id)
  WHERE deleted_at IS NULL;

CREATE TABLE memory_block_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES memory_blocks(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id),
  permission text NOT NULL CHECK (permission IN ('read', 'read_write')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX memory_block_attachments_block_agent_idx
  ON memory_block_attachments (block_id, agent_id);

CREATE INDEX memory_block_attachments_agent_idx
  ON memory_block_attachments (agent_id);

-- RLS policies (new tables created with RLS from Sprint 2 onward)
ALTER TABLE memory_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_blocks_org_isolation ON memory_blocks
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY memory_blocks_admin_bypass ON memory_blocks
  TO admin_role
  USING (true)
  WITH CHECK (true);

-- memory_block_attachments does not have organisation_id directly.
-- RLS is enforced via the FK to memory_blocks (which is RLS-protected).
-- However, for query-time isolation, we still need a policy. The
-- approach: join through memory_blocks. But Postgres RLS cannot do joins
-- in USING clauses natively. Alternative: add organisation_id to
-- memory_block_attachments for direct RLS, or rely on the service layer.
-- Decision: add organisation_id to memory_block_attachments for direct RLS.

ALTER TABLE memory_block_attachments
  ADD COLUMN organisation_id uuid NOT NULL REFERENCES organisations(id);

ALTER TABLE memory_block_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_block_attachments_org_isolation ON memory_block_attachments
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

CREATE POLICY memory_block_attachments_admin_bypass ON memory_block_attachments
  TO admin_role
  USING (true)
  WITH CHECK (true);
```

### 5.2 Schema files

**File:** `server/db/schema/memoryBlocks.ts` (NEW)

```typescript
import { pgTable, uuid, text, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';

export const memoryBlocks = pgTable(
  'memory_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    name: text('name').notNull(),
    content: text('content').notNull(),
    ownerAgentId: uuid('owner_agent_id').references(() => agents.id),
    isReadOnly: boolean('is_read_only').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgNameIdx: uniqueIndex('memory_blocks_org_name_idx')
      .on(table.organisationId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    orgIdx: index('memory_blocks_org_idx')
      .on(table.organisationId)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type MemoryBlock = typeof memoryBlocks.$inferSelect;
export type NewMemoryBlock = typeof memoryBlocks.$inferInsert;
```

**File:** `server/db/schema/memoryBlockAttachments.ts` (NEW)

```typescript
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { agents } from './agents';
import { memoryBlocks } from './memoryBlocks';

export const memoryBlockAttachments = pgTable(
  'memory_block_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    blockId: uuid('block_id').notNull().references(() => memoryBlocks.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    permission: text('permission').notNull().$type<'read' | 'read_write'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    blockAgentIdx: uniqueIndex('memory_block_attachments_block_agent_idx')
      .on(table.blockId, table.agentId),
    agentIdx: index('memory_block_attachments_agent_idx')
      .on(table.agentId),
  })
);

export type MemoryBlockAttachment = typeof memoryBlockAttachments.$inferSelect;
export type NewMemoryBlockAttachment = typeof memoryBlockAttachments.$inferInsert;
```

**File:** `server/db/schema/index.ts`

Add exports after the `agentRunMessages` export (line ~104):

```typescript
// Sprint 5 -- P4.2 shared memory blocks (migration 0088)
export * from './memoryBlocks';
export * from './memoryBlockAttachments';
```

**File:** `server/config/rlsProtectedTables.ts`

Append to `RLS_PROTECTED_TABLES` array before the closing `]` (line ~128):

```typescript
  // 0088 -- Sprint 5 P4.2 shared memory blocks
  {
    tableName: 'memory_blocks',
    schemaFile: 'memoryBlocks.ts',
    policyMigration: '0088_memory_blocks.sql',
    rationale: 'Named memory blocks contain business context, brand voice, client-specific instructions.',
  },
  {
    tableName: 'memory_block_attachments',
    schemaFile: 'memoryBlockAttachments.ts',
    policyMigration: '0088_memory_blocks.sql',
    rationale: 'Agent-to-block links reveal which agents have access to which shared context.',
  },
```

### 5.3 Service

**File:** `server/services/memoryBlockService.ts` (NEW)

```typescript
export const memoryBlockService = {
  // CRUD operations
  async list(orgId: string, subaccountId?: string): Promise<MemoryBlock[]>;
  async get(orgId: string, blockId: string): Promise<MemoryBlock>;
  async create(orgId: string, data: {
    name: string;
    content: string;
    subaccountId?: string;
    ownerAgentId?: string;
    isReadOnly?: boolean;
  }): Promise<MemoryBlock>;
  async update(orgId: string, blockId: string, data: {
    name?: string;
    content?: string;
    isReadOnly?: boolean;
  }): Promise<MemoryBlock>;
  async softDelete(orgId: string, blockId: string): Promise<void>;

  // Attachment management
  async attach(orgId: string, blockId: string, agentId: string, permission: 'read' | 'read_write'): Promise<void>;
  async detach(orgId: string, blockId: string, agentId: string): Promise<void>;
  async getAttachmentsForAgent(orgId: string, agentId: string): Promise<Array<MemoryBlock & { permission: string }>>;

  // Runtime write (from agent skill)
  async updateBlockContent(
    orgId: string,
    blockName: string,
    agentId: string,
    newContent: string,
  ): Promise<void>;
  // Validates: agent has read_write attachment, agent is the owner,
  // block is not read-only. Throws failure('memory_block_permission_denied')
  // on any violation.
};
```

All queries scoped by `organisationId` and filtered by `isNull(memoryBlocks.deletedAt)`.

### 5.4 System prompt merge

**File:** `server/services/agentService.ts`

Extend `resolveSystemPrompt()` to merge attached memory blocks. After the existing `additionalPrompt` merge, add:

```typescript
// Merge shared memory blocks
const attachedBlocks = await memoryBlockService.getAttachmentsForAgent(orgId, agentId);
if (attachedBlocks.length > 0) {
  const blockSection = attachedBlocks
    .sort((a, b) => a.name.localeCompare(b.name))  // deterministic order
    .map(b => `### ${b.name}\n${b.content}`)
    .join('\n\n');
  systemPrompt += `\n\n## Shared Context\n\n${blockSection}`;
}
```

**File:** `server/services/middleware/types.ts`

Add ephemeral cache field to `MiddlewareContext`:

```typescript
  // Sprint 5 P4.2 -- cached memory blocks, rebuilt on resume from attachments.
  // ephemeral: recomputed on resume from memory_block_attachments, see Rule 6
  cachedMemoryBlocks?: Array<{ name: string; content: string; permission: string }>;
```

### 5.5 Skill: update_memory_block

**File:** `server/skills/update_memory_block.md` (NEW)

Standard skill definition. Gate level: `review` (writes shared context -- should require approval by default).

**File:** `server/config/actionRegistry.ts`

Add entry:

```typescript
update_memory_block: {
  actionType: 'update_memory_block',
  description: 'Update the content of a named shared memory block.',
  actionCategory: 'api',
  isExternal: false,
  defaultGateLevel: 'review',
  createsBoardTask: false,
  payloadFields: [],
  parameterSchema: z.object({
    blockName: z.string().describe('Name of the memory block to update.'),
    newContent: z.string().describe('The new content for the memory block.'),
  }),
  retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
  idempotencyStrategy: 'keyed_write',
  topics: ['workspace'],
},
```

**File:** `server/services/skillExecutor.ts`

Add handler case that calls `memoryBlockService.updateBlockContent(orgId, args.blockName, agentId, args.newContent)`.

### 5.6 Routes

**File:** `server/routes/memoryBlocks.ts` (NEW)

```typescript
// CRUD routes for memory blocks
// All require authenticate + requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT)

GET  /api/memory-blocks                     -- list blocks for org
POST /api/memory-blocks                     -- create block
GET  /api/memory-blocks/:id                 -- get block
PATCH /api/memory-blocks/:id                -- update block
DELETE /api/memory-blocks/:id               -- soft delete

POST /api/memory-blocks/:id/attach          -- attach to agent { agentId, permission }
DELETE /api/memory-blocks/:id/attach/:agentId  -- detach from agent

GET  /api/agents/:agentId/memory-blocks     -- list blocks attached to an agent
```

All routes use `asyncHandler`, `authenticate`, appropriate permission guards, and scope by `req.orgId`.

**File:** `server/index.ts`

Mount the new router.

### 5.7 Tests

- `server/services/__tests__/memoryBlockService.test.ts` -- permission checks (owner-only write, read-only enforcement, non-owner rejection).
- Verify `getAttachmentsForAgent` returns blocks in deterministic order.
- Verify soft delete hides blocks from all queries.

---

## 6. P4.3 Plan-then-execute

**Dependencies:** P3.1 (Sprint 4) for supervised-mode integration.

### 6.1 Migrations 0089 and 0090

**File:** `migrations/0089_agent_runs_plan.sql`

```sql
-- P4.3 -- Plan-then-execute for single-shot agent runs.
-- Stores the agent's emitted plan as structured JSON.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS plan_json jsonb;
```

**File:** `migrations/0090_agents_complexity_hint.sql`

```sql
-- P4.3 -- Per-agent complexity hint for plan-then-execute.
-- When set to 'complex', the agent emits a plan before executing.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS complexity_hint text
    CHECK (complexity_hint IN ('simple', 'complex'));
```

### 6.2 Pure helpers

**File:** `server/services/agentExecutionServicePure.ts`

Add two new exported functions:

```typescript
// ---------------------------------------------------------------------------
// Sprint 5 P4.3 -- plan-then-execute helpers
// ---------------------------------------------------------------------------

export interface AgentPlan {
  actions: Array<{
    tool: string;
    description: string;
    order: number;
  }>;
  reasoning?: string;
}

/**
 * Parse a planning response from the LLM. Expects a JSON object with
 * an `actions` array. Returns null if the response is not valid JSON
 * or doesn't match the expected shape.
 */
export function parsePlan(content: string): AgentPlan | null {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.actions)) return null;
    // Validate each action has at least tool + description
    for (const action of parsed.actions) {
      if (typeof action.tool !== 'string') return null;
    }
    return parsed as AgentPlan;
  } catch {
    return null;
  }
}

/**
 * Determine if a run should use the plan-then-execute pattern.
 * Returns true if any of the complexity signals are present.
 */
export function isComplexRun(params: {
  complexityHint?: string | null;
  userMessageWordCount: number;
  skillCount: number;
}): boolean {
  if (params.complexityHint === 'complex') return true;
  if (params.userMessageWordCount > 300) return true;
  if (params.skillCount > 15) return true;
  return false;
}
```

### 6.3 Planning prelude

**File:** `server/services/agentExecutionService.ts`

In `runAgenticLoop`, before the main iteration loop (before `iteration = 0`), add a planning prelude:

```typescript
// P4.3 -- planning prelude for complex runs
if (isComplexRun({
  complexityHint: agent.complexityHint,
  userMessageWordCount: countWords(lastUserMessage),
  skillCount: activeTools.length,
})) {
  // 1. Call LLM with a planning system prompt
  const planningPrompt = `Output a JSON plan describing the actions you intend to take. Do NOT execute any tools yet. Your response must be a JSON object with an "actions" array where each entry has "tool", "description", and "order" fields. Optionally include a "reasoning" field.`;

  // Inject planning instruction as a system reminder
  // Call LLM (no tools provided -- planning only)
  const planResponse = await routeCall({ ... messages with planning prompt, tools: [] });

  // 2. Parse the plan
  const plan = parsePlan(planResponse.content);
  if (plan) {
    // 3. Persist to agent_runs.plan_json
    await db.update(agentRuns)
      .set({ planJson: plan, updatedAt: new Date() })
      .where(eq(agentRuns.id, runId));

    // 4. Emit WebSocket event
    emitAgentRunPlan(runId, plan);

    // 5. If supervised playbook mode, pause for plan approval
    // (check if this run was triggered from a supervised-mode playbook)
    // Implementation: check run context for supervised flag

    // 6. Inject plan as system reminder for execution iterations
    messages.push({
      role: 'user',
      content: `Your approved plan:\n${JSON.stringify(plan, null, 2)}\n\nExecute this plan step by step. If a step fails and requires a different approach, explain why before deviating.`,
    });
  }
  // If plan parsing fails, proceed without a plan (graceful degradation)
}
```

**Replanning:** If a tool call fails during execution and the agent's response indicates a plan revision, detect the revised plan in the assistant response, call `parsePlan` again, and overwrite `plan_json`.

### 6.4 Supervised-mode integration

**File:** `server/services/playbookEngineService.ts`

In the `supervised` branch, after detecting that a step run has an associated agent run: if that agent run has a `plan_json`, route the plan through `playbookStepReviewService.requireApproval()` as a plan-approval item before letting the agent begin execution.

**File:** `server/services/playbookStepReviewService.ts`

Extend `requireApproval()` to accept a `reviewKind` parameter: `'step' | 'agent-run-plan'`. The review entry stores the kind so the UI can differentiate.

### 6.5 WebSocket event

**File:** `server/websocket/emitters.ts`

Add after the `emitAwaitingClarification` emitter:

```typescript
// -- Agent run plan events (Sprint 5 P4.3) ------------------------------------

export function emitAgentRunPlan(
  runId: string,
  plan: unknown
): void {
  emitToRoom(`agent-run:${runId}`, 'agent:run:plan', runId, {
    runId,
    plan,
  });
}
```

### 6.6 Schema changes

**File:** `server/db/schema/agentRuns.ts`

Add `planJson` column:

```typescript
    // Sprint 5 P4.3 -- plan-then-execute
    planJson: jsonb('plan_json'),
```

**File:** `server/db/schema/agents.ts`

Add `complexityHint` column after `regressionCaseCap` (line ~63):

```typescript
    // Sprint 5 P4.3 -- complexity hint for plan-then-execute
    complexityHint: text('complexity_hint').$type<'simple' | 'complex'>(),
```

### 6.7 Tests

- `server/services/__tests__/agentExecutionService.plan.test.ts` -- `parsePlan` with valid JSON, malformed JSON, missing actions array, empty plan
- `isComplexRun` -- boundary cases: exactly 300 words (not complex), 301 (complex), explicit hint overrides word count
- Manual test: run a complex agent, verify plan appears in `plan_json` and WebSocket event fires

---

## 7. P4.4 Semantic critique gate

**Dependencies:** P0.2 Slice B (Sprint 1, already shipped -- `requiresCritiqueGate` field exists on ActionDefinition).

### 7.1 postCall middleware phase

**File:** `server/services/middleware/types.ts`

Add a new middleware phase to the pipeline:

```typescript
export type PostCallResult =
  | { action: 'continue' }
  | { action: 'flag'; reason: string; verdict: 'ok' | 'suspect' };

export interface PostCallMiddleware {
  name: string;
  execute(
    ctx: MiddlewareContext,
    response: { content: string; toolCalls: Array<{ name: string; input: Record<string, unknown> }> },
  ): PostCallResult | Promise<PostCallResult>;
}

export interface MiddlewarePipeline {
  preCall: PreCallMiddleware[];
  preTool: PreToolMiddleware[];
  postTool: PostToolMiddleware[];
  postCall: PostCallMiddleware[];  // NEW -- after LLM responds, before tool execution
}
```

**IMPORTANT naming note:** The existing `PostToolResult` and `PostToolMiddleware` are for post-tool-execution. The new `PostCallResult` and `PostCallMiddleware` are for post-LLM-call, pre-tool-execution. These are distinct phases.

**File:** `server/services/agentExecutionService.ts`

In `runAgenticLoop`, after receiving the LLM response and before iterating over tool calls, run the `postCall` pipeline:

```typescript
// After: const response = await routeCall(...);
// Before: for (const toolCall of response.toolCalls) { ... }

for (const mw of pipeline.postCall) {
  const result = await mw.execute(ctx, {
    content: response.content,
    toolCalls: response.toolCalls,
  });
  if (result.action === 'flag') {
    // Shadow mode: log only, do not alter execution
    logger.info('critique_gate_flagged', {
      runId, verdict: result.verdict, reason: result.reason,
    });
  }
}
```

### 7.2 Critique gate middleware

**File:** `server/services/middleware/critiqueGatePure.ts` (NEW)

```typescript
/**
 * Parse the critique gate LLM response.
 * Expected format: { "verdict": "ok" | "suspect", "reason": "..." }
 */
export function parseCritiqueResult(
  content: string,
): { verdict: 'ok' | 'suspect'; reason: string } | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed.verdict === 'ok' || parsed.verdict === 'suspect') {
      return { verdict: parsed.verdict, reason: parsed.reason ?? '' };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the critique gate prompt for a single tool call.
 */
export function buildCritiquePrompt(
  toolName: string,
  toolArgs: Record<string, unknown>,
  lastMessages: Array<{ role: string; content: string }>,
): string {
  const context = lastMessages.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n');
  return `You are a critique gate. The agent is about to call a tool.
Tool: ${toolName}
Args: ${JSON.stringify(toolArgs)}
Context (last 3 messages):
${context}

Question: Is this tool call coherent with the user's request?
Answer with JSON: { "verdict": "ok" | "suspect", "reason": "..." }`;
}
```

**File:** `server/services/middleware/critiqueGate.ts` (NEW)

```typescript
import { CRITIQUE_GATE_SHADOW_MODE } from '../../config/limits.js';
import { ACTION_REGISTRY } from '../../config/actionRegistry.js';
import { parseCritiqueResult, buildCritiquePrompt } from './critiqueGatePure.js';

export const critiqueGateMiddleware: PostCallMiddleware = {
  name: 'critique_gate',
  async execute(ctx, response) {
    if (!CRITIQUE_GATE_SHADOW_MODE) return { action: 'continue' as const };

    for (const toolCall of response.toolCalls) {
      const actionDef = ACTION_REGISTRY[toolCall.name];
      if (!actionDef?.requiresCritiqueGate) continue;

      // Only fire on economy-tier responses (check ctx for routing info)
      // Build the critique prompt
      const prompt = buildCritiquePrompt(
        toolCall.name,
        toolCall.input,
        [], // extract last 3 messages from ctx
      );

      // Fire a flash-tier LLM call
      // const critiqueResponse = await routeCall({ model: 'flash', ... });
      // const result = parseCritiqueResult(critiqueResponse.content);

      // Write result to llmRequests.metadataJson.critique_gate_result
      // This is shadow mode -- no tool call blocking

      // if (result?.verdict === 'suspect') {
      //   return { action: 'flag', reason: result.reason, verdict: 'suspect' };
      // }
    }

    return { action: 'continue' as const };
  },
};
```

**Implementation note:** The critique middleware needs access to `routeCall` for the flash-tier LLM call. The cleanest approach: pass the router function through the middleware context or as a constructor parameter. Since the `critiqueGateMiddleware` is an impure service (makes LLM calls), it should receive the router via closure at pipeline construction time.

### 7.3 Action registry tags

**File:** `server/config/actionRegistry.ts`

Tag high-stakes actions with `requiresCritiqueGate: true`:

```typescript
// On send_email:
requiresCritiqueGate: true,
// On write_patch:
requiresCritiqueGate: true,
// On create_pr:
requiresCritiqueGate: true,
// On trigger_account_intervention:
requiresCritiqueGate: true,
```

### 7.4 Limits

**File:** `server/config/limits.ts`

Add at end:

```typescript
// -- Sprint 5 P4.4 -- Semantic critique gate (shadow mode) --------------------

/**
 * When true, the critique gate middleware logs disagreement data to
 * llmRequests.metadataJson but does NOT block or reroute tool calls.
 * Flip to false only after 2-4 weeks of shadow-mode data justifies
 * active mode. This is the one feature flag that survives the
 * pre-production simplification.
 */
export const CRITIQUE_GATE_SHADOW_MODE = true;
```

### 7.5 Tests

- `server/services/__tests__/critiqueGate.test.ts` -- test `parseCritiqueResult` with valid JSON, malformed, missing verdict, wrong verdict values.
- Test `buildCritiquePrompt` produces expected output structure.
- Test that middleware returns `continue` when `CRITIQUE_GATE_SHADOW_MODE` is false (should be a no-op).

**Gate:** `scripts/gates/verify-critique-gate-shadow-only.sh` (NEW)
- Asserts `CRITIQUE_GATE_SHADOW_MODE = true` in limits.ts.
- Asserts no callsite routes or blocks based on critique gate result (the middleware logs only).

---

## 8. Baseline cleanup pass

**Dependencies:** All Sprint 4+5 items should be complete before this pass.

The current `scripts/guard-baselines.json` has pre-existing violations:

```json
{
  "no-db-in-routes": 19,
  "async-handler": 1,
  "subaccount-resolution": 9,
  "org-scoped-writes": 44,
  "no-direct-role-checks": 10,
  "org-id-source": 3,
  "permission-scope": 15,
  "rate-limiting": 5,
  "input-validation": 39,
  "rls-contract-compliance": 31
}
```

The goal is to drive toward zero where feasible. For each baseline:

### 8.1 Actionable baselines (fix in this sprint)

1. **`async-handler: 1`** -- Find the one route missing asyncHandler and fix it. Should go to 0.

2. **`org-id-source: 3`** -- Three places using `req.user.organisationId` instead of `req.orgId`. Fix all three.

3. **`no-direct-role-checks: 10`** -- These are likely hardcoded role checks instead of using permission middleware. Audit each; fix straightforward ones.

### 8.2 Review-only baselines (document, don't fix)

4. **`no-db-in-routes: 19`** -- Each needs a service extraction. Too large for a cleanup pass. Document which routes and create follow-up tickets.

5. **`org-scoped-writes: 44`** -- Many are in services that use the org-scoping middleware. Some are legitimate (admin operations). Audit to confirm which are real violations vs suppression-worthy.

6. **`rls-contract-compliance: 31`** -- These are raw DB access patterns outside the ALS wrapper. Many exist in seed scripts, migration helpers, and admin tooling where they are correct. Audit and add suppression comments where appropriate.

7. **`input-validation: 39`** -- Missing Zod validation on route inputs. Too many to fix in a cleanup pass.

### 8.3 Procedure

1. Run `npm run test:gates` with `GUARD_BASELINE=true`.
2. For each actionable baseline, fix violations and reduce the count.
3. Run `scripts/update-guard-baselines.sh` to snapshot the new baselines.
4. Commit the updated `guard-baselines.json` with the fixes.

---

## 9. Sprint 4+5 gates and tests

### 9.1 New gate scripts

All new gates go in `scripts/gates/` and are wired into `scripts/run-all-gates.sh` at line 80 (after the Sprint 3 gates).

**Sprint 4 gates:**

| Gate | File | What it checks |
|------|------|----------------|
| `verify-playbook-run-mode-enforced.sh` | `scripts/gates/verify-playbook-run-mode-enforced.sh` | `playbookEngineService.ts` contains branching on `runMode` in the tick handler. Checks for `run.runMode` or `runMode` string in the file. |

**Sprint 5 gates:**

| Gate | File | What it checks |
|------|------|----------------|
| `verify-universal-skills-preserved.sh` | `scripts/gates/verify-universal-skills-preserved.sh` | No middleware directly mutates `activeTools` via `= activeTools.filter(` or `activeTools =` without calling `mutateActiveToolsPreservingUniversal`. Also asserts `SerialisableMiddlewareContext` has no `activeTools` field. |
| `verify-confidence-escape-hatch-wired.sh` | `scripts/gates/verify-confidence-escape-hatch-wired.sh` | The preTool middleware contains `MIN_TOOL_ACTION_CONFIDENCE`, limits.ts declares it, and `ask_clarifying_question` parameter schema includes `low_confidence` in the `blocked_by` enum. |
| `verify-critique-gate-shadow-only.sh` | `scripts/gates/verify-critique-gate-shadow-only.sh` | `CRITIQUE_GATE_SHADOW_MODE = true` in limits.ts. No code path blocks or reroutes based on critique result (grep for `verdict === 'suspect'` in branching context outside of logging). |

**Wire into `run-all-gates.sh`:**

At line 80 (after the Sprint 3 gates section), add:

```bash
# -- Sprint 4 (P3.1) gates from docs/improvements-roadmap-spec.md --
run_gate "$SCRIPT_DIR/verify-playbook-run-mode-enforced.sh"

# -- Sprint 5 (P4.1 + P4.4) gates from docs/improvements-roadmap-spec.md --
run_gate "$SCRIPT_DIR/verify-universal-skills-preserved.sh"
run_gate "$SCRIPT_DIR/verify-confidence-escape-hatch-wired.sh"
run_gate "$SCRIPT_DIR/verify-critique-gate-shadow-only.sh"
```

### 9.2 New unit tests

All tests follow the `*Pure.ts` + `*.test.ts` convention.

| Test file | Tests | Sprint |
|-----------|-------|--------|
| `server/services/__tests__/playbookEngine.runModes.test.ts` | 4 mode branches, bulk fan-out, idempotency | 4 |
| `server/services/__tests__/trajectoryService.test.ts` | 4 match modes, argMatchers, formatDiff | 4 |
| `server/services/__tests__/topicClassifier.test.ts` | Keyword classification, compound asks, confidence scoring | 5 |
| `server/services/__tests__/mutateActiveToolsPreservingUniversal.test.ts` | Universal skill re-injection, transform edge cases | 5 |
| `server/services/__tests__/askClarifyingQuestion.test.ts` | Status transitions, message append | 5 |
| `server/config/__tests__/universalSkills.test.ts` | Universal set correctness, merge with allowlist | 5 |
| `server/services/__tests__/agentExecutionService.plan.test.ts` | parsePlan, isComplexRun | 5 |
| `server/services/__tests__/critiqueGate.test.ts` | parseCritiqueResult, buildCritiquePrompt | 5 |
| `server/services/__tests__/memoryBlockService.test.ts` | Permission checks, soft delete | 5 |

### 9.3 Integration test I3

**File:** `server/services/__tests__/playbookBulk.parent-child-idempotency.test.ts` (NEW)

Ships with P3.1 in Sprint 4. Full test cases from the roadmap spec:

1. **Fan-out and synthesis.** 3 fake subaccounts, assert 3 children, synthesis waits.
2. **Child retry idempotency.** Force one child to fail, retry, assert exactly one completion.
3. **Parent retry idempotency.** Kill parent mid-dispatch, restart, assert no duplicate children.
4. **Concurrency cap.** `ghlConcurrencyCap = 2`, 5 targets, assert max 2 in-flight.
5. **Failure propagation.** One child fails non-retryably, parent completes as `partial`.

Uses existing tsx convention, `loadFixtures()` helper, LLM stub from P0.1.

### 9.4 Guard baselines

**File:** `scripts/guard-baselines.json`

After all Sprint 4+5 items ship, update with new gates:

```json
{
  "playbook-run-mode-enforced": 0,
  "universal-skills-preserved": 0,
  "confidence-escape-hatch-wired": 0,
  "critique-gate-shadow-only": 0
}
```

Run `scripts/update-guard-baselines.sh` to capture the final snapshot.

---

## 10. Build order and dependencies

### Dependency graph

```
P3.1 (playbook run modes)
  |
  +-> P3.2 (portfolio health bulk playbook)
  |     |
  |     +-> P3.3 (trajectory comparison) -- needs P3.2 for fixture 4
  |
  +-> P4.3 (plan-then-execute) -- needs supervised mode from P3.1

P4.1 (topics filter) -- needs P2.3 (Sprint 3, shipped)
P4.2 (shared memory blocks) -- independent
P4.4 (critique gate) -- needs P0.2 Slice B (Sprint 1, shipped)
```

### Recommended implementation order

**Sprint 4 (3 chunks, sequential):**

| Order | Chunk | Estimated scope | Files created | Files modified |
|-------|-------|-----------------|---------------|----------------|
| 1 | P3.1 -- Playbook run modes | Large | migration 0086, playbookStepReviewService.ts, playbookEngine.runModes.test.ts, playbookBulk integration test, verify-playbook-run-mode-enforced.sh | playbookRuns.ts (schema), playbookEngineService.ts, emitters.ts, playbookRuns.ts (route), playbookRunService.ts, run-all-gates.sh, guard-baselines.json |
| 2 | P3.2 -- Portfolio Health | Medium | migration 0087, seed-portfolio-health-playbook.ts, list_active_subaccounts.md | organisations.ts (schema), playbookEngineService.ts, actionRegistry.ts, skillExecutor.ts, package.json |
| 3 | P3.3 -- Trajectory comparison | Medium | trajectorySchema.ts, trajectoryServicePure.ts, trajectoryService.ts, run-trajectory-tests.ts, 5 reference JSON pairs, trajectoryService.test.ts | package.json |

**Sprint 5 (4 chunks, partially parallelizable):**

| Order | Chunk | Estimated scope | Can parallel with |
|-------|-------|-----------------|-------------------|
| 4 | P4.2 -- Shared memory blocks | Medium | P4.1, P4.3, P4.4 (independent) |
| 5 | P4.1 -- Topics filter | Large | P4.2 (after P4.2 if serializing, but independent paths) |
| 6 | P4.3 -- Plan-then-execute | Medium | P4.4 |
| 7 | P4.4 -- Critique gate | Small | P4.3 |
| 8 | Baseline cleanup | Small | None (last) |
| 9 | Gates + final tests | Small | None (last) |

### Per-chunk verification

After each chunk, run:

```bash
npm run lint
npm run typecheck
npm test          # gates + qa + unit + trajectories
npm run db:generate  # verify migration (for chunks with migrations)
```

### File inventory summary

**New files (Sprint 4+5 combined): 30+**

| Category | Files |
|----------|-------|
| Migrations | 0086, 0087, 0088, 0089, 0090 (5 files) |
| Schema | memoryBlocks.ts, memoryBlockAttachments.ts (2 files) |
| Services | playbookStepReviewService.ts, trajectoryServicePure.ts, trajectoryService.ts, topicClassifierPure.ts, topicClassifier.ts, memoryBlockService.ts (6 files) |
| Middleware | critiqueGatePure.ts, critiqueGate.ts (2 files) |
| Skills | list_active_subaccounts.md, ask_clarifying_question.md, update_memory_block.md (3 files) |
| Handlers | askClarifyingQuestion.ts (1 file) |
| Config | topicRegistry.ts (1 file) |
| Routes | memoryBlocks.ts (1 file) |
| Shared | trajectorySchema.ts (1 file) |
| Scripts | seed-portfolio-health-playbook.ts, run-trajectory-tests.ts (2 files) |
| Gates | 4 new verify-*.sh scripts |
| Tests | 9 new test files + 1 integration test + 5 trajectory reference pairs |

**Modified files: ~20**

| File | Chunks that touch it |
|------|---------------------|
| `server/db/schema/playbookRuns.ts` | P3.1 |
| `server/db/schema/organisations.ts` | P3.2 |
| `server/db/schema/agentRuns.ts` | P4.1, P4.3 |
| `server/db/schema/agents.ts` | P4.3 |
| `server/db/schema/index.ts` | P4.2 |
| `server/config/actionRegistry.ts` | P3.2, P4.1, P4.2, P4.4 |
| `server/config/limits.ts` | P4.1, P4.4 |
| `server/config/rlsProtectedTables.ts` | P4.2 |
| `server/config/jobConfig.ts` | P4.1 (add agent-run-resume job, deferred from Sprint 3B) |
| `server/services/playbookEngineService.ts` | P3.1, P3.2, P4.3 |
| `server/services/playbookRunService.ts` | P3.1 |
| `server/services/agentExecutionService.ts` | P4.1, P4.3, P4.4 |
| `server/services/agentExecutionServicePure.ts` | P4.1, P4.3 |
| `server/services/skillService.ts` | P4.1 |
| `server/services/skillExecutor.ts` | P4.1, P4.2 |
| `server/services/agentService.ts` | P4.2 |
| `server/services/middleware/types.ts` | P4.2, P4.4 |
| `server/websocket/emitters.ts` | P3.1, P4.1, P4.3 |
| `server/routes/agentRuns.ts` | P4.1 |
| `server/routes/playbookRuns.ts` | P3.1 |
| `server/index.ts` | P4.2 (mount memoryBlocks route) |
| `scripts/run-all-gates.sh` | Sprint 4+5 gates |
| `scripts/guard-baselines.json` | Baseline cleanup |
| `package.json` | P3.2, P3.3 |

### Critical risk items

1. **Playbook status CHECK constraint (P3.1):** Confirmed constraint name is `playbook_runs_status_chk` (from migration 0076 line 130). The migration 0086 DDL uses this name.

2. **Bulk fan-out concurrency (P3.1):** First time the engine creates N rows in one tick. Test with N=3 and N=50 to catch performance issues.

3. **preCall middleware active-tool mutation (P4.1):** Extending the PreCallMiddleware interface to support tool-set mutation is a design decision that affects the middleware contract. The recommended approach (adding `activeTools` to MiddlewareContext as ephemeral) must be validated against the `verify-middleware-state-serialised.sh` gate from Sprint 3.

4. **agent_runs status for `awaiting_clarification` (P4.1):** Confirmed: no CHECK constraint exists on agent_runs.status (it is a plain text column, typed only at the TypeScript level via `$type<>`). No migration needed for the status widening -- only the schema type union needs updating.

5. **Memory blocks RLS (P4.2):** The `memory_block_attachments` table needs `organisation_id` added for direct RLS (cannot do RLS via FK join). This is handled in migration 0088 but adds a denormalized column that must be kept in sync.

6. **postCall vs PostTool naming (P4.4):** The existing codebase uses `PostToolMiddleware` for the post-tool-execution phase. The new `PostCallMiddleware` is for post-LLM-call. The naming similarity could cause confusion. Use clear comments and distinct type names.
