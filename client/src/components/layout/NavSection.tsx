import React from 'react';

export function NavSectionAction({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-[16px] h-[16px] flex items-center justify-center rounded text-slate-500 hover:text-slate-300 hover:bg-white/[0.08] border-0 bg-transparent cursor-pointer transition-colors text-[13px] leading-none p-0"
    >
      +
    </button>
  );
}

export function NavSection({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="px-[18px] pt-[14px] pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] flex items-center justify-between">
      <span>{label}</span>
      {action}
    </div>
  );
}
