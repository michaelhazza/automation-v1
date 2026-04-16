# PR Review Hardening — Memory & Briefings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 7 must-fix / strong-recommendation items from the external code review of the memory-briefings branch.

**Architecture:** Single migration (0150) for all DB schema additions; service-layer changes consume the new columns; pure function additions follow the project's `*Pure.ts` pattern with tests. No new pages or routes.

**Tech Stack:** Drizzle ORM, PostgreSQL, TypeScript, Vitest (`npm test`), pg triggers via raw SQL in migration.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `migrations/0150_pr_review_hardening.sql` | Create | Single migration — all 7 items |
| `migrations/meta/_journal.json` | Modify | Register migration 0150 |
| `server/db/schema/workspaceMemories.ts` | Modify | 8 new columns on `workspaceMemoryEntries` |
| `server/db/schema/memoryBlocks.ts` | Modify | `activeVersionId` FK |
| `server/db/schema/memoryReviewQueue.ts` | Modify | `requiresClarification` boolean |
| `server/db/schema/dropZoneProcessingLog.ts` | Create | New append-only processing log table |
| `server/db/schema/index.ts` | Modify | Export `dropZoneProcessingLog` |
| `server/services/memoryEntryQualityService.ts` | Modify | Lifecycle timestamps + `qualityScoreUpdater` on all mutations |
| `server/services/workspaceMemoryService.ts` | Modify | Provenance on insert + `embeddingComputedAt` on embed write |
| `server/services/memoryBlockSynthesisService.ts` | Modify | Skip `isUnverified=true` entries |
| `server/services/memoryBlockVersionService.ts` | Modify | Set `activeVersionId` after writing version row |
| `server/services/deliveryServicePure.ts` | Modify | Add `resolveDeliveryEligibility()` |
| `server/services/clarificationService.ts` | Modify | Accept + persist `requiresClarification` |
| `server/services/dropZoneService.ts` | Modify | Write processing log steps on confirm |
| `server/services/__tests__/deliveryServicePure.test.ts` | Modify | Tests for `resolveDeliveryEligibility` |
| `server/services/__tests__/qualityScoreMutationBoundaryTest.ts` | Modify | Add migration 0150 to allowlist |

---

## Task 1: Migration 0150 — all schema additions in one file

**Files:**
- Create: `migrations/0150_pr_review_hardening.sql`
- Modify: `migrations/meta/_journal.json`

- [ ] **Step 1: Create the migration file**

Create `migrations/0150_pr_review_hardening.sql` with the full content below. The order matters: columns first, backfill second, trigger last (trigger reads `quality_score_updater` which must exist and be non-null before firing).

```sql
-- migrations/0150_pr_review_hardening.sql
-- Items 1–7: lifecycle timestamps, provenance columns, processing log,
-- clarification flag, active version pointer, quality_score trigger guard.
-- Single migration — no prior migrations from this branch have been applied.

-- ============================================================
-- Items 1 & 2 & 7: workspace_memory_entries additions
-- ============================================================
ALTER TABLE workspace_memory_entries
  ADD COLUMN embedding_computed_at  TIMESTAMPTZ,
  ADD COLUMN quality_computed_at    TIMESTAMPTZ,
  ADD COLUMN decay_computed_at      TIMESTAMPTZ,
  ADD COLUMN provenance_source_type TEXT
    CHECK (provenance_source_type IN
      ('agent_run','manual','playbook','drop_zone','synthesis')),
  ADD COLUMN provenance_source_id   UUID,
  ADD COLUMN provenance_confidence  REAL
    CHECK (provenance_confidence IS NULL
        OR (provenance_confidence >= 0 AND provenance_confidence <= 1)),
  ADD COLUMN is_unverified          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN quality_score_updater  TEXT
    CHECK (quality_score_updater IS NULL
        OR quality_score_updater IN
           ('initial_score','system_decay_job','system_utility_job'));

-- Backfill: tag all pre-existing rows so the trigger allows future job updates.
UPDATE workspace_memory_entries
   SET quality_score_updater = 'initial_score'
 WHERE quality_score_updater IS NULL;

-- ============================================================
-- Item 3: drop_zone_processing_log
-- ============================================================
CREATE TABLE drop_zone_processing_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_audit_id UUID        NOT NULL
    REFERENCES drop_zone_upload_audit(id) ON DELETE CASCADE,
  step            TEXT        NOT NULL
    CHECK (step IN ('parse','synthesize','index')),
  status          TEXT        NOT NULL
    CHECK (status IN ('started','completed','failed')),
  error_code      TEXT,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX drop_zone_processing_log_upload_idx
  ON drop_zone_processing_log(upload_audit_id, created_at);

-- ============================================================
-- Item 4: memory_review_queue — requires_clarification
-- ============================================================
ALTER TABLE memory_review_queue
  ADD COLUMN requires_clarification BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- Item 6: memory_blocks — active_version_id pointer
-- ============================================================
ALTER TABLE memory_blocks
  ADD COLUMN active_version_id UUID
    REFERENCES memory_block_versions(id) ON DELETE SET NULL;

CREATE INDEX memory_blocks_active_version_idx
  ON memory_blocks(active_version_id)
  WHERE active_version_id IS NOT NULL;

-- ============================================================
-- Item 7: quality_score trigger guard
-- Fires BEFORE UPDATE; raises if quality_score changes but
-- quality_score_updater is not an allowed value.
-- ============================================================
CREATE OR REPLACE FUNCTION check_quality_score_updater()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.quality_score IS DISTINCT FROM NEW.quality_score THEN
    IF NEW.quality_score_updater IS NULL
    OR NEW.quality_score_updater NOT IN
         ('initial_score','system_decay_job','system_utility_job')
    THEN
      RAISE EXCEPTION
        'quality_score update requires quality_score_updater '
        'to be initial_score, system_decay_job, or system_utility_job '
        '(got: %)',
        COALESCE(NEW.quality_score_updater, 'NULL');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quality_score_guard
  BEFORE UPDATE ON workspace_memory_entries
  FOR EACH ROW EXECUTE FUNCTION check_quality_score_updater();
```

- [ ] **Step 2: Register in Drizzle journal**

Open `migrations/meta/_journal.json`. Append to the `entries` array. Use the `idx` and `when` pattern of the existing last entry (0149). Set `idx: 150`, increment `when` by 1000, tag `"0150_pr_review_hardening"`:

```json
{
  "idx": 150,
  "version": "7",
  "when": <last_entry_when + 1000>,
  "tag": "0150_pr_review_hardening",
  "breakpoints": true
}
```

- [ ] **Step 3: Verify journal is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('migrations/meta/_journal.json','utf8')); console.log('valid')"
```

Expected: `valid`

---

## Task 2: Drizzle schema file updates

**Files:**
- Modify: `server/db/schema/workspaceMemories.ts`
- Modify: `server/db/schema/memoryBlocks.ts`
- Modify: `server/db/schema/memoryReviewQueue.ts`
- Create: `server/db/schema/dropZoneProcessingLog.ts`
- Modify: `server/db/schema/index.ts`

- [ ] **Step 1: Add 8 new columns to workspaceMemoryEntries**

In `server/db/schema/workspaceMemories.ts`, after `promotedFromEntryId` (the last column, line 135) and before the closing `},` of the column block, insert:

```typescript
    // PR Review Hardening — migration 0150 ————————————————————————————————

    // Item 1: lifecycle timestamps. Each async job sets its timestamp on every
    // row it touches so downstream jobs can verify ordering.
    // decayComputedAt: set by nightly decay job. Utility-adjust job checks IS NOT
    //   NULL before running — ensures decay always precedes utility adjustment.
    // qualityComputedAt: set by both decay and utility jobs when qualityScore changes.
    // embeddingComputedAt: set when the entry's embedding vector is written.
    embeddingComputedAt: timestamp('embedding_computed_at', { withTimezone: true }),
    qualityComputedAt:   timestamp('quality_computed_at',   { withTimezone: true }),
    decayComputedAt:     timestamp('decay_computed_at',     { withTimezone: true }),

    // Item 2: citation provenance at write boundary.
    // provenanceSourceType: who created this entry. NULL => isUnverified=true.
    // provenanceSourceId:   UUID of the specific run/upload/playbook.
    // provenanceConfidence: optional [0,1] confidence score.
    // isUnverified: true when no provenance supplied. High-trust paths
    //   (synthesis, utility-adjust) filter these out.
    provenanceSourceType: text('provenance_source_type')
      .$type<'agent_run' | 'manual' | 'playbook' | 'drop_zone' | 'synthesis'>(),
    provenanceSourceId:   uuid('provenance_source_id'),
    provenanceConfidence: real('provenance_confidence'),
    isUnverified:         boolean('is_unverified').notNull().default(false),

    // Item 7: DB-level qualityScore mutation guard.
    // Every UPDATE that changes qualityScore must also set this field to an
    // allowed value; the trigger in migration 0150 raises otherwise.
    qualityScoreUpdater: text('quality_score_updater')
      .$type<'initial_score' | 'system_decay_job' | 'system_utility_job'>(),
```

- [ ] **Step 2: Add activeVersionId to memoryBlocks**

In `server/db/schema/memoryBlocks.ts`, add the import for `memoryBlockVersions` after the existing `workspaceMemoryEntries` import:

```typescript
import { memoryBlockVersions } from './memoryBlockVersions';
```

Then add the column after `divergenceDetectedAt` and before `createdAt`:

```typescript
    // PR Review Hardening — Item 6: explicit canonical version pointer.
    // Set by memoryBlockVersionService.writeVersionRow() in the same transaction
    // as each content mutation. Eliminates "latest by timestamp" ambiguity.
    activeVersionId: uuid('active_version_id')
      .references(() => memoryBlockVersions.id, { onDelete: 'set null' }),
```

- [ ] **Step 3: Add requiresClarification to memoryReviewQueue**

In `server/db/schema/memoryReviewQueue.ts`, add after `createdAt` (before the closing `},`):

```typescript
    // PR Review Hardening — Item 4: clarification dependency flag.
    // When true the run that triggered this clarification must not have its
    // outputs used by synthesis if the clarification timed out.
    requiresClarification: boolean('requires_clarification').notNull().default(false),
```

- [ ] **Step 4: Create dropZoneProcessingLog schema**

Create `server/db/schema/dropZoneProcessingLog.ts`:

```typescript
import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { dropZoneUploadAudit } from './dropZoneUploadAudit';

/**
 * drop_zone_processing_log — append-only pipeline step audit (Item 3)
 *
 * One row per step per upload. Records whether each stage of the
 * parse → synthesize → index pipeline started, completed, or failed.
 * Enables answering "did this upload actually become memory?" and
 * "where in the pipeline did it fail?".
 *
 * Spec: docs/memory-and-briefings-spec.md §5.5 (S9) — PR Review Hardening
 */

export type DropZoneProcessingStep   = 'parse' | 'synthesize' | 'index';
export type DropZoneProcessingStatus = 'started' | 'completed' | 'failed';

export const dropZoneProcessingLog = pgTable(
  'drop_zone_processing_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    uploadAuditId: uuid('upload_audit_id')
      .notNull()
      .references(() => dropZoneUploadAudit.id, { onDelete: 'cascade' }),
    step:       text('step').notNull().$type<DropZoneProcessingStep>(),
    status:     text('status').notNull().$type<DropZoneProcessingStatus>(),
    /** Error code when status='failed'. */
    errorCode:  text('error_code'),
    /** Wall-clock ms for the step (null when status='started'). */
    durationMs: integer('duration_ms'),
    createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uploadIdx: index('drop_zone_processing_log_upload_idx').on(
      table.uploadAuditId,
      table.createdAt,
    ),
  }),
);

export type DropZoneProcessingLog    = typeof dropZoneProcessingLog.$inferSelect;
export type NewDropZoneProcessingLog = typeof dropZoneProcessingLog.$inferInsert;
```

- [ ] **Step 5: Export new table from schema index**

In `server/db/schema/index.ts`, after `export * from './dropZoneUploadAudit.js';`, add:

```typescript
export * from './dropZoneProcessingLog.js';
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

---

## Task 3: Lifecycle timestamps — ordering guarantee (Item 1)

**Files:**
- Modify: `server/services/memoryEntryQualityService.ts`
- Modify: `server/services/workspaceMemoryService.ts`

- [ ] **Step 1: Add isNotNull to import in memoryEntryQualityService**

In `server/services/memoryEntryQualityService.ts` line 19, add `isNotNull` to the drizzle import:

```typescript
import { eq, and, isNull, isNotNull, lt, inArray, sql } from 'drizzle-orm';
```

- [ ] **Step 2: Update applyDecay to set lifecycle timestamps**

In `server/services/memoryEntryQualityService.ts`, replace the `if (factor < 1.0)` block inside the batch loop (lines 85–91):

```typescript
// BEFORE:
        if (factor < 1.0) {
          const newScore = Math.max(0.1, currentScore * factor);
          await db
            .update(workspaceMemoryEntries)
            .set({ qualityScore: newScore })
            .where(eq(workspaceMemoryEntries.id, entry.id));
          decayed += 1;
        }
```

Replace with:

```typescript
        if (factor < 1.0) {
          const newScore = Math.max(0.1, currentScore * factor);
          await db
            .update(workspaceMemoryEntries)
            .set({
              qualityScore: newScore,
              qualityScoreUpdater: 'system_decay_job',
              qualityComputedAt: now,
              decayComputedAt: now,
            })
            .where(eq(workspaceMemoryEntries.id, entry.id));
          decayed += 1;
        } else {
          // Score unchanged — still stamp decayComputedAt so utility-adjust
          // job knows decay has run on this entry.
          await db
            .update(workspaceMemoryEntries)
            .set({ decayComputedAt: now })
            .where(eq(workspaceMemoryEntries.id, entry.id));
        }
```

- [ ] **Step 3: Update adjustFromUtility to guard on decayComputedAt and set timestamps**

In `server/services/memoryEntryQualityService.ts` `adjustFromUtility`, replace the `.where(and(...))` on the select query (around lines 230–236):

```typescript
    .where(
      and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
        // Ordering guard: only adjust entries that have had at least one
        // decay pass. Ensures decay always precedes utility adjustment.
        isNotNull(workspaceMemoryEntries.decayComputedAt),
        // Skip unverified entries — no provenance = no reliable utility signal.
        eq(workspaceMemoryEntries.isUnverified, false),
      ),
    );
```

Then replace the `.set({ qualityScore: decision.newScore })` call inside the loop (around line 252):

```typescript
      await db
        .update(workspaceMemoryEntries)
        .set({
          qualityScore: decision.newScore,
          qualityScoreUpdater: 'system_utility_job',
          qualityComputedAt: new Date(),
        })
        .where(eq(workspaceMemoryEntries.id, entry.id));
```

- [ ] **Step 4: Set embeddingComputedAt when embedding is written**

In `server/services/workspaceMemoryService.ts`, find the inline embedding SQL update (around line 810):

```typescript
              await db.execute(
                sql`UPDATE workspace_memory_entries SET embedding = ${formatVectorLiteral(embedding)}::vector WHERE id = ${entry.id}`
              );
```

Replace with:

```typescript
              await db.execute(
                sql`UPDATE workspace_memory_entries
                       SET embedding = ${formatVectorLiteral(embedding)}::vector,
                           embedding_computed_at = NOW()
                     WHERE id = ${entry.id}`
              );
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

---

## Task 4: Citation provenance enforcement at write boundary (Item 2)

**Files:**
- Modify: `server/services/workspaceMemoryService.ts`
- Modify: `server/services/memoryBlockSynthesisService.ts`

- [ ] **Step 1: Add provenance fields to entry insert values**

In `server/services/workspaceMemoryService.ts`, find the `baseValues` object construction (around lines 770–783). The object currently ends with `createdAt: new Date()`. Extend it with provenance fields:

```typescript
          return {
            organisationId,
            subaccountId,
            agentRunId: runId,
            agentId,
            content: e.content,
            entryType: e.entryType as EntryType,
            qualityScore: scoreMemoryEntry(e),
            taskSlug: taskSlug ?? null,
            domain,
            topic,
            createdAt: new Date(),
            // Citation provenance — Item 2 (PR Review Hardening)
            provenanceSourceType: runId ? ('agent_run' as const) : null,
            provenanceSourceId: runId ?? null,
            provenanceConfidence: null,
            isUnverified: !runId,
            qualityScoreUpdater: 'initial_score' as const,
          };
```

- [ ] **Step 2: Add qualityScoreUpdater to the dedup UPDATE path**

In `server/services/workspaceMemoryService.ts`, find the UPDATE op for dedup (around line 793):

```typescript
          await db.update(workspaceMemoryEntries)
            .set({ content: op.updatedContent, qualityScore: scoreMemoryEntry({ content: op.updatedContent, entryType: op.entryType }) })
            .where(eq(workspaceMemoryEntries.id, op.existingId));
```

Replace with:

```typescript
          await db.update(workspaceMemoryEntries)
            .set({
              content: op.updatedContent,
              qualityScore: scoreMemoryEntry({ content: op.updatedContent, entryType: op.entryType }),
              qualityScoreUpdater: 'initial_score',
            })
            .where(eq(workspaceMemoryEntries.id, op.existingId));
```

- [ ] **Step 3: Filter unverified entries from synthesis candidate scan**

In `server/services/memoryBlockSynthesisService.ts`, find the entry scan WHERE clause (around lines 120–125). Add `eq(workspaceMemoryEntries.isUnverified, false)` to the `and(...)`:

```typescript
      .where(
        and(
          eq(workspaceMemoryEntries.subaccountId, subaccountId),
          isNull(workspaceMemoryEntries.deletedAt),
          gt(workspaceMemoryEntries.qualityScore, 0.7),
          gt(workspaceMemoryEntries.citedCount, 2),
          // Provenance guard: do not synthesise from unverified entries.
          eq(workspaceMemoryEntries.isUnverified, false),
        ),
      )
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

---

## Task 5: Drop zone processing log (Item 3)

**Files:**
- Modify: `server/services/dropZoneService.ts`

- [ ] **Step 1: Add import for the new log table**

In `server/services/dropZoneService.ts`, update the schema import (currently importing `subaccounts` and `dropZoneUploadAudit`) to also import the new table and types:

```typescript
import {
  subaccounts,
  dropZoneUploadAudit,
  dropZoneProcessingLog,
  type DropZoneProcessingStep,
  type DropZoneProcessingStatus,
} from '../db/schema/index.js';
```

- [ ] **Step 2: Add logProcessingStep helper at the bottom of the file**

After the `getProposal` export (end of file), add:

```typescript
// ---------------------------------------------------------------------------
// logProcessingStep — append a pipeline step event for observability
// ---------------------------------------------------------------------------

/**
 * Append one row to drop_zone_processing_log for the given audit row.
 *
 * Call at the start and end of each pipeline stage (parse, synthesize, index)
 * so we can answer "did this upload actually become memory?" and
 * "where did it fail?". Non-fatal: a warning is logged on DB error so a
 * logging failure never blocks the actual pipeline work.
 */
export async function logProcessingStep(params: {
  auditId: string;
  step: DropZoneProcessingStep;
  status: DropZoneProcessingStatus;
  errorCode?: string;
  durationMs?: number;
}): Promise<void> {
  try {
    await db.insert(dropZoneProcessingLog).values({
      uploadAuditId: params.auditId,
      step: params.step,
      status: params.status,
      errorCode: params.errorCode ?? null,
      durationMs: params.durationMs ?? null,
    });
  } catch (err) {
    logger.warn('dropZoneService.logProcessingStep.failed', {
      auditId: params.auditId,
      step: params.step,
      status: params.status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [ ] **Step 3: Wire parse step events into confirm()**

In `confirm()`, after `auditRowId = row?.id ?? '';` (just before the end of the `db.transaction` callback), add:

```typescript
    auditRowId = row?.id ?? '';

    // Log parse step as started + completed. Deeper pipeline stages
    // (synthesize, index) add their own calls when implemented.
    // The scaffold log entries make the pipeline visible even while it is
    // being filled in — unanswered steps signal an incomplete pipeline.
    if (auditRowId) {
      await logProcessingStep({ auditId: auditRowId, step: 'parse', status: 'started' });
      await logProcessingStep({
        auditId: auditRowId,
        step: 'parse',
        status: 'completed',
        durationMs: 0,
      });
    }
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

---

## Task 6: Clarification dependency semantics (Item 4)

**Files:**
- Modify: `server/services/clarificationService.ts`
- Modify: `server/jobs/clarificationTimeoutJob.ts`

- [ ] **Step 1: Add requiresClarification to RequestClarificationInput**

In `server/services/clarificationService.ts`, find `RequestClarificationInput` (around line 42). Add the optional field after `suggestedAnswers`:

```typescript
  /**
   * When true, downstream synthesis must not use outputs from this run if the
   * clarification times out (hadUncertainty=true in runMetadata).
   * Defaults to false.
   */
  requiresClarification?: boolean;
```

- [ ] **Step 2: Persist requiresClarification to the queue row and payload**

In `server/services/clarificationService.ts`, find the `.values({` block for the `db.insert(memoryReviewQueue)` call (around lines 126–147). Add `requiresClarification` to both the `payload` object and as a top-level column:

In the `payload` object, after `routingConfigSnapshot: config,` add:
```typescript
        requiresClarification: input.requiresClarification ?? false,
```

After `expiresAt,` (the last top-level field, before the closing `}`), add:
```typescript
      requiresClarification: input.requiresClarification ?? false,
```

The final `.values({` block should look like:
```typescript
    .values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      itemType: 'clarification_pending',
      confidence: 0,
      status: 'pending',
      createdByAgentId: input.askingAgentId,
      expiresAt,
      payload: {
        question: input.question,
        contextSnippet: input.contextSnippet ?? null,
        urgency: input.urgency,
        suggestedAnswers: input.suggestedAnswers ?? [],
        recipientRole: resolved.role,
        recipientReason: resolved.reason,
        isClientDomain: resolved.isClientDomain,
        activeRunId: input.activeRunId,
        stepId: input.stepId ?? null,
        askingAgentId: input.askingAgentId,
        routingConfigSnapshot: config,
        requiresClarification: input.requiresClarification ?? false,
      },
      requiresClarification: input.requiresClarification ?? false,
    })
```

- [ ] **Step 3: Propagate requiresClarification in timeout metadata**

In `server/jobs/clarificationTimeoutJob.ts`, after `const urgency = (payload.urgency as string | null) ?? null;` (line 63), add:

```typescript
      const requiresClarification =
        (payload.requiresClarification as boolean | null) ?? false;
```

Then find the `clarificationTimeouts` array construction (around lines 95–101) and extend each entry object:

Replace:
```typescript
                  {
                    clarificationId: row.id,
                    timedOutAt: now.toISOString(),
                  },
```

With:
```typescript
                  {
                    clarificationId: row.id,
                    timedOutAt: now.toISOString(),
                    urgency,
                    requiresClarification,
                  },
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

---

## Task 7: Delivery eligibility resolver (Item 5)

**Files:**
- Modify: `server/services/deliveryServicePure.ts`
- Modify: `server/services/__tests__/deliveryServicePure.test.ts`

- [ ] **Step 1: Write failing tests**

In `server/services/__tests__/deliveryServicePure.test.ts`, add a new `describe` block (import `resolveDeliveryEligibility` at the top alongside the existing imports):

```typescript
import { resolveDeliveryEligibility } from '../deliveryServicePure.js';

describe('resolveDeliveryEligibility', () => {
  it('email is always eligible regardless of availability or config', () => {
    expect(
      resolveDeliveryEligibility(
        { email: false, portal: false, slack: false },
        { email: false, portal: false, slack: false },
      ).email,
    ).toBe(true);
  });

  it('portal requires both available and config enabled', () => {
    // available + config on → true
    expect(
      resolveDeliveryEligibility(
        { email: true, portal: true,  slack: false },
        { email: true, portal: true,  slack: false },
      ).portal,
    ).toBe(true);
    // not available → false even if config on
    expect(
      resolveDeliveryEligibility(
        { email: true, portal: false, slack: false },
        { email: true, portal: true,  slack: false },
      ).portal,
    ).toBe(false);
    // available but config off → false
    expect(
      resolveDeliveryEligibility(
        { email: true, portal: true,  slack: false },
        { email: true, portal: false, slack: false },
      ).portal,
    ).toBe(false);
  });

  it('slack requires both available and config enabled', () => {
    expect(
      resolveDeliveryEligibility(
        { email: true, portal: false, slack: true },
        { email: true, portal: false, slack: true },
      ).slack,
    ).toBe(true);
    expect(
      resolveDeliveryEligibility(
        { email: true, portal: false, slack: false },
        { email: true, portal: false, slack: true },
      ).slack,
    ).toBe(false);
  });
});
```

Run: `npm test -- deliveryServicePure`

Expected: FAIL — `resolveDeliveryEligibility is not a function`.

- [ ] **Step 2: Implement resolveDeliveryEligibility**

In `server/services/deliveryServicePure.ts`, add after the `shouldDispatchChannel` export (after line 123):

```typescript
// ---------------------------------------------------------------------------
// Eligibility resolver — single source of truth for final channel set
// ---------------------------------------------------------------------------

/**
 * Combine channel *availability* (from DB/integrations) with user *config*
 * (per-subaccount delivery preferences) to return the final set of enabled
 * channels for a delivery run.
 *
 * Rules:
 *   email  — always true (always-on inbox invariant §10.5)
 *   portal — true only when available.portal AND config.portal
 *   slack  — true only when available.slack AND config.slack
 *
 * All callers (routes, backend validation, execution layer) must use this
 * function — no caller should re-implement the logic. PR Review Item 5.
 */
export function resolveDeliveryEligibility(
  available: DeliveryChannelConfig,
  config: DeliveryChannelConfig,
): DeliveryChannelConfig {
  return {
    email:  true,
    portal: available.portal && config.portal,
    slack:  available.slack  && config.slack,
  };
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- deliveryServicePure
```

Expected: all tests PASS.

---

## Task 8: Active version pointer (Item 6)

**Files:**
- Modify: `server/services/memoryBlockVersionService.ts`

- [ ] **Step 1: Update writeVersionRow to set activeVersionId on the block**

In `server/services/memoryBlockVersionService.ts`, find the `writeVersionRow` function. After the `.insert(memoryBlockVersions)...returning()` call (line ~88) and before `return inserted ?? null;`, insert the block update:

```typescript
  const [inserted] = await dbh
    .insert(memoryBlockVersions)
    .values({
      memoryBlockId: params.blockId,
      content: params.content,
      version: nextVersion,
      createdByUserId: params.actorUserId ?? null,
      changeSource: params.changeSource,
      notes: params.notes,
    })
    .returning();

  if (inserted) {
    // Keep activeVersionId in sync. All callers (memoryBlockService content
    // mutations, resetToCanonical) share this path so the pointer is always
    // authoritative — no caller needs to resolve "latest by timestamp".
    await dbh
      .update(memoryBlocks)
      .set({ activeVersionId: inserted.id })
      .where(eq(memoryBlocks.id, params.blockId));
  }

  return inserted ?? null;
```

(This replaces just the final `return inserted ?? null;` line — insert the `if (inserted) { ... }` block before it.)

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

---

## Task 9: Update qualityScoreMutationBoundaryTest (Item 7 follow-through)

**Files:**
- Modify: `server/services/__tests__/qualityScoreMutationBoundaryTest.ts`

- [ ] **Step 1: Read the allowlist in the boundary test**

Open `server/services/__tests__/qualityScoreMutationBoundaryTest.ts` and find the `ALLOWED_WRITER_PATHS` set. Note what's already there.

- [ ] **Step 2: Add migration 0150 and schema file to allowlist**

Add two entries to the `ALLOWED_WRITER_PATHS` set:

```typescript
  // Migration 0150 declares the quality_score_updater column, backfill, and trigger.
  'migrations/0150_pr_review_hardening.sql',
  // Schema file declares the qualityScoreUpdater column type.
  'server/db/schema/workspaceMemories.ts',
```

- [ ] **Step 3: Run the boundary test**

```bash
npx tsx server/services/__tests__/qualityScoreMutationBoundaryTest.ts
```

Expected: exits cleanly with no violations reported.

---

## Task 10: Final verification

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: zero errors. Fix any before proceeding.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Boundary test**

```bash
npx tsx server/services/__tests__/qualityScoreMutationBoundaryTest.ts
```

Expected: exits cleanly.

- [ ] **Step 5: Commit**

```bash
git add \
  migrations/0150_pr_review_hardening.sql \
  migrations/meta/_journal.json \
  server/db/schema/workspaceMemories.ts \
  server/db/schema/memoryBlocks.ts \
  server/db/schema/memoryReviewQueue.ts \
  server/db/schema/dropZoneProcessingLog.ts \
  server/db/schema/index.ts \
  server/services/memoryEntryQualityService.ts \
  server/services/workspaceMemoryService.ts \
  server/services/memoryBlockSynthesisService.ts \
  server/services/memoryBlockVersionService.ts \
  server/services/deliveryServicePure.ts \
  server/services/clarificationService.ts \
  server/services/dropZoneService.ts \
  server/services/__tests__/deliveryServicePure.test.ts \
  server/services/__tests__/qualityScoreMutationBoundaryTest.ts

git commit -m "fix(memory-briefings): PR review hardening — lifecycle timestamps, provenance enforcement, delivery resolver, version pointer, trigger guard"
```

---

## Self-Review Notes

- All 7 review items are addressed across Tasks 1–9.
- Single migration 0150 contains all schema additions. The SQL order is correct: columns first, backfill second, trigger last (trigger reads `quality_score_updater` which must be non-null before firing).
- The trigger backfill (`UPDATE workspace_memory_entries SET quality_score_updater = 'initial_score'`) tags all pre-existing rows so the decay job's first post-migration run does not trip the trigger.
- `resolveDeliveryEligibility` is pure and fully tested.
- `activeVersionId` is set inside `writeVersionRow` so all existing callers (`resetToCanonical`, every content mutation via `memoryBlockService`) automatically maintain the pointer with no additional changes.
- Drop zone processing log scaffold writes `parse: started → completed` on `confirm()`. Downstream parse/synthesize/index stages call `logProcessingStep` as they are implemented.
- `requiresClarification` propagates through the clarification queue row and into `run.runMetadata.clarificationTimeouts[]` so synthesis jobs can inspect it when deciding whether to trust run outputs.
- Tasks 3–9 are independent after Task 2 lands the schema types, so they can be executed in any order if parallelised via subagents.
