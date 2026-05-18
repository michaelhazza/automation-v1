// client/src/pages/operate/components/RunTraceEventRenderer.tsx
//
// Renders a list of run-trace tool-call events returned by the
// /api/agent-runs/:id/trace-events endpoint with role-aware masking applied
// server-side (spec §4.8).
//
// For masked fields (value === '<redacted>'): renders a greyed-out redaction
// chip. For truncated fields (outputTruncated === true): shows visible content
// + "... [truncated]" indicator.
//
// `embedded` prop: when true, suppresses any "open in modal" / "open in
// iframe" affordances (embedded-mode recursion guard — see RunTracePage.tsx
// invariant comment).
//
// `systemEvents` prop: optional unified-stream events from the new
// /api/agent-runs/:id/trace endpoint. When provided, renders system event
// rows (controller_style_decided, policy_envelope_resolved,
// tool_security_decision) above the tool-call tree, with late-event markers.

import { useEffect, useState } from 'react';
import type { RuntimeCheckResult } from '../../../../../shared/types/runtimeCheck';
import { RuntimeCheckBadge } from '../../../components/runtimeCheck/RuntimeCheckBadge';
import api from '../../../lib/api';
import type { RunTraceEvent } from '../../../../../shared/types/runTraceEvent';
import { getSupportEventRenderer } from '../../../components/run-trace/SupportEventRenderers';
import {
  MacroReportRenderingFailedRenderer,
  MacroArtifactUploadFailedRenderer,
} from '../../../components/run-trace/MacroFailureRenderers';
import { ChainLinkDivider } from '../../../components/run-trace/ChainLinkDivider';
import { AttemptGroup } from '../../../components/run-trace/AttemptGroup';
import { RunTraceImprovementEvent } from '../../../components/operate/RunTraceImprovementEvent.js';

// ── Wire shape returned by /api/agent-runs/:id/trace-events ─────────────────

export interface RunTraceToolCallEvent {
  toolName: string;
  input: Record<string, unknown> | '<redacted>';
  output: string | '<redacted>';
  outputTruncated?: true;
  durationMs: number;
  iteration: number;
  /**
   * Canonical `agent_execution_events.id` for this tool-call. Null when no
   * matching event row exists (legacy run, fail_run-truncated log).
   * The Correct affordance is hidden when null — the corrections route
   * rejects requests without a real eventId (Trust & Verification Layer
   * spec §9 cross-entity guard).
   */
  eventId: string | null;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function RedactionChip() {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-400 border border-slate-200 select-none"
      title="Redacted — not visible at your access level"
    >
      [redacted]
    </span>
  );
}

function TruncatedIndicator() {
  return (
    <span className="text-[11px] text-slate-400 italic ml-1">
      ... [truncated]
    </span>
  );
}

function InputField({ input }: { input: Record<string, unknown> | '<redacted>' }) {
  if (input === '<redacted>') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-slate-500 font-medium">Input</span>
        <RedactionChip />
      </div>
    );
  }

  const keys = Object.keys(input);
  if (keys.length === 0) {
    return (
      <div>
        <span className="text-[12px] text-slate-500 font-medium">Input</span>
        <span className="ml-2 text-[12px] text-slate-400">(empty)</span>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[12px] text-slate-500 font-medium mb-1">Input</div>
      <pre className="text-[11px] text-slate-700 bg-slate-50 rounded-lg border border-slate-100 px-3 py-2 overflow-auto whitespace-pre-wrap break-words max-h-[120px]">
        {JSON.stringify(input, null, 2)}
      </pre>
    </div>
  );
}

function OutputField({
  output,
  outputTruncated,
}: {
  output: string | '<redacted>';
  outputTruncated?: true;
}) {
  if (output === '<redacted>') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-slate-500 font-medium">Output</span>
        <RedactionChip />
      </div>
    );
  }

  return (
    <div>
      <div className="text-[12px] text-slate-500 font-medium mb-1">Output</div>
      <div className="text-[12px] text-slate-700 bg-slate-50 rounded-lg border border-slate-100 px-3 py-2 overflow-auto whitespace-pre-wrap break-words max-h-[120px]">
        {output}
        {outputTruncated && <TruncatedIndicator />}
      </div>
    </div>
  );
}

// ── System event row (new event types from unified trace stream) ─────────────

function LateChip() {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-200 ml-1 select-none"
      title="This event arrived after the run terminated"
    >
      late
    </span>
  );
}

function SystemEventRow({ event, subaccountId }: { event: RunTraceEvent; subaccountId?: string | null }) {
  const isLate = !!event.late;

  // Phase1 support events — delegated to the support event renderer registry.
  const SupportRenderer = getSupportEventRenderer(event.eventType);
  if (SupportRenderer) {
    return <SupportRenderer event={event as { payload?: Record<string, unknown>; eventType: string }} />;
  }

  if (event.eventType === 'phase1.macro.report_rendering_failed') {
    return <MacroReportRenderingFailedRenderer event={event as { payload?: Record<string, unknown> }} />;
  }
  if (event.eventType === 'phase1.macro.artifact_upload_failed') {
    return <MacroArtifactUploadFailedRenderer event={event as { payload?: Record<string, unknown> }} />;
  }

  // ── operator-session.* event renderers (mockup r17 / c2) ────────────────────

  if (event.eventType === 'operator-session.dispatched') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-[12px] text-indigo-700">
        <span className="font-medium">Chain link {event.payload?.chainSeq ?? '?'} dispatched</span>
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'operator-session.chain_link_completed') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-[12px] text-green-700">
        <span className="font-medium">Chain link {event.payload?.chainSeq ?? '?'} completed</span>
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'operator-session.chain_link_failed') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">
        <span className="font-medium">Chain link {event.payload?.chainSeq ?? '?'} failed</span>
        {event.payload?.failureReason && (
          <span className="text-slate-400 text-[11px]">{event.payload.failureReason}</span>
        )}
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'operator-session.chain_link_cancelled') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[12px] text-slate-600">
        <span className="font-medium">Chain link {event.payload?.chainSeq ?? '?'} cancelled</span>
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'operator-session.fallback_engaged') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-700">
        <span className="font-medium">Fallback engaged</span>
        <span className="text-amber-600 text-[11px]">Switched to API key</span>
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'operator-session.auto_extending') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-700">
        <span className="font-medium">Auto-extending</span>
        <span className="text-amber-600 text-[11px]">Extending past soft cap to reach checkpoint</span>
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'operator-session.task_completed') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-[12px] text-green-700">
        <span className="font-medium">Task completed</span>
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'operator-session.task_failed') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700">
        <span className="font-medium">Task failed</span>
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'operator-session.task_cancelled') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[12px] text-slate-600">
        <span className="font-medium">Task cancelled</span>
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'operator-session.fresh_profile_restart') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[12px] text-slate-600">
        <span className="font-medium">Fresh profile restart</span>
        {event.payload?.newAttemptNumber !== undefined && (
          <span className="text-slate-400 text-[11px]">Attempt {event.payload.newAttemptNumber}</span>
        )}
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'controller_style_decided') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-[12px] text-slate-600">
        <span className="font-medium text-slate-700">Controller decided:</span>
        <span>{event.controllerStyle}</span>
        <span className="text-slate-400 text-[11px]">source: {event.source}</span>
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'policy_envelope_resolved') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-[12px] text-slate-600">
        <span className="font-medium text-slate-700">Policy envelope resolved</span>
        <span className="text-slate-400 text-[11px]">schema v{event.schemaVersion}</span>
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'tool_security_decision') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-[12px] text-slate-600">
        <span className="font-medium text-slate-700">Security decision:</span>
        <span>{event.toolSlug}</span>
        <span className="text-slate-400 text-[11px]">
          tier {event.riskTier} / gate: {event.gateLevel} ({event.gateLevelSource})
        </span>
        {isLate && <LateChip />}
      </div>
    );
  }

  if (event.eventType === 'amendment.proposed') {
    return (
      <RunTraceImprovementEvent
        skillSlug={event.skillSlug}
        kind={event.kind}
        subaccountId={subaccountId}
      />
    );
  }

  return null;
}

// ── Single event card ────────────────────────────────────────────────────────

function ToolCallEventCard({
  event,
  runtimeCheck,
  canCorrect,
  onCorrect,
}: {
  event: RunTraceToolCallEvent;
  runtimeCheck?: RuntimeCheckResult;
  canCorrect?: boolean;
  onCorrect?: (event: RunTraceToolCallEvent) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden group">
      <div className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
        <button
          type="button"
          className="flex-1 text-left flex items-center gap-3 min-w-0"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {/* Iteration badge */}
          <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 text-[11px] font-semibold flex items-center justify-center">
            {event.iteration + 1}
          </span>

          {/* Tool name */}
          <span className="flex-1 text-[13px] font-medium text-slate-800 truncate">
            {event.toolName}
          </span>

          {/* Runtime check badge */}
          {runtimeCheck && (
            <RuntimeCheckBadge
              state={runtimeCheck.state}
              reasonText={runtimeCheck.reasonText}
              suggestedFix={runtimeCheck.suggestedFix}
            />
          )}

          {/* Duration */}
          {event.durationMs > 0 && (
            <span className="shrink-0 text-[11px] text-slate-400">
              {event.durationMs < 1000
                ? `${event.durationMs}ms`
                : `${(event.durationMs / 1000).toFixed(1)}s`}
            </span>
          )}

          {/* Expand chevron */}
          <svg
            className={`shrink-0 w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Correct affordance — hover-only, visible only when canCorrect AND
            this tool call has a canonical eventId. Tool calls without an
            eventId (legacy runs / fail_run-truncated logs) are not
            correctable because the corrections route requires a real
            agent_execution_events.id (spec §9 cross-entity guard). */}
        {canCorrect && event.output !== '<redacted>' && event.eventId !== null && (
          <button
            type="button"
            onClick={() => onCorrect?.(event)}
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] font-medium text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100"
          >
            Correct
          </button>
        )}
      </div>

      {open && (
        <div className="px-4 py-3 border-t border-slate-100 flex flex-col gap-3">
          <InputField input={event.input} />
          <OutputField output={event.output} outputTruncated={event.outputTruncated} />
        </div>
      )}
    </div>
  );
}

// ── Main renderer ────────────────────────────────────────────────────────────

interface RunTraceEventRendererProps {
  /** The run ID to fetch trace events for. */
  runId: string;
  /**
   * When true, suppresses "open in modal" / "open in iframe" affordances.
   * Required by the embedded-mode recursion guard (see RunTracePage.tsx invariant).
   */
  embedded?: boolean;
  /**
   * Optional runtime check results keyed by sequenceNumber (= event.iteration).
   * When provided, a badge is rendered inline on the matching event card.
   */
  runtimeChecks?: RuntimeCheckResult[];
  /** When true, renders the hover Correct affordance on each step card. */
  canCorrect?: boolean;
  /** Called when the user clicks Correct on a step. */
  onCorrect?: (event: RunTraceToolCallEvent) => void;
  /**
   * Optional unified-stream events from /api/agent-runs/:id/trace.
   * When provided, system events (controller_style_decided,
   * policy_envelope_resolved, tool_security_decision, amendment.proposed)
   * are rendered above the tool-call tree. Late-event markers are shown on late events.
   */
  systemEvents?: RunTraceEvent[];
  /** Subaccount ID for the run — used by amendment.proposed event cards to link to the review queue. */
  subaccountId?: string | null;
}

// embedded: reserved for the recursion-guard invariant (RunTracePage.tsx). No modal affordances
// exist in this renderer today, so the prop is intentionally unused — future contributors adding
// run-id links or "view in modal" buttons MUST check this flag and suppress those affordances.
export function RunTraceEventRenderer({ runId, embedded: _embedded, runtimeChecks, canCorrect, onCorrect, systemEvents, subaccountId }: RunTraceEventRendererProps) {
  const [events, setEvents] = useState<RunTraceToolCallEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get(`/api/agent-runs/${runId}/trace-events`)
      .then(({ data }) => {
        if (!cancelled) setEvents(data.data ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error ?? 'Failed to load trace events');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [runId]);

  if (loading) {
    return (
      <div className="flex flex-col gap-2 animate-[fadeIn_0.2s_ease-out_both]">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-12 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-[13px]">
        {error}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center text-slate-500 text-[13px]">
        No tool calls recorded for this run.
      </div>
    );
  }

  // Build a lookup from sequenceNumber → RuntimeCheckResult for O(1) badge lookup per card.
  // sequenceNumber in the DB corresponds to event.iteration (0-based step index).
  const checkBySequence = new Map<number, RuntimeCheckResult>();
  if (runtimeChecks) {
    for (const rc of runtimeChecks) {
      checkBySequence.set(rc.sequenceNumber, rc);
    }
  }

  // Filter system events to the types this renderer handles: known system event
  // types, operator-session.* events, plus all phase1.* events (support agent + Macro failures).
  const SYSTEM_EVENT_TYPES = new Set([
    'controller_style_decided',
    'policy_envelope_resolved',
    'tool_security_decision',
    'amendment.proposed',
  ]);
  const filteredSystemEvents = systemEvents?.filter((e) =>
    SYSTEM_EVENT_TYPES.has(e.eventType) ||
    e.eventType.startsWith('phase1.') ||
    e.eventType.startsWith('operator-session.'),
  ) ?? [];

  // ── Operator chain-link divider logic (r17) ──────────────────────────────────
  // Group operator-session events by attempt_number and insert ChainLinkDividers
  // between events of different chain_seq values.

  const renderSystemEventList = () => {
    if (filteredSystemEvents.length === 0) return null;

    const items: React.ReactNode[] = [];
    let lastChainSeq: number | null = null;
    let lastAttemptNumber: number | null = null;
    let currentAttemptEvents: React.ReactNode[] = [];

    const flushAttemptGroup = (attempt: number) => {
      if (currentAttemptEvents.length === 0) return;
      if (attempt > 1) {
        items.push(
          <AttemptGroup key={`attempt-${attempt}`} attemptNumber={attempt}>
            {currentAttemptEvents}
          </AttemptGroup>,
        );
      } else {
        items.push(...currentAttemptEvents);
      }
      currentAttemptEvents = [];
    };

    filteredSystemEvents.forEach((event, idx) => {
      const opEvent = event as unknown as { payload?: { chainSeq?: number; attemptNumber?: number } };
      const chainSeq = opEvent.payload?.chainSeq ?? null;
      const attemptNumber = opEvent.payload?.attemptNumber ?? 1;

      if (lastAttemptNumber !== null && attemptNumber !== lastAttemptNumber) {
        flushAttemptGroup(lastAttemptNumber);
        lastChainSeq = null;
      }

      if (chainSeq !== null && chainSeq !== lastChainSeq && event.eventType.startsWith('operator-session.')) {
        currentAttemptEvents.push(
          <ChainLinkDivider key={`divider-${idx}`} chainSeq={chainSeq} startedAt={event.timestamp} />,
        );
        lastChainSeq = chainSeq;
      }

      currentAttemptEvents.push(
        <SystemEventRow key={`${event.eventType}-${idx}`} event={event} subaccountId={subaccountId} />,
      );
      lastAttemptNumber = attemptNumber;
    });

    if (lastAttemptNumber !== null) {
      flushAttemptGroup(lastAttemptNumber);
    }

    return items;
  };

  return (
    <div className="flex flex-col gap-2 animate-[fadeIn_0.2s_ease-out_both]">
      {filteredSystemEvents.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          <div className="text-[12px] text-slate-400 font-medium uppercase tracking-wider mb-1">
            System events ({filteredSystemEvents.length})
          </div>
          {renderSystemEventList()}
        </div>
      )}
      <div className="text-[12px] text-slate-400 font-medium uppercase tracking-wider mb-1">
        Tool calls ({events.length})
      </div>
      {events.map((event, idx) => (
        <ToolCallEventCard
          key={`${event.toolName}-${idx}`}
          event={event}
          runtimeCheck={checkBySequence.get(event.iteration)}
          canCorrect={canCorrect}
          onCorrect={onCorrect}
        />
      ))}
    </div>
  );
}
