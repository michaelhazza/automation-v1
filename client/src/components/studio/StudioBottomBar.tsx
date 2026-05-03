/**
 * StudioBottomBar — bottom action bar for the Workflow Studio canvas.
 *
 * Spec: tasks/Workflows-spec.md §10.2.
 *
 * Shows:
 *   - Validation status: "Valid" or "N errors: <worst error message>"
 *   - Estimated cost (aggregate of all step estimates)
 *   - Publish button (disabled when validation fails)
 */

import React from 'react';
import type { ValidationSummary } from './studioCanvasPure.js';

export interface StudioBottomBarProps {
  validation: ValidationSummary;
  /** Aggregate cost estimate in cents. */
  estimatedCostCents: number;
  /** Whether a publish operation is in progress. */
  publishing?: boolean;
  onPublish: () => void;
}

export default function StudioBottomBar({
  validation,
  estimatedCostCents,
  publishing,
  onPublish,
}: StudioBottomBarProps) {
  const publishDisabled = !validation.valid || publishing;

  function formatCost(cents: number): string {
    if (cents === 0) return '$0.00';
    return `$${(cents / 100).toFixed(2)}`;
  }

  return (
    <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-200 bg-white">
      {/* Validation status */}
      <div className="flex items-center gap-1.5 text-sm">
        {validation.valid ? (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-emerald-700 font-medium">Valid</span>
          </>
        ) : (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
            <span className="text-red-700 font-medium">
              {validation.errorCount} error{validation.errorCount !== 1 ? 's' : ''}
              {validation.worstError ? ': ' : ''}
            </span>
            {validation.worstError && (
              <span className="text-red-600 text-xs truncate max-w-xs">
                {validation.worstError}
              </span>
            )}
          </>
        )}
      </div>

      {/* Separator */}
      <div className="w-px h-4 bg-slate-200" />

      {/* Cost estimate */}
      <div className="text-sm text-slate-600">
        Est. cost:{' '}
        <span className="font-medium text-slate-800">{formatCost(estimatedCostCents)}</span>
        <span className="text-xs text-slate-400 ml-1">(pessimistic)</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Publish button */}
      <button
        type="button"
        onClick={onPublish}
        disabled={publishDisabled}
        className={[
          'px-4 py-1.5 rounded text-sm font-medium transition-colors',
          publishDisabled
            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
            : 'bg-indigo-600 text-white hover:bg-indigo-700',
        ].join(' ')}
        title={
          !validation.valid
            ? 'Fix validation errors before publishing'
            : publishing
            ? 'Publishing...'
            : 'Publish a new version'
        }
      >
        {publishing ? 'Publishing...' : 'Publish'}
      </button>
    </div>
  );
}
