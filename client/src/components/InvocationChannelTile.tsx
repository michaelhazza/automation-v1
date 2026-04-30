import React from 'react';

interface InvocationChannelTileProps {
  icon: React.ReactNode;
  label: string;
  badge: { kind: 'active'; detail?: string } | { kind: 'setup' } | { kind: 'soon' };
  onClick?: () => void;
  isExpanded?: boolean;
  disabled?: boolean;
}

export function InvocationChannelTile({ icon, label, badge, onClick, isExpanded, disabled }: InvocationChannelTileProps) {
  const badgeClass =
    badge.kind === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
    badge.kind === 'setup'  ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                              'bg-slate-100 text-slate-400 border border-slate-200';
  const badgeText =
    badge.kind === 'active' ? `Active${badge.detail ? ` · ${badge.detail}` : ''}` :
    badge.kind === 'setup'  ? 'Setup' :
                              'Soon';

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={[
        'flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors text-left',
        disabled
          ? 'opacity-50 cursor-not-allowed border-slate-200 bg-white'
          : isExpanded
            ? 'border-indigo-300 bg-indigo-50 cursor-pointer'
            : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer',
      ].join(' ')}
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center">{icon}</div>
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      <span className={`text-[11px] px-2 py-0.5 rounded-full ${badgeClass}`}>{badgeText}</span>
    </button>
  );
}
