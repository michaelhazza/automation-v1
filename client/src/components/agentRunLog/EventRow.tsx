import type { AgentExecutionEvent } from '../../../../shared/types/agentExecutionLog';

interface Props {
  event: AgentExecutionEvent;
  onOpen: (event: AgentExecutionEvent) => void;
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

export default function EventRow({ event, onOpen }: Props) {
  const typeLabel = TYPE_LABEL[event.eventType] ?? event.eventType;
  const isCritical =
    event.payload && typeof event.payload === 'object' && 'critical' in event.payload
      ? Boolean((event.payload as { critical?: boolean }).critical)
      : false;

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
