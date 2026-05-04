/**
 * StudioBottomBar — step count + cost estimate + Publish button strip,
 * pinned to the bottom of the Studio.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14a §10.2.
 */

import React from 'react';
import type { CanvasStep } from './studioCanvasPure';

interface StudioBottomBarProps {
  steps: CanvasStep[];
  onPublish: () => void;
  disabled?: boolean;
  validationErrors?: string[];
}

// Coarse per-step cost heuristic (USD). Agent/prompt steps invoke an LLM;
// action steps call an external API; ask/approval steps wait for a human.
const STEP_COST: Record<string, number> = {
  agent: 0.01,
  prompt: 0.01,
  action: 0.002,
  ask: 0,
  approval: 0,
};
const DEFAULT_STEP_COST = 0.005;

function estimateCost(steps: CanvasStep[]): string {
  if (steps.length === 0) return '$0.00';
  const total = steps.reduce((sum, s) => {
    const cost = STEP_COST[s.type] ?? DEFAULT_STEP_COST;
    return sum + cost;
  }, 0);
  return `~$${total.toFixed(3)}`;
}

export default function StudioBottomBar({
  steps,
  onPublish,
  disabled,
  validationErrors,
}: StudioBottomBarProps) {
  const hasErrors = validationErrors && validationErrors.length > 0;
  const costLabel = estimateCost(steps);

  return (
    <div className="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-3">
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500">
          {steps.length} {steps.length === 1 ? 'step' : 'steps'}
        </span>
        <span className="text-sm text-slate-400" title="Estimated cost per run (heuristic)">
          {costLabel} / run
        </span>
        {hasErrors && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {validationErrors!.length} {validationErrors!.length === 1 ? 'error' : 'errors'}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onPublish}
        disabled={disabled}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        Publish
      </button>
    </div>
  );
}
