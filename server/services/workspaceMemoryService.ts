import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  workspaceMemories,
  workspaceMemoryEntries,
  tasks,
} from '../db/schema/index.js';
import { callAnthropic, approxTokens } from './llmService.js';
import { taskService } from './taskService.js';

// ---------------------------------------------------------------------------
// Workspace Memory Service — shared memory across agents in a workspace
// ---------------------------------------------------------------------------

const EXTRACTION_MODEL = 'claude-sonnet-4-6';

export const workspaceMemoryService = {
  // ─── Read ──────────────────────────────────────────────────────────────────

  async getMemory(organisationId: string, subaccountId: string) {
    const [memory] = await db
      .select()
      .from(workspaceMemories)
      .where(
        and(
          eq(workspaceMemories.organisationId, organisationId),
          eq(workspaceMemories.subaccountId, subaccountId)
        )
      );
    return memory ?? null;
  },

  async getOrCreateMemory(organisationId: string, subaccountId: string) {
    const existing = await this.getMemory(organisationId, subaccountId);
    if (existing) return existing;

    const [created] = await db
      .insert(workspaceMemories)
      .values({
        organisationId,
        subaccountId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return created;
  },

  async listEntries(
    subaccountId: string,
    opts?: { limit?: number; offset?: number; includedInSummary?: boolean }
  ) {
    const conditions = [eq(workspaceMemoryEntries.subaccountId, subaccountId)];
    if (opts?.includedInSummary !== undefined) {
      conditions.push(eq(workspaceMemoryEntries.includedInSummary, opts.includedInSummary));
    }

    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    return db
      .select()
      .from(workspaceMemoryEntries)
      .where(and(...conditions))
      .orderBy(desc(workspaceMemoryEntries.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async deleteEntry(entryId: string, organisationId: string, subaccountId: string) {
    const [deleted] = await db
      .delete(workspaceMemoryEntries)
      .where(
        and(
          eq(workspaceMemoryEntries.id, entryId),
          eq(workspaceMemoryEntries.organisationId, organisationId),
          eq(workspaceMemoryEntries.subaccountId, subaccountId)
        )
      )
      .returning();
    return deleted ?? null;
  },

  // ─── Write / Update ────────────────────────────────────────────────────────

  async updateSummary(organisationId: string, subaccountId: string, summary: string) {
    const memory = await this.getOrCreateMemory(organisationId, subaccountId);
    const [updated] = await db
      .update(workspaceMemories)
      .set({ summary, updatedAt: new Date() })
      .where(eq(workspaceMemories.id, memory.id))
      .returning();
    return updated;
  },

  // ─── Post-Run Extraction ───────────────────────────────────────────────────

  async extractRunInsights(
    runId: string,
    agentId: string,
    organisationId: string,
    subaccountId: string,
    runSummary: string
  ): Promise<void> {
    if (!runSummary || runSummary.trim().length < 20) return;

    try {
      const response = await callAnthropic({
        modelId: EXTRACTION_MODEL,
        systemPrompt: `You are an insight extractor. Given an agent run summary, extract key insights as a JSON array.
Each entry has "content" (string) and "entryType" (one of: "observation", "decision", "preference", "issue", "pattern").
Focus on: client preferences, recurring patterns, important decisions, issues discovered, and anything future agents should know.
Respond with ONLY valid JSON: { "entries": [...] }
If there are no meaningful insights, respond with: { "entries": [] }`,
        messages: [{ role: 'user', content: `Agent run summary:\n\n${runSummary}` }],
        temperature: 0.3,
        maxTokens: 1024,
      });

      let entries: Array<{ content: string; entryType: string }> = [];
      try {
        const parsed = JSON.parse(response.content);
        entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      } catch {
        // If parsing fails, try to extract JSON from the response
        const match = response.content.match(/\{[\s\S]*"entries"[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          entries = Array.isArray(parsed.entries) ? parsed.entries : [];
        }
      }

      if (entries.length === 0) return;

      const validTypes = ['observation', 'decision', 'preference', 'issue', 'pattern'];

      const values = entries
        .filter(e => e.content && validTypes.includes(e.entryType))
        .map(e => ({
          organisationId,
          subaccountId,
          agentRunId: runId,
          agentId,
          content: e.content,
          entryType: e.entryType as 'observation' | 'decision' | 'preference' | 'issue' | 'pattern',
          createdAt: new Date(),
        }));

      if (values.length > 0) {
        await db.insert(workspaceMemoryEntries).values(values);
      }

      // Increment run counter and check if we need to regenerate
      const memory = await this.getOrCreateMemory(organisationId, subaccountId);
      const newCount = memory.runsSinceSummary + 1;

      if (newCount >= memory.summaryThreshold) {
        // Trigger regeneration
        await this.regenerateSummary(organisationId, subaccountId);
      } else {
        await db
          .update(workspaceMemories)
          .set({ runsSinceSummary: newCount, updatedAt: new Date() })
          .where(eq(workspaceMemories.id, memory.id));
      }
    } catch (err) {
      console.error('[WorkspaceMemory] Failed to extract insights:', err);
    }
  },

  // ─── Summary Regeneration ──────────────────────────────────────────────────

  async regenerateSummary(organisationId: string, subaccountId: string): Promise<void> {
    const memory = await this.getOrCreateMemory(organisationId, subaccountId);

    // Load existing summary + unincluded entries
    const newEntries = await db
      .select()
      .from(workspaceMemoryEntries)
      .where(
        and(
          eq(workspaceMemoryEntries.subaccountId, subaccountId),
          eq(workspaceMemoryEntries.includedInSummary, false)
        )
      )
      .orderBy(desc(workspaceMemoryEntries.createdAt));

    if (newEntries.length === 0 && memory.summary) return;

    // Build the input for the summary LLM call
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

    const response = await callAnthropic({
      modelId: EXTRACTION_MODEL,
      systemPrompt: `You are a workspace memory compiler. Your job is to maintain a concise, useful memory document for a team of AI agents working on a client account.

Given the current memory summary (if any) and new insights from recent agent runs, produce an updated memory document.

Rules:
- Keep it under 500 words
- Organise by theme (client preferences, ongoing issues, key decisions, patterns, etc.)
- Remove outdated or superseded information
- Prioritise actionable information that helps agents do better work
- Write in present tense, factual statements
- Do NOT include meta-commentary about the compilation process

Respond with ONLY the updated memory text.`,
      messages: [{ role: 'user', content: parts.join('\n') }],
      temperature: 0.3,
      maxTokens: 2048,
    });

    // Also regenerate board summary
    const boardSummary = await this.generateBoardSummary(organisationId, subaccountId);

    // Update memory record
    await db
      .update(workspaceMemories)
      .set({
        summary: response.content,
        boardSummary,
        runsSinceSummary: 0,
        version: memory.version + 1,
        summaryGeneratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workspaceMemories.id, memory.id));

    // Mark entries as included (batch update)
    if (newEntries.length > 0) {
      const entryIds = newEntries.map(e => e.id);
      await db
        .update(workspaceMemoryEntries)
        .set({ includedInSummary: true })
        .where(inArray(workspaceMemoryEntries.id, entryIds));
    }
  },

  // ─── Board Summary Generation ──────────────────────────────────────────────

  async generateBoardSummary(organisationId: string, subaccountId: string): Promise<string | null> {
    try {
      const allTasks = await taskService.listTasks(organisationId, subaccountId, {});
      if (allTasks.length === 0) return null;

      // Build a compact representation
      const counts: Record<string, number> = {};
      const statusTasks: Record<string, string[]> = {};
      for (const t of allTasks) {
        const status = String(t.status);
        counts[status] = (counts[status] ?? 0) + 1;
        if (!statusTasks[status]) statusTasks[status] = [];
        if (statusTasks[status].length < 5) {
          const agentName = (t as Record<string, unknown>).assignedAgent
            ? ((t as Record<string, unknown>).assignedAgent as Record<string, unknown>).name
            : null;
          statusTasks[status].push(
            `${t.title}${t.priority !== 'normal' ? ` [${t.priority}]` : ''}${agentName ? ` → ${agentName}` : ''}`
          );
        }
      }

      const boardText = Object.entries(statusTasks)
        .map(([status, titles]) => {
          const total = counts[status];
          const list = titles.map(t => `  - ${t}`).join('\n');
          return `**${status}** (${total}):\n${list}${total > 5 ? `\n  ... and ${total - 5} more` : ''}`;
        })
        .join('\n');

      const response = await callAnthropic({
        modelId: EXTRACTION_MODEL,
        systemPrompt: `Summarise this board state in under 200 words. Focus on: what's in progress, what's blocked, what's been completed recently, and what needs attention. Be factual and concise. Respond with ONLY the summary text.`,
        messages: [{ role: 'user', content: boardText }],
        temperature: 0.3,
        maxTokens: 512,
      });

      return response.content;
    } catch (err) {
      console.error('[WorkspaceMemory] Failed to generate board summary:', err);
      return null;
    }
  },

  // ─── Prompt Builder ────────────────────────────────────────────────────────

  async getMemoryForPrompt(organisationId: string, subaccountId: string): Promise<string | null> {
    const memory = await this.getMemory(organisationId, subaccountId);
    if (!memory) return null;

    const parts: string[] = [];

    if (memory.summary) {
      parts.push('### Shared Workspace Memory');
      parts.push('This is compiled knowledge from all agent runs in this workspace:');
      parts.push(memory.summary);
    }

    if (!parts.length) return null;
    return parts.join('\n');
  },

  async getBoardSummaryForPrompt(organisationId: string, subaccountId: string): Promise<string | null> {
    const memory = await this.getMemory(organisationId, subaccountId);
    return memory?.boardSummary ?? null;
  },
};
