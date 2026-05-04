/**
 * ApprovalInspector — read-only inspector for approval steps.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14b.
 */

import type { CanvasStep } from '../studioCanvasPure';

interface Props {
  step: CanvasStep;
}

export default function ApprovalInspector({ step }: Props) {
  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-800" title="Read-only in V1">
          {step.name}
        </h2>
        <p className="font-mono text-xs text-slate-400 mt-0.5" title="Read-only in V1">
          {step.id}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-700">
          {step.type}
        </span>
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700">
          Human review required
        </span>
      </div>

      <div className="border-t border-slate-100 pt-3 space-y-2">
        <p className="text-xs text-slate-500">
          Approval pool is resolved at runtime. Confidence scoring applied per §6.
        </p>
        <p className="text-xs text-slate-500">
          All approval decisions are logged in the task event trail.
        </p>
      </div>
    </div>
  );
}
