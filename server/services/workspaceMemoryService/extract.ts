import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workspaceMemories, workspaceMemoryEntries } from '../../db/schema/index.js';
import { routeCall } from '../llmRouter.js';
import { createSpan } from '../../lib/tracing.js';
import {
  EXTRACTION_MAX_TOKENS,
  VALID_ENTRY_TYPES,
  type EntryType,
} from '../../config/limits.js';
import {
  applyOutcomeDefaults,
  scoreForOutcome,
  selectPromotedEntryType,
  type RunOutcome,
} from '../workspaceMemoryServicePure.js';
import {
  classifyDomainTopic,
  type ExtractRunInsightsOptions,
} from './types.js';
import { scoreMemoryEntry } from './quality.js';
import * as readMethods from './read.js';

// ---------------------------------------------------------------------------
// pgBoss callback — module-level state; moves to enrichmentJob.ts in W4.
// setContextEnrichmentJobSender in the barrel delegates to this setter.
// ---------------------------------------------------------------------------

let pgBossSendCallback: ((queue: string, data: unknown, options?: Record<string, unknown>) => Promise<void>) | null = null;

export function setExtractPgBossCallback(fn: typeof pgBossSendCallback): void {
  pgBossSendCallback = fn;
}

// ---------------------------------------------------------------------------
// Wrappers that resolve barrel exports via dynamic import to avoid the
// circular dependency that would arise from a static import of the barrel
// (which spreads this module). Both reembedEntry and regenerateSummary remain
// in the barrel until W4 when they move to their own sub-modules.
// ---------------------------------------------------------------------------

async function callReembedEntry(params: { id: string; content: string; resetContext: boolean }): Promise<boolean> {
  const { reembedEntry } = await import('../workspaceMemoryService.js');
  return reembedEntry(params);
}

async function callRegenerateSummary(organisationId: string, subaccountId: string): Promise<void> {
  const { workspaceMemoryService } = await import('../workspaceMemoryService.js');
  await workspaceMemoryService.regenerateSummary(organisationId, subaccountId);
}

// ---------------------------------------------------------------------------
// Mem0 dedup loop — private to this module; moves to dedup.ts in W4
// ---------------------------------------------------------------------------

interface DedupeEntry {
  content: string;
  entryType: string;
  op: 'ADD' | 'UPDATE' | 'DELETE';
  existingId?: string;
  updatedContent?: string;
}

const DEDUP_SYSTEM = `You are a memory deduplication assistant.
Given new facts and existing facts, classify each new fact as ADD, UPDATE, or DELETE.
- ADD: new information not in existing facts
- UPDATE: amends an existing fact (provide existing_id and updated_fact)
- DELETE: makes an existing fact wrong or obsolete (provide existing_id)

Output ONLY valid JSON: { "ops": [{ "type": "ADD"|"UPDATE"|"DELETE", "fact": "...", "existing_id"?: "uuid", "updated_fact"?: "..." }] }
If all are new: { "ops": [{ "type": "ADD", "fact": "..." }, ...] }`;

async function deduplicateEntries(
  newEntries: Array<{ content: string; entryType: string }>,
  subaccountId: string,
  taskSlug: string | null,
  organisationId: string,
  runId: string,
): Promise<DedupeEntry[]> {
  if (newEntries.length === 0) return [];

  // Load recent candidate entries for comparison (top 20 by recency).
  // §7 G6.2 — skip archived Reference notes so dedup does not re-surface
  // content that the user intentionally removed from the workspace.
  const taskFilter = taskSlug
    ? and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
        sql`(task_slug = ${taskSlug} OR task_slug IS NULL)`,
      )
    : and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
      );

  const candidates = await db
    .select({ id: workspaceMemoryEntries.id, content: workspaceMemoryEntries.content })
    .from(workspaceMemoryEntries)
    .where(taskFilter)
    .orderBy(desc(workspaceMemoryEntries.createdAt))
    .limit(20);

  // If no existing entries, all are ADD — skip LLM call
  if (candidates.length === 0) {
    return newEntries.map(e => ({ ...e, op: 'ADD' as const }));
  }

  try {
    const response = await routeCall({
      system: DEDUP_SYSTEM,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          new_facts: newEntries.map(e => ({ content: e.content, type: e.entryType })),
          existing_facts: candidates.map(c => ({ id: c.id, fact: c.content })),
        }),
      }],
      maxTokens: 1024,
      temperature: 0.1,
      context: {
        organisationId,
        subaccountId,
        runId,
        sourceType: 'agent_run',
        taskType: 'memory_compile',
        executionPhase: 'execution',
        routingMode: 'ceiling',
      },
    });

    const parsed = JSON.parse(response.content) as {
      ops: Array<{ type: 'ADD' | 'UPDATE' | 'DELETE'; fact?: string; existing_id?: string; updated_fact?: string }>;
    };

    const result: DedupeEntry[] = [];
    const opsLimit = Math.min(parsed.ops.length, newEntries.length);
    for (let i = 0; i < opsLimit; i++) {
      const op = parsed.ops[i];
      const source = newEntries[i];
      result.push({
        content: op.fact ?? source.content,
        entryType: source.entryType,
        op: op.type,
        existingId: op.existing_id,
        updatedContent: op.updated_fact,
      });
    }
    return result;
  } catch {
    // Dedup failed — fall through to ADD all (safe degradation)
    return newEntries.map(e => ({ ...e, op: 'ADD' as const }));
  }
}

// ---------------------------------------------------------------------------
// Post-Run Extraction
// ---------------------------------------------------------------------------

export async function extractRunInsights(
  runId: string,
  agentId: string,
  organisationId: string,
  subaccountId: string,
  runSummary: string,
  outcome: RunOutcome,
  options?: ExtractRunInsightsOptions,
): Promise<void> {
  const taskSlug = options?.taskSlug;
  const overrides = options?.overrides;
  if (!runSummary || runSummary.trim().length < 20) return;

  // Hermes Tier 1 Phase B §6.8 — short-summary guard on failed runs.
  // Skip extraction when a failed run carries no meaningful signal
  // (both structured error absent AND summary below 100 chars).
  const hasStructuredError = Boolean(outcome.errorMessage && outcome.errorMessage.length > 0);
  const hasMeaningfulSummary = runSummary.trim().length >= 100;
  if (
    outcome.runResultStatus === 'failed'
    && !hasStructuredError
    && !hasMeaningfulSummary
  ) {
    return;
  }

  const insightsSpan = createSpan('memory.insights.extract', { runId, criticalPath: false });

  try {
    const callFn = options?._routeCall ?? routeCall;
    const response = await callFn({
      messages: [{ role: 'user', content: `Agent run summary:\n\n${runSummary}` }],
      system: `You are an insight extractor. Given an agent run summary, extract key insights as a JSON array.
Each entry has "content" (string) and "entryType" (one of: "observation", "decision", "preference", "issue", "pattern").
Focus on: client preferences, recurring patterns, important decisions, issues discovered, and anything future agents should know.
Respond with ONLY valid JSON: { "entries": [...] }
If there are no meaningful insights, respond with: { "entries": [] }`,
      temperature: 0.3,
      maxTokens: EXTRACTION_MAX_TOKENS,
      context: {
        organisationId,
        subaccountId,
        runId,
        sourceType: 'agent_run',
        agentName: agentId,
        taskType: 'memory_compile',
        executionPhase: 'execution',
        routingMode: 'ceiling',
      },
    });

    let entries: Array<{ content: string; entryType: string }> = [];
    try {
      const parsed = JSON.parse(response.content);
      entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      const match = response.content.match(/\{[\s\S]*"entries"[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      }
    }

    if (entries.length === 0) {
      insightsSpan.end({ output: { insightsExtracted: 0 } });
      return;
    }

    const memory = await readMethods.getOrCreateMemory(organisationId, subaccountId);
    const threshold = memory.qualityThreshold;

    // ── Mem0 dedup loop ───────────────────────────────────────────────────
    // Compare new entries against recent existing entries and classify as
    // ADD, UPDATE, or DELETE before persisting. Runs async after return.
    const validEntries = entries.filter(
      e => e.content && (VALID_ENTRY_TYPES as readonly string[]).includes(e.entryType)
    );

    const dedupedEntries = await deduplicateEntries(
      validEntries,
      subaccountId,
      taskSlug ?? null,
      organisationId,
      runId,
    );

    // Hermes Tier 1 Phase B §6.5 / §6.7 — apply outcome-driven
    // promotion/demotion + quality modifier + provenance confidence
    // via the pure helpers. Overrides from the caller (see §6.7.1)
    // replace defaults field-by-field; omitted fields fall through.
    const resolvedDefaults = applyOutcomeDefaults(outcome, overrides);
    let promotedCount = 0;
    const baseValues = dedupedEntries
      .filter(e => e.op === 'ADD')
      .map(e => {
        const rawEntryType = e.entryType as EntryType;
        const finalEntryType = selectPromotedEntryType(rawEntryType, outcome);
        if (finalEntryType !== rawEntryType) promotedCount += 1;
        const baseline = scoreMemoryEntry({ content: e.content, entryType: finalEntryType });
        const finalScore = scoreForOutcome(baseline, finalEntryType, outcome);
        // Phase 2C: auto-classify domain + topic at write time
        const { domain, topic } = classifyDomainTopic(e.content);
        return {
          organisationId,
          subaccountId,
          agentRunId: runId,
          agentId,
          content: e.content,
          entryType: finalEntryType,
          qualityScore: finalScore,
          taskSlug: taskSlug ?? null,
          domain,
          topic,
          createdAt: new Date(),
          // Citation provenance — PR Review Hardening Item 2
          provenanceSourceType: runId ? ('agent_run' as const) : null,
          provenanceSourceId: runId ?? null,
          provenanceConfidence: resolvedDefaults.provenanceConfidence,
          isUnverified:         resolvedDefaults.isUnverified,
          qualityScoreUpdater: 'initial_score' as const,
        };
      });

    // Apply UPDATE and DELETE ops. Track UPDATE targets so we can
    // re-embed them — content has changed, so the existing embedding
    // (and its embedding_content_hash) is now stale (review §2.1).
    const reembedTargets: Array<{ id: string; content: string }> = [];
    for (const op of dedupedEntries.filter(e => e.op === 'UPDATE' || e.op === 'DELETE')) {
      if (!op.existingId) continue;
      if (op.op === 'DELETE') {
        await db.delete(workspaceMemoryEntries)
          .where(eq(workspaceMemoryEntries.id, op.existingId));
      } else if (op.op === 'UPDATE' && op.updatedContent) {
        await db.update(workspaceMemoryEntries)
          .set({
            content: op.updatedContent,
            qualityScore: scoreMemoryEntry({ content: op.updatedContent, entryType: op.entryType }),
            // 'initial_score' is the closest available value — no 'dedup_update'
            // variant exists. Required so the quality_score_guard trigger passes.
            qualityScoreUpdater: 'initial_score',
          })
          .where(eq(workspaceMemoryEntries.id, op.existingId));
        reembedTargets.push({ id: op.existingId, content: op.updatedContent });
      }
    }

    // Fire-and-forget re-embed of updated entries so vector search reflects
    // the new content. Process-local dedup inside reembedEntry collapses
    // bursts (review §3.2). Failures are non-fatal — the partial index will
    // resurface stale entries on the next ops sweep.
    if (reembedTargets.length > 0) {
      Promise.all(
        reembedTargets.map((target) =>
          callReembedEntry({ id: target.id, content: target.content, resetContext: true })
        )
      ).catch((err) => console.error('[WorkspaceMemory] Failed to re-embed updated entries:', err));
    }

    const values = baseValues;

    if (values.length > 0) {
      const inserted = await db.insert(workspaceMemoryEntries).values(values).returning();

      // Phase 1: Generate content-only embeddings immediately (searchable
      // right away). reembedEntry handles hash stamping + in-flight dedup.
      Promise.all(
        inserted.map((entry) =>
          callReembedEntry({ id: entry.id, content: entry.content, resetContext: false })
        )
      ).catch((err) => console.error('[WorkspaceMemory] Failed to generate embeddings:', err));

      // Phase 2: Enqueue async context enrichment job (B1)
      // This generates contextual prefixes and re-embeds with richer context
      if (pgBossSendCallback) {
        const entryIds = inserted.map(e => e.id);
        const jobKey = `ctx-enrich:${entryIds.sort().join(',')}`;
        pgBossSendCallback('memory-context-enrichment', {
          entryIds,
          runSummary,
          agentName: agentId,
          taskTitle: taskSlug ?? null,
          organisationId,
          subaccountId,
        }, { singletonKey: jobKey }).catch((err) =>
          console.error('[WorkspaceMemory] Failed to enqueue context enrichment:', err)
        );
      }
    }

    console.info(`[WorkspaceMemory] Extracted ${values.length} entries (${values.filter(v => (v.qualityScore ?? 0) >= threshold).length} above threshold) for subaccount ${subaccountId}`);

    // Hermes Tier 1 Phase B §8.5 — structured log for post-hoc audit of
    // outcome-driven promotion. Written once per extraction call.
    console.info('[WorkspaceMemory] memory.insights.outcome_applied', {
      runId,
      runResultStatus:  outcome.runResultStatus,
      trajectoryPassed: outcome.trajectoryPassed,
      entriesWritten:   values.length,
      entriesDropped:   Math.max(0, entries.length - values.length),
      promotedCount,
    });

    insightsSpan.end({ output: { insightsExtracted: values.length } });

    // Increment run counter and check if we need to regenerate
    const newCount = memory.runsSinceSummary + 1;

    if (newCount >= memory.summaryThreshold) {
      await callRegenerateSummary(organisationId, subaccountId);
    } else {
      await db
        .update(workspaceMemories)
        .set({ runsSinceSummary: newCount, updatedAt: new Date() })
        .where(eq(workspaceMemories.id, memory.id));
    }
  } catch (err) {
    insightsSpan.end({ output: { error: err instanceof Error ? err.message : String(err) } });
    console.error('[WorkspaceMemory] Failed to extract insights:', err instanceof Error ? err.message : err);
  }
}
