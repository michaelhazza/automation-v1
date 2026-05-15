// ─── Core usage types ──────────────────────────────────────────────────────────

export interface UsageSummary {
  period: string;
  monthly: CostAggregate | null;
  today:   CostAggregate | null;
  limits:  WorkspaceLimits | null;
}

export interface CostAggregate {
  totalCostCents: number;
  requestCount: number;
  errorCount: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface WorkspaceLimits {
  monthlyCostLimitCents: number | null;
  dailyCostLimitCents: number | null;
  maxCostPerRunCents: number | null;
}

export interface AgentUsageRow {
  agentName: string | null;
  requestCount: number;
  totalCostCents: number;
  totalTokensIn: number;
  totalTokensOut: number;
  errorCount: number;
}

export interface ModelUsageRow {
  provider: string;
  model: string;
  requestCount: number;
  totalCostCents: number;
  totalTokensIn: number;
  totalTokensOut: number;
  avgLatencyMs: number;
}

export interface RunCostRow {
  entityId: string;
  totalCostCents: number;
  requestCount: number;
  updatedAt: string;
}

export interface DayBucket {
  date: string;
  completed: number;
  failed: number;
  timeout: number;
  other: number;
  total: number;
}

// ─── Routing tab types ────────────────────────────────────────────────────────

export interface RoutingDistribution {
  totalRequests: number;
  totalCostCents: number;
  byTier: { frontier: number; economy: number };
  byReason: Record<string, number>;
  byPhase: Record<string, number>;
  byStatus: Record<string, number>;
  byProvider: Record<string, number>;
  costByTier: { frontier: number; economy: number };
  costByReason: Record<string, number>;
  latencyByProvider: Record<string, number>;
  latencyByTier: { frontier: number; economy: number };
  fallbackPct: number;
  escalationPct: number;
  downgradePct: number;
}

export interface RoutingLogItem {
  id: string;
  createdAt: string;
  agentName: string | null;
  provider: string;
  model: string;
  requestedProvider: string | null;
  requestedModel: string | null;
  executionPhase: string;
  capabilityTier: string;
  routingReason: string | null;
  status: string;
  providerLatencyMs: number | null;
  routerOverheadMs: number | null;
  costWithMarginCents: number;
  wasDowngraded: boolean;
  wasEscalated: boolean;
  escalationReason: string | null;
  fallbackChain: string | null;
  tokensIn: number;
  tokensOut: number;
  cachedPromptTokens: number;
  costRaw: string;
  costWithMargin: string;
  marginMultiplier: string;
  requestPayloadHash: string | null;
  responsePayloadHash: string | null;
  idempotencyKey: string;
  runId: string | null;
  executionId: string | null;
  taskType: string;
}

// ─── IEE row types ────────────────────────────────────────────────────────────

export interface IeeUsageRow {
  id: string;
  agentId: string;
  type: 'browser' | 'dev';
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  stepCount: number;
  llmCostCents: number;
  runtimeCostCents: number;
  totalCostCents: number;
  failureReason: string | null;
}

export interface IeeUsageSummary {
  total:   { cents: number; runCount: number };
  llm:     { cents: number; callCount: number };
  compute: { cents: number };
}

// ─── Type aliases ─────────────────────────────────────────────────────────────

export type Tab = 'overview' | 'agents' | 'models' | 'runs' | 'routing' | 'iee' | 'memory_utility';

export type FallbackChainEntry = { provider: string; model: string; error?: string; success?: boolean };

export type RoutingFilters = {
  provider?: string;
  routingReason?: string;
  capabilityTier?: string;
  executionPhase?: string;
  status?: string;
  wasDowngraded?: string;
  wasEscalated?: string;
  agentName?: string;
  runId?: string;
};

export type IeeFilters = {
  types: string;
  statuses: string;
  minCostCents: string;
  search: string;
};
