/**
 * StudioCanvas — vertical step-card list for the Workflow Studio.
 *
 * Spec: tasks/Workflows-spec.md §10.1.
 *
 * Renders:
 *   - Step cards top-down.
 *   - Branching forks: side-by-side mini-columns below parent.
 *   - Parallel steps: side-by-side at the same row.
 *   - Approval-on-reject: dashed back-arrow from Approval to rollback target.
 *   - Inline validation pills on steps with errors.
 *   - Inspector mount-point: div id="studio-inspector-mount" (portal anchor).
 */

import React from 'react';
import {
  computeBranchLayout,
  computeParallelLayout,
  computeRejectArrows,
  type CanvasStep,
  type StepValidationResult,
} from './studioCanvasPure.js';

// ─── Step type icons ──────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, string> = {
  agent: 'A',
  agent_call: 'A',
  action: 'Ac',
  action_call: 'Ac',
  ask: '?',
  user_input: '?',
  approval: 'Ok',
  prompt: 'P',
  conditional: 'If',
  agent_decision: 'D',
  invoke_automation: 'Run',
};

function stepTypeIcon(type: string): string {
  return TYPE_ICON[type] ?? type.slice(0, 2).toUpperCase();
}

const TYPE_COLOR: Record<string, string> = {
  agent: 'bg-indigo-100 text-indigo-700',
  agent_call: 'bg-indigo-100 text-indigo-700',
  action: 'bg-amber-100 text-amber-700',
  action_call: 'bg-amber-100 text-amber-700',
  ask: 'bg-teal-100 text-teal-700',
  user_input: 'bg-teal-100 text-teal-700',
  approval: 'bg-violet-100 text-violet-700',
  prompt: 'bg-sky-100 text-sky-700',
  conditional: 'bg-orange-100 text-orange-700',
  agent_decision: 'bg-orange-100 text-orange-700',
  invoke_automation: 'bg-emerald-100 text-emerald-700',
};

function stepTypeColor(type: string): string {
  return TYPE_COLOR[type] ?? 'bg-slate-100 text-slate-700';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StudioCanvasProps {
  steps: CanvasStep[];
  /** Per-step validation errors. Keyed by step id. */
  validationErrors?: Map<string, StepValidationResult[]>;
  /** Called when user clicks the "edit" affordance on a step card. */
  onEditStep?: (stepId: string) => void;
}

// ─── Step card ────────────────────────────────────────────────────────────────

interface StepCardProps {
  step: CanvasStep;
  errors: StepValidationResult[];
  isBranchChild?: boolean;
  branchLabel?: string;
  onEdit?: (stepId: string) => void;
}

function StepCard({ step, errors, isBranchChild, branchLabel, onEdit }: StepCardProps) {
  const hasErrors = errors.some((e) => e.severity === 'error');
  const hasWarnings = !hasErrors && errors.some((e) => e.severity === 'warning');

  return (
    <div className="flex flex-col gap-1">
      {isBranchChild && branchLabel && (
        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1">
          {branchLabel}
        </div>
      )}
      <div
        className={[
          'rounded-lg border bg-white px-3 py-2.5 shadow-sm',
          hasErrors
            ? 'border-red-300'
            : hasWarnings
            ? 'border-amber-300'
            : 'border-slate-200',
        ].join(' ')}
        data-step-id={step.id}
      >
        <div className="flex items-center gap-2">
          {/* Type icon badge */}
          <span
            className={[
              'text-[10px] font-bold px-1.5 py-0.5 rounded select-none flex-shrink-0',
              stepTypeColor(step.type),
            ].join(' ')}
            title={step.type}
          >
            {stepTypeIcon(step.type)}
          </span>

          {/* Step name */}
          <span className="text-sm font-medium text-slate-800 truncate flex-1">{step.name}</span>

          {/* Validation pill */}
          {hasErrors && (
            <span className="text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 flex-shrink-0">
              {errors.filter((e) => e.severity === 'error').length} error
              {errors.filter((e) => e.severity === 'error').length !== 1 ? 's' : ''}
            </span>
          )}
          {hasWarnings && !hasErrors && (
            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 flex-shrink-0">
              warn
            </span>
          )}

          {/* Edit affordance — opens StudioInspector via onEditStep callback */}
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(step.id)}
              className="text-[10px] text-slate-400 hover:text-slate-700 transition-colors flex-shrink-0 px-1"
              title="Edit step"
            >
              Edit
            </button>
          )}
        </div>

        {/* Step id in muted monospace */}
        <div className="text-[10px] text-slate-400 font-mono mt-0.5">{step.id}</div>

        {/* Inline validation error messages */}
        {errors.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {errors.map((e, i) => (
              <div
                key={i}
                className={[
                  'text-[10px] px-1.5 py-0.5 rounded',
                  e.severity === 'error'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-amber-50 text-amber-700',
                ].join(' ')}
              >
                [{e.rule}] {e.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Connector between cards ──────────────────────────────────────────────────

function StepConnector() {
  return (
    <div className="flex justify-center">
      <div className="w-px h-5 bg-slate-200" />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StudioCanvas({ steps, validationErrors, onEditStep }: StudioCanvasProps) {
  const errorsFor = (id: string): StepValidationResult[] =>
    validationErrors?.get(id) ?? [];

  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-sm">
        <div className="mb-2 text-2xl">+</div>
        <div>No steps yet. Add steps to build your workflow.</div>
        <div id="studio-inspector-mount" />
      </div>
    );
  }

  const renderableSteps = computeBranchLayout(steps);
  const parallelLayout = computeParallelLayout(renderableSteps);
  const rejectArrows = computeRejectArrows(steps);

  const sortedRows = Array.from(parallelLayout.keys()).sort((a, b) => a - b);

  return (
    <div className="relative flex flex-col gap-0 px-4 py-4 max-w-2xl mx-auto w-full">
      {/* Reject arrows — rendered as a simple overlay annotation for V1.
          Full SVG overlay is out-of-scope for 14a; we show a text annotation
          on the target step instead. */}
      {rejectArrows.length > 0 && (
        <div className="mb-2 space-y-1">
          {rejectArrows.map((arrow) => (
            <div
              key={`${arrow.fromStepId}->${arrow.toStepId}`}
              className="text-[10px] text-violet-600 border border-dashed border-violet-300 rounded px-2 py-1 bg-violet-50"
            >
              On reject: <span className="font-mono">{arrow.fromStepId}</span> rolls back to{' '}
              <span className="font-mono">{arrow.toStepId}</span>
            </div>
          ))}
        </div>
      )}

      {sortedRows.map((rowIndex, i) => {
        const rowSteps = parallelLayout.get(rowIndex)!;
        const isParallelRow = rowSteps.length > 1;

        return (
          <React.Fragment key={rowIndex}>
            {i > 0 && <StepConnector />}
            {isParallelRow ? (
              <div className="flex gap-3">
                {rowSteps.map((rs) => (
                  <div key={rs.step.id} className="flex-1 min-w-0">
                    <StepCard
                      step={rs.step}
                      errors={errorsFor(rs.step.id)}
                      isBranchChild={rs.isBranchChild}
                      branchLabel={rs.branchLabel}
                      onEdit={onEditStep}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <StepCard
                step={rowSteps[0].step}
                errors={errorsFor(rowSteps[0].step.id)}
                isBranchChild={rowSteps[0].isBranchChild}
                branchLabel={rowSteps[0].branchLabel}
                onEdit={onEditStep}
              />
            )}
          </React.Fragment>
        );
      })}

      {/* Inspector mount-point — used by StudioInspector for portal anchoring. */}
      <div id="studio-inspector-mount" />
    </div>
  );
}
