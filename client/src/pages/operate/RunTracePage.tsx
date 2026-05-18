// Run Trace UI — consumes GET /api/agent-runs/:runId/trace (added in synthetos-foundation-refactor). See docs/synthetos-nomenclature.md
// client/src/pages/operate/RunTracePage.tsx
//
// ============================================================
// EMBEDDED-MODE RECURSION GUARD (INVARIANT — do not remove)
// ============================================================
// When `embedded === true` this page is rendered inside an <iframe> launched
// by <RunTraceModal>. Every affordance that could open ANOTHER RunTraceModal
// or another iframe-embedded run-trace MUST be suppressed:
//
//   1. Run-id references render as plain text or copy-chip, NOT as
//      <RunTraceModal> triggers.
//   2. Cross-run links (parent/child run pointers) become:
//        <a href="/run-trace/:otherId" target="_top">
//      NOT modal launches. Using target="_top" keeps navigation in the top
//      window so the user exits the iframe rather than spawning a nested one.
//   3. The placeholder renderer (and, in C5b, <RunTraceEventRenderer>)
//      receives `embedded` as a prop and disables "open in modal" affordances.
//
// Any future feature that adds a run-id link or "open" button inside this
// page MUST check the `embedded` flag and apply the same suppression.
// ============================================================

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import api from '../../lib/api';
import { User } from '../../lib/auth';
import { AGENT_RUN_STATUS, isTerminalRunStatus } from '../../lib/runStatus';
import { useSocketRoom } from '../../hooks/useSocket';
import { parseEmbeddedFlag } from '../../lib/runTraceEmbeddedPure';
import { WorkspaceBadge } from '../../components/WorkspaceBadge';
import { PageShell } from '../../components/PageShell';
import type { RunDetail } from '../../components/runs/RunTraceView';
import CorrectDialog from '../../components/correction/CorrectDialog';
import type { RunTraceToolCallEvent } from './components/RunTraceEventRenderer';
import { RunTraceEventRenderer } from './components/RunTraceEventRenderer';
import type { RuntimeCheckResult } from '../../../../shared/types/runtimeCheck';
import { fetchRunRuntimeChecks } from '../../lib/api/runtimeChecks';
import { RuntimeCheckSummaryStrip } from '../../components/runtimeCheck/RuntimeCheckSummaryStrip';
import { collapseToOperatorBadge } from '../../lib/runtimeCheckBadgePure';
import { fetchRunTrace } from '../../lib/api/runTrace';
import type { RunTraceResult } from '../../lib/api/runTrace';
import { RunTraceHeadline } from '../../components/run-trace/RunTraceHeadline';
import { RunTraceArtifactsPanel } from '../../components/run-trace/RunTraceArtifactsPanel';
import { formatApprovalStatus } from '../../lib/runTraceFormatters';
import { RunTraceCompositionPanel } from '../../components/operate/RunTraceCompositionPanel.js';

// ── IEE progress polling (ported from RunTraceViewerPage) ─────────────────────

interface IeeProgress {
  ieeRunId: string;
  status: string;
  stepCount: number;
  heartbeatAgeSeconds: number | null;
  startedAt: string | null;
  failureReason: string | null;
}

const POLL_BACKOFF_SCHEDULE_MS = [3_000, 5_000, 10_000] as const;
const POLL_MAX_DURATION_MS = 15 * 60 * 1_000; // 15 minutes


// ── RunTracePage ──────────────────────────────────────────────────────────────

export default function RunTracePage({ user }: { user: User }) {
  const { id: runId } = useParams<{ id: string }>();
  const location = useLocation();

  // Read embedded flag ONCE on mount — not reactive (per spec §4.3).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const embedded = useRef(parseEmbeddedFlag(location.search)).current;

  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runtimeChecks, setRuntimeChecks] = useState<RuntimeCheckResult[]>([]);
  const [rcFetchState, setRcFetchState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [correctingEvent, setCorrectingEvent] = useState<RunTraceToolCallEvent | null>(null);

  const [chainRuns, setChainRuns] = useState<Array<{
    id: string; agentName: string; isSubAgent: boolean; runSource: string;
    status: string; startedAt: string | null; completedAt: string | null;
    durationMs: number | null; totalTokens: number | null;
  }>>([]);

  const [ieeProgress, setIeeProgress] = useState<IeeProgress | null>(null);
  const [traceResult, setTraceResult] = useState<RunTraceResult | null>(null);

  // ── Data fetch ──────────────────────────────────────────────────────────────

  const refreshRun = useCallback(async () => {
    if (!runId) return;
    try {
      const { data } = await api.get(`/api/agent-runs/${runId}`);
      setRun(data);
    } catch {
      // Silent — the initial load handles the error state.
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    api.get(`/api/agent-runs/${runId}`)
      .then(({ data }) => setRun(data))
      .catch((err) => setError(err.response?.data?.error ?? 'Failed to load run'))
      .finally(() => setLoading(false));
    api.get(`/api/agent-runs/${runId}/chain`)
      .then(({ data }) => setChainRuns(data.runs ?? []))
      .catch(() => setChainRuns([]));
    fetchRunTrace(runId)
      .then((result) => setTraceResult(result))
      .catch(() => setTraceResult(null));
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    setRcFetchState('loading');
    fetchRunRuntimeChecks(runId)
      .then((results) => { setRuntimeChecks(results); setRcFetchState('ok'); })
      .catch(() => { setRcFetchState('error'); });
  }, [runId]);

  // ── WebSocket room subscription (ported from RunTraceViewerPage) ─────────────

  useSocketRoom(
    'agent-run',
    runId ?? null,
    {
      'agent:run:delegated': refreshRun,
      'agent:run:completed': refreshRun,
      'agent:run:failed': refreshRun,
    },
    refreshRun,
  );

  // ── IEE Phase 0 — delegated run progress polling ────────────────────────────

  const ieeRunId = run?.status === AGENT_RUN_STATUS.DELEGATED
    ? (run?.ieeRunId ?? null)
    : null;

  // subaccountId may arrive via query param (promoted by C8 redirect from the
  // old /admin/subaccounts/:id/runs/:runId path).
  const subaccountIdFromQuery = new URLSearchParams(location.search).get('subaccountId');

  useEffect(() => {
    if (!ieeRunId) {
      setIeeProgress(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastStepCount = -1;
    let lastStatus = '';
    let backoffIdx = 0;
    const startedAt = Date.now();
    const subaccountParam = subaccountIdFromQuery
      ? `?subaccountId=${encodeURIComponent(subaccountIdFromQuery)}`
      : '';

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const scheduleNext = () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - startedAt >= POLL_MAX_DURATION_MS) return;
      const delay = POLL_BACKOFF_SCHEDULE_MS[
        Math.min(backoffIdx, POLL_BACKOFF_SCHEDULE_MS.length - 1)
      ];
      timer = setTimeout(fetchProgress, delay);
    };

    const fetchProgress = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      try {
        const { data } = await api.get(
          `/api/iee/runs/${ieeRunId}/progress${subaccountParam}`,
        );
        if (cancelled) return;
        setIeeProgress(data);
        if (['completed', 'failed', 'cancelled'].includes(data?.status)) {
          cancelled = true;
          clearTimer();
          refreshRun();
          return;
        }
        const progressed =
          typeof data?.stepCount === 'number' &&
          (data.stepCount !== lastStepCount || data.status !== lastStatus);
        if (progressed) {
          backoffIdx = 0;
          lastStepCount = typeof data.stepCount === 'number' ? data.stepCount : lastStepCount;
          lastStatus = typeof data.status === 'string' ? data.status : lastStatus;
        } else {
          backoffIdx = Math.min(backoffIdx + 1, POLL_BACKOFF_SCHEDULE_MS.length - 1);
        }
      } catch {
        backoffIdx = Math.min(backoffIdx + 1, POLL_BACKOFF_SCHEDULE_MS.length - 1);
      }
      scheduleNext();
    };

    const startPolling = () => { if (!timer) fetchProgress(); };
    const stopPolling = () => { clearTimer(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') startPolling();
      else stopPolling();
    };

    if (document.visibilityState === 'visible') startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  // refreshRun is a useCallback keyed on runId — stable while runId doesn't change mid-poll session.
  }, [ieeRunId, subaccountIdFromQuery, refreshRun]);

  // When IEE reports terminal but parent run hasn't caught up yet.
  useEffect(() => {
    if (!ieeProgress) return;
    if (
      ['completed', 'failed', 'cancelled'].includes(ieeProgress.status) &&
      run?.status === AGENT_RUN_STATUS.DELEGATED
    ) {
      const timer = setTimeout(refreshRun, 1_000);
      return () => clearTimeout(timer);
    }
  }, [ieeProgress, run?.status, refreshRun]);

  // ── Loading / error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        style={embedded ? { height: '100vh', overflow: 'auto' } : undefined}
        className="animate-[fadeIn_0.2s_ease-out_both]"
      >
        <div className="flex flex-col gap-3 p-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-12 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div
        style={embedded ? { height: '100vh', overflow: 'auto' } : undefined}
        className="animate-[fadeIn_0.2s_ease-out_both] p-6"
      >
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700 text-[14px]">
          {error ?? 'Run not found'}
        </div>
      </div>
    );
  }

  // ── Run-id display: suppressed in embedded mode (recursion guard) ───────────
  // In embedded mode, the run ID is plain text only — no modal trigger.
  const RunIdDisplay = () => (
    <span className="font-mono text-[12px] text-slate-400 select-all">{run.id}</span>
  );

  // ── Workspace badge (spec §4.5: clickable for org_admin) ───────────────────
  const workspaceBadge = run.subaccountId ? (
    <WorkspaceBadge
      clientId={run.subaccountId}
      clientName={run.subaccountName ?? 'Workspace'}
      variant="pill"
    />
  ) : null;

  // ── Header (suppressed entirely in embedded mode) ───────────────────────────
  const pageHeader = !embedded ? (
    <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
      <div className="flex-1 flex items-center gap-3 min-w-0">
        {workspaceBadge}
        <span className="text-[14px] font-semibold text-slate-800 truncate">Run Trace</span>
        <RunIdDisplay />
      </div>
    </div>
  ) : undefined;

  // ── IEE progress panel ──────────────────────────────────────────────────────
  const ieePanel =
    run.status === AGENT_RUN_STATUS.DELEGATED &&
    ieeProgress &&
    !isTerminalRunStatus(run.status) ? (
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-4 mb-4 flex items-center gap-3 text-[13px] text-indigo-800">
        <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
        <div className="font-medium">Delegated to IEE worker</div>
        <div className="text-indigo-600">·</div>
        <div>Step {ieeProgress.stepCount}</div>
        {ieeProgress.heartbeatAgeSeconds !== null && (
          <>
            <div className="text-indigo-600">·</div>
            <div>Last heartbeat {ieeProgress.heartbeatAgeSeconds}s ago</div>
          </>
        )}
        <div className="ml-auto text-[12px] text-indigo-600 font-medium">
          worker status: {ieeProgress.status}
        </div>
      </div>
    ) : null;

  // ── Chain info (suppressed in embedded mode to keep chrome minimal) ─────────
  const chainInfo =
    !embedded && chainRuns.length > 1 ? (
      <div className="bg-white rounded-xl border border-slate-200 px-5 py-3 mb-4">
        <p className="text-[13px] text-slate-500 m-0">
          Part of a chain — {chainRuns.length} runs total.
        </p>
      </div>
    ) : null;

  // ── Runtime check summary counts ────────────────────────────────────────────

  let rcPassCount = 0;
  let rcFailCount = 0;
  let rcPendingCount = 0;
  for (const rc of runtimeChecks) {
    const badge = collapseToOperatorBadge(rc.state);
    if (badge === 'pass') rcPassCount++;
    else if (badge === 'fail') rcFailCount++;
    else rcPendingCount++;
  }

  // org_admin and system_admin always hold org.review.view / subaccount.review.view.
  const canViewInbox = user.role === 'org_admin' || user.role === 'system_admin';

  // Correct affordance: org_admin / system_admin can always correct; subaccount users
  // require the subaccount.corrections.create permission (enforced server-side).
  // In embedded mode: suppress to avoid recursion issues.
  const canCorrect = !embedded && (
    user.role === 'org_admin' || user.role === 'system_admin' || user.role === 'user'
  );

  // Empty-state footer: fetch completed, zero results, but run has tool-call steps
  // (i.e. skills exist but verify is null). Distinguish from still-loading or errored.
  const rcEmptyFooter =
    rcFetchState === 'ok' &&
    runtimeChecks.length === 0 ? (
      <p className="text-[11px] text-slate-400 text-center mt-2 mb-3">
        Runtime checks not configured for these skills.
      </p>
    ) : null;

  // Error footer: fetch failed — the badges have already rendered as ghost shapes
  // via RunTraceEventRenderer receiving an empty array.
  const rcErrorFooter =
    rcFetchState === 'error' ? (
      <p className="text-[11px] text-amber-600 text-center mt-2 mb-3">
        Could not load runtime check results.
      </p>
    ) : null;

  // ── Run Trace headline (spec §5.1.1–§5.1.5) ─────────────────────────────────
  // Derived from the new /api/agent-runs/:runId/trace endpoint.
  // Shows controller style, approval status, duration, cost above the tree.
  // Absent when traceResult has not yet loaded (renders nothing, non-blocking).

  const traceHeadline = traceResult ? (() => {
    const { summary, controllerStyle: traceControllerStyle, events } = traceResult;

    // Determine hasEvents: true when trace contains tool_call / tool_result /
    // llm_call / iee_step events (spec §4.5.6 fail-before-execution predicate).
    const executionEventTypes = new Set(['tool_call', 'tool_result', 'llm_call', 'iee_step']);
    const hasEvents = events.some((e) => executionEventTypes.has(e.eventType));

    // Extract approvedBy from review_decided event if present.
    const reviewDecidedEvent = events.find(
      (e): e is typeof e & { eventType: 'review_decided'; decidedBy: string | null } =>
        e.eventType === 'review_decided',
    );
    const approvedBy = reviewDecidedEvent
      ? ((reviewDecidedEvent as { decidedBy?: string | null }).decidedBy ?? null)
      : null;

    // Extract failureReason from run_terminated event if present.
    const terminatedEvent = events.find(
      (e): e is typeof e & { eventType: 'run_terminated' } => e.eventType === 'run_terminated',
    );
    const failureReason = terminatedEvent
      ? ((terminatedEvent as { failureReason?: string | null }).failureReason ?? null)
      : null;

    const approvalStatus = formatApprovalStatus({
      finalStatus: summary.finalStatus ?? '',
      failureReason,
      hasEvents,
      approvedBy: approvedBy === null ? undefined : approvedBy,
    });

    return (
      <RunTraceHeadline
        controllerStyle={traceControllerStyle}
        approvalStatus={approvalStatus}
        durationMs={summary.totalDurationMs ?? null}
        costCents={summary.totalCostCents ?? null}
      />
    );
  })() : null;

  // ── Embedded mode: full-viewport container without PageShell chrome ─────────

  if (embedded) {
    return (
      <div
        className="run-layout animate-[fadeIn_0.2s_ease-out_both]"
        style={{ height: '100vh', overflow: 'auto', padding: '16px' }}
      >
        {ieePanel}
        {traceHeadline}
        {/* C5b: RunTraceEventRenderer with role-aware masking (spec §4.8) */}
        <RunTraceEventRenderer
          runId={run.id}
          embedded={true}
          runtimeChecks={runtimeChecks}
          systemEvents={traceResult?.events}
          subaccountId={run.subaccountId}
        />
        {rcEmptyFooter}
        {rcErrorFooter}
        <RunTraceCompositionPanel runId={run.id} />
        <RunTraceArtifactsPanel runId={run.id} />
      </div>
    );
  }

  // ── Full-page mode ──────────────────────────────────────────────────────────

  return (
    <PageShell header={pageHeader}>
      <div className="animate-[fadeIn_0.2s_ease-out_both]">
        {chainInfo}
        {ieePanel}
        {traceHeadline}
        <RuntimeCheckSummaryStrip
          passCount={rcPassCount}
          failCount={rcFailCount}
          pendingCount={rcPendingCount}
          runId={run.id}
          canViewInbox={canViewInbox}
        />
        {rcEmptyFooter}
        {rcErrorFooter}
        {/* C5b: RunTraceEventRenderer with role-aware masking (spec §4.8) */}
        <RunTraceEventRenderer
          runId={run.id}
          embedded={false}
          runtimeChecks={runtimeChecks}
          canCorrect={canCorrect}
          onCorrect={setCorrectingEvent}
          systemEvents={traceResult?.events}
          subaccountId={run.subaccountId}
        />
        <RunTraceCompositionPanel runId={run.id} />
        <RunTraceArtifactsPanel runId={run.id} />
      </div>

      {/* Correct dialog — mounts when the user clicks Correct on a step.
          eventId is the canonical agent_execution_events.id from the
          trace-events response (spec §9 cross-entity guard). The Correct
          affordance is hidden when eventId is null, so the dialog only
          mounts with a real eventId — non-null is guaranteed here. */}
      {correctingEvent && correctingEvent.eventId && (
        <CorrectDialog
          runId={run.id}
          eventId={correctingEvent.eventId}
          skillSlug={correctingEvent.toolName}
          originalOutput={
            typeof correctingEvent.output === 'string'
              ? correctingEvent.output
              : ''
          }
          onClose={() => setCorrectingEvent(null)}
          onSaved={() => setCorrectingEvent(null)}
        />
      )}
    </PageShell>
  );
}
