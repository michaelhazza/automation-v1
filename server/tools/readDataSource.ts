import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentDataSources } from '../db/schema/index.js';
import {
  loadSourceContent,
  type LoadedDataSource,
} from '../services/agentService.js';
import { readTaskAttachmentContent } from '../services/taskAttachmentContextService.js';
import { approxTokens } from '../services/llmService.js';
import {
  MAX_READ_DATA_SOURCE_CALLS_PER_RUN,
  MAX_READ_DATA_SOURCE_TOKENS_PER_CALL,
} from '../config/limits.js';
import type { SkillExecutionContext } from '../services/skillExecutor.js';

// ---------------------------------------------------------------------------
// read_data_source skill handler (spec §8.2)
//
// Two ops:
//   - list: return the manifest of active sources (winners only — suppressed
//           sources are invisible per spec §3.6)
//   - read: return a slice of a specific source's content
//
// Enforces:
//   - MAX_READ_DATA_SOURCE_CALLS_PER_RUN per-run call count
//   - MAX_READ_DATA_SOURCE_TOKENS_PER_CALL per-call token cap (clamped)
//   - offset/limit slicing with nextOffset continuation
// ---------------------------------------------------------------------------

interface ReadDataSourceInput {
  op?: 'list' | 'read';
  id?: string;
  offset?: number;
  limit?: number;
}

interface ReadDataSourceResult {
  ok: boolean;
  error?: string;
  sources?: Array<{
    id: string;
    name: string;
    description: string | null;
    scope: LoadedDataSource['scope'];
    sizeBytes: number;
    tokenCount: number;
    contentType: string;
    loadingMode: 'eager' | 'lazy';
    alreadyInKnowledgeBase: boolean;
    excludedByBudget: boolean;
    readable: boolean;
  }>;
  source?: {
    id: string;
    name: string;
    scope: LoadedDataSource['scope'];
    contentType: string;
    content: string;
    tokenCount: number;
    offset: number;
    nextOffset: number | null;
    totalSizeChars: number;
    truncated: boolean;
  };
}

const APPROX_CHARS_PER_TOKEN = 4;

export async function executeReadDataSource(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<ReadDataSourceResult> {
  const parsed = input as ReadDataSourceInput;
  const op = parsed.op;

  const runContext = context.runContextData;
  if (!runContext) {
    return {
      ok: false,
      error: 'No run context available — this skill must be called within an agent run.',
    };
  }

  if (op === 'list') {
    // Suppressed sources are invisible — see spec §8.2 design note 1.
    const activeSources = [...runContext.eager, ...runContext.manifest];
    return {
      ok: true,
      sources: activeSources.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        scope: s.scope,
        sizeBytes: s.sizeBytes,
        tokenCount: s.tokenCount,
        contentType: s.contentType,
        loadingMode: s.loadingMode,
        alreadyInKnowledgeBase:
          s.loadingMode === 'eager' && !!s.includedInPrompt && s.fetchOk,
        excludedByBudget:
          s.loadingMode === 'eager' && !s.includedInPrompt,
        readable: s.fetchOk,
      })),
    };
  }

  if (op === 'read') {
    const id = parsed.id;
    if (!id) {
      return { ok: false, error: "'id' is required when op='read'" };
    }

    const offset = parsed.offset ?? 0;
    if (offset < 0) {
      return { ok: false, error: "'offset' must be >= 0" };
    }

    const requestedLimit = parsed.limit ?? MAX_READ_DATA_SOURCE_TOKENS_PER_CALL;

    // Per-run call count limit — enforced BEFORE any work
    const currentCount = context.readDataSourceCallCount ?? 0;
    if (currentCount >= MAX_READ_DATA_SOURCE_CALLS_PER_RUN) {
      return {
        ok: false,
        error: `read_data_source call limit (${MAX_READ_DATA_SOURCE_CALLS_PER_RUN}) exceeded for this run`,
      };
    }
    context.readDataSourceCallCount = currentCount + 1;

    // Per-read token cap — cannot exceed the system ceiling even if the
    // caller passes a larger explicit limit (clamped slicing contract).
    const effectiveLimit = Math.min(
      Math.max(1, requestedLimit),
      MAX_READ_DATA_SOURCE_TOKENS_PER_CALL
    );

    // Resolve the source — active pool only (suppressed sources are invisible)
    const activeSources = [...runContext.eager, ...runContext.manifest];
    const source = activeSources.find((s) => s.id === id);
    if (!source) {
      return {
        ok: false,
        error: `Source with id '${id}' not found in current run context`,
      };
    }

    if (!source.fetchOk) {
      return {
        ok: false,
        error: `Source '${source.name}' is not readable (binary content type or previous fetch failure)`,
      };
    }

    // Step 1: ensure content is loaded (lazy fetch on first read, cached after)
    let fullContent: string;
    if (source.loadingMode === 'eager' && source.content) {
      fullContent = source.content;
    } else if (source.id.startsWith('task_attachment:')) {
      const attachmentId = source.id.slice('task_attachment:'.length);
      const content = await readTaskAttachmentContent(
        attachmentId,
        context.organisationId
      );
      if (content === null) {
        return {
          ok: false,
          error: `Failed to fetch task attachment '${source.name}'`,
        };
      }
      fullContent = content;
      source.content = content;
      source.tokenCount = approxTokens(content);
    } else {
      // Lazy agent / scheduled-task / subaccount data source
      const [row] = await db
        .select()
        .from(agentDataSources)
        .where(eq(agentDataSources.id, source.id));
      if (!row) {
        return { ok: false, error: 'Source row missing from database' };
      }
      const { content, fetchOk, tokenCount } = await loadSourceContent(row);
      if (!fetchOk) {
        return { ok: false, error: `Failed to fetch source '${source.name}'` };
      }
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

  return { ok: false, error: `Unknown op: ${String(op)}` };
}
