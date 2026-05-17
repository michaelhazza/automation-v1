import React from 'react';

export function AccordionRow({
  icon,
  label,
  badge,
  isExpanded,
  onToggle,
  disabled,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  badge: { kind: 'active'; detail?: string } | { kind: 'setup' } | { kind: 'soon' };
  isExpanded: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const badgeClass =
    badge.kind === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
    badge.kind === 'setup'  ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                              'bg-slate-100 text-slate-400 border border-slate-200';
  const badgeText =
    badge.kind === 'active' ? `Active${badge.detail ? ` · ${badge.detail}` : ''}` :
    badge.kind === 'setup'  ? 'Setup' :
                              'Soon';

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${isExpanded ? 'border-indigo-300' : 'border-slate-200'}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={disabled ? undefined : onToggle}
        className={[
          'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
          disabled
            ? 'opacity-50 cursor-not-allowed bg-white'
            : isExpanded
              ? 'bg-indigo-50'
              : 'bg-white hover:bg-slate-50 cursor-pointer',
        ].join(' ')}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0">{icon}</div>
        <span className="text-[13px] font-semibold text-slate-800 flex-1">{label}</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${badgeClass}`}>{badgeText}</span>
        {!disabled && (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className={`shrink-0 text-slate-400 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {isExpanded && children && (
        <div className="px-4 pb-4 pt-2 bg-white border-t border-slate-100">
          {children}
        </div>
      )}
    </div>
  );
}
