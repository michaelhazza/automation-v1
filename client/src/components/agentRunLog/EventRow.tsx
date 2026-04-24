import type { AgentExecutionEvent } from '../../../../shared/types/agentExecutionLog';

interface Props {
  event: AgentExecutionEvent;
  onOpen: (event: AgentExecutionEvent) => void;
  /** Called when the user clicks "Retry step" on a failed invoke_automation row. */
  onRetryStep?: (event: AgentExecutionEvent) => void;
  /** Called when the user clicks "Set up [Provider]" on a failed invoke_automation row. */
  onSetupConnection?: (provider: string, event: AgentExecutionEvent) => void;
}

// ---------------------------------------------------------------------------
// Failed invoke_automation row (Mock 07)
// ---------------------------------------------------------------------------
// Shown when event.eventType === 'skill.completed' and the payload indicates
// an invoke_automation skill that finished with status 'error'.  We surface
// one human error line and two action buttons — no JSON, no trace internals.

interface InvokeAutomationFailedRowProps {
  stepName: string;
  errorMessage: string;
  provider?: string;
  onRetryStep: () => void;
  onSetupConnection: (provider: string) => void;
}

function InvokeAutomationFailedRow({
  stepName,
  errorMessage,
  provider,
  onRetryStep,
  onSetupConnection,
}: InvokeAutomationFailedRowProps) {
  const providerLabel = provider ?? 'the connection';
  return (
    <div className="w-full border border-red-200 rounded bg-red-50/60 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-[5px]" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-slate-900">{stepName}</div>
          <div className="text-[12.5px] text-red-800 mt-1">{errorMessage}</div>
          <div className="mt-3 flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onSetupConnection(providerLabel)}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12.5px] font-semibold rounded-md border-0 cursor-pointer font-[inherit]"
            >
              Set up {providerLabel}
            </button>
            <button
              type="button"
              onClick={onRetryStep}
              className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-[12.5px] font-medium rounded-md border border-slate-300 cursor-pointer font-[inherit]"
            >
              Retry step
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  'orchestrator.routing_decided': 'Orchestrator routed run',
  'run.started': 'Run started',
  'prompt.assembled': 'Prompt assembled',
  'context.source_loaded': 'Context source loaded',
  'memory.retrieved': 'Memory retrieved',
  'rule.evaluated': 'Policy rule evaluated',
  'skill.invoked': 'Skill invoked',
  'skill.completed': 'Skill completed',
  'llm.requested': 'LLM call started',
  'llm.completed': 'LLM call completed',
  'handoff.decided': 'Handoff decided',
  'clarification.requested': 'Clarification requested',
  'run.event_limit_reached': 'Event limit reached',
  'run.completed': 'Run completed',
};

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

export default function EventRow({ event, onOpen, onRetryStep, onSetupConnection }: Props) {
  const typeLabel = TYPE_LABEL[event.eventType] ?? event.eventType;
  const isCritical =
    event.payload && typeof event.payload === 'object' && 'critical' in event.payload
      ? Boolean((event.payload as { critical?: boolean }).critical)
      : false;

  // ---------------------------------------------------------------------------
  // invoke_automation failure branch — skill.completed with status 'error'
  // where the skill slug indicates an automation invocation.
  // ---------------------------------------------------------------------------
  if (event.eventType === 'skill.completed') {
    const p = event.payload as {
      skillSlug: string;
      status: 'ok' | 'error';
      resultSummary: string;
      skillName?: string;
    };
    const isAutomationSkill =
      p.skillSlug === 'invoke_automation' ||
      p.skillSlug.startsWith('automation.') ||
      p.skillSlug.startsWith('invoke_automation.');

    if (isAutomationSkill && p.status === 'error') {
      // Extract provider from resultSummary heuristically.
      // Automation failures typically embed the provider name, e.g.
      // "The Mailchimp connection isn't set up for this subaccount, so nothing was sent."
      const providerMatch = p.resultSummary.match(/The (\w+) connection/i);
      const provider = providerMatch ? providerMatch[1] : undefined;

      const stepName = event.linkedEntity?.label ?? p.skillName ?? p.skillSlug;

      return (
        <InvokeAutomationFailedRow
          stepName={stepName}
          errorMessage={p.resultSummary}
          provider={provider}
          onRetryStep={() => onRetryStep?.(event)}
          onSetupConnection={(prov) => onSetupConnection?.(prov, event)}
        />
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Default row — all other event types
  // ---------------------------------------------------------------------------
  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      className="w-full text-left border border-slate-200 rounded px-3 py-2 hover:bg-slate-50 flex items-start gap-3"
      aria-label={`Open event detail for ${typeLabel}`}
    >
      <div className="w-16 flex-none text-xs text-slate-500 font-mono pt-0.5">
        +{formatDurationMs(event.durationSinceRunStartMs)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${isCritical ? 'text-slate-900' : 'text-slate-700'}`}>
            {typeLabel}
          </span>
          {isCritical && (
            <span className="text-[10px] uppercase tracking-wide text-indigo-700 bg-indigo-50 rounded px-1.5 py-0.5">
              critical
            </span>
          )}
          <span className="text-[10px] text-slate-400 ml-auto font-mono">
            #{event.sequenceNumber}
          </span>
        </div>
        {event.linkedEntity && (
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-600">
            <span className="truncate">{event.linkedEntity.label}</span>
            {event.permissionMask.viewHref && (
              <a
                href={event.permissionMask.viewHref}
                onClick={(e) => e.stopPropagation()}
                className="text-indigo-600 hover:underline"
              >
                View
              </a>
            )}
            {event.permissionMask.editHref && (
              <a
                href={event.permissionMask.editHref}
                onClick={(e) => e.stopPropagation()}
                className="text-indigo-600 hover:underline"
              >
                Edit
              </a>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
