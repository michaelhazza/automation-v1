// Run Trace Service — unified read across seven source ledger tables.
// Returns events for a given run with cursor pagination, late-event marking,
// and a summary + policy envelope snapshot (spec §4.4.1–§4.4.14).
//
// NOTE: routing_outcomes is excluded from the UNION because it has no run_id
// column (no FK to agent_runs). The `routing_path_chosen` event is therefore
// deferred to Phase 3 alongside canonical ledger consolidation, when
// routing_outcomes gains a run linkage. The 14-member event union (spec
// §4.4.4) reflects this Phase 1 scope. See docs/synthetos-nomenclature.md.

import { sql, and, eq } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agentRuns } from '../db/schema/index.js';
import {
  encodeCursor,
  decodeCursor,
} from '../../shared/types/runTraceEvent.js';
import type {
  RunTraceEvent,
  RunTraceEventType,
  RunTraceSummary,
} from '../../shared/types/runTraceEvent.js';
import type { PolicyEnvelopeSnapshot } from '../../shared/types/policyEnvelope.js';
import type { ControllerStyle } from '../../shared/types/controllerStyle.js';
import type { RiskTier } from '../../shared/types/riskTier.js';
import { TERMINAL_RUN_STATUSES } from '../../shared/runStatus.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunTraceQuery {
  runId: string;
  cursor?: string;
  limit?: number;
  eventTypes?: RunTraceEventType[];
  sinceTimestamp?: string;
  untilTimestamp?: string;
  toolSlug?: string;
}

export interface RunTraceResult {
  runId: string;
  events: RunTraceEvent[];
  pagination: {
    nextCursor?: string;
    hasMore: boolean;
  };
  envelope: PolicyEnvelopeSnapshot | null;
  controllerStyle: ControllerStyle;
  summary: RunTraceSummary;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class InvalidRunTraceCursorError extends Error {
  readonly statusCode = 400;
  readonly errorCode = 'invalid_run_trace_cursor';

  constructor(detail?: string) {
    super(detail ? `Invalid run trace cursor: ${detail}` : 'Invalid run trace cursor');
    this.name = 'InvalidRunTraceCursorError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ---------------------------------------------------------------------------
// Row shape returned by the UNION query
// ---------------------------------------------------------------------------

interface UnionRow {
  run_id: string;
  event_type: string;
  ts: string | Date;
  seq: string | number;
  source_table: string;
  source_id: string;
  payload: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIso(ts: string | Date): string {
  if (ts instanceof Date) return ts.toISOString();
  return ts;
}

function toSeq(seq: string | number | null | undefined): number {
  if (seq === null || seq === undefined) return 0;
  const n = Number(seq);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// UNION ALL query — returns raw rows ordered by (ts, seq, source_table, source_id)
// All parameters are passed via sql template interpolation (safe, parameterised).
//
// Cursor + filter predicates (event-type, since/until timestamp, toolSlug) are
// pushed into SQL so that LIMIT applies AFTER filtering — otherwise LIMIT N
// against the earliest N+1 rows can return an empty filtered result with
// hasMore=false even when matching events exist later in the run.
//
// `toolSlug` semantics (spec §4.4.5):
//   - `actions`                   : action_type = $toolSlug
//   - `tool_call_security_events` : tool_slug = $toolSlug (column)
//   - `agent_execution_events`    : event_type IN ('tool_call','tool_result')
//                                    AND payload->>'tool_slug' = $toolSlug
//   - all other source tables     : excluded (rows omitted entirely)
// ---------------------------------------------------------------------------

interface FetchOptions {
  runId: string;
  fetchLimit: number;
  cursorTs: string | null;
  cursorSeq: number | null;
  cursorTable: string | null;
  cursorId: string | null;
  eventTypes: string[] | null;
  sinceTimestamp: string | null;
  untilTimestamp: string | null;
  toolSlug: string | null;
}

async function fetchUnionRows(opts: FetchOptions): Promise<UnionRow[]> {
  const {
    runId,
    fetchLimit,
    cursorTs,
    cursorSeq,
    cursorTable,
    cursorId,
    eventTypes,
    sinceTimestamp,
    untilTimestamp,
    toolSlug,
  } = opts;

  // Per-arm toolSlug predicate. When toolSlug is set, non-tool-scoped tables
  // contribute zero rows; tool-scoped tables apply their column-level filter.
  const aeeToolPredicate = toolSlug !== null
    ? sql`AND event_type::text IN ('tool_call','tool_result') AND payload->>'tool_slug' = ${toolSlug}`
    : sql``;
  const tcseToolPredicate = toolSlug !== null
    ? sql`AND tool_slug = ${toolSlug}`
    : sql``;
  const actionsToolPredicate = toolSlug !== null
    ? sql`AND action_type = ${toolSlug}`
    : sql``;

  // When toolSlug is set, hide non-tool-scoped arms entirely (false-where).
  const excludeWhenToolSlug = toolSlug !== null ? sql`AND FALSE` : sql``;

  // Outer-query predicates (composable). Tuple comparison is the canonical
  // pagination predicate: (ts, seq, source_table, source_id) > (cursor...)
  // matches strictly later rows in the canonical sort order.
  const cursorPredicate = cursorTs !== null
    ? sql`AND (ts, COALESCE(seq, 0), source_table, source_id) > (${cursorTs}::timestamptz, ${cursorSeq ?? 0}, ${cursorTable ?? ''}, ${cursorId ?? ''})`
    : sql``;

  const eventTypePredicate = eventTypes !== null && eventTypes.length > 0
    ? sql`AND event_type = ANY(${eventTypes}::text[])`
    : sql``;

  const sincePredicate = sinceTimestamp !== null
    ? sql`AND ts >= ${sinceTimestamp}::timestamptz`
    : sql``;

  const untilPredicate = untilTimestamp !== null
    ? sql`AND ts <= ${untilTimestamp}::timestamptz`
    : sql``;

  const rows = await getOrgScopedDb('runTraceService.fetchUnionRows').execute(sql`
    SELECT
      run_id,
      event_type,
      ts,
      seq,
      source_table,
      source_id,
      payload
    FROM (
      -- 1. agent_execution_events — translate native log event codes into
      -- the run-trace event vocabulary. The source event_type column uses
      -- log codes (e.g. foundation.controller_style.derived, run.started);
      -- the run-trace mapper switch expects the dotless variants. Translation
      -- happens here (in SQL) so the outer event-type filter and the mapper
      -- both operate on the canonical run-trace name. Rows whose log codes
      -- don''t translate to a run-trace type are excluded from the trace.
      -- Note: run.completed is intentionally NOT translated here — the
      -- service synthesises exactly one run_terminated event from the
      -- agent_runs row to avoid double-emission across schemas.
      SELECT
        run_id::text              AS run_id,
        CASE event_type
          WHEN 'run.started'                              THEN 'run_started'
          WHEN 'foundation.controller_style.derived'      THEN 'controller_style_decided'
          WHEN 'foundation.policy_envelope.resolved'      THEN 'policy_envelope_resolved'
          ELSE event_type::text
        END                       AS event_type,
        event_timestamp           AS ts,
        sequence_number           AS seq,
        'agent_execution_events'  AS source_table,
        id::text                  AS source_id,
        payload
      FROM agent_execution_events
      WHERE run_id = ${runId}
        AND event_type IN (
          'run.started',
          'foundation.controller_style.derived',
          'foundation.policy_envelope.resolved'
        )
      ${aeeToolPredicate}

      UNION ALL

      -- 2. delegation_outcomes (excluded when toolSlug is set per spec §4.4.5)
      SELECT
        run_id::text              AS run_id,
        CASE outcome
          WHEN 'accepted' THEN 'delegation_spawned'
          ELSE 'delegation_completed'
        END                       AS event_type,
        created_at                AS ts,
        0                         AS seq,
        'delegation_outcomes'     AS source_table,
        id::text                  AS source_id,
        jsonb_build_object(
          'targetAgentId',    target_agent_id,
          'delegationScope',  delegation_scope,
          'depth',            0,
          'outcome',          outcome,
          'reason',           reason
        )                         AS payload
      FROM delegation_outcomes
      WHERE run_id = ${runId}
      ${excludeWhenToolSlug}

      UNION ALL

      -- 3. tool_call_security_events
      SELECT
        agent_run_id::text            AS run_id,
        'tool_security_decision'      AS event_type,
        created_at                    AS ts,
        0                             AS seq,
        'tool_call_security_events'   AS source_table,
        id::text                      AS source_id,
        jsonb_build_object(
          'toolSlug',         tool_slug,
          'riskTier',         0,
          'gateLevel',        decision,
          'gateLevelSource',  'tier_default'
        )                             AS payload
      FROM tool_call_security_events
      WHERE agent_run_id = ${runId}
      ${tcseToolPredicate}

      UNION ALL

      -- 4. review_audit_records (excluded when toolSlug is set per spec §4.4.5)
      SELECT
        agent_run_id::text        AS run_id,
        'review_decided'          AS event_type,
        decided_at                AS ts,
        0                         AS seq,
        'review_audit_records'    AS source_table,
        id::text                  AS source_id,
        jsonb_build_object(
          'toolSlug',     tool_slug,
          'decision',     decision,
          'decidedBy',    decided_by,
          'requestedBy',  decided_by
        )                         AS payload
      FROM review_audit_records
      WHERE agent_run_id = ${runId}
      ${excludeWhenToolSlug}

      UNION ALL

      -- 5. actions (emit tool_proposed for proposed, tool_call for executing, tool_result for completed/failed)
      SELECT
        agent_run_id::text        AS run_id,
        CASE status
          WHEN 'proposed'   THEN 'tool_proposed'
          WHEN 'executing'  THEN 'tool_call'
          WHEN 'completed'  THEN 'tool_result'
          WHEN 'failed'     THEN 'tool_result'
          ELSE 'tool_call'
        END                       AS event_type,
        created_at                AS ts,
        0                         AS seq,
        'actions'                 AS source_table,
        id::text                  AS source_id,
        jsonb_build_object(
          'toolSlug',   action_type,
          'proposedBy', 'agent',
          'actionId',   id::text,
          'status',     CASE WHEN status IN ('completed','failed') THEN status ELSE 'ok' END,
          'durationMs', 0
        )                         AS payload
      FROM actions
      WHERE agent_run_id = ${runId}
      ${actionsToolPredicate}

      UNION ALL

      -- 6. llm_requests (excluded when toolSlug is set per spec §4.4.5)
      SELECT
        run_id::text              AS run_id,
        'llm_call'                AS event_type,
        created_at                AS ts,
        0                         AS seq,
        'llm_requests'            AS source_table,
        id::text                  AS source_id,
        jsonb_build_object(
          'llmRequestId',         id,
          'provider',             provider,
          'model',                model,
          'tokensIn',             tokens_in,
          'tokensOut',            tokens_out,
          'costWithMarginCents',  cost_with_margin_cents,
          'durationMs',           COALESCE(provider_latency_ms, 0)
        )                         AS payload
      FROM llm_requests
      WHERE run_id = ${runId}
      ${excludeWhenToolSlug}

      UNION ALL

      -- 7. iee_steps (joined via iee_runs for the agent_run_id; excluded when toolSlug is set)
      SELECT
        ir.agent_run_id::text     AS run_id,
        'iee_step'                AS event_type,
        s.created_at              AS ts,
        s.step_number             AS seq,
        'iee_steps'               AS source_table,
        s.id::text                AS source_id,
        jsonb_build_object(
          'stepKind',   s.action_type,
          'durationMs', COALESCE(s.duration_ms, 0)
        )                         AS payload
      FROM iee_steps s
      JOIN iee_runs ir ON ir.id = s.iee_run_id
      WHERE ir.agent_run_id = ${runId}
      ${excludeWhenToolSlug}
    ) AS all_events
    WHERE TRUE
      ${cursorPredicate}
      ${eventTypePredicate}
      ${sincePredicate}
      ${untilPredicate}
    ORDER BY ts ASC, COALESCE(seq, 0) ASC, source_table ASC, source_id ASC
    LIMIT ${fetchLimit}
  `);

  return rows as unknown as UnionRow[];
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

async function query(q: RunTraceQuery, orgId: string): Promise<RunTraceResult> {
  const startMs = Date.now();
  const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // ── Decode cursor ──────────────────────────────────────────────────────────
  let cursorTs: string | null = null;
  let cursorSeq: number | null = null;
  let cursorTable: string | null = null;
  let cursorId: string | null = null;

  if (q.cursor) {
    try {
      const decoded = decodeCursor(q.cursor);
      cursorTs = decoded.timestamp;
      cursorSeq = decoded.sequenceNumber;
      cursorTable = decoded.sourceTable;
      cursorId = decoded.sourceId;
    } catch {
      throw new InvalidRunTraceCursorError();
    }
  }

  // ── Fetch run row (verify org ownership + extract metadata) ───────────────
  const [run] = await getOrgScopedDb('runTraceService.query')
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      controllerStyle: agentRuns.controllerStyle,
      policyEnvelopeSnapshot: agentRuns.policyEnvelopeSnapshot,
      completedAt: agentRuns.completedAt,
      updatedAt: agentRuns.updatedAt,
      durationMs: agentRuns.durationMs,
    })
    .from(agentRuns)
    .where(and(eq(agentRuns.id, q.runId), eq(agentRuns.organisationId, orgId)))
    .limit(1);

  if (!run) {
    const err = Object.assign(new Error('Run not found'), { statusCode: 404 });
    throw err;
  }

  // ── Resolve terminal timestamp ─────────────────────────────────────────────
  const isTerminal = (TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status);
  const terminalTs: string | null = isTerminal
    ? (run.completedAt?.toISOString() ?? run.updatedAt?.toISOString() ?? null)
    : null;

  // ── Execute UNION query (fetch limit+1 for hasMore detection) ─────────────
  // Cursor + filter predicates are pushed into SQL so LIMIT applies AFTER
  // filtering — not against the earliest N+1 rows of the run. See
  // fetchUnionRows for the toolSlug semantics from spec §4.4.5.
  // No silent fallback: a DB error here must surface so observability and the
  // caller's error envelope can distinguish "no events yet" from a query failure.
  let rawRows: UnionRow[];
  try {
    rawRows = await fetchUnionRows({
      runId: q.runId,
      fetchLimit: limit + 1,
      cursorTs,
      cursorSeq,
      cursorTable,
      cursorId,
      eventTypes: q.eventTypes && q.eventTypes.length > 0 ? q.eventTypes : null,
      sinceTimestamp: q.sinceTimestamp ?? null,
      untilTimestamp: q.untilTimestamp ?? null,
      toolSlug: q.toolSlug ?? null,
    });
  } catch (err) {
    logger.error('foundation.run_trace.query_failed', {
      runId: q.runId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  const hasMore = rawRows.length > limit;
  if (hasMore) rawRows = rawRows.slice(0, limit);

  // ── Map raw rows to RunTraceEvent ──────────────────────────────────────────
  const events: RunTraceEvent[] = rawRows.map((row) => {
    const tsStr = toIso(row.ts);
    const seqNum = toSeq(row.seq);
    const isLate = terminalTs !== null && tsStr > terminalTs;
    const base = {
      id: `${row.source_table}:${row.source_id}`,
      runId: q.runId,
      organisationId: orgId,
      timestamp: tsStr,
      sequenceNumber: seqNum,
      sourceTable: row.source_table,
      sourceId: row.source_id,
      ...(isLate ? { late: true as const } : {}),
    };
    const p = row.payload ?? {};

    switch (row.event_type as RunTraceEventType) {
      case 'controller_style_decided':
        return {
          ...base,
          eventType: 'controller_style_decided' as const,
          controllerStyle: (p['controllerStyle'] as ControllerStyle) ?? 'native',
          source: (p['source'] as string) ?? 'tier_default',
        };
      case 'policy_envelope_resolved':
        return {
          ...base,
          eventType: 'policy_envelope_resolved' as const,
          schemaVersion: (p['schemaVersion'] as number) ?? 1,
          sourceCounts: (p['sourceCounts'] as Record<string, number>) ?? {},
        };
      case 'tool_proposed':
        return {
          ...base,
          eventType: 'tool_proposed' as const,
          toolSlug: (p['toolSlug'] as string) ?? '',
          proposedBy: (p['proposedBy'] as string) ?? 'agent',
        };
      case 'tool_security_decision':
        return {
          ...base,
          eventType: 'tool_security_decision' as const,
          toolSlug: (p['toolSlug'] as string) ?? '',
          riskTier: ((p['riskTier'] as RiskTier) ?? 0) as RiskTier,
          gateLevel: (p['gateLevel'] as 'auto' | 'review' | 'block') ?? 'auto',
          gateLevelSource: (p['gateLevelSource'] as string) ?? 'tier_default',
        };
      case 'tool_call':
        return {
          ...base,
          eventType: 'tool_call' as const,
          toolSlug: (p['toolSlug'] as string) ?? '',
          actionId: (p['actionId'] as string | null) ?? null,
        };
      case 'tool_result':
        return {
          ...base,
          eventType: 'tool_result' as const,
          toolSlug: (p['toolSlug'] as string) ?? '',
          status: ((p['status'] as string) === 'failed' ? 'error' : 'ok') as 'ok' | 'error',
          durationMs: (p['durationMs'] as number) ?? 0,
        };
      case 'llm_call':
        return {
          ...base,
          eventType: 'llm_call' as const,
          llmRequestId: (p['llmRequestId'] as string) ?? row.source_id,
          provider: (p['provider'] as string) ?? '',
          model: (p['model'] as string) ?? '',
          tokensIn: (p['tokensIn'] as number) ?? 0,
          tokensOut: (p['tokensOut'] as number) ?? 0,
          costWithMarginCents: (p['costWithMarginCents'] as number) ?? 0,
          durationMs: (p['durationMs'] as number) ?? 0,
        };
      case 'delegation_spawned':
        return {
          ...base,
          eventType: 'delegation_spawned' as const,
          targetAgentId: (p['targetAgentId'] as string) ?? '',
          delegationScope: (p['delegationScope'] as string) ?? '',
          depth: (p['depth'] as number) ?? 0,
        };
      case 'delegation_completed':
        return {
          ...base,
          eventType: 'delegation_completed' as const,
          targetAgentId: (p['targetAgentId'] as string) ?? '',
          outcome: ((p['outcome'] as string) === 'accepted' ? 'accepted' : 'rejected') as 'accepted' | 'rejected',
          reason: (p['reason'] as string | null) ?? null,
        };
      case 'review_requested':
        return {
          ...base,
          eventType: 'review_requested' as const,
          toolSlug: (p['toolSlug'] as string) ?? '',
          requestedBy: (p['requestedBy'] as string) ?? '',
        };
      case 'review_decided':
        return {
          ...base,
          eventType: 'review_decided' as const,
          toolSlug: (p['toolSlug'] as string) ?? '',
          decision: (p['decision'] as 'auto' | 'review' | 'block') ?? 'auto',
          decidedBy: (p['decidedBy'] as string | null) ?? null,
        };
      case 'iee_step':
        return {
          ...base,
          eventType: 'iee_step' as const,
          stepKind: (p['stepKind'] as string) ?? '',
          durationMs: (p['durationMs'] as number) ?? 0,
        };
      case 'run_started':
        return {
          ...base,
          eventType: 'run_started' as const,
          runType: (p['runType'] as string) ?? '',
          triggeredBy: (p['triggeredBy'] as string) ?? '',
        };
      case 'run_terminated':
        return {
          ...base,
          eventType: 'run_terminated' as const,
          finalStatus: (p['finalStatus'] as string) ?? '',
          failureReason: (p['failureReason'] as string | null) ?? null,
          totalDurationMs: (p['totalDurationMs'] as number) ?? 0,
        };
      default: {
        // Unknown event type — emit as tool_proposed as a safe fallback shape
        return {
          ...base,
          eventType: 'tool_proposed' as const,
          toolSlug: '',
          proposedBy: 'unknown',
        };
      }
    }
  });

  // ── Synthesise exactly one run_terminated event when the run is terminal ───
  // The synthetic event must respect the query filters and pagination window
  // — otherwise a `?eventTypes=llm_call` or `?toolSlug=X` query on a
  // terminal run would still surface the terminal event, and any page can
  // overflow `limit` by one. The synthetic event only appears when the
  // caller would have included it had it lived in a source ledger.
  if (isTerminal && terminalTs && !hasMore) {
    // - Skip if cursor is set (the cursor is past the last source row by
    //   construction; the synthetic event also lives "past" everything but
    //   we only emit it on the last page, never on cursor-paged pages).
    const cursorPaged = q.cursor !== undefined;
    // - Skip if eventTypes filter is set and run_terminated is not in it.
    const filteredOutByEventType =
      q.eventTypes !== undefined &&
      q.eventTypes.length > 0 &&
      !q.eventTypes.includes('run_terminated');
    // - Skip if toolSlug filter is set (run_terminated is not tool-scoped).
    const filteredOutByToolSlug = q.toolSlug !== undefined && q.toolSlug !== null;
    // - Skip if outside the time window.
    const beforeSince = q.sinceTimestamp ? terminalTs < q.sinceTimestamp : false;
    const afterUntil = q.untilTimestamp ? terminalTs > q.untilTimestamp : false;
    // - Skip if including it would push the page past the requested limit.
    const wouldOverflowLimit = events.length >= limit;

    if (
      !cursorPaged &&
      !filteredOutByEventType &&
      !filteredOutByToolSlug &&
      !beforeSince &&
      !afterUntil &&
      !wouldOverflowLimit
    ) {
      events.push({
        id: `synthetic:run_terminated:${q.runId}`,
        runId: q.runId,
        organisationId: orgId,
        timestamp: terminalTs,
        sequenceNumber: 9999999,
        sourceTable: 'agent_runs',
        sourceId: q.runId,
        eventType: 'run_terminated',
        finalStatus: run.status,
        failureReason: null,
        totalDurationMs: run.durationMs ?? 0,
      });
    }
  }

  // ── Build next cursor ──────────────────────────────────────────────────────
  let nextCursor: string | undefined;
  if (hasMore && rawRows.length > 0) {
    const last = rawRows[rawRows.length - 1];
    nextCursor = encodeCursor(
      toIso(last.ts),
      toSeq(last.seq),
      last.source_table,
      last.source_id,
    );
  }

  // ── Compute summary ────────────────────────────────────────────────────────
  const eventCounts: Partial<Record<RunTraceEventType, number>> = {};
  for (const ev of events) {
    eventCounts[ev.eventType] = (eventCounts[ev.eventType] ?? 0) + 1;
  }

  const totalCostCents = events.reduce((sum, ev) => {
    if (ev.eventType === 'llm_call') return sum + (ev.costWithMarginCents ?? 0);
    return sum;
  }, 0);

  const summary: RunTraceSummary = {
    finalStatus: run.status,
    totalCostCents,
    totalDurationMs: run.durationMs ?? 0,
    eventCounts,
  };

  const latencyMs = Date.now() - startMs;

  logger.info('foundation.run_trace.queried', {
    runId: q.runId,
    eventCount: events.length,
    latencyMs,
    filters: {
      hasCursor: q.cursor !== undefined,
      eventTypes: q.eventTypes ?? null,
      sinceTimestamp: q.sinceTimestamp ?? null,
      untilTimestamp: q.untilTimestamp ?? null,
      toolSlug: q.toolSlug ?? null,
    },
  });

  return {
    runId: q.runId,
    events,
    pagination: { nextCursor, hasMore },
    envelope: run.policyEnvelopeSnapshot ?? null,
    controllerStyle: run.controllerStyle,
    summary,
  };
}

export const runTraceService = { query };
