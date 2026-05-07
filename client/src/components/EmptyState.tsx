/**
 * EmptyState — centered placeholder for empty list/page states.
 *
 * Usage:
 *   <EmptyState
 *     title="No automations yet"
 *     body="Create your first automation to get started."
 *     primaryAction={{ label: 'New automation', onClick: handleCreate }}
 *   />
 */

import { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  body?: string;
  icon?: ReactNode;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}

export function EmptyState({
  title,
  body,
  icon,
  primaryAction,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-4">
      {icon && (
        <div className="mx-auto mb-4 h-12 w-12 text-slate-400 flex items-center justify-center">
          {icon}
        </div>
      )}

      <h3 className="text-base font-medium text-slate-900 mb-1">{title}</h3>

      {body && <p className="text-sm text-slate-500 mb-4">{body}</p>}

      {(primaryAction || secondaryAction) && (
        <div className="inline-flex items-center gap-2">
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 transition-colors"
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="border border-slate-300 text-slate-700 px-4 py-2 rounded text-sm hover:bg-slate-50 transition-colors"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
