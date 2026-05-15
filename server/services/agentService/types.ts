// ---------------------------------------------------------------------------
// Consolidation Build C1 — local type declarations
// (Will be replaced by shared/types/build.ts exports in chunk C5)
// ---------------------------------------------------------------------------

export interface AgentPersonality {
  traits: string[];
  tone: string;
  description: string;
  enabled: boolean;
}

export interface AgentRunPreview {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  costUsd: number;
}

export interface AgentFull {
  id: string;
  etag: string;
  /** Runtime guard used by service; not exposed in API response */
  isSystemManaged: boolean;
  configure: {
    name: string;
    description: string;
    roleTitle: string;
    parentAgentId: string | null;
    model: string;
    outputSize: 'compact' | 'standard' | 'extended';
    allowSubaccountModelOverride: boolean;
    responseMode: 'balanced' | 'expressive' | 'precise' | 'highly_creative';
  };
  behaviour: {
    briefingTemplate: string;
    constraints: string[];
  };
  personality: AgentPersonality;
  skills: Array<{ id: string; key: string; name: string; configJson: unknown; status: 'enabled' | 'disabled' }>;
  dataSources: Array<{ id: string; kind: string; ref: string; status: 'connected' | 'disconnected' | 'error' }>;
  triggers: Array<{ id: string; kind: 'schedule' | 'event' | 'manual'; spec: unknown; status: 'active' | 'paused' }>;
  budget: { dailyCapUsd: number | null; monthlyCapUsd: number | null; warnThresholdPct: number };
  runs: { last5: AgentRunPreview[]; total30d: number; cost30d: number };
  /** Minimum 1. Agents with no revision history return 1 (not 0). */
  agentRevisionCount: number;
  lastRevisionEditedAt: string | null;
  lastRevisionAuthor: string | null;
}

// ---------------------------------------------------------------------------
// In-memory cache types (package-internal — not re-exported from barrel)
// ---------------------------------------------------------------------------

export interface CacheEntry {
  content: string;
  fetchedAt: number;
  expiresAt: number;
}

export interface GoogleDocsContent {
  body?: {
    content?: Array<{
      paragraph?: {
        elements?: Array<{ textRun?: { content?: string } }>;
      };
    }>;
  };
}

// ---------------------------------------------------------------------------
// Data source scope types
// ---------------------------------------------------------------------------

/**
 * Scope descriptor for loading data sources. See spec §6.1.
 *
 * At least `agentId` must be set. Optionally narrows by subaccountAgentId
 * (for subaccount-specific sources) or scheduledTaskId (for scheduled-task-
 * specific sources). These two are orthogonal — a run either came from a
 * subaccount-agent link, or from a scheduled task, but not both sources of
 * scoping at the same row level.
 */
export interface DataSourceScope {
  agentId: string;
  subaccountAgentId?: string | null;
  scheduledTaskId?: string | null;
}

/**
 * LoadedDataSource — the raw shape returned by fetchDataSourcesByScope and
 * loadTaskAttachmentsAsContext. The "decision" fields (orderIndex,
 * includedInPrompt, etc.) are populated later by loadRunContextData — see
 * spec §6.1 for the full pre/post-loader invariant.
 */
export interface LoadedDataSource {
  id: string;
  scope: 'agent' | 'subaccount' | 'scheduled_task' | 'task_instance';
  name: string;
  description: string | null;
  content: string;
  contentType: string;
  tokenCount: number;
  sizeBytes: number;
  priority: number;
  fetchOk: boolean;
  maxTokenBudget: number;

  // Decision fields — populated by loadRunContextData after sorting,
  // override suppression, and the budget walk. Optional at the type level
  // because fetchDataSourcesByScope and loadTaskAttachmentsAsContext return
  // values with none of them set. See spec §6.1.
  orderIndex?: number;
  includedInPrompt?: boolean;
  truncated?: boolean;
  suppressedByOverride?: boolean;
  suppressedBy?: string;
}
