/**
 * server/services/recurringTasksServicePure.ts
 *
 * Pure helpers for the recurring-tasks aggregator (spec §4.4).
 *
 * No I/O, no side effects, no DB imports.
 *
 * Imported by:
 *   - server/services/recurringTasksService.ts
 *   - server/services/__tests__/recurringTasksServicePure.test.ts
 */

// ── Shared types ──────────────────────────────────────────────────────────────

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

export interface RecurringTasksResponse {
  rows: RecurringTask[];
  cursor: string | null;
  filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
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
  sortKey?: 'name' | 'fireCondition' | 'action' | 'scope' | 'project' | 'status' | 'lastFired' | 'fires30d' | 'nextFire';
  sortDir?: 'asc' | 'desc';
}

// ── Input shapes for unionRecurringTasks ──────────────────────────────────────

export interface TriggerRow {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  subaccountAgentId: string | null;
  eventType: string;
  isActive: boolean | null;
  lastTriggeredAt: Date | null;
  triggerCount: number;
}

export interface ScheduledTaskRow {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  assignedAgentId: string;
  title: string;
  isActive: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  totalRuns: number;
  consecutiveFailures: number;
}

export interface ManualRunRow {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  subaccountAgentId: string | null;
  startedAt: Date | null;
  projectId: string | null;
}

export interface AgentInfo {
  id: string;
  name: string;
}

export interface SubaccountInfo {
  id: string;
  name: string;
  isOrgSubaccount: boolean;
}

export interface ProjectInfo {
  id: string;
  name: string;
}

export interface UnionInput {
  triggers: TriggerRow[];
  scheduled: ScheduledTaskRow[];
  manualRuns: ManualRunRow[];
  agentsMap: Map<string, AgentInfo>;
  subaccountsMap: Map<string, SubaccountInfo>;
  projectsMap: Map<string, ProjectInfo>;
}

// ── TriggerOrSchedule input for formatFireCondition ───────────────────────────

export type TriggerOrSchedule =
  | { kind: 'event'; eventType?: string }
  | { kind: 'schedule' }
  | { kind: 'manual' };

// ── formatFireCondition (STUB — full implementation in C3b) ───────────────────

export function formatFireCondition(input: TriggerOrSchedule): string {
  if (input.kind === 'manual') return 'Manual run';
  if (input.kind === 'event') return `On ${input.eventType ?? 'event'}`;
  return 'Scheduled'; // C3b will expand this with RRULE parsing
}

// ── unionRecurringTasks ───────────────────────────────────────────────────────

/**
 * Union three source arrays into RecurringTask[].
 *
 * INVARIANT — deduplication:
 * - agentTrigger rows take precedence over scheduledTask rows ONLY when
 *   scheduledTasks does NOT have its own triggerId FK column (none exists in
 *   current schema). In the current schema, triggers and scheduledTasks are
 *   independent — each emits its own row with no cross-entity dedupe.
 * - Manual run rows are NEVER deduplicated against trigger/scheduled rows.
 * - Unique key for manual rows: agentId + runId.
 */
export function unionRecurringTasks(input: UnionInput): RecurringTask[] {
  const rows: RecurringTask[] = [];

  // ── 1. Trigger rows ───────────────────────────────────────────────────────
  for (const t of input.triggers) {
    const subaccount = t.subaccountId ? input.subaccountsMap.get(t.subaccountId) : undefined;
    const subaccountAgentEntry = t.subaccountAgentId
      ? findAgentBySubaccountAgentId(t.subaccountAgentId, input.agentsMap)
      : undefined;

    const agentName = subaccountAgentEntry?.name ?? 'Unknown agent';

    rows.push({
      id: `trigger:${t.id}`,
      name: `${agentName} — ${t.eventType}`,
      fireKind: 'event',
      fireCondition: formatFireCondition({ kind: 'event', eventType: t.eventType }),
      action: agentName,
      scope: subaccount
        ? { kind: subaccount.isOrgSubaccount ? 'org' : 'workspace', id: subaccount.id, name: subaccount.name }
        : { kind: 'workspace', id: t.subaccountId ?? t.organisationId, name: 'Unknown workspace' },
      project: null,
      status: (t.isActive ?? true) ? 'active' : 'paused',
      lastFiredAt: t.lastTriggeredAt ? t.lastTriggeredAt.toISOString() : null,
      fires30d: t.triggerCount,
      nextFireAt: null,
    });
  }

  // ── 2. Scheduled task rows ─────────────────────────────────────────────────
  for (const s of input.scheduled) {
    const subaccount = s.subaccountId ? input.subaccountsMap.get(s.subaccountId) : undefined;
    const agent = input.agentsMap.get(s.assignedAgentId);
    const agentName = agent?.name ?? 'Unknown agent';

    let status: RecurringTask['status'] = 'active';
    if (!s.isActive) {
      status = 'paused';
    } else if (s.consecutiveFailures > 0) {
      status = 'error';
    }

    rows.push({
      id: `schedule:${s.id}`,
      name: s.title,
      fireKind: 'schedule',
      fireCondition: formatFireCondition({ kind: 'schedule' }),
      action: agentName,
      scope: subaccount
        ? { kind: subaccount.isOrgSubaccount ? 'org' : 'workspace', id: subaccount.id, name: subaccount.name }
        : { kind: 'workspace', id: s.subaccountId ?? s.organisationId, name: 'Unknown workspace' },
      project: null,
      status,
      lastFiredAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
      fires30d: s.totalRuns,
      nextFireAt: s.nextRunAt ? s.nextRunAt.toISOString() : null,
    });
  }

  // ── 3. Manual run rows — no dedupe against trigger/schedule rows ───────────
  // Unique key: agentId + runId
  for (const r of input.manualRuns) {
    const agent = input.agentsMap.get(r.agentId);
    const agentName = agent?.name ?? 'Unknown agent';
    const subaccount = r.subaccountId ? input.subaccountsMap.get(r.subaccountId) : undefined;
    const project = r.projectId ? input.projectsMap.get(r.projectId) : undefined;

    rows.push({
      id: `manual:${r.agentId}:${r.id}`,
      name: `${agentName} (manual)`,
      fireKind: 'manual',
      fireCondition: formatFireCondition({ kind: 'manual' }),
      action: agentName,
      scope: subaccount
        ? { kind: subaccount.isOrgSubaccount ? 'org' : 'workspace', id: subaccount.id, name: subaccount.name }
        : { kind: 'workspace', id: r.subaccountId ?? r.organisationId, name: 'Unknown workspace' },
      project: project ? { id: project.id, name: project.name } : null,
      status: 'active',
      lastFiredAt: r.startedAt ? r.startedAt.toISOString() : null,
      fires30d: 1,
      nextFireAt: null,
    });
  }

  return rows;
}

/**
 * Helper: look up agent by subaccountAgentId.
 * The agentsMap is keyed by agentId, not subaccountAgentId.
 * The subaccountAgentId resolves to an agentId via the subaccountAgents join in the service tier.
 * Here we use a separate agentsBySubaccountAgentId map injected via agentsMap using the
 * subaccountAgentId as key prefix `sa:`.
 */
function findAgentBySubaccountAgentId(
  subaccountAgentId: string,
  agentsMap: Map<string, AgentInfo>,
): AgentInfo | undefined {
  return agentsMap.get(`sa:${subaccountAgentId}`);
}

// ── applySearch ───────────────────────────────────────────────────────────────

export function applySearch(rows: RecurringTask[], q?: string): RecurringTask[] {
  if (!q || q.trim() === '') return rows;
  const lower = q.toLowerCase();
  return rows.filter(
    (r) =>
      r.name.toLowerCase().includes(lower) ||
      r.fireCondition.toLowerCase().includes(lower) ||
      r.action.toLowerCase().includes(lower),
  );
}

// ── applyFilters ──────────────────────────────────────────────────────────────

export function applyFilters(rows: RecurringTask[], query: RecurringTasksQuery): RecurringTask[] {
  let result = rows;

  if (query.scope) {
    const s = query.scope;
    if (s === 'workspace') {
      result = result.filter((r) => r.scope.kind === 'workspace');
    } else if (s === 'org') {
      result = result.filter((r) => r.scope.kind === 'org');
    }
    // 'system' — no rows match in current model; returns empty
  }

  if (query.fireKind && query.fireKind.length > 0) {
    const kinds = new Set(query.fireKind);
    result = result.filter((r) => kinds.has(r.fireKind));
  }

  if (query.status && query.status.length > 0) {
    const statuses = new Set(query.status);
    result = result.filter((r) => statuses.has(r.status));
  }

  if (query.agent && query.agent.length > 0) {
    const agents = new Set(query.agent);
    result = result.filter((r) => agents.has(r.action));
  }

  if (query.project && query.project.length > 0) {
    const projects = new Set(query.project);
    result = result.filter((r) => r.project !== null && projects.has(r.project.id));
  }

  return result;
}

// ── applySortWithTiebreaker ───────────────────────────────────────────────────

type SortKey = NonNullable<RecurringTasksQuery['sortKey']>;

/**
 * Sort rows by sortKey then by id DESC tiebreaker.
 *
 * INVARIANT — null ordering:
 *   dir === 'asc'  → nulls LAST (treated as +∞)
 *   dir === 'desc' → nulls LAST (treated as +∞; nulls trail real values)
 */
export function applySortWithTiebreaker(
  rows: RecurringTask[],
  sortKey?: SortKey,
  sortDir?: 'asc' | 'desc',
): RecurringTask[] {
  const key: SortKey = sortKey ?? 'nextFire';
  const dir: 'asc' | 'desc' = sortDir ?? 'desc';

  const getValue = (r: RecurringTask): string | number | null => {
    switch (key) {
      case 'name': return r.name;
      case 'fireCondition': return r.fireCondition;
      case 'action': return r.action;
      case 'scope': return r.scope.name;
      case 'project': return r.project?.name ?? null;
      case 'status': return r.status;
      case 'lastFired': return r.lastFiredAt;
      case 'fires30d': return r.fires30d;
      case 'nextFire': return r.nextFireAt;
      default: return r.nextFireAt;
    }
  };

  return [...rows].sort((a, b) => {
    const av = getValue(a);
    const bv = getValue(b);

    // Nulls always last (regardless of dir)
    if (av === null && bv === null) {
      // Fall through to tiebreaker
    } else if (av === null) {
      return 1; // a is null → a goes after b (last)
    } else if (bv === null) {
      return -1; // b is null → b goes after a (last)
    } else {
      // Both non-null
      const cmp = (typeof av === 'number' && typeof bv === 'number')
        ? av - bv
        : (() => { const as = String(av); const bs = String(bv); return as < bs ? -1 : as > bs ? 1 : 0; })();
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }

    // Tiebreaker: id DESC
    return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
  });
}

// ── Cursor encode / decode ────────────────────────────────────────────────────

interface CursorPayload {
  v: 1;
  k: SortKey;
  d: 'asc' | 'desc';
  s: string | number | null;
  i: string;
}

export function encodeCursor(row: RecurringTask, sortKey: SortKey, sortDir: 'asc' | 'desc'): string {
  const getValue = (): string | number | null => {
    switch (sortKey) {
      case 'name': return row.name;
      case 'fireCondition': return row.fireCondition;
      case 'action': return row.action;
      case 'scope': return row.scope.name;
      case 'project': return row.project?.name ?? null;
      case 'status': return row.status;
      case 'lastFired': return row.lastFiredAt;
      case 'fires30d': return row.fires30d;
      case 'nextFire': return row.nextFireAt;
      default: return row.nextFireAt;
    }
  };

  const payload: CursorPayload = {
    v: 1,
    k: sortKey,
    d: sortDir,
    s: getValue(),
    i: row.id,
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string, expectedKey: SortKey, expectedDir: 'asc' | 'desc'): CursorPayload {
  let payload: CursorPayload;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    payload = JSON.parse(json) as CursorPayload;
  } catch {
    throw new CursorDecodeError('Cursor is malformed or corrupt');
  }

  if (!payload || payload.v !== 1 || !payload.k || !payload.d || payload.i === undefined) {
    throw new CursorDecodeError('Cursor has invalid structure');
  }

  if (payload.k !== expectedKey || payload.d !== expectedDir) {
    throw new CursorMismatchError(
      `Cursor was issued for (${payload.k}, ${payload.d}) but query is (${expectedKey}, ${expectedDir})`,
    );
  }

  return payload;
}

export class CursorDecodeError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'CursorDecodeError';
  }
}

export class CursorMismatchError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'CursorMismatchError';
  }
}

// ── paginate ──────────────────────────────────────────────────────────────────

/**
 * Cursor-aware pagination.
 * When cursor is absent, returns the first page.
 * When cursor is present, skips rows up to and including the cursor row (by id).
 */
export function paginate(
  rows: RecurringTask[],
  cursor: string | undefined,
  limit: number,
  sortKey: SortKey,
  sortDir: 'asc' | 'desc',
): { page: RecurringTask[]; nextCursor: string | null } {
  let startIdx = 0;

  if (cursor) {
    const decoded = decodeCursor(cursor, sortKey, sortDir);
    const cursorId = decoded.i;
    const idx = rows.findIndex((r) => r.id === cursorId);
    if (idx !== -1) {
      startIdx = idx + 1;
    }
  }

  const page = rows.slice(startIdx, startIdx + limit);
  const lastRow = page[page.length - 1];
  const nextCursor = page.length === limit && startIdx + limit < rows.length
    ? encodeCursor(lastRow, sortKey, sortDir)
    : null;

  return { page, nextCursor };
}

// ── buildFilterOptions ────────────────────────────────────────────────────────

/**
 * Faceted-filter semantics: each dimension's options are computed against rows
 * filtered by every OTHER active dimension but NOT this dimension itself.
 *
 * Example: with { fireKind: ['schedule'], status: ['active'] }:
 *   - fireKind options computed with only status=active filter applied
 *   - status options computed with only fireKind=schedule filter applied
 */
export function buildFilterOptions(
  searchedRows: RecurringTask[],
  query: RecurringTasksQuery,
): Record<string, Array<{ value: string; label: string; count: number }>> {
  const computeFor = (
    dimension: keyof RecurringTasksQuery,
    getKey: (r: RecurringTask) => string | null,
  ): Array<{ value: string; label: string; count: number }> => {
    // Apply all filters EXCEPT this dimension
    const filtered = applyFiltersExcept(searchedRows, query, dimension);
    const counts = new Map<string, number>();
    for (const r of filtered) {
      const val = getKey(r);
      if (val !== null) {
        counts.set(val, (counts.get(val) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => (a.value < b.value ? -1 : 1));
  };

  return {
    fireKind: computeFor('fireKind', (r) => r.fireKind),
    status: computeFor('status', (r) => r.status),
    scope: computeFor('scope', (r) => r.scope.kind),
    agent: computeFor('agent', (r) => r.action),
    project: computeFor('project', (r) => r.project?.id ?? null),
  };
}

function applyFiltersExcept(
  rows: RecurringTask[],
  query: RecurringTasksQuery,
  exclude: keyof RecurringTasksQuery,
): RecurringTask[] {
  const partial: RecurringTasksQuery = { ...query };

  // Strip pagination-only fields — these are irrelevant to filter logic and
  // guard against applyFilters ever being extended to honour them.
  partial.cursor = undefined;
  partial.limit = undefined;
  partial.sortKey = undefined;
  partial.sortDir = undefined;

  // Remove the excluded dimension from the filter
  switch (exclude) {
    case 'scope': partial.scope = undefined; break;
    case 'fireKind': partial.fireKind = undefined; break;
    case 'status': partial.status = undefined; break;
    case 'agent': partial.agent = undefined; break;
    case 'project': partial.project = undefined; break;
    default: break;
  }

  return applyFilters(rows, partial);
}
