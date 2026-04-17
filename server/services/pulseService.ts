import { eq, and, inArray, isNull, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  reviewItems,
  tasks,
  agentRuns,
  actions,
  subaccounts,
  agents,
  workspaceHealthFindings,
} from '../db/schema/index.js';
import { getMajorThresholds } from './pulseConfigService.js';
import {
  classify,
  buildAckText,
  type PulseLane,
  type PulseItemDraft,
  type MajorReason,
} from './pulseLaneClassifier.js';

// ── Types ──────────────────────────────────────────────────────────

export interface PulseScope {
  type: 'org' | 'subaccount';
  orgId: string;
  subaccountId?: string;
  userId: string;
}

export interface PulseItem {
  id: string;
  kind: 'review' | 'task' | 'failed_run' | 'health_finding';
  lane: PulseLane;
  title: string;
  reasoning: string | null;
  evidence: Record<string, unknown> | null;
  costSummary: string;
  estimatedCostMinor: number | null;
  reversible: boolean;
  ackText: string | null;
  ackAmountMinor: number | null;
  ackCurrencyCode: string | null;
  subaccountId: string;
  subaccountName: string;
  agentId: string | null;
  agentName: string | null;
  createdAt: string;
  detailUrl: string;
  actionType: string | null;
  runId: string | null;
}

export interface PulseAttentionResponse {
  lanes: { client: PulseItem[]; major: PulseItem[]; internal: PulseItem[] };
  counts: { client: number; major: number; internal: number; total: number };
  warnings: PulseWarning[];
  isPartial: boolean;
  generatedAt: string;
}

export interface PulseWarning {
  source: 'reviews' | 'tasks' | 'runs' | 'health';
  type: 'timeout' | 'error';
}

// ── Internal helpers ───────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 2000;
const MAX_PER_SOURCE = 50;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PULSE_TIMEOUT')), ms),
    ),
  ]);
}

async function getSubaccountIdsForScope(scope: PulseScope): Promise<string[]> {
  if (scope.type === 'subaccount' && scope.subaccountId) {
    return [scope.subaccountId];
  }
  const rows = await db
    .select({ id: subaccounts.id })
    .from(subaccounts)
    .where(and(
      eq(subaccounts.organisationId, scope.orgId),
      isNull(subaccounts.deletedAt),
    ));
  return rows.map(r => r.id);
}

// ── Cost aggregation ───────────────────────────────────────────────

export async function getRunTotalCostMinor(
  runId: string,
  orgId: string,
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${actions.estimatedCostMinor}), 0)`,
    })
    .from(actions)
    .where(and(
      eq(actions.agentRunId, runId),
      eq(actions.organisationId, orgId),
      inArray(actions.status, ['pending', 'pending_approval', 'approved', 'executing', 'completed']),
    ));
  return row?.total ?? 0;
}

export async function getRunTotalCostMinorBatch(
  runIds: string[],
  orgId: string,
): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map();
  const rows = await db
    .select({
      runId: actions.agentRunId,
      total: sql<number>`COALESCE(SUM(${actions.estimatedCostMinor}), 0)`,
    })
    .from(actions)
    .where(and(
      inArray(actions.agentRunId, runIds),
      eq(actions.organisationId, orgId),
      inArray(actions.status, ['pending', 'pending_approval', 'approved', 'executing', 'completed']),
    ))
    .groupBy(actions.agentRunId);
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.runId) map.set(row.runId, row.total);
  }
  return map;
}

// ── Fetchers ───────────────────────────────────────────────────────

async function fetchPendingReviews(orgId: string, subaccountIds: string[]) {
  return db
    .select({
      id: reviewItems.id,
      actionId: reviewItems.actionId,
      agentRunId: reviewItems.agentRunId,
      subaccountId: reviewItems.subaccountId,
      reviewPayloadJson: reviewItems.reviewPayloadJson,
      createdAt: reviewItems.createdAt,
    })
    .from(reviewItems)
    .where(and(
      eq(reviewItems.organisationId, orgId),
      inArray(reviewItems.subaccountId, subaccountIds),
      inArray(reviewItems.reviewStatus, ['pending', 'edited_pending']),
    ))
    .orderBy(desc(reviewItems.createdAt))
    .limit(MAX_PER_SOURCE);
}

async function fetchInboxTasks(orgId: string, subaccountIds: string[]) {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      subaccountId: tasks.subaccountId,
      assignedAgentId: tasks.assignedAgentId,
      priority: tasks.priority,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(and(
      eq(tasks.organisationId, orgId),
      inArray(tasks.subaccountId, subaccountIds),
      eq(tasks.status, 'inbox'),
      isNull(tasks.deletedAt),
    ))
    .orderBy(desc(tasks.createdAt))
    .limit(MAX_PER_SOURCE);
}

async function fetchUnackedFailures(orgId: string, subaccountIds: string[]) {
  return db
    .select({
      id: agentRuns.id,
      subaccountId: agentRuns.subaccountId,
      agentId: agentRuns.agentId,
      status: agentRuns.status,
      errorMessage: agentRuns.errorMessage,
      summary: agentRuns.summary,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .where(and(
      eq(agentRuns.organisationId, orgId),
      inArray(agentRuns.subaccountId, subaccountIds),
      inArray(agentRuns.status, ['failed', 'timeout', 'budget_exceeded', 'loop_detected']),
      isNull(agentRuns.failureAcknowledgedAt),
    ))
    .orderBy(desc(agentRuns.createdAt))
    .limit(MAX_PER_SOURCE);
}

async function fetchOpenFindings(orgId: string, _subaccountIds: string[]) {
  return db
    .select({
      id: workspaceHealthFindings.id,
      detector: workspaceHealthFindings.detector,
      severity: workspaceHealthFindings.severity,
      resourceKind: workspaceHealthFindings.resourceKind,
      resourceLabel: workspaceHealthFindings.resourceLabel,
      message: workspaceHealthFindings.message,
      recommendation: workspaceHealthFindings.recommendation,
      detectedAt: workspaceHealthFindings.detectedAt,
    })
    .from(workspaceHealthFindings)
    .where(and(
      eq(workspaceHealthFindings.organisationId, orgId),
      isNull(workspaceHealthFindings.resolvedAt),
    ))
    .orderBy(desc(workspaceHealthFindings.detectedAt))
    .limit(MAX_PER_SOURCE);
}

// ── Draft builder ──────────────────────────────────────────────────

export function buildDraftFromAction(
  action: { actionType: string; estimatedCostMinor: number | null; subaccountScope: string },
  runTotalCostMinor?: number | null,
  subaccountName?: string,
): PulseItemDraft {
  return {
    kind: 'review',
    actionType: action.actionType,
    estimatedCostMinor: action.estimatedCostMinor,
    runTotalCostMinor: runTotalCostMinor ?? null,
    subaccountScope: (action.subaccountScope as 'single' | 'multiple') ?? 'single',
    subaccountName: subaccountName ?? '',
  };
}

// ── Subaccount + agent name cache ──────────────────────────────────

async function loadSubaccountNames(orgId: string, subaccountIds: string[]): Promise<Map<string, string>> {
  if (subaccountIds.length === 0) return new Map();
  const unique = [...new Set(subaccountIds)];
  const rows = await db
    .select({ id: subaccounts.id, name: subaccounts.name })
    .from(subaccounts)
    .where(and(
      inArray(subaccounts.id, unique),
      eq(subaccounts.organisationId, orgId),
      isNull(subaccounts.deletedAt),
    ));
  return new Map(rows.map(r => [r.id, r.name]));
}

async function loadAgentNames(orgId: string, agentIds: string[]): Promise<Map<string, string>> {
  if (agentIds.length === 0) return new Map();
  const unique = [...new Set(agentIds)];
  const rows = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(and(inArray(agents.id, unique), eq(agents.organisationId, orgId), isNull(agents.deletedAt)));
  return new Map(rows.map(r => [r.id, r.name ?? 'Unnamed Agent']));
}

// ── getAttention ───────────────────────────────────────────────────

export async function getAttention(scope: PulseScope): Promise<PulseAttentionResponse> {
  const [thresholds, subaccountIds] = await Promise.all([
    getMajorThresholds(scope.orgId),
    getSubaccountIdsForScope(scope),
  ]);

  if (subaccountIds.length === 0) {
    return {
      lanes: { client: [], major: [], internal: [] },
      counts: { client: 0, major: 0, internal: 0, total: 0 },
      warnings: [],
      isPartial: false,
      generatedAt: new Date().toISOString(),
    };
  }

  const warnings: PulseWarning[] = [];

  type SourceKey = 'reviews' | 'tasks' | 'runs' | 'health';
  const fetchers: Array<{ key: SourceKey; fn: () => Promise<unknown[]> }> = [
    { key: 'reviews', fn: () => fetchPendingReviews(scope.orgId, subaccountIds) },
    { key: 'tasks', fn: () => fetchInboxTasks(scope.orgId, subaccountIds) },
    { key: 'runs', fn: () => fetchUnackedFailures(scope.orgId, subaccountIds) },
    { key: 'health', fn: () => fetchOpenFindings(scope.orgId, subaccountIds) },
  ];

  const results = await Promise.allSettled(
    fetchers.map(f =>
      withTimeout(f.fn(), FETCH_TIMEOUT_MS).catch(err => {
        const type = err?.message === 'PULSE_TIMEOUT' ? 'timeout' : 'error';
        warnings.push({ source: f.key, type });
        return [];
      }),
    ),
  );

  const [reviewRows, taskRows, failedRunRows, findingRows] = results.map(r =>
    r.status === 'fulfilled' ? (r.value as unknown[]) : [],
  );

  // Collect all action IDs from reviews for batch loading
  const reviewData = reviewRows as Awaited<ReturnType<typeof fetchPendingReviews>>;
  const taskData = taskRows as Awaited<ReturnType<typeof fetchInboxTasks>>;
  const failedRunData = failedRunRows as Awaited<ReturnType<typeof fetchUnackedFailures>>;
  const findingData = findingRows as Awaited<ReturnType<typeof fetchOpenFindings>>;

  // Batch-load actions for review items
  const actionIds = reviewData.map(r => r.actionId).filter(Boolean) as string[];
  const actionMap = new Map<string, Awaited<ReturnType<typeof loadActions>>[number]>();
  if (actionIds.length > 0) {
    const loadedActions = await loadActions(actionIds, scope.orgId);
    for (const a of loadedActions) actionMap.set(a.id, a);
  }

  // Batch-load run totals
  const runIds = [
    ...reviewData.map(r => r.agentRunId).filter(Boolean),
    ...failedRunData.map(r => r.id),
  ].filter(Boolean) as string[];
  const runTotalsMap = await getRunTotalCostMinorBatch(runIds, scope.orgId);

  // Collect subaccount/agent IDs for name lookup
  const allSubaccountIds = [
    ...reviewData.map(r => r.subaccountId),
    ...taskData.map(r => r.subaccountId),
    ...failedRunData.map(r => r.subaccountId),
  ].filter(Boolean) as string[];
  const allAgentIds = [
    ...failedRunData.map(r => r.agentId),
  ].filter(Boolean) as string[];

  const [subaccountNameMap, agentNameMap] = await Promise.all([
    loadSubaccountNames(scope.orgId, allSubaccountIds),
    loadAgentNames(scope.orgId, allAgentIds),
  ]);

  const items: PulseItem[] = [];

  // Process reviews
  for (const review of reviewData) {
    const action = actionMap.get(review.actionId);
    if (!action) continue;
    const runId = review.agentRunId;
    const runTotal = runId ? runTotalsMap.get(runId) ?? null : null;
    const subName = (review.subaccountId && subaccountNameMap.get(review.subaccountId)) || '';
    const draft = buildDraftFromAction(action, runTotal, subName);
    const { lane, majorReason } = classify(draft, thresholds);

    let ackText: string | null = null;
    let ackAmountMinor: number | null = null;
    if (lane === 'major' && majorReason) {
      const ack = buildAckText(draft, majorReason, thresholds.currencyCode, thresholds);
      ackText = ack.text;
      ackAmountMinor = ack.amountMinor;
    }

    const payload = review.reviewPayloadJson as Record<string, unknown> | null;
    items.push({
      id: review.id,
      kind: 'review',
      lane,
      title: (payload?.actionType as string) || action.actionType,
      reasoning: (payload?.reasoning as string) || null,
      evidence: payload?.originalContext as Record<string, unknown> || null,
      costSummary: action.estimatedCostMinor != null
        ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: thresholds.currencyCode }).format(action.estimatedCostMinor / 100)
        : '',
      estimatedCostMinor: action.estimatedCostMinor,
      reversible: !majorReason || majorReason !== 'irreversible',
      ackText,
      ackAmountMinor,
      ackCurrencyCode: lane === 'major' ? thresholds.currencyCode : null,
      subaccountId: review.subaccountId || '',
      subaccountName: subName,
      agentId: null,
      agentName: null,
      createdAt: review.createdAt.toISOString(),
      detailUrl: `review:${review.id}`,
      actionType: action.actionType,
      runId: runId || null,
    });
  }

  // Process tasks
  for (const task of taskData) {
    const subName = (task.subaccountId && subaccountNameMap.get(task.subaccountId)) || '';
    items.push({
      id: task.id,
      kind: 'task',
      lane: 'internal',
      title: task.title,
      reasoning: task.description,
      evidence: null,
      costSummary: '',
      estimatedCostMinor: null,
      reversible: true,
      ackText: null,
      ackAmountMinor: null,
      ackCurrencyCode: null,
      subaccountId: task.subaccountId,
      subaccountName: subName,
      agentId: task.assignedAgentId,
      agentName: task.assignedAgentId ? agentNameMap.get(task.assignedAgentId) || null : null,
      createdAt: task.createdAt.toISOString(),
      detailUrl: `task:${task.id}`,
      actionType: null,
      runId: null,
    });
  }

  // Process failed runs
  for (const run of failedRunData) {
    const subName = (run.subaccountId && subaccountNameMap.get(run.subaccountId)) || '';
    items.push({
      id: run.id,
      kind: 'failed_run',
      lane: 'internal',
      title: `Agent run ${run.status}`,
      reasoning: run.errorMessage || run.summary || null,
      evidence: null,
      costSummary: '',
      estimatedCostMinor: null,
      reversible: true,
      ackText: null,
      ackAmountMinor: null,
      ackCurrencyCode: null,
      subaccountId: run.subaccountId || '',
      subaccountName: subName,
      agentId: run.agentId,
      agentName: agentNameMap.get(run.agentId) || null,
      createdAt: run.createdAt.toISOString(),
      detailUrl: `run:${run.id}`,
      actionType: null,
      runId: run.id,
    });
  }

  // Process health findings (org-scoped, no subaccountId)
  for (const finding of findingData) {
    items.push({
      id: finding.id,
      kind: 'health_finding',
      lane: 'internal',
      title: finding.message,
      reasoning: finding.recommendation,
      evidence: null,
      costSummary: '',
      estimatedCostMinor: null,
      reversible: true,
      ackText: null,
      ackAmountMinor: null,
      ackCurrencyCode: null,
      subaccountId: '',
      subaccountName: '',
      agentId: null,
      agentName: null,
      createdAt: finding.detectedAt.toISOString(),
      detailUrl: `health:${finding.id}`,
      actionType: null,
      runId: null,
    });
  }

  // Group by lane, sort newest first within each lane
  const lanes: PulseAttentionResponse['lanes'] = { client: [], major: [], internal: [] };
  for (const item of items) {
    lanes[item.lane].push(item);
  }
  for (const lane of Object.values(lanes)) {
    lane.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  const counts = {
    client: lanes.client.length,
    major: lanes.major.length,
    internal: lanes.internal.length,
    total: lanes.client.length + lanes.major.length + lanes.internal.length,
  };

  return {
    lanes,
    counts,
    warnings,
    isPartial: warnings.length > 0,
    generatedAt: new Date().toISOString(),
  };
}

// ── getItem (direct single-record lookup per kind) ────────────────

export async function getItem(
  scope: PulseScope,
  kind: PulseItem['kind'],
  id: string,
): Promise<PulseItem | null> {
  const orgId = scope.orgId;

  if (kind === 'review') {
    const [row] = await db
      .select({
        id: reviewItems.id,
        actionId: reviewItems.actionId,
        agentRunId: reviewItems.agentRunId,
        subaccountId: reviewItems.subaccountId,
        reviewPayloadJson: reviewItems.reviewPayloadJson,
        createdAt: reviewItems.createdAt,
      })
      .from(reviewItems)
      .where(and(
        eq(reviewItems.id, id),
        eq(reviewItems.organisationId, orgId),
        inArray(reviewItems.reviewStatus, ['pending', 'edited_pending']),
      ))
      .limit(1);
    if (!row) return null;

    const [action] = await loadActions([row.actionId].filter(Boolean) as string[], orgId);
    if (!action) return null;

    const thresholds = await getMajorThresholds(orgId);
    const runTotal = row.agentRunId ? await getRunTotalCostMinor(row.agentRunId, orgId) : null;
    const subMap = await loadSubaccountNames(orgId, [row.subaccountId].filter(Boolean) as string[]);
    const subName = (row.subaccountId && subMap.get(row.subaccountId)) || '';
    const draft = buildDraftFromAction(action, runTotal, subName);
    const { lane, majorReason } = classify(draft, thresholds);
    let ackText: string | null = null;
    let ackAmountMinor: number | null = null;
    if (lane === 'major' && majorReason) {
      const ack = buildAckText(draft, majorReason, thresholds.currencyCode, thresholds);
      ackText = ack.text;
      ackAmountMinor = ack.amountMinor;
    }
    const payload = row.reviewPayloadJson as Record<string, unknown> | null;
    return {
      id: row.id, kind: 'review', lane,
      title: (payload?.actionType as string) || action.actionType,
      reasoning: (payload?.reasoning as string) || null,
      evidence: payload?.originalContext as Record<string, unknown> || null,
      costSummary: action.estimatedCostMinor != null
        ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: thresholds.currencyCode }).format(action.estimatedCostMinor / 100)
        : '',
      estimatedCostMinor: action.estimatedCostMinor,
      reversible: !majorReason || majorReason !== 'irreversible',
      ackText, ackAmountMinor, ackCurrencyCode: lane === 'major' ? thresholds.currencyCode : null,
      subaccountId: row.subaccountId || '', subaccountName: subName,
      agentId: null, agentName: null,
      createdAt: row.createdAt.toISOString(), detailUrl: `review:${row.id}`,
      actionType: action.actionType, runId: row.agentRunId || null,
    };
  }

  if (kind === 'task') {
    const [row] = await db
      .select({ id: tasks.id, title: tasks.title, description: tasks.description, subaccountId: tasks.subaccountId, assignedAgentId: tasks.assignedAgentId, createdAt: tasks.createdAt })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, orgId), eq(tasks.status, 'inbox'), isNull(tasks.deletedAt)))
      .limit(1);
    if (!row) return null;
    const subMap = await loadSubaccountNames(orgId, [row.subaccountId].filter(Boolean) as string[]);
    return {
      id: row.id, kind: 'task', lane: 'internal', title: row.title, reasoning: row.description,
      evidence: null, costSummary: '', estimatedCostMinor: null, reversible: true,
      ackText: null, ackAmountMinor: null, ackCurrencyCode: null,
      subaccountId: row.subaccountId, subaccountName: (row.subaccountId && subMap.get(row.subaccountId)) || '',
      agentId: row.assignedAgentId, agentName: null, createdAt: row.createdAt.toISOString(),
      detailUrl: `task:${row.id}`, actionType: null, runId: null,
    };
  }

  if (kind === 'failed_run') {
    const [row] = await db
      .select({ id: agentRuns.id, subaccountId: agentRuns.subaccountId, agentId: agentRuns.agentId, status: agentRuns.status, errorMessage: agentRuns.errorMessage, summary: agentRuns.summary, createdAt: agentRuns.createdAt })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, id), eq(agentRuns.organisationId, orgId), inArray(agentRuns.status, ['failed', 'timeout', 'budget_exceeded', 'loop_detected']), isNull(agentRuns.failureAcknowledgedAt)))
      .limit(1);
    if (!row) return null;
    const subMap = await loadSubaccountNames(orgId, [row.subaccountId].filter(Boolean) as string[]);
    const agMap = await loadAgentNames(orgId, [row.agentId].filter(Boolean) as string[]);
    return {
      id: row.id, kind: 'failed_run', lane: 'internal', title: `Agent run ${row.status}`,
      reasoning: row.errorMessage || row.summary || null, evidence: null, costSummary: '',
      estimatedCostMinor: null, reversible: true, ackText: null, ackAmountMinor: null, ackCurrencyCode: null,
      subaccountId: row.subaccountId || '', subaccountName: (row.subaccountId && subMap.get(row.subaccountId)) || '',
      agentId: row.agentId, agentName: agMap.get(row.agentId) || null,
      createdAt: row.createdAt.toISOString(), detailUrl: `run:${row.id}`, actionType: null, runId: row.id,
    };
  }

  if (kind === 'health_finding') {
    const [row] = await db
      .select({ id: workspaceHealthFindings.id, message: workspaceHealthFindings.message, recommendation: workspaceHealthFindings.recommendation, detectedAt: workspaceHealthFindings.detectedAt })
      .from(workspaceHealthFindings)
      .where(and(eq(workspaceHealthFindings.id, id), eq(workspaceHealthFindings.organisationId, orgId), isNull(workspaceHealthFindings.resolvedAt)))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id, kind: 'health_finding', lane: 'internal', title: row.message,
      reasoning: row.recommendation, evidence: null, costSummary: '', estimatedCostMinor: null,
      reversible: true, ackText: null, ackAmountMinor: null, ackCurrencyCode: null,
      subaccountId: '', subaccountName: '', agentId: null, agentName: null,
      createdAt: row.detectedAt.toISOString(), detailUrl: `health:${row.id}`, actionType: null, runId: null,
    };
  }

  return null;
}

// ── getCounts ──────────────────────────────────────────────────────

export async function getCounts(scope: PulseScope): Promise<{
  attention: number;
  byLane: Record<PulseLane, number>;
}> {
  const response = await getAttention(scope);
  return {
    attention: response.counts.total,
    byLane: {
      client: response.counts.client,
      major: response.counts.major,
      internal: response.counts.internal,
    },
  };
}

// ── Batch action loader ────────────────────────────────────────────

async function loadActions(actionIds: string[], orgId: string) {
  return db
    .select({
      id: actions.id,
      actionType: actions.actionType,
      estimatedCostMinor: actions.estimatedCostMinor,
      subaccountScope: actions.subaccountScope,
    })
    .from(actions)
    .where(and(
      inArray(actions.id, actionIds),
      eq(actions.organisationId, orgId),
    ));
}
