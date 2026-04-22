/**
 * Shared per-field indicators + reset button for the ClientPulse Settings
 * page. Per spec §4.5 / §6.4:
 *
 *  - OverrideBadge: shows "overridden" when `differsFromTemplate === true`
 *    (the effective value differs from the system-defaults-only value).
 *  - ManuallySetIndicator: shows when `hasExplicitOverride === true &&
 *    differsFromTemplate === false` — audit transparency that someone wrote
 *    the leaf even though the effective value now matches the template.
 *    (Shipped per §10.5 recommendation.)
 *  - ResetToDefaultButton: POSTs the system-default value as an explicit
 *    override (option a from §6.7.1). Disabled when `differsFromTemplate`
 *    is false.
 */

import React from 'react';

export function OverrideBadge({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200"
      title="This value differs from the adopted template default."
    >
      overridden
    </span>
  );
}

export function ManuallySetIndicator({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      className="inline-flex items-center w-2 h-2 rounded-full bg-slate-400"
      title="Explicitly written (audit trail), but currently matches the adopted template default."
      aria-label="Manually set"
    />
  );
}

export function ResetToDefaultButton({
  disabled,
  onClick,
  label = 'Reset',
}: { disabled: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition ${
        disabled
          ? 'text-slate-400 bg-slate-50 border-slate-200 cursor-not-allowed'
          : 'text-slate-700 bg-white border-slate-300 hover:border-slate-400 hover:bg-slate-50'
      }`}
      title={disabled ? 'Already at template default.' : 'Reset this value to the adopted template default.'}
    >
      ↺ {label}
    </button>
  );
}
