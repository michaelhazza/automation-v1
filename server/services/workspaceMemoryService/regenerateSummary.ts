import { eq, and, desc, inArray, isNull, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import {
  workspaceMemories,
  workspaceMemoryEntries,
} from '../../db/schema/index.js';
import { routeCall } from '../llmRouter.js';
import { taskService } from '../taskService.js';
import { SUMMARY_MAX_TOKENS } from '../../config/limits.js';
import * as readMethods from './read.js';

// ---------------------------------------------------------------------------
// Build a compact board snapshot (pure data, no LLM call)
// ---------------------------------------------------------------------------

async function buildBoardSnapshot(organisationId: string, subaccountId: string): Promise<string | null> {
  const allTasks = await taskService.listTasks(organisationId, subaccountId, {});
  if (allTasks.length === 0) return null;

  const counts: Record<string, number> = {};
  const statusTasks: Record<string, string[]> = {};

  for (const t of allTasks) {
    const status = String(t.status);
    counts[status] = (counts[status] ?? 0) + 1;
    if (!statusTasks[status]) statusTasks[status] = [];
    if (statusTasks[status].length < 5) {
      statusTasks[status].push(
        `${t.title}${t.priority !== 'normal' ? ` [${t.priority}]` : ''}`
      );
    }
  }

  return Object.entries(statusTasks)
    .map(([status, titles]) => {
      const total = counts[status];
      const list = titles.map(t => `  - ${t}`).join('\n');
      return `**${status}** (${total}):\n${list}${total > 5 ? `\n  ... and ${total - 5} more` : ''}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Summary Regeneration (single LLM call for both memory + board)
// ---------------------------------------------------------------------------

export async function regenerateSummary(organisationId: string, subaccountId: string): Promise<void> {
  const memory = await readMethods.getOrCreateMemory(organisationId, subaccountId);

  // Load unincluded entries that meet the quality threshold
  const regenScopedDb = getOrgScopedDb('regenerateSummary.regenerateSummary');
  const newEntries = await regenScopedDb
    .select()
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        eq(workspaceMemoryEntries.includedInSummary, false),
        // §7 G6.2 / migration 0126 — archived Reference notes must not
        // feed the summary compiler.
        isNull(workspaceMemoryEntries.deletedAt),
        sql`(${workspaceMemoryEntries.qualityScore} IS NULL OR ${workspaceMemoryEntries.qualityScore} >= ${memory.qualityThreshold})`
      )
    )
    .orderBy(desc(workspaceMemoryEntries.createdAt));

  if (newEntries.length === 0 && memory.summary) return;

  // Build board state snapshot (no LLM call — just raw data)
  const boardSnapshot = await buildBoardSnapshot(organisationId, subaccountId);

  // Build combined input for a single LLM call
  const parts: string[] = [];
  if (memory.summary) {
    parts.push(`## Current Memory Summary\n${memory.summary}`);
  }
  if (newEntries.length > 0) {
    parts.push('\n## New Insights to Incorporate');
    for (const entry of newEntries) {
      parts.push(`- [${entry.entryType}] ${entry.content}`);
    }
  }
  if (boardSnapshot) {
    parts.push(`\n## Current Board State\n${boardSnapshot}`);
  }

  const response = await routeCall({
    system: `You are a workspace memory compiler. Produce TWO sections separated by the exact marker "---BOARD_SUMMARY---".

SECTION 1 (before the marker): Updated workspace memory document.
Rules:
- Keep under 500 words
- Organise by theme (client preferences, ongoing issues, key decisions, patterns)
- Remove outdated or superseded information
- Prioritise actionable information
- Write in present tense, factual statements
- Do NOT include meta-commentary

SECTION 2 (after the marker): Board summary in under 200 words.
Focus on: what's in progress, what's blocked, what's completed recently, what needs attention.
If no board state is provided, write "No board data available."

Respond with ONLY the two sections separated by ---BOARD_SUMMARY---.`,
    messages: [{ role: 'user', content: parts.join('\n') }],
    temperature: 0.3,
    maxTokens: SUMMARY_MAX_TOKENS,
    context: {
      organisationId,
      subaccountId,
      sourceType: 'system',
      taskType: 'memory_compile',
      routingMode: 'ceiling',
    },
  });

  // Parse the two sections from the single response
  const separator = '---BOARD_SUMMARY---';
  const separatorIdx = response.content.indexOf(separator);
  let memorySummary: string;
  let boardSummary: string | null;

  if (separatorIdx >= 0) {
    memorySummary = response.content.slice(0, separatorIdx).trim();
    boardSummary = response.content.slice(separatorIdx + separator.length).trim() || null;
  } else {
    // Fallback: treat entire response as memory summary
    memorySummary = response.content.trim();
    boardSummary = null;
  }

  // Update memory record
  await regenScopedDb
    .update(workspaceMemories)
    .set({
      summary: memorySummary,
      boardSummary,
      runsSinceSummary: 0,
      version: memory.version + 1,
      summaryGeneratedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workspaceMemories.id, memory.id));

  // Mark entries as included (batch update)
  if (newEntries.length > 0) {
    await regenScopedDb
      .update(workspaceMemoryEntries)
      .set({ includedInSummary: true })
      .where(inArray(workspaceMemoryEntries.id, newEntries.map(e => e.id)));
  }
}
