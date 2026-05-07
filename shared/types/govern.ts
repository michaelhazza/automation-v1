// shared/types/govern.ts
// Govern surface — shared contracts between server routes and frontend pages.
// Spec: tasks/builds/consolidation-govern/spec.md §4

// ── Knowledge ──────────────────────────────────────────────────────────────

export interface KnowledgeListQuery {
  scope?: 'workspace' | 'org';
  status?: ('pending_review' | 'in_use' | 'ignored')[];
  autoUpdateDisabled?: boolean;
  kind?: ('belief' | 'fact' | 'observation' | 'preference' | 'issue')[];
  agent?: string[];
  q?: string;
  cursor?: string;
  limit?: number;
  sortKey?: 'createdAt' | 'updatedAt' | 'confidence' | 'sourceAgent' | 'kind' | 'status';
  sortDir?: 'asc' | 'desc';
}

export interface KnowledgeEntry {
  id: string;
  kind: 'belief' | 'fact' | 'observation' | 'preference' | 'issue';
  body: string;
  confidence: number; // 0-1
  status: 'pending_review' | 'in_use' | 'ignored';
  source: { runId: string; agentName: string; extractedAt: string };
  subaccount: { id: string; name: string } | null;
  autoUpdateDisabled: boolean;
  lastEditedBy: { kind: 'auto' | 'manual'; userId: string | null; at: string } | null;
  /** Opaque ETag for override concurrency check. */
  etag: string;
}

export interface KnowledgeListResponse {
  rows: KnowledgeEntry[];
  cursor: string | null;
  filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
}

// ── Spend Ledger ───────────────────────────────────────────────────────────

export interface LedgerQuery {
  scope?: 'workspace' | 'org';
  workspace?: string[];
  agent?: string[];
  type?: ('llm' | 'embedding' | 'tool_call' | 'storage' | 'other')[];
  from?: string;
  to?: string;
  q?: string;
  cursor?: string;
  limit?: number;
  sortKey?: 'timestamp' | 'workspace' | 'agent' | 'type' | 'tokens' | 'cost';
  sortDir?: 'asc' | 'desc';
}

export interface LedgerRow {
  id: string;
  timestamp: string;
  workspace: { id: string; name: string };
  agent: { id: string; name: string };
  type: 'llm' | 'embedding' | 'tool_call' | 'storage' | 'other';
  provider: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number;
}

export interface LedgerResponse {
  rows: LedgerRow[];
  cursor: string | null;
  filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
}

// ── Spend Caps ─────────────────────────────────────────────────────────────

export interface CapsResponse {
  scope: 'workspace' | 'org';
  orgCap: {
    monthlyUsd: number;
    usedMtdUsd: number;
    daysRemaining: number;
    pace: 'on_track' | 'warning' | 'over';
  };
  workspaces: Array<{
    id: string;
    name: string;
    dailyCapUsd: number | null;
    monthlyCapUsd: number | null;
    usedMtdUsd: number;
    pacePct: number;
    status: 'on_track' | 'warning' | 'over';
  }>;
  periodResetAt: string;
  paceWindow: '7d' | '14d' | '30d';
  paceProjectedEndOfPeriodUsd: number;
}

// ── Spend Insights ─────────────────────────────────────────────────────────

export interface SpendInsights {
  topSpender: {
    workspace: { id: string; name: string };
    mtdUsd: number;
    pctOfOrgTotal: number;
    deltaPct: number | null;
  } | null;
  fastestGrower: {
    workspace: { id: string; name: string };
    deltaPct: number | null;
  } | null;
  mostActiveAgent: {
    agent: { id: string; name: string };
    runs30d: number;
    workspace: { id: string; name: string };
  } | null;
}

// ── Spend Trends ───────────────────────────────────────────────────────────

export interface SpendTrends {
  workspaces: Array<{
    id: string;
    name: string;
    spend6mo: number[];
    capUsage6mo: (number | null)[];
    capBlownAt: number | null;
  }>;
  monthLabels: string[];
}

// ── Connections ────────────────────────────────────────────────────────────

export interface ConnectionsQuery {
  scope?: 'workspace' | 'org';
  provider?: string[];
  authMethod?: ('oauth' | 'api_key' | 'web_login' | 'mcp' | 'cookie')[];
  status?: ('connected' | 'expired' | 'failed' | 'pending')[];
  q?: string;
  cursor?: string;
  limit?: number;
  sortKey?: 'name' | 'provider' | 'authMethod' | 'status' | 'lastSync' | 'owner';
  sortDir?: 'asc' | 'desc';
}

export interface Connection {
  id: string;
  name: string;
  provider: string;
  authMethod: 'oauth' | 'api_key' | 'web_login' | 'mcp' | 'cookie';
  status: 'connected' | 'expired' | 'failed' | 'pending';
  lastSyncAt: string | null;
  owner: { kind: 'workspace' | 'org'; id: string; name: string };
  createdAt: string;
}

export interface ConnectionsResponse {
  rows: Connection[];
  cursor: string | null;
  filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
}

export interface ConnectionUsage {
  agents: Array<{ id: string; name: string; lastUsedAt: string | null }>;
  recurringTasks: Array<{ id: string; name: string; nextFireAt: string | null }>;
  workflows: Array<{ id: string; name: string }>;
}

export interface ConnectionTestResponse {
  status: 'ok' | 'failed';
  latencyMs: number;
  testedAt: string;
  error?: { code: 'TIMEOUT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'PROVIDER_ERROR'; message: string };
  capabilities?: string[];
}
