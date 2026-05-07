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

import { useEffect, useState } from 'react';
import api from '../../../lib/api';

// ── Wire shape returned by /api/agent-runs/:id/trace-events ─────────────────

export interface RunTraceToolCallEvent {
  toolName: string;
  input: Record<string, unknown> | '<redacted>';
  output: string | '<redacted>';
  outputTruncated?: true;
  durationMs: number;
  iteration: number;
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

// ── Single event card ────────────────────────────────────────────────────────

function ToolCallEventCard({ event }: { event: RunTraceToolCallEvent }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <button
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors"
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
}

export function RunTraceEventRenderer({ runId, embedded: _embedded }: RunTraceEventRendererProps) {
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

  return (
    <div className="flex flex-col gap-2 animate-[fadeIn_0.2s_ease-out_both]">
      <div className="text-[12px] text-slate-400 font-medium uppercase tracking-wider mb-1">
        Tool calls ({events.length})
      </div>
      {events.map((event, idx) => (
        <ToolCallEventCard key={`${event.toolName}-${idx}`} event={event} />
      ))}
    </div>
  );
}
