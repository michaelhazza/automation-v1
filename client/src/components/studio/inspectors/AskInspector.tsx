/**
 * AskInspector — read-only inspector for ask / user_input steps.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14b.
 */

import type { CanvasStep } from '../studioCanvasPure';

interface Props {
  step: CanvasStep;
}

interface AskField {
  name: string;
  type?: string;
  label?: string;
}

export default function AskInspector({ step }: Props) {
  const fields = step.params?.fields as AskField[] | undefined;
  const allowSkip = step.params?.allowSkip as boolean | undefined;
  const autofill = step.params?.autofill as Record<string, unknown> | undefined;
  const approverPool = step.params?.approverPool as unknown;

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
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700">
          {step.type}
        </span>
        {allowSkip && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-600">
            Skippable
          </span>
        )}
        {autofill && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700">
            Autofill enabled
          </span>
        )}
      </div>

      {fields && fields.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 font-medium mb-1">Fields</p>
          <ul className="space-y-1.5">
            {fields.map((field, i) => (
              <li key={i} className="text-xs border border-slate-200 rounded p-2 bg-slate-50">
                <p className="font-medium text-slate-700" title="Read-only in V1">
                  {field.label ?? field.name}
                </p>
                <p className="text-slate-400 font-mono mt-0.5">
                  {field.name}
                  {field.type ? ` · ${field.type}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {approverPool !== undefined && (
        <div>
          <p className="text-xs text-slate-500 font-medium mb-0.5">Who can submit</p>
          <p className="text-xs text-slate-700" title="Read-only in V1">
            {typeof approverPool === 'string' ? approverPool : JSON.stringify(approverPool)}
          </p>
        </div>
      )}

      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-400">Ask inspector editing coming in V2</p>
      </div>
    </div>
  );
}
