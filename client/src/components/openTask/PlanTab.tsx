/**
 * PlanTab — step graph view in the right pane.
 *
 * Renders planSteps from the projection. Three task types:
 * trivial (single step), multi-step (linear), workflow-fired (DAG with branches).
 *
 * Empty state: "No plan available yet." per spec §9.6.
 * Spec: docs/workflows-dev-spec.md §9.4.2.
 */

import type { PlanStep, TaskStatus } from '../../hooks/useTaskProjectionPure.js';
import { classifyTaskType } from './openTaskViewPure.js';

interface PlanTabProps {
  planSteps: PlanStep[];
  taskStatus: TaskStatus;
}

const STEP_STATUS_STYLES: Record<PlanStep['status'], string> = {
  pending:           'bg-slate-700/40 text-slate-400 border-slate-600',
  queued:            'bg-slate-700/40 text-slate-400 border-slate-600',
  running:           'bg-blue-900/40 text-blue-300 border-blue-700/60',
  completed:         'bg-emerald-900/30 text-emerald-400 border-emerald-700/40',
  failed:            'bg-red-900/30 text-red-400 border-red-700/40',
  skipped:           'bg-slate-700/20 text-slate-600 border-slate-700/30',
  awaiting_approval: 'bg-amber-900/30 text-amber-300 border-amber-700/40',
  awaiting_input:    'bg-violet-900/30 text-violet-300 border-violet-700/40',
};

const STEP_STATUS_LABEL: Record<PlanStep['status'], string> = {
  pending:           'pending',
  queued:            'queued',
  running:           'working',
  completed:         'done',
  failed:            'failed',
  skipped:           'skipped',
  awaiting_approval: 'awaiting approval',
  awaiting_input:    'awaiting input',
};

/** Stub confidence chip — Chunk 6 will provide seenConfidence per step */
function ConfidenceChip({ status }: { status: PlanStep['status'] }) {
  if (status !== 'awaiting_approval') return null;
  // Stub: always show "high" until Chunk 6 wires the real seenConfidence
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-700 border-emerald-200">
      high
    </span>
  );
}

function StepRow({ step, showConnector }: { step: PlanStep; showConnector: boolean }) {
  const statusClass = STEP_STATUS_STYLES[step.status] ?? STEP_STATUS_STYLES.pending;

  return (
    <div className="flex flex-col">
      <div className={`rounded-lg border px-3 py-2.5 ${statusClass}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-medium text-slate-200 truncate">
                {step.stepId}
              </span>
              <span className="text-[10px] text-slate-500">{step.stepType}</span>
            </div>

            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {/* Status badge */}
              <span className="text-[10px] font-semibold uppercase tracking-wide">
                {STEP_STATUS_LABEL[step.status]}
              </span>

              {/* Critical pill */}
              {step.isCritical && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-900/50 text-red-400 border border-red-700/50 uppercase tracking-wide">
                  critical
                </span>
              )}

              {/* Branch label */}
              {step.branchLabel && (
                <span className="text-[11px] font-medium text-indigo-400">
                  {step.branchLabel}
                </span>
              )}

              {/* Confidence chip (approval steps) */}
              <ConfidenceChip status={step.status} />
            </div>
          </div>
        </div>
      </div>

      {/* Vertical connector to next step */}
      {showConnector && (
        <div className="flex justify-center">
          <div className="w-px h-4 bg-slate-700/60" />
        </div>
      )}
    </div>
  );
}

/** Drafting placeholder — shown before the orchestrator has emitted any steps */
function DraftingPlaceholder() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-700/60 bg-slate-800/30 px-4 py-3">
      <span className="shrink-0 w-2 h-2 rounded-full bg-indigo-400 [animation:pulse_1.5s_ease-in-out_infinite]" />
      <span className="text-[13px] italic text-slate-400">Drafting plan...</span>
    </div>
  );
}

export default function PlanTab({ planSteps, taskStatus }: PlanTabProps) {
  // Empty state: show drafting placeholder when task is starting and no steps yet
  if (planSteps.length === 0) {
    const isDone = taskStatus === 'succeeded' || taskStatus === 'failed' || taskStatus === 'cancelled';
    if (isDone) {
      return (
        <div className="flex items-center justify-center h-full py-12">
          <p className="text-[13px] text-slate-500">No plan available yet.</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-full overflow-auto p-4">
        <DraftingPlaceholder />
      </div>
    );
  }

  const taskType = classifyTaskType(planSteps);

  return (
    <div className="flex flex-col h-full overflow-auto p-4">
      {/* Task type indicator */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[11px] text-slate-600 uppercase tracking-wider">
          {taskType === 'trivial' ? 'Single step' : taskType === 'multi-step' ? 'Multi-step' : 'Workflow'}
        </span>
        <span className="text-[11px] text-slate-700">
          {planSteps.length} step{planSteps.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Step list */}
      <div className="flex flex-col">
        {planSteps.map((step, idx) => (
          <StepRow
            key={step.stepId}
            step={step}
            showConnector={idx < planSteps.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
