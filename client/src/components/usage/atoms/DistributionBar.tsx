import { formatCents } from '../format';

export function DistributionBar({ label, items }: { label: string; items: { name: string; count: number; cost: number; color: string }[] }) {
  const totalCount = items.reduce((s, i) => s + i.count, 0) || 1;
  return (
    <div className="mb-4">
      <div className="text-[12px] font-semibold text-slate-700 mb-1.5">{label}</div>
      <div className="flex h-5 rounded-full overflow-hidden bg-slate-100">
        {items.filter(i => i.count > 0).map(item => (
          <div
            key={item.name}
            className={`${item.color} flex items-center justify-center text-[10px] font-bold text-white transition-all duration-500`}
            style={{ width: `${Math.max((item.count / totalCount) * 100, 2)}%` }}
            title={`${item.name}: ${item.count} requests (${formatCents(item.cost)})`}
          >
            {(item.count / totalCount) > 0.08 ? item.name : ''}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
        {items.filter(i => i.count > 0).map(item => (
          <span key={item.name} className="text-[11px] text-slate-500">
            <span className={`inline-block w-2 h-2 rounded-full mr-1 ${item.color}`} />
            {item.name}: {item.count} ({Math.round((item.count / totalCount) * 100)}%) {item.cost > 0 ? `· ${formatCents(item.cost)}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
