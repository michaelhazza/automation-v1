/**
 * VisibilitySegmentedControl — three-state cascade visibility picker.
 *
 * Used on the System Skills and Org Skills list pages (and edit forms) to
 * set how a skill cascades to lower tiers:
 *
 *   None  — invisible to lower tiers
 *   Basic — name + one-line description only
 *   Full  — everything (instructions, definition)
 *
 * Designed as a compact pill-style segmented control with a coloured dot
 * for the active state. Optimised for use inside dense table rows: ~140px
 * wide, single line, no shadow stacking.
 */

import { useState } from 'react';

export type SkillVisibility = 'none' | 'basic' | 'full';

const OPTIONS: ReadonlyArray<{
  value: SkillVisibility;
  label: string;
  dot: string;
  hint: string;
}> = [
  { value: 'none', label: 'None', dot: 'bg-slate-400', hint: 'Hidden from lower tiers' },
  { value: 'basic', label: 'Basic', dot: 'bg-amber-500', hint: 'Name + description only' },
  { value: 'full', label: 'Full', dot: 'bg-emerald-500', hint: 'Full body visible' },
];

interface Props {
  value: SkillVisibility;
  onChange: (next: SkillVisibility) => void | Promise<void>;
  disabled?: boolean;
  /** Compact mode shrinks the control for use inside table rows. */
  size?: 'sm' | 'md';
}

export default function VisibilitySegmentedControl({ value, onChange, disabled, size = 'sm' }: Props) {
  const [busy, setBusy] = useState<SkillVisibility | null>(null);

  const handleClick = async (next: SkillVisibility) => {
    if (disabled || busy || next === value) return;
    setBusy(next);
    try {
      await onChange(next);
    } finally {
      setBusy(null);
    }
  };

  const cellPad = size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1.5';
  const fontSize = size === 'sm' ? 'text-[11.5px]' : 'text-[12.5px]';

  return (
    <div
      role="radiogroup"
      aria-label="Cascade visibility"
      className={`inline-flex items-center rounded-lg bg-slate-100 p-0.5 border border-slate-200 ${disabled ? 'opacity-60' : ''}`}
    >
      {OPTIONS.map((opt) => {
        const isActive = opt.value === value;
        const isBusy = busy === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={isActive}
            title={opt.hint}
            disabled={disabled || busy !== null}
            onClick={() => handleClick(opt.value)}
            className={`${cellPad} ${fontSize} font-semibold rounded-md border-0 cursor-pointer flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed ${
              isActive
                ? 'bg-white text-slate-800 shadow-sm'
                : 'bg-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? opt.dot : 'bg-slate-300'}`} />
            {opt.label}
            {isBusy && <span className="w-2 h-2 border border-slate-400 border-t-transparent rounded-full animate-spin" />}
          </button>
        );
      })}
    </div>
  );
}
