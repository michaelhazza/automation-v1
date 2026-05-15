import React from 'react';

export function NavButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-[9px] w-full px-3 py-[7px] mx-1.5 my-px rounded-[7px] text-[13px] font-medium text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] bg-transparent border-0 cursor-pointer transition-[color,background] duration-100"
    >
      <span>{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
    </button>
  );
}
