import React from 'react';
import type { StepRun, StepDef } from './types';
import { STATUS_COLORS, SIDE_EFFECT_COLORS } from './types';
import { formatDuration } from './format';

export default function StepDetailPane({
  stepRun,
  stepDef,
}: {
  stepRun: StepRun;
  stepDef: StepDef | null;
}) {
  const duration = formatDuration(stepRun.startedAt, stepRun.completedAt);
  return (
    <div className="p-6 space-y-5">
      <section>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">
            {stepDef?.name ?? stepRun.stepId}
          </h2>
          <span
            className={`px-2 py-0.5 rounded text-xs ${
              STATUS_COLORS[stepRun.status] ?? 'bg-slate-100 text-slate-700'
            }`}
          >
            {stepRun.status}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          <span className="font-mono">{stepRun.stepId}</span>
          {' · '}
          {stepRun.stepType}
          {' · '}
          <span
            className={`${
              SIDE_EFFECT_COLORS[stepRun.sideEffectType] ?? ''
            } uppercase tracking-wide`}
          >
            {stepRun.sideEffectType}
          </span>
          {stepRun.attempt > 1 && <> · attempt {stepRun.attempt}</>}
          {duration && <> · {duration}</>}
        </p>
        {stepDef?.description && (
          <p className="mt-3 text-sm text-slate-700">{stepDef.description}</p>
        )}
      </section>

      {stepRun.error && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Error
          </h3>
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 font-mono whitespace-pre-wrap break-words">
            {stepRun.error}
          </div>
        </section>
      )}

      {stepRun.dependsOn.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Depends on
          </h3>
          <div className="flex flex-wrap gap-1">
            {stepRun.dependsOn.map((d) => (
              <code
                key={d}
                className="text-xs px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200"
              >
                {d}
              </code>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1">
          Input
        </h3>
        {stepRun.inputJson ? (
          <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-60">
            {JSON.stringify(stepRun.inputJson, null, 2)}
          </pre>
        ) : (
          <p className="text-xs text-slate-400 italic">No input recorded yet.</p>
        )}
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1">
          Output
        </h3>
        {stepRun.outputJson ? (
          <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-80">
            {JSON.stringify(stepRun.outputJson, null, 2)}
          </pre>
        ) : (
          <p className="text-xs text-slate-400 italic">
            No output yet — step is {stepRun.status}.
          </p>
        )}
      </section>
    </div>
  );
}
