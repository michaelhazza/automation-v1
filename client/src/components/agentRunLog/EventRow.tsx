import { useState } from 'react';
import type { AgentExecutionEvent } from '../../../../shared/types/agentExecutionLog';
import ConfirmDialog from '../ConfirmDialog';
import {
  mapEventToViewModel,
  retryNeedsConfirmation,
  NON_IDEMPOTENT_RETRY_CONFIRM_MESSAGE,
  type InvokeAutomationFailedViewModel,
} from './eventRowPure';

/**
 * Structured request passed to onSetupConnection — replaces the previous
 * (provider, event) signature so callers receive enough context to navigate
 * to the right configuration screen (provider + connection slot key + the
 * spec-named errorCode that classified the failure).
 */
export interface SetupConnectionRequest {
  provider: string | undefined;
  connectionKey: string | undefined;
  errorCode: string | undefined;
  event: AgentExecutionEvent;
}

interface Props {
  event: AgentExecutionEvent;
  onOpen: (event: AgentExecutionEvent) => void;
  /** Called when the user clicks "Retry step" on a failed invoke_automation row.
   *  For non-idempotent automations, the row first prompts the user via ConfirmDialog. */
  onRetryStep?: (event: AgentExecutionEvent) => void;
  /** Called when the user clicks "Set up [Provider]" on a failed invoke_automation row. */
  onSetupConnection?: (request: SetupConnectionRequest) => void;
}

// ---------------------------------------------------------------------------
// Failed invoke_automation row (Mock 07)
// ---------------------------------------------------------------------------
// Shown when event.eventType === 'skill.completed' and the payload indicates
// an invoke_automation skill that finished with status 'error'.  We surface
// one human error line and two action buttons — no JSON, no trace internals.
//
// All payload-shape inference lives in `eventRowPure.ts` (mapEventToViewModel).

interface InvokeAutomationFailedRowProps {
  vm: InvokeAutomationFailedViewModel;
  onRetryStep: () => void;
  onSetupConnection: () => void;
}

function InvokeAutomationFailedRow({
  vm,
  onRetryStep,
  onSetupConnection,
}: InvokeAutomationFailedRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const providerLabel = vm.provider ?? 'the connection';

  const handleRetryClick = () => {
    if (retryNeedsConfirmation(vm.idempotent)) {
      setConfirmOpen(true);
    } else {
      onRetryStep();
    }
  };

  return (
    <>
      <div className="w-full border border-red-200 rounded bg-red-50/60 px-4 py-3.5">
        <div className="flex items-start gap-3">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-[5px]" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-slate-900">{vm.stepName}</div>
            <div className="text-[12.5px] text-red-800 mt-1">{vm.errorMessage}</div>
            <div className="mt-3 flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={onSetupConnection}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12.5px] font-semibold rounded-md border-0 cursor-pointer font-[inherit]"
              >
                Set up {providerLabel}
              </button>
              <button
                type="button"
                onClick={handleRetryClick}
                className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-[12.5px] font-medium rounded-md border border-slate-300 cursor-pointer font-[inherit]"
              >
                Retry step
              </button>
            </div>
          </div>
        </div>
      </div>
      {confirmOpen && (
        <ConfirmDialog
          title="Confirm retry"
          message={NON_IDEMPOTENT_RETRY_CONFIRM_MESSAGE}
          confirmLabel="Retry anyway"
          onConfirm={() => {
            setConfirmOpen(false);
            onRetryStep();
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </>
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
  // invoke_automation failure branch — view-model is computed in eventRowPure.
  // ---------------------------------------------------------------------------
  const vm = mapEventToViewModel(event);
  if (vm.kind === 'invoke_automation_failed') {
    return (
      <InvokeAutomationFailedRow
        vm={vm}
        onRetryStep={() => onRetryStep?.(event)}
        onSetupConnection={() =>
          onSetupConnection?.({
            provider: vm.provider,
            connectionKey: vm.connectionKey,
            errorCode: vm.errorCode,
            event,
          })
        }
      />
    );
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
