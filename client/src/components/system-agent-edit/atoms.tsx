import React from 'react';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100">
      <h2 className="m-0 text-[14px] font-semibold text-slate-800">{title}</h2>
      {subtitle && <p className="m-0 mt-1 text-[12px] text-slate-500">{subtitle}</p>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="m-0 mt-1 text-[12px] text-slate-400">{hint}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={onChange}
        className={`relative w-10 h-[22px] rounded-full border-0 cursor-pointer transition-colors ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}
      >
        <div className={`absolute w-[16px] h-[16px] rounded-full bg-white top-[3px] transition-all shadow-sm ${checked ? 'left-[21px]' : 'left-[3px]'}`} />
      </button>
      {label && <span className="text-[13px] text-slate-600">{label}</span>}
    </div>
  );
}

export function RoleBadge({ role }: { role: string }) {
  if (!role) return null;
  const cls: Record<string, string> = {
    orchestrator: 'bg-purple-100 text-purple-700',
    specialist: 'bg-blue-100 text-blue-700',
    worker: 'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${cls[role] ?? 'bg-slate-100 text-slate-600'}`}>
      {role}
    </span>
  );
}
