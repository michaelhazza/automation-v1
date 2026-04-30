import { eq, and, desc, asc, isNull, gte, lte, ilike, inArray, lt, gt, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  agentRuns,
  agents,
  users,
  subaccounts,
  reviewItems,
  actions,
  executions,
  workflowRuns,
  auditEvents,
} from '../db/schema/index.js';
import { workspaceHealthFindings } from '../db/schema/workspaceHealthFindings.js';
import { workspaceActors } from '../db/schema/workspaceActors.js';
import { mapAgentRunTriggerType, sortActivityItems, addNullAdditiveFields } from './activityServicePure.js';
import type { TriggerType } from './activityServicePure.js';

const VALID_TRIGGER_TYPES = new Set<string>(['manual', 'scheduled', 'webhook', 'agent', 'system']);

// ---------------------------------------------------------------------------
// Activity Service — unified activity feed across all data sources
// ---------------------------------------------------------------------------

export type ActivityType =
  | 'agent_run'
  | 'review_item'
  | 'health_finding'
  | 'inbox_item'
  | 'workflow_run'
  | 'workflow_execution'
  | 'email.sent'
  | 'email.received'
  | 'calendar.event_created'
  | 'calendar.event_accepted'
  | 'calendar.event_declined'
  | 'identity.provisioned'
  | 'identity.activated'
  | 'identity.suspended'
  | 'identity.resumed'
  | 'identity.revoked'
  | 'identity.archived'
  | 'identity.email_sending_enabled'
  | 'identity.email_sending_disabled'
  | 'identity.migrated'
  | 'identity.migration_failed'
  | 'identity.provisioning_failed'
  | 'actor.onboarded'
  | 'subaccount.migration_completed';

export type NormalisedStatus =
  | 'active'
  | 'attention_needed'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ActivityItem = {
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
  // ── Task 1.3 additive fields (all nullable) ──────────────────────────────
  triggeredByUserId: string | null;
  triggeredByUserName: string | null;
  triggerType: TriggerType | null;
  durationMs: number | null;
  runId: string | null;
};

export type ActivityScope =
  | { type: 'subaccount'; subaccountId: string; orgId: string }
  | { type: 'org'; orgId: string; subaccountId?: string }
  | { type: 'system'; organisationId?: string };

/**
 * Cursor for the activity feed (DE-CR-7 / spec §12).
 * Encodes the (createdAt, id) tuple of the LAST item in the previous page.
 * Server filter: `(createdAt, id) "after" cursor` under `createdAt DESC, id ASC` ordering, i.e.
 *   `createdAt < cursor.createdAt OR (createdAt = cursor.createdAt AND id > cursor.id)`.
 */
export interface ActivityCursor {
  createdAt: string;  // ISO string
  id: string;
}

export type ActivityFilters = {
  type?: string[];
  status?: string[];
  from?: string;
  to?: string;
  agentId?: string;
  actorId?: string;  // workspace_actors.id — covers humans + agents; takes precedence over agentId for workspace events
  severity?: string[];
  assignee?: string;
  q?: string;
  sort?: 'newest' | 'oldest' | 'severity' | 'attention_first';
  limit?: number;
  /** DE-CR-7: cursor pagination only — offset is forbidden by spec §12. */
  cursor?: ActivityCursor;
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

function normaliseWorkflowStatus(s: string): NormalisedStatus {
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
// Org ID resolver for scope
// ---------------------------------------------------------------------------

function orgIdFromScope(scope: ActivityScope): string | undefined {
  switch (scope.type) {
    case 'subaccount':
      return scope.orgId;
    case 'org':
      return scope.orgId;
    case 'system':
      return scope.organisationId;
  }
}

function subaccountIdFromScope(scope: ActivityScope): string | undefined {
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
// Cursor predicate helper — DE-CR-7
// ---------------------------------------------------------------------------

/**
 * Builds the SQL predicate that walks PAST a cursor under `createdAt DESC, id ASC`
 * ordering. Returns `undefined` when no cursor is present so the predicate can be
 * omitted from `and(...)` without producing a `WHERE TRUE` no-op.
 *
 * For a cursor C = (createdAt_c, id_c), an item is "after" C in the feed if
 * `createdAt < createdAt_c OR (createdAt = createdAt_c AND id > id_c)`.
 *
 * Each source applies this against its own canonical (createdAt, id) columns.
 * After in-memory merge + sort, items remain in canonical order because the
 * tiebreaker (id ASC) is consistent across sources.
 */
function buildCursorPredicate<C extends { name: string }, I extends { name: string }>(
  createdAtCol: C,
  idCol: I,
  cursor: ActivityCursor | undefined,
) {
  if (!cursor) return undefined;
  const cutoff = new Date(cursor.createdAt);
  // Cast columns through `any` because drizzle's column type expressions are too
  // loose to compose generically without a deep type-import dance — the runtime
  // shape is just `Column` either way.
  const c = createdAtCol as any;
  const i = idCol as any;
  return or(lt(c, cutoff), and(eq(c, cutoff), gt(i, cursor.id)));
}

// ---------------------------------------------------------------------------
// Data source fetchers
// ---------------------------------------------------------------------------

async function fetchAgentRuns(
  scope: ActivityScope,
  filters: ActivityFilters,
): Promise<ActivityItem[]> {
  const orgId = orgIdFromScope(scope);
  const subId = subaccountIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [];

  if (orgId) conditions.push(eq(agentRuns.organisationId, orgId));
  if (subId) conditions.push(eq(agentRuns.subaccountId, subId));
  if (filters.agentId) conditions.push(eq(agentRuns.agentId, filters.agentId));
  if (filters.from) conditions.push(gte(agentRuns.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(agentRuns.createdAt, new Date(filters.to)));
  if (filters.q) conditions.push(ilike(agentRuns.summary, `%${filters.q}%`));

  const cursorPredicate = buildCursorPredicate(agentRuns.createdAt, agentRuns.id, filters.cursor);
  if (cursorPredicate) conditions.push(cursorPredicate);

  const rows = await db
    .select({
      run: agentRuns,
      agentName: agents.name,
      subaccountName: subaccounts.name,
      triggeredByUserId: agentRuns.actingAsUserId,
      triggeredByUserName: users.firstName,
      triggeredByUserLastName: users.lastName,
    })
    .from(agentRuns)
    .innerJoin(agents, and(eq(agents.id, agentRuns.agentId), isNull(agents.deletedAt)))
    .leftJoin(subaccounts, and(eq(subaccounts.id, agentRuns.subaccountId), isNull(subaccounts.deletedAt)))
    // LEFT JOIN users — deleted user yields null, does NOT drop the row
    .leftJoin(users, eq(users.id, agentRuns.actingAsUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentRuns.createdAt), asc(agentRuns.id))
    .limit(200);

  return rows.map(({ run, agentName, subaccountName, triggeredByUserId, triggeredByUserName, triggeredByUserLastName }) => ({
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
    // ── Additive fields ────────────────────────────────────────────────────
    triggeredByUserId: triggeredByUserId ?? null,
    triggeredByUserName: triggeredByUserName != null
      ? (triggeredByUserLastName != null
          ? `${triggeredByUserName} ${triggeredByUserLastName}`
          : triggeredByUserName)
      : null,
    triggerType: mapAgentRunTriggerType(run.runType, run.runSource ?? null),
    durationMs: run.durationMs ?? null,
    runId: run.id,
  }));
}

async function fetchReviewItems(
  scope: ActivityScope,
  filters: ActivityFilters,
): Promise<ActivityItem[]> {
  const orgId = orgIdFromScope(scope);
  const subId = subaccountIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [];

  if (orgId) conditions.push(eq(reviewItems.organisationId, orgId));
  if (subId) conditions.push(eq(reviewItems.subaccountId, subId));
  if (filters.from) conditions.push(gte(reviewItems.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(reviewItems.createdAt, new Date(filters.to)));

  const cursorPredicate = buildCursorPredicate(reviewItems.createdAt, reviewItems.id, filters.cursor);
  if (cursorPredicate) conditions.push(cursorPredicate);

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
    .orderBy(desc(reviewItems.createdAt), asc(reviewItems.id))
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
    ...addNullAdditiveFields(),
  }));
}

async function fetchHealthFindings(
  scope: ActivityScope,
  filters: ActivityFilters,
): Promise<ActivityItem[]> {
  const orgId = orgIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [
    isNull(workspaceHealthFindings.resolvedAt),
  ];
  if (orgId) conditions.push(eq(workspaceHealthFindings.organisationId, orgId));
  if (filters.from) conditions.push(gte(workspaceHealthFindings.detectedAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(workspaceHealthFindings.detectedAt, new Date(filters.to)));
  if (filters.q) conditions.push(ilike(workspaceHealthFindings.message, `%${filters.q}%`));

  const cursorPredicate = buildCursorPredicate(workspaceHealthFindings.detectedAt, workspaceHealthFindings.id, filters.cursor);
  if (cursorPredicate) conditions.push(cursorPredicate);

  const rows = await db
    .select()
    .from(workspaceHealthFindings)
    .where(and(...conditions))
    .orderBy(desc(workspaceHealthFindings.detectedAt), asc(workspaceHealthFindings.id))
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
    ...addNullAdditiveFields(),
  }));
}

async function fetchInboxItems(
  scope: ActivityScope,
  filters: ActivityFilters,
): Promise<ActivityItem[]> {
  const orgId = orgIdFromScope(scope);
  const subId = subaccountIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [
    eq(actions.status, 'pending_approval'),
  ];

  if (orgId) conditions.push(eq(actions.organisationId, orgId));
  if (subId) conditions.push(eq(actions.subaccountId, subId));
  if (filters.from) conditions.push(gte(actions.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(actions.createdAt, new Date(filters.to)));

  const cursorPredicate = buildCursorPredicate(actions.createdAt, actions.id, filters.cursor);
  if (cursorPredicate) conditions.push(cursorPredicate);

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
    .orderBy(desc(actions.createdAt), asc(actions.id))
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
    ...addNullAdditiveFields(),
  }));
}

async function fetchWorkflowRuns(
  scope: ActivityScope,
  filters: ActivityFilters,
): Promise<ActivityItem[]> {
  const orgId = orgIdFromScope(scope);
  const subId = subaccountIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [];

  if (orgId) conditions.push(eq(workflowRuns.organisationId, orgId));
  if (subId) conditions.push(eq(workflowRuns.subaccountId, subId));
  if (filters.from) conditions.push(gte(workflowRuns.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(workflowRuns.createdAt, new Date(filters.to)));

  const cursorPredicate = buildCursorPredicate(workflowRuns.createdAt, workflowRuns.id, filters.cursor);
  if (cursorPredicate) conditions.push(cursorPredicate);

  const rows = await db
    .select({
      run: workflowRuns,
      subaccountName: subaccounts.name,
    })
    .from(workflowRuns)
    .leftJoin(subaccounts, and(eq(subaccounts.id, workflowRuns.subaccountId), isNull(subaccounts.deletedAt)))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(workflowRuns.createdAt), asc(workflowRuns.id))
    .limit(200);

  return rows.map(({ run, subaccountName }) => ({
    id: run.id,
    type: 'workflow_run' as const,
    status: normaliseWorkflowStatus(run.status),
    subject: `Workflow run (${run.runMode})`,
    actor: 'Workflow',
    subaccountId: run.subaccountId,
    subaccountName,
    agentId: null,
    agentName: null,
    severity: run.status === 'failed' ? 'warning' as const : null,
    createdAt: (run.createdAt ?? new Date()).toISOString(),
    updatedAt: (run.updatedAt ?? run.createdAt ?? new Date()).toISOString(),
    detailUrl: `/subaccounts/${run.subaccountId}/workflow-runs/${run.id}`,
    ...addNullAdditiveFields(),
  }));
}

async function fetchWorkflowExecutions(
  scope: ActivityScope,
  filters: ActivityFilters,
): Promise<ActivityItem[]> {
  const orgId = orgIdFromScope(scope);
  const subId = subaccountIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [];

  if (orgId) conditions.push(eq(executions.organisationId, orgId));
  if (subId) conditions.push(eq(executions.subaccountId, subId));
  if (filters.from) conditions.push(gte(executions.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(executions.createdAt, new Date(filters.to)));
  if (filters.q) conditions.push(ilike(executions.errorMessage, `%${filters.q}%`));

  const cursorPredicate = buildCursorPredicate(executions.createdAt, executions.id, filters.cursor);
  if (cursorPredicate) conditions.push(cursorPredicate);

  const rows = await db
    .select({
      exec: executions,
      subaccountName: subaccounts.name,
      triggeredByUserId: executions.triggeredByUserId,
      triggeredByUserName: users.firstName,
      triggeredByUserLastName: users.lastName,
    })
    .from(executions)
    .leftJoin(subaccounts, and(eq(subaccounts.id, executions.subaccountId), isNull(subaccounts.deletedAt)))
    // LEFT JOIN users — deleted user yields null, does NOT drop the row
    .leftJoin(users, eq(users.id, executions.triggeredByUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(executions.createdAt), asc(executions.id))
    .limit(200);

  return rows.map(({ exec, subaccountName, triggeredByUserId, triggeredByUserName, triggeredByUserLastName }) => ({
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
    // ── Additive fields ────────────────────────────────────────────────────
    triggeredByUserId: triggeredByUserId ?? null,
    triggeredByUserName: triggeredByUserName != null
      ? (triggeredByUserLastName != null
          ? `${triggeredByUserName} ${triggeredByUserLastName}`
          : triggeredByUserName)
      : null,
    triggerType: (exec.triggerType && VALID_TRIGGER_TYPES.has(exec.triggerType))
      ? (exec.triggerType as TriggerType)
      : null,
    durationMs: exec.durationMs ?? null,
    runId: exec.id,
  }));
}

// ---------------------------------------------------------------------------
// Workspace audit event fetcher
// ---------------------------------------------------------------------------

export const WORKSPACE_EVENT_TYPES = new Set<string>([
  'email.sent',
  'email.received',
  'calendar.event_created',
  'calendar.event_accepted',
  'calendar.event_declined',
  'identity.provisioned',
  'identity.activated',
  'identity.suspended',
  'identity.resumed',
  'identity.revoked',
  'identity.archived',
  'identity.email_sending_enabled',
  'identity.email_sending_disabled',
  'identity.migrated',
  'identity.migration_failed',
  'identity.provisioning_failed',
  'actor.onboarded',
  'subaccount.migration_completed',
]);

function formatAuditEventSubject(action: ActivityType, metadata: Record<string, unknown>): string {
  switch (action) {
    case 'email.sent': return `Email sent${metadata.to ? ` to ${metadata.to}` : ''}`;
    case 'email.received': return `Email received${metadata.from ? ` from ${metadata.from}` : ''}`;
    case 'calendar.event_created': return 'Calendar event created';
    case 'calendar.event_accepted': return 'Calendar event accepted';
    case 'calendar.event_declined': return 'Calendar event declined';
    case 'identity.provisioned': return 'Identity provisioned';
    case 'identity.activated': return 'Identity activated';
    case 'identity.suspended': return 'Identity suspended';
    case 'identity.resumed': return 'Identity resumed';
    case 'identity.revoked': return 'Identity revoked';
    case 'identity.archived': return 'Identity archived';
    case 'identity.email_sending_enabled': return 'Email sending enabled';
    case 'identity.email_sending_disabled': return 'Email sending disabled';
    case 'identity.migrated': return 'Identity migrated';
    case 'identity.migration_failed': return 'Identity migration failed';
    case 'identity.provisioning_failed': return 'Identity provisioning failed';
    case 'actor.onboarded': return 'Agent onboarded';
    case 'subaccount.migration_completed': return 'Workspace migration completed';
    default: return (action as string).replace(/\./g, ' ');
  }
}

async function fetchAuditEvents(
  scope: ActivityScope,
  filters: ActivityFilters,
): Promise<ActivityItem[]> {
  const orgId = orgIdFromScope(scope);
  const subId = subaccountIdFromScope(scope);
  const conditions: ReturnType<typeof eq>[] = [];

  if (orgId) conditions.push(eq(auditEvents.organisationId, orgId));
  if (filters.actorId) conditions.push(eq(auditEvents.workspaceActorId, filters.actorId));
  if (filters.from) conditions.push(gte(auditEvents.createdAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(auditEvents.createdAt, new Date(filters.to)));

  // Determine which workspace event types to fetch
  const typeFilter = filters.type ?? [];
  const workspaceTypes = typeFilter.length > 0
    ? typeFilter.filter((t) => WORKSPACE_EVENT_TYPES.has(t))
    : [...WORKSPACE_EVENT_TYPES];
  if (workspaceTypes.length === 0) return [];

  conditions.push(inArray(auditEvents.action, workspaceTypes));

  const cursorPredicate = buildCursorPredicate(auditEvents.createdAt, auditEvents.id, filters.cursor);
  if (cursorPredicate) conditions.push(cursorPredicate);

  const whereClause = subId
    ? and(...conditions, eq(workspaceActors.subaccountId, subId))
    : conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      workspaceActorId: auditEvents.workspaceActorId,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
      actorDisplayName: workspaceActors.displayName,
      actorSubaccountId: workspaceActors.subaccountId,
    })
    .from(auditEvents)
    .leftJoin(workspaceActors, eq(workspaceActors.id, auditEvents.workspaceActorId))
    .where(whereClause)
    .orderBy(desc(auditEvents.createdAt), asc(auditEvents.id))
    .limit(200);

  return rows.map((row) => {
    const action = row.action as ActivityType;
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      type: action,
      status: 'completed' as NormalisedStatus,
      subject: formatAuditEventSubject(action, metadata),
      actor: row.actorDisplayName ?? 'System',
      subaccountId: row.actorSubaccountId ?? null,
      subaccountName: null,
      agentId: null,
      agentName: null,
      severity: (row.action.includes('failed') ? 'warning' : null) as 'warning' | null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.createdAt.toISOString(),
      detailUrl: '',
      triggeredByUserId: null,
      triggeredByUserName: null,
      triggerType: null,
      durationMs: null,
      runId: null,
    };
  });
}

// ---------------------------------------------------------------------------
// Sort + filter
// ---------------------------------------------------------------------------

function sortItems(items: ActivityItem[], sort: string): ActivityItem[] {
  return sortActivityItems(items, sort);
}

function filterByStatus(items: ActivityItem[], statuses: string[]): ActivityItem[] {
  if (statuses.length === 0) return items;
  const set = new Set(statuses);
  return items.filter((i) => set.has(i.status));
}

function filterBySeverity(items: ActivityItem[], severities: string[]): ActivityItem[] {
  if (severities.length === 0) return items;
  const set = new Set(severities);
  return items.filter((i) => i.severity && set.has(i.severity));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listActivityItems(
  filters: ActivityFilters,
  scope: ActivityScope,
): Promise<{ items: ActivityItem[]; nextCursor: ActivityCursor | null }> {
  const typeFilter = filters.type ?? [];
  const shouldFetch = (t: ActivityType) => typeFilter.length === 0 || typeFilter.includes(t);

  // Fan out to data sources in parallel. Each fetcher applies the cursor
  // predicate at the SQL layer, so the merged set is already past the cursor.
  const [
    agentRunItems,
    reviewItemRows,
    healthFindingRows,
    inboxItemRows,
    workflowRunRows,
    workflowExecRows,
    auditEventItems,
  ] = await Promise.all([
    shouldFetch('agent_run') ? fetchAgentRuns(scope, filters) : [],
    shouldFetch('review_item') ? fetchReviewItems(scope, filters) : [],
    shouldFetch('health_finding') ? fetchHealthFindings(scope, filters) : [],
    shouldFetch('inbox_item') ? fetchInboxItems(scope, filters) : [],
    shouldFetch('workflow_run') ? fetchWorkflowRuns(scope, filters) : [],
    shouldFetch('workflow_execution') ? fetchWorkflowExecutions(scope, filters) : [],
    // Fetch audit_events if any workspace type is requested (or if no type filter)
    (typeFilter.length === 0 || typeFilter.some((t) => WORKSPACE_EVENT_TYPES.has(t)))
      ? fetchAuditEvents(scope, filters)
      : [],
  ]);

  // Merge all sources
  let items: ActivityItem[] = [
    ...agentRunItems,
    ...reviewItemRows,
    ...healthFindingRows,
    ...inboxItemRows,
    ...workflowRunRows,
    ...workflowExecRows,
    ...auditEventItems,
  ];

  // Apply post-merge filters
  if (filters.status?.length) {
    items = filterByStatus(items, filters.status);
  }
  if (filters.severity?.length) {
    items = filterBySeverity(items, filters.severity);
  }

  // Sort under the canonical (createdAt DESC, id ASC) ordering — DE-CR-8.
  items = sortItems(items, filters.sort ?? 'attention_first');

  const limit = Math.min(filters.limit ?? 50, 200);
  const paged = items.slice(0, limit);

  // DE-CR-7: emit a cursor only when the full page was filled. If we returned
  // fewer than `limit` items, there is no next page to walk to. The cursor is
  // the (createdAt, id) of the LAST item shown — clients pass it back to
  // continue under `(createdAt, id) "after" cursor` semantics.
  const last = paged[paged.length - 1];
  const nextCursor: ActivityCursor | null =
    paged.length === limit && last
      ? { createdAt: last.createdAt, id: last.id }
      : null;

  return { items: paged, nextCursor };
}
