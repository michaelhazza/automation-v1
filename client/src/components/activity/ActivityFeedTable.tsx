export type ActivityItem = {
  id: string;
  type: string;
  status: 'active' | 'attention_needed' | 'completed' | 'failed' | 'cancelled';
  subject: string;
  actor: string;
  subaccountId: string | null;
  subaccountName: string | null;
  agentId: string | null;
  agentName: string | null;
  severity: 'critical' | 'warning' | 'info' | null;
  createdAt: string;
  updatedAt: string;
  detailUrl: string;
};

interface ActivityFeedTableProps {
  items: ActivityItem[];
  loading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

type NormalisedStatus = ActivityItem['status'];

function formatRelative(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatTypeLabel(type: string): string {
  if (type.includes('.')) {
    const parts = type.split('.');
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }
  const words = type.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function statusBadge(s: NormalisedStatus) {
  const map: Record<NormalisedStatus, { bg: string; text: string }> = {
    active: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    attention_needed: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
    completed: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
    failed: { bg: 'bg-red-50 border-red-200', text: 'text-red-700' },
    cancelled: { bg: 'bg-slate-50 border-slate-200', text: 'text-slate-500' },
  };
  const { bg, text } = map[s];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full border ${bg} ${text}`}>
      {s.replace(/_/g, ' ')}
    </span>
  );
}

export default function ActivityFeedTable({ items, loading, onLoadMore, hasMore }: ActivityFeedTableProps) {
  if (loading && items.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Time</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Type</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Actor</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Summary</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-[13px] text-slate-500">
                Loading...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Time</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Type</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Actor</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Summary</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-[13px] text-slate-500">
                No activity to show.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Time</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Type</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Actor</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Summary</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-[13px] text-slate-500 whitespace-nowrap">
                  <span title={item.createdAt}>{formatRelative(item.createdAt)}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                    {formatTypeLabel(item.type)}
                  </span>
                </td>
                <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">{item.actor}</td>
                <td className="px-4 py-3 text-[13px] text-slate-700">
                  {item.subject.length > 80 ? item.subject.slice(0, 80) + '...' : item.subject}
                </td>
                <td className="px-4 py-3">{statusBadge(item.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && onLoadMore && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={onLoadMore}
            className="btn btn-secondary"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
