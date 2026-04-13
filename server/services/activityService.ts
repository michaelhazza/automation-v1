import { eq, and, desc, isNull, gte, lte, ilike } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  agentRuns,
  agents,
  subaccounts,
  reviewItems,
  actions,
  executions,
  playbookRuns,
} from '../db/schema/index.js';
import { workspaceHealthFindings } from '../db/schema/workspaceHealthFindings.js';

// ---------------------------------------------------------------------------
// Ops Dashboard Service — unified activity feed across all data sources
// ---------------------------------------------------------------------------

export type ActivityType =
  | 'agent_run'
  | 'review_item'
  | 'health_finding'
  | 'inbox_item'
  | 'decision_log'
  | 'playbook_run'
  | 'task_event'
  | 'workflow_execution';

export type NormalisedStatus =
  | 'active'
  | 'attention_needed'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type OpsDashboardItem = {
  id: string;
  type: ActivityType;
  status: NormalisedStatus;
  subject: string;
  actor: string;
  subaccountId: string | null;
  subaccountName: string | null;
  agentId: string | null;
  agentName: string | null;
  severity: 'critical' | 'warning' | 'info' | null;
  createdAt: string;
  updatedAt: string;
  detailUrl: string;
};

export type OpsDashboardScope =
  | { type: 'subaccount'; subaccountId: string; orgId: string }
  | { type: 'org'; orgId: string; subaccountId?: string }
  | { type: 'system'; organisationId?: string };

export type OpsDashboardFilters = {
  type?: string[];
  status?: string[];
  from?: string;
  to?: string;
  agentId?: string;
  severity?: string[];
  assignee?: string;
  q?: string;
  sort?: 'newest' | 'oldest' | 'severity' | 'attention_first';
  limit?: number;
  offset?: number;
};

// ---------------------------------------------------------------------------
// Status normalisation helpers
// ---------------------------------------------------------------------------

function normaliseAgentRunStatus(s: string): NormalisedStatus {
  switch (s) {
    case 'running':
    case 'pending':
      return 'active';
    case 'failed':
    case 'timeout':
    case 'budget_exceeded':
    case 'loop_detected':
      return 'failed';
    case 'awaiting_clarification':
      return 'attention_needed';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'active';
  }
}

function normaliseReviewStatus(s: string): NormalisedStatus {
  switch (s) {
    case 'pending':
    case 'edited_pending':
      return 'attention_needed';
    case 'approved':
    case 'completed':
      return 'completed';
    case 'rejected':
      return 'cancelled';
    default:
      return 'attention_needed';
  }
}

function normaliseExecutionStatus(s: string): NormalisedStatus {
  switch (s) {
    case 'pending':
    case 'running':
      return 'active';
    case 'completed':
      return 'completed';
    case 'failed':
    case 'timeout':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'active';
  }
}

function normalisePlaybookStatus(s: string): NormalisedStatus {
  switch (s) {
    case 'pending':
    case 'running':
      return 'active';
    case 'awaiting_input':
    case 'awaiting_approval':
      return 'attention_needed';
    case 'completed':
    case 'completed_with_errors':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
    case 'cancelling':
      return 'cancelled';
    default:
      return 'active';
  }
}

// ---------------------------------------------------------------------------
// Severity ordering for sort
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };
const STATUS_ORDER: Record<NormalisedStatus, number> = {
  attention_needed: 0,
  failed: 1,
  active: 2,
  completed: 3,
  cancelled: 4,
};

// ---------------------------------------------------------------------------
// Org ID resolver for scope
// ---------------------------------------------------------------------------

function orgIdFromScope(scope: OpsDashboardScope): string | undefined {
  switch (scope.type) {
    case 'subaccount':
      return scope.orgId;
    case 'org':
      return scope.orgId;
    case 'system':
      return scope.organisationId;
  }
}

function subaccountIdFromScope(scope: OpsDashboardScope): string | undefined {
  switch (scope.type) {
    case 'subaccount':
      return scope.subaccountId;
    case 'org':
      return scope.subaccountId;
    case 'system':
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Data source fetchers
// ---------------------------------------------------------------------------

async function fetchAgentRuns(
  scope: OpsDashboardScope,
  filters: OpsDashboardFilters,
): Promise<OpsDashboardItem[]> {
  const orgId = orgIdFromScope(scope);
  const subId = subaccountIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [];

  if (orgId) conditions.push(eq(agentRuns.organisationId, orgId));
  if (subId) conditions.push(eq(agentRuns.subaccountId, subId));
  if (filters.agentId) conditions.push(eq(agentRuns.agentId, filters.agentId));
  if (filters.from) conditions.push(gte(agentRuns.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(agentRuns.createdAt, new Date(filters.to)));
  if (filters.q) conditions.push(ilike(agentRuns.summary, `%${filters.q}%`));

  const rows = await db
    .select({
      run: agentRuns,
      agentName: agents.name,
      subaccountName: subaccounts.name,
    })
    .from(agentRuns)
    .innerJoin(agents, and(eq(agents.id, agentRuns.agentId), isNull(agents.deletedAt)))
    .leftJoin(subaccounts, and(eq(subaccounts.id, agentRuns.subaccountId), isNull(subaccounts.deletedAt)))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentRuns.createdAt))
    .limit(200);

  return rows.map(({ run, agentName, subaccountName }) => ({
    id: run.id,
    type: 'agent_run' as const,
    status: normaliseAgentRunStatus(run.status),
    subject: run.summary ?? `Agent run (${run.runType})`,
    actor: agentName ?? 'Unknown agent',
    subaccountId: run.subaccountId,
    subaccountName,
    agentId: run.agentId,
    agentName,
    severity: run.status === 'failed' || run.status === 'timeout' ? 'warning' as const : null,
    createdAt: (run.createdAt ?? new Date()).toISOString(),
    updatedAt: (run.updatedAt ?? run.createdAt ?? new Date()).toISOString(),
    detailUrl: run.subaccountId
      ? `/subaccounts/${run.subaccountId}/agents/${run.agentId}/runs/${run.id}`
      : `/admin/agents/${run.agentId}/runs/${run.id}`,
  }));
}

async function fetchReviewItems(
  scope: OpsDashboardScope,
  filters: OpsDashboardFilters,
): Promise<OpsDashboardItem[]> {
  const orgId = orgIdFromScope(scope);
  const subId = subaccountIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [];

  if (orgId) conditions.push(eq(reviewItems.organisationId, orgId));
  if (subId) conditions.push(eq(reviewItems.subaccountId, subId));
  if (filters.from) conditions.push(gte(reviewItems.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(reviewItems.createdAt, new Date(filters.to)));

  const rows = await db
    .select({
      item: reviewItems,
      actionType: actions.actionType,
      agentName: agents.name,
      subaccountName: subaccounts.name,
    })
    .from(reviewItems)
    .innerJoin(actions, eq(actions.id, reviewItems.actionId))
    .leftJoin(agents, and(eq(agents.id, actions.agentId), isNull(agents.deletedAt)))
    .leftJoin(subaccounts, and(eq(subaccounts.id, reviewItems.subaccountId), isNull(subaccounts.deletedAt)))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(reviewItems.createdAt))
    .limit(200);

  return rows.map(({ item, actionType, agentName, subaccountName }) => ({
    id: item.id,
    type: 'review_item' as const,
    status: normaliseReviewStatus(item.reviewStatus),
    subject: `Review: ${actionType}`,
    actor: agentName ?? 'Unknown agent',
    subaccountId: item.subaccountId,
    subaccountName,
    agentId: null,
    agentName,
    severity: item.reviewStatus === 'pending' ? 'warning' as const : null,
    createdAt: (item.createdAt ?? new Date()).toISOString(),
    updatedAt: (item.reviewedAt ?? item.createdAt ?? new Date()).toISOString(),
    detailUrl: item.subaccountId
      ? `/subaccounts/${item.subaccountId}/review`
      : `/admin/review`,
  }));
}

async function fetchHealthFindings(
  scope: OpsDashboardScope,
  filters: OpsDashboardFilters,
): Promise<OpsDashboardItem[]> {
  const orgId = orgIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [
    isNull(workspaceHealthFindings.resolvedAt),
  ];
  if (orgId) conditions.push(eq(workspaceHealthFindings.organisationId, orgId));
  if (filters.from) conditions.push(gte(workspaceHealthFindings.detectedAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(workspaceHealthFindings.detectedAt, new Date(filters.to)));
  if (filters.q) conditions.push(ilike(workspaceHealthFindings.message, `%${filters.q}%`));

  const rows = await db
    .select()
    .from(workspaceHealthFindings)
    .where(and(...conditions))
    .orderBy(desc(workspaceHealthFindings.detectedAt))
    .limit(200);

  return rows.map((f) => ({
    id: f.id,
    type: 'health_finding' as const,
    status: 'attention_needed' as const,
    subject: f.message,
    actor: `Detector: ${f.detector}`,
    subaccountId: null,
    subaccountName: null,
    agentId: null,
    agentName: null,
    severity: f.severity as 'critical' | 'warning' | 'info',
    createdAt: (f.detectedAt ?? new Date()).toISOString(),
    updatedAt: (f.detectedAt ?? new Date()).toISOString(),
    detailUrl: '/admin/health',
  }));
}

async function fetchInboxItems(
  scope: OpsDashboardScope,
  filters: OpsDashboardFilters,
): Promise<OpsDashboardItem[]> {
  const orgId = orgIdFromScope(scope);
  const subId = subaccountIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [
    eq(actions.status, 'pending_approval'),
  ];

  if (orgId) conditions.push(eq(actions.organisationId, orgId));
  if (subId) conditions.push(eq(actions.subaccountId, subId));
  if (filters.from) conditions.push(gte(actions.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(actions.createdAt, new Date(filters.to)));

  const rows = await db
    .select({
      action: actions,
      agentName: agents.name,
      subaccountName: subaccounts.name,
    })
    .from(actions)
    .innerJoin(agents, and(eq(agents.id, actions.agentId), isNull(agents.deletedAt)))
    .leftJoin(subaccounts, and(eq(subaccounts.id, actions.subaccountId), isNull(subaccounts.deletedAt)))
    .where(and(...conditions))
    .orderBy(desc(actions.createdAt))
    .limit(200);

  return rows.map(({ action, agentName, subaccountName }) => ({
    id: action.id,
    type: 'inbox_item' as const,
    status: 'attention_needed' as const,
    subject: `Pending: ${action.actionType}`,
    actor: agentName ?? 'Unknown agent',
    subaccountId: action.subaccountId,
    subaccountName,
    agentId: action.agentId,
    agentName,
    severity: 'warning' as const,
    createdAt: (action.createdAt ?? new Date()).toISOString(),
    updatedAt: (action.updatedAt ?? action.createdAt ?? new Date()).toISOString(),
    detailUrl: action.subaccountId
      ? `/subaccounts/${action.subaccountId}/agent-inbox`
      : `/admin/agent-inbox`,
  }));
}

async function fetchPlaybookRuns(
  scope: OpsDashboardScope,
  filters: OpsDashboardFilters,
): Promise<OpsDashboardItem[]> {
  const orgId = orgIdFromScope(scope);
  const subId = subaccountIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [];

  if (orgId) conditions.push(eq(playbookRuns.organisationId, orgId));
  if (subId) conditions.push(eq(playbookRuns.subaccountId, subId));
  if (filters.from) conditions.push(gte(playbookRuns.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(playbookRuns.createdAt, new Date(filters.to)));

  const rows = await db
    .select({
      run: playbookRuns,
      subaccountName: subaccounts.name,
    })
    .from(playbookRuns)
    .leftJoin(subaccounts, eq(subaccounts.id, playbookRuns.subaccountId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(playbookRuns.createdAt))
    .limit(200);

  return rows.map(({ run, subaccountName }) => ({
    id: run.id,
    type: 'playbook_run' as const,
    status: normalisePlaybookStatus(run.status),
    subject: `Playbook run (${run.runMode})`,
    actor: 'Playbook',
    subaccountId: run.subaccountId,
    subaccountName,
    agentId: null,
    agentName: null,
    severity: run.status === 'failed' ? 'warning' as const : null,
    createdAt: (run.createdAt ?? new Date()).toISOString(),
    updatedAt: (run.updatedAt ?? run.createdAt ?? new Date()).toISOString(),
    detailUrl: `/subaccounts/${run.subaccountId}/playbook-runs/${run.id}`,
  }));
}

async function fetchWorkflowExecutions(
  scope: OpsDashboardScope,
  filters: OpsDashboardFilters,
): Promise<OpsDashboardItem[]> {
  const orgId = orgIdFromScope(scope);
  const subId = subaccountIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [];

  if (orgId) conditions.push(eq(executions.organisationId, orgId));
  if (subId) conditions.push(eq(executions.subaccountId, subId));
  if (filters.from) conditions.push(gte(executions.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(executions.createdAt, new Date(filters.to)));
  if (filters.q) conditions.push(ilike(executions.errorMessage, `%${filters.q}%`));

  const rows = await db
    .select({
      exec: executions,
      subaccountName: subaccounts.name,
    })
    .from(executions)
    .leftJoin(subaccounts, eq(subaccounts.id, executions.subaccountId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(executions.createdAt))
    .limit(200);

  return rows.map(({ exec, subaccountName }) => ({
    id: exec.id,
    type: 'workflow_execution' as const,
    status: normaliseExecutionStatus(exec.status),
    subject: `Workflow execution (${exec.triggerType})`,
    actor: exec.triggerType === 'agent' ? 'Agent' : exec.triggerType ?? 'Manual',
    subaccountId: exec.subaccountId,
    subaccountName,
    agentId: null,
    agentName: null,
    severity: exec.status === 'failed' || exec.status === 'timeout' ? 'warning' as const : null,
    createdAt: (exec.createdAt ?? new Date()).toISOString(),
    updatedAt: (exec.updatedAt ?? exec.createdAt ?? new Date()).toISOString(),
    detailUrl: `/executions/${exec.id}`,
  }));
}

// ---------------------------------------------------------------------------
// Sort + filter
// ---------------------------------------------------------------------------

function sortItems(items: OpsDashboardItem[], sort: string): OpsDashboardItem[] {
  return [...items].sort((a, b) => {
    switch (sort) {
      case 'newest':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case 'oldest':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case 'severity': {
        const sa = SEVERITY_ORDER[a.severity ?? 'info'] ?? 3;
        const sb = SEVERITY_ORDER[b.severity ?? 'info'] ?? 3;
        if (sa !== sb) return sa - sb;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      case 'attention_first':
      default: {
        const oa = STATUS_ORDER[a.status];
        const ob = STATUS_ORDER[b.status];
        if (oa !== ob) return oa - ob;
        const sa = SEVERITY_ORDER[a.severity ?? 'info'] ?? 3;
        const sb = SEVERITY_ORDER[b.severity ?? 'info'] ?? 3;
        if (sa !== sb) return sa - sb;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    }
  });
}

function filterByStatus(items: OpsDashboardItem[], statuses: string[]): OpsDashboardItem[] {
  if (statuses.length === 0) return items;
  const set = new Set(statuses);
  return items.filter((i) => set.has(i.status));
}

function filterBySeverity(items: OpsDashboardItem[], severities: string[]): OpsDashboardItem[] {
  if (severities.length === 0) return items;
  const set = new Set(severities);
  return items.filter((i) => i.severity && set.has(i.severity));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listOpsDashboardItems(
  filters: OpsDashboardFilters,
  scope: OpsDashboardScope,
): Promise<{ items: OpsDashboardItem[]; total: number; hasMore: boolean }> {
  const typeFilter = filters.type ?? [];
  const shouldFetch = (t: ActivityType) => typeFilter.length === 0 || typeFilter.includes(t);

  // Fan out to data sources in parallel
  const [
    agentRunItems,
    reviewItemRows,
    healthFindingRows,
    inboxItemRows,
    playbookRunRows,
    workflowExecRows,
  ] = await Promise.all([
    shouldFetch('agent_run') ? fetchAgentRuns(scope, filters) : [],
    shouldFetch('review_item') ? fetchReviewItems(scope, filters) : [],
    shouldFetch('health_finding') ? fetchHealthFindings(scope, filters) : [],
    shouldFetch('inbox_item') ? fetchInboxItems(scope, filters) : [],
    shouldFetch('playbook_run') ? fetchPlaybookRuns(scope, filters) : [],
    shouldFetch('workflow_execution') ? fetchWorkflowExecutions(scope, filters) : [],
  ]);

  // Merge all sources
  let items: OpsDashboardItem[] = [
    ...agentRunItems,
    ...reviewItemRows,
    ...healthFindingRows,
    ...inboxItemRows,
    ...playbookRunRows,
    ...workflowExecRows,
  ];

  // Apply post-merge filters
  if (filters.status?.length) {
    items = filterByStatus(items, filters.status);
  }
  if (filters.severity?.length) {
    items = filterBySeverity(items, filters.severity);
  }

  // Sort
  items = sortItems(items, filters.sort ?? 'attention_first');

  const total = items.length;
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  const paged = items.slice(offset, offset + limit);

  return {
    items: paged,
    total,
    hasMore: offset + limit < total,
  };
}
