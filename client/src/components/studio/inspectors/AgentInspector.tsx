/**
 * AgentInspector — read-only inspector for agent / agent_call steps.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14b.
 */

import type { CanvasStep } from '../studioCanvasPure';

interface Props {
  step: CanvasStep;
}

export default function AgentInspector({ step }: Props) {
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
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700">
          {step.type}
        </span>
      </div>

      {step.sideEffectType && (
        <div>
          <p className="text-xs text-slate-500 font-medium mb-0.5">Side effect</p>
          <p className="text-xs text-slate-700" title="Read-only in V1">
            {step.sideEffectType}
          </p>
        </div>
      )}

      {step.dependsOn.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 font-medium mb-0.5">Depends on</p>
          <ul className="space-y-0.5">
            {step.dependsOn.map((dep) => (
              <li key={dep} className="font-mono text-xs text-slate-600" title="Read-only in V1">
                {dep}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Boolean(step.prompt) && (
        <div>
          <p className="text-xs text-slate-500 font-medium mb-0.5">Prompt</p>
          <pre className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded p-2 whitespace-pre-wrap break-words" title="Read-only in V1">
            {String(step.prompt)}
          </pre>
        </div>
      )}
    </div>
  );
}
