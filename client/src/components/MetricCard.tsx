// Adapted from Paperclip (MIT) — reusable KPI metric card.

import { Link } from 'react-router-dom';

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  iconBg?: string;      // tailwind bg class, e.g. 'bg-indigo-50'
  iconColor?: string;   // tailwind text class
  to?: string;
  onClick?: () => void;
  loading?: boolean;
  /** 0–1 fraction for a utilisation bar, e.g. budget used */
  utilisation?: number;
  utilisationColor?: string; // tailwind bg class for the bar fill
}

export default function MetricCard({
  label, value, sub, icon, iconBg = 'bg-slate-50', iconColor = 'text-slate-500',
  to, onClick, loading, utilisation, utilisationColor = 'bg-indigo-400',
}: MetricCardProps) {
  const shimmer = 'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]';

  const inner = (
    <div className={`bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3 transition-all duration-150 ${
      to || onClick ? 'cursor-pointer hover:border-indigo-200 hover:shadow-md hover:-translate-y-0.5' : ''
    }`}>
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
          {icon}
        </div>
        {loading ? (
          <div className={`h-7 w-20 rounded-md ${shimmer}`} />
        ) : (
          <div className="text-right">
            <div className="text-[22px] font-extrabold text-slate-900 leading-none">{value}</div>
          </div>
        )}
      </div>

      <div>
        <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
        {sub && !loading && (
          <div className="text-[12px] text-slate-400 mt-0.5">{sub}</div>
        )}
      </div>

      {utilisation !== undefined && (
        <div className="mt-auto">
          <div className="flex justify-between text-[11px] text-slate-400 mb-1">
            <span>Utilisation</span>
            <span>{Math.round(utilisation * 100)}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                utilisation > 0.9 ? 'bg-red-400' :
                utilisation > 0.75 ? 'bg-amber-400' :
                utilisationColor
              }`}
              style={{ width: `${Math.min(utilisation * 100, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );

  if (to) return <Link to={to} className="no-underline">{inner}</Link>;
  if (onClick) return <button onClick={onClick} className="w-full text-left bg-transparent border-0 p-0 [font-family:inherit]">{inner}</button>;
  return inner;
}
