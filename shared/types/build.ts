// Agent list
export interface AgentListItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  modelProvider: string;
  modelId: string;
  status: 'draft' | 'active' | 'inactive';
  systemAgentId: string | null;
  isSystemManaged: boolean;
  parentAgentId: string | null;
  agentRole: string | null;
  agentTitle: string | null;
  createdAt: string;
  updatedAt: string;
  // C5b additions:
  /** Minimum 1. Agents with no revision history return 1 (not 0). */
  agentRevisionCount: number;
  lastRevisionEditedAt: string | null;
  lastRevisionAuthor: string | null;
  // Optional: subaccount context (when scope=workspace)
  subaccount?: { id: string; name: string } | null;
}

// Agent full (from GET /api/agents/:id/full)
export interface AgentFull {
  id: string;
  etag: string;
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
  behaviour: { briefingTemplate: string; constraints: string[] };
  personality: AgentPersonality;
  skills: Array<{ id: string; key: string; name: string; configJson: unknown; status: 'enabled' | 'disabled' }>;
  dataSources: Array<{ id: string; kind: string; ref: string; status: 'connected' | 'disconnected' | 'error' }>;
  triggers: Array<{ id: string; kind: 'schedule' | 'event' | 'manual'; spec: unknown; status: 'active' | 'paused' }>;
  budget: { dailyCapUsd: number | null; monthlyCapUsd: number | null; warnThresholdPct: number };
  runs: { last5: AgentRunPreview[]; total30d: number; cost30d: number };
}

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

// Patch payloads (for tab-scoped writes)
export interface AgentConfigurePatch {
  name?: string;
  description?: string;
  roleTitle?: string;
  parentAgentId?: string | null;
  model?: string;
  outputSize?: 'compact' | 'standard' | 'extended';
  allowSubaccountModelOverride?: boolean;
  responseMode?: 'balanced' | 'expressive' | 'precise' | 'highly_creative';
}

export interface AgentBehaviourPatch {
  briefingTemplate?: string;
  constraints?: string[];
}

export type AgentPersonalityPatch = Partial<AgentPersonality>;

export interface AgentBudgetPatch {
  dailyCapUsd?: number | null;
  monthlyCapUsd?: number | null;
  warnThresholdPct?: number;
}

export interface SkillBindingPayload {
  id: string;
  key: string;
  name: string;
  configJson?: unknown;
  status?: 'enabled' | 'disabled';
}

export interface DataSourceBindingPayload {
  id: string;
  kind: string;
  ref: string;
  status?: 'connected' | 'disconnected' | 'error';
}

export interface TriggerBindingPayload {
  id: string;
  kind: 'schedule' | 'event' | 'manual';
  spec?: unknown;
  status?: 'active' | 'paused';
}

// Test run
export interface AgentTestRequest {
  input: string;
  workspaceContextId: string;
  idempotencyKey: string;
}

export interface AgentTestAccepted {
  runId: string;
  status: 'running';
}

export interface AgentTestResult {
  runId: string;
  status: 'running' | 'completed' | 'failed';
  durationMs: number | null;
  resultPreview: string | null;
  traceUrl: string | null;
}

// Recurring tasks
export interface RecurringTask {
  id: string;
  name: string;
  fireKind: 'schedule' | 'event' | 'manual';
  fireCondition: string;
  action: string;
  scope: { kind: 'workspace' | 'org'; id: string; name: string };
  project: { id: string; name: string } | null;
  status: 'active' | 'paused' | 'error';
  lastFiredAt: string | null;
  fires30d: number;
  nextFireAt: string | null;
}

export interface RecurringTasksQuery {
  scope?: 'workspace' | 'org' | 'system';
  fireKind?: ('schedule' | 'event' | 'manual')[];
  status?: ('active' | 'paused' | 'error')[];
  agent?: string[];
  project?: string[];
  q?: string;
  cursor?: string;
  limit?: number;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
}

export interface RecurringTasksResponse {
  rows: RecurringTask[];
  cursor: string | null;
  filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
}

// Projects
export interface ApiProject {
  id: string;
  organisationId: string;
  subaccountId: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'completed' | 'archived';
  color: string;
  objective: string | null;
  targetDate: string | null;
  budgetUsd: number | null;
  budgetWarnThresholdPct: number;
  repositoryUrl: string | null;
  linkedAgents: string[];
  migratedFromGoalsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPatch {
  name?: string;
  color?: string;
  description?: string;
  status?: 'active' | 'paused' | 'completed' | 'archived';
  objective?: string | null;
  targetDate?: string | null;
  budgetUsd?: number | null;
  budgetWarnThresholdPct?: number;
  repositoryUrl?: string | null;
  linkedAgents?: string[];
}

// ETag error
export interface EtagMismatchPayload {
  errorCode: 'ETAG_MISMATCH';
  currentEtag: string;
  conflictingActor?: { id: string; name: string } | null;
  updatedAt?: string;
  changedFields?: string[];
  message?: string;
}
