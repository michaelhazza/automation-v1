// client/src/components/run-trace/MacroFailureRenderers.tsx
// Renderers for 42 Macro failure event types (spec §4.5.3, §5.6.3).
// Handles: phase1.macro.report_rendering_failed, phase1.macro.artifact_upload_failed.

// ── Shared primitives ────────────────────────────────────────────────────────

function WarningIcon() {
  return (
    <svg
      className="shrink-0 w-4 h-4 text-red-500 mt-0.5"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-4.75a.75.75 0 001.5 0v-4.5a.75.75 0 00-1.5 0v4.5zm.75-7a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

interface FailureCardProps {
  headline: string;
  detail: string;
  contextId?: string;
}

function FailureCard({ headline, detail, contextId }: FailureCardProps) {
  return (
    <div className="border-l-4 border-red-400 bg-red-50 rounded-r-xl px-4 py-3 flex gap-3">
      <WarningIcon />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[13px] font-medium text-red-800">{headline}</span>
        <span className="text-[12px] text-red-700">{detail}</span>
        {contextId !== undefined && (
          <span className="text-[11px] text-slate-400 font-mono truncate">{contextId}</span>
        )}
      </div>
    </div>
  );
}

// ── Event prop shape ─────────────────────────────────────────────────────────

interface FailureEventProps {
  event: { payload?: Record<string, unknown> };
}

function resolveContextId(payload?: Record<string, unknown>): string | undefined {
  if (!payload) return undefined;
  if (typeof payload.ieeRunId === 'string') return `ieeRunId: ${payload.ieeRunId}`;
  if (typeof payload.agentRunId === 'string') return `agentRunId: ${payload.agentRunId}`;
  return undefined;
}

// ── Exported renderers ───────────────────────────────────────────────────────

export function MacroReportRenderingFailedRenderer({ event }: FailureEventProps) {
  return (
    <FailureCard
      headline="Report rendering failed"
      detail="The PDF could not be generated. The run will retry on the next trigger."
      contextId={resolveContextId(event.payload)}
    />
  );
}

export function MacroArtifactUploadFailedRenderer({ event }: FailureEventProps) {
  return (
    <FailureCard
      headline="Report upload failed"
      detail="The PDF was rendered but could not be stored. The run will retry on the next trigger."
      contextId={resolveContextId(event.payload)}
    />
  );
}
