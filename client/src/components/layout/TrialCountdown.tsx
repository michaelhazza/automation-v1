import React from 'react';
import { useTrialCountdown } from '../../hooks/useTrialCountdown';

export default function TrialCountdown() {
  const { label, severity } = useTrialCountdown();
  if (!label) return null;

  const cls =
    severity === 'danger' ? 'text-red-400' :
    severity === 'warn' ? 'text-amber-400' :
    'text-slate-500';

  return (
    <div className={`flex items-center gap-2 px-3 py-[6px] mx-1.5 my-px text-[11.5px] font-medium ${cls}`}>
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <span>{label}</span>
    </div>
  );
}
