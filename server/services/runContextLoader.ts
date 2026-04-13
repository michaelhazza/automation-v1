import { eq, and } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/index.js';
import { scheduledTasks } from '../db/schema/index.js';
import {
  fetchDataSourcesByScope,
  type LoadedDataSource,
} from './agentService.js';
import { loadTaskAttachmentsAsContext } from './taskAttachmentContextService.js';
import { assertScopeSingle } from '../lib/scopeAssertion.js';
import {
  processContextPool,
  rankContextPoolByRelevance,
  resolveScheduledTaskId as resolveScheduledTaskIdPure,
  type ProcessedContextPool,
} from './runContextLoaderPure.js';
import { generateEmbedding } from '../lib/embeddings.js';

// Re-export the pure helpers for callers and tests
export { processContextPool };

// ---------------------------------------------------------------------------
// Skill-typed scheduled task run instructions
//
// When a scheduled task brief contains `"type": "<skill>_run"`, this function
// loads the corresponding skill markdown file and extracts the
// `## Scheduled Run Instructions` section to prepend to taskInstructions.
//
// Phase 4 scope: currently handles `monitor_webpage_run`.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILLS_DIR = resolve(__dirname, '../skills');
const SCHEDULED_RUN_SECTION_HEADER = '## Scheduled Run Instructions';

/**
 * Extract `## Scheduled Run Instructions` from a skill markdown file.
 * Returns null if the section is not present or the skill file doesn't exist.
 */
async function loadSkillRunInstructions(skillSlug: string): Promise<string | null> {
  try {
    const filePath = resolve(SKILLS_DIR, `${skillSlug}.md`);
    const content = await readFile(filePath, 'utf8');
    const headerIdx = content.indexOf(SCHEDULED_RUN_SECTION_HEADER);
    if (headerIdx === -1) return null;

    // Extract from the header to the next `##` section or end of file
    const afterHeader = content.slice(headerIdx + SCHEDULED_RUN_SECTION_HEADER.length);
    const nextSection = afterHeader.search(/\n##\s/);
    const sectionContent = nextSection === -1 ? afterHeader : afterHeader.slice(0, nextSection);

    return `${SCHEDULED_RUN_SECTION_HEADER}\n${sectionContent.trim()}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run Context Loader (spec §7.1)
//
// Single entry point for assembling the context data pool that an agent run
// will see. Merges four scopes — agent / subaccount / scheduled_task /
// task_instance — resolves same-name overrides, enforces the eager budget,
// caps the lazy manifest, and exposes the scheduled task's instructions as
// a dedicated system prompt layer.
//
// Returns a RunContextData blob that:
//   - `eager`              — full list of eager sources (filter by includedInPrompt)
//   - `manifest`           — full list of lazy sources (used by read_data_source)
//   - `manifestForPrompt`  — capped subset rendered into the system prompt
//   - `manifestElidedCount`— count of lazy entries omitted from the prompt
//   - `suppressed`         — override losers (snapshot only)
//   - `taskInstructions`   — scheduled task description, if applicable
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the agent run request that the loader needs.
 * Avoids importing the full AgentRunRequest type (which causes circular
 * imports with agentExecutionService) while staying strictly typed.
 */
export interface RunContextLoadRequest {
  agentId: string;
  organisationId: string;
  subaccountAgentId?: string | null;
  taskId?: string | null;
  triggerContext?: unknown;
}

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

export async function loadRunContextData(
  request: RunContextLoadRequest
): Promise<RunContextData> {
  const pool: LoadedDataSource[] = [];

  // 1. Load agent_data_sources across all applicable scopes
  const triggerScheduledTaskId = resolveScheduledTaskIdPure(request.triggerContext);
  const scopedSources = await fetchDataSourcesByScope({
    agentId: request.agentId,
    subaccountAgentId: request.subaccountAgentId ?? null,
    scheduledTaskId: triggerScheduledTaskId,
  });
  pool.push(...scopedSources);

  // 2. Load task instance attachments if the run targets a specific task
  if (request.taskId) {
    const taskAtts = await loadTaskAttachmentsAsContext(
      request.taskId,
      request.organisationId,
    );
    pool.push(...taskAtts);
  }

  // 3. Resolve scheduled task instructions (the "Task Instructions" layer)
  let taskInstructions: string | null = null;
  if (triggerScheduledTaskId) {
    const [rawSt] = await db
      .select({
        description: scheduledTasks.description,
        brief: scheduledTasks.brief,
        organisationId: scheduledTasks.organisationId,
      })
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.id, triggerScheduledTaskId),
          // Defense-in-depth: scheduledTaskId is sourced from caller-supplied
          // triggerContext, so we must scope by the run's own organisationId
          // rather than trust the id in isolation.
          eq(scheduledTasks.organisationId, request.organisationId),
        )
      );
    // P1.1 Layer 2 scope assertion — belt-and-suspenders on the scheduled
    // task description that will land in the LLM system prompt window.
    const st = assertScopeSingle(
      rawSt ?? null,
      { organisationId: request.organisationId },
      'runContextLoader.loadRunContextData.scheduledTask',
    );
    if (st?.description && st.description.trim().length > 0) {
      taskInstructions = st.description.trim();
    }

    // Inject skill-typed run protocol from skill markdown file.
    // If the brief is a JSON string with "type": "<skill>_run", load the
    // corresponding skill file's ## Scheduled Run Instructions section.
    if (st) {
      const brief = st.brief;
      if (brief && typeof brief === 'string') {
        try {
          const parsed = JSON.parse(brief) as Record<string, unknown>;
          const briefType = typeof parsed.type === 'string' ? parsed.type : null;
          const typeMatch = briefType?.match(/^([a-z_]+)_run$/);
          if (typeMatch) {
            const skillSlug = typeMatch[1]; // e.g. "monitor_webpage"
            const runInstructions = await loadSkillRunInstructions(skillSlug);
            if (runInstructions) {
              taskInstructions = taskInstructions
                ? `${taskInstructions}\n\n${runInstructions}`
                : runInstructions;
            }
          }
        } catch {
          // brief is not valid JSON — skip skill-typed injection
        }
      }
    }
  }

  // Phase 1D: Compute task embedding for relevance ranking
  if (taskInstructions) {
    const taskEmbedding = await generateEmbedding(taskInstructions);
    if (taskEmbedding) {
      // Compute content embeddings for eager sources (on-the-fly)
      const eagerSources = pool.filter(s => s.loadingMode === 'eager');
      const embeddingPromises = eagerSources.slice(0, 20).map(async (source) => {
        if (source.content) {
          const emb = await generateEmbedding(source.content.slice(0, 2000));
          if (emb) {
            (source as LoadedDataSource & { embedding?: number[] }).embedding = emb;
          }
        }
      });
      await Promise.all(embeddingPromises);
      rankContextPoolByRelevance(pool, taskEmbedding);
    }
  }

  // Steps 4-9 — pure post-fetch processing
  const processed: ProcessedContextPool = processContextPool(pool);

  return {
    ...processed,
    taskInstructions,
  };
}
