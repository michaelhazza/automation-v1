/**
 * ActionInspector — read-only inspector for action / action_call steps.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14b.
 */

import type { CanvasStep } from '../studioCanvasPure';

interface Props {
  step: CanvasStep;
}

export default function ActionInspector({ step }: Props) {
  const retryPolicy = step.retryPolicy as
    | { maxAttempts?: number; backoffStrategy?: string }
    | undefined;
  const failurePolicy = step.failurePolicy as string | undefined;
  const isIrreversible = step.sideEffectType === 'irreversible';

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

      <div>
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700">
          {step.type}
        </span>
      </div>

      {step.sideEffectType && (
        <div>
          <p className="text-xs text-slate-500 font-medium mb-0.5">Side effect</p>
          <p
            className={`text-xs font-medium ${isIrreversible ? 'text-red-600' : 'text-slate-700'}`}
            title="Read-only in V1"
          >
            {step.sideEffectType}
          </p>
        </div>
      )}

      {retryPolicy && (
        <div>
          <p className="text-xs text-slate-500 font-medium mb-1">Retry policy</p>
          <div className="space-y-0.5">
            {retryPolicy.maxAttempts !== undefined && (
              <p className="text-xs text-slate-700" title="Read-only in V1">
                Max attempts: {retryPolicy.maxAttempts}
              </p>
            )}
            {retryPolicy.backoffStrategy && (
              <p className="text-xs text-slate-700" title="Read-only in V1">
                Backoff: {retryPolicy.backoffStrategy}
              </p>
            )}
          </div>
        </div>
      )}

      {failurePolicy && (
        <div>
          <p className="text-xs text-slate-500 font-medium mb-0.5">Failure policy</p>
          <p className="text-xs text-slate-700" title="Read-only in V1">
            {failurePolicy}
          </p>
        </div>
      )}
    </div>
  );
}
