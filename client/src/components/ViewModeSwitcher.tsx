/**
 * ViewModeSwitcher.tsx
 *
 * Three-segment pill control for switching between Workspace / Org / System
 * view modes. Renders only the segments listed in availableModes.
 *
 * When availableModes.length === 1, collapses to a plain label with no
 * interactive affordance — the user is locked to that single mode.
 *
 * Per spec §4.6:
 *   - Active segment: filled (solid background)
 *   - Inactive segments: outline style
 *   - Segments not in availableModes are not rendered at all
 */

import React from 'react';
import type { ViewMode } from '../hooks/useViewModePure.js';

export type { ViewMode };

export interface ViewModeSwitcherProps {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  availableModes?: ReadonlyArray<ViewMode>;
}

const LABELS: Record<ViewMode, string> = {
  workspace: 'Workspace',
  org: 'Org',
  system: 'System',
};

// Canonical order for segment rendering
const CANONICAL_ORDER: ReadonlyArray<ViewMode> = ['workspace', 'org', 'system'];

export default function ViewModeSwitcher({
  value,
  onChange,
  availableModes = CANONICAL_ORDER,
}: ViewModeSwitcherProps) {
  const visibleModes = CANONICAL_ORDER.filter((m) => availableModes.includes(m));

  // Collapse to plain label when only one mode is available
  if (visibleModes.length <= 1) {
    const label = LABELS[value] ?? value;
    return (
      <span className="inline-flex items-center px-2.5 py-1 text-[11.5px] font-medium text-slate-500 select-none">
        {label}
      </span>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 p-0.5 gap-0.5"
    >
      {visibleModes.map((mode) => {
        const isActive = mode === value;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={LABELS[mode]}
            onClick={() => {
              if (!isActive) onChange(mode);
            }}
            className={[
              'inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition-colors',
              isActive
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
            ].join(' ')}
          >
            {LABELS[mode]}
          </button>
        );
      })}
    </div>
  );
}
