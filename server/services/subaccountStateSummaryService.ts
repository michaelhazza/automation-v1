/**
 * subaccountStateSummaryService — Phase 3B of Agent Intelligence Upgrade.
 *
 * Generates a structured text snapshot of a subaccount's operational state
 * using pure data assembly (no LLM calls). The summary includes task counts
 * by status, recent agent run stats, and high-signal workspace memory entries.
 * Results are cached in the `subaccount_state_summaries` table with a 4-hour
 * TTL.
 */

import { eq, and, sql, isNull, inArray, gte, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  subaccountStateSummaries,
  tasks,
  agentRuns,
  workspaceMemoryEntries,
} from '../db/schema/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours
const CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const subaccountStateSummaryService = {
  /**
   * Return the cached summary if it exists and is fresh (< 4 hours).
   * Otherwise regenerate, persist, and return.
   */
  async getOrGenerate(orgId: string, subaccountId: string): Promise<string | null> {
    const existing = await db
      .select()
      .from(subaccountStateSummaries)
      .where(
        and(
          eq(subaccountStateSummaries.organisationId, orgId),
          eq(subaccountStateSummaries.subaccountId, subaccountId),
        ),
      )
      .limit(1);

    const row = existing[0];
    if (row) {
      const age = Date.now() - new Date(row.generatedAt).getTime();
      if (age < STALE_THRESHOLD_MS) {
        return row.content;
      }
    }

    await this.regenerate(orgId, subaccountId);

    // Re-read after regeneration
    const refreshed = await db
      .select()
      .from(subaccountStateSummaries)
      .where(
        and(
          eq(subaccountStateSummaries.organisationId, orgId),
          eq(subaccountStateSummaries.subaccountId, subaccountId),
        ),
      )
      .limit(1);

    return refreshed[0]?.content ?? null;
  },

  /**
   * Regenerate the summary from live data and upsert into the DB.
   * Pure data assembly — no LLM calls.
   */
  async regenerate(orgId: string, subaccountId: string): Promise<void> {
    // 1. Task counts grouped by status
    const taskRows = await db
      .select({
        status: tasks.status,
        count: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, orgId),
          eq(tasks.subaccountId, subaccountId),
          isNull(tasks.deletedAt),
        ),
      )
      .groupBy(tasks.status);

    const taskCounts: Record<string, number> = {};
    let totalTasks = 0;
    for (const row of taskRows) {
      taskCounts[row.status] = row.count;
      totalTasks += row.count;
    }

    // 2. Agent run stats for last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const runRows = await db
      .select({
        status: agentRuns.status,
        count: sql<number>`count(*)::int`,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.organisationId, orgId),
          eq(agentRuns.subaccountId, subaccountId),
          gte(agentRuns.createdAt, sevenDaysAgo),
        ),
      )
      .groupBy(agentRuns.status);

    const agentRunStats: Record<string, number> = {};
    for (const row of runRows) {
      agentRunStats[row.status] = row.count;
    }

    const successCount = agentRunStats['completed'] ?? 0;
    const failedCount = agentRunStats['failed'] ?? 0;
    // Escalated approximated by awaiting_clarification status
    const escalatedCount = agentRunStats['awaiting_clarification'] ?? 0;

    // 3. Recent high-signal memory entries (issues + decisions, top 3 by quality_score)
    const memoryRows = await db
      .select({
        content: workspaceMemoryEntries.content,
        entryType: workspaceMemoryEntries.entryType,
        qualityScore: workspaceMemoryEntries.qualityScore,
      })
      .from(workspaceMemoryEntries)
      .where(
        and(
          eq(workspaceMemoryEntries.organisationId, orgId),
          eq(workspaceMemoryEntries.subaccountId, subaccountId),
          inArray(workspaceMemoryEntries.entryType, ['issue', 'decision']),
          gte(workspaceMemoryEntries.createdAt, sevenDaysAgo),
        ),
      )
      .orderBy(desc(workspaceMemoryEntries.qualityScore))
      .limit(3);

    // 4. Assemble structured text block
    const sections: string[] = ['## Current Subaccount State\n'];

    // Task overview
    sections.push('### Tasks');
    if (totalTasks === 0) {
      sections.push('No tasks recorded.\n');
    } else {
      const statusLines = Object.entries(taskCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([status, count]) => `- **${status}**: ${count}`);
      sections.push(`Total: ${totalTasks}\n${statusLines.join('\n')}\n`);
    }

    // Agent run overview (last 7 days)
    sections.push('### Agent Runs (Last 7 Days)');
    const totalRuns = Object.values(agentRunStats).reduce((a, b) => a + b, 0);
    if (totalRuns === 0) {
      sections.push('No agent runs in the last 7 days.\n');
    } else {
      sections.push(
        `Total: ${totalRuns} | Completed: ${successCount} | Failed: ${failedCount} | Escalated: ${escalatedCount}\n`,
      );
    }

    // Recent signals
    if (memoryRows.length > 0) {
      sections.push('### Recent Signals');
      for (const entry of memoryRows) {
        const truncatedContent = entry.content.length > 120
          ? entry.content.slice(0, 117) + '...'
          : entry.content;
        sections.push(`- [${entry.entryType}] ${truncatedContent}`);
      }
      sections.push('');
    }

    const content = sections.join('\n');
    const tokenCount = Math.ceil(content.length / CHARS_PER_TOKEN);

    // 5. Upsert to subaccount_state_summaries
    await db
      .insert(subaccountStateSummaries)
      .values({
        organisationId: orgId,
        subaccountId,
        content,
        tokenCount,
        taskCounts,
        agentRunStats,
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          subaccountStateSummaries.organisationId,
          subaccountStateSummaries.subaccountId,
        ],
        set: {
          content,
          tokenCount,
          taskCounts,
          agentRunStats,
          generatedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  },
};
