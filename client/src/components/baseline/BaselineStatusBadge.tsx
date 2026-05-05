import { useEffect, useState } from 'react';

interface BaselineStatus {
  status: string;
  confidence?: string;
}

const colorMap: Record<string, string> = {
  pending: 'bg-slate-300',
  ready: 'bg-amber-400',
  capturing: 'bg-blue-400',
  captured: 'bg-emerald-500',
  failed: 'bg-rose-500',
  manual: 'bg-violet-500',
};

const labelMap: Record<string, string> = {
  pending: 'Baseline pending',
  ready: 'Capturing soon',
  capturing: 'Capturing',
  captured: 'Baseline captured',
  failed: 'Capture failed',
  manual: 'Baseline (manual)',
};

export function BaselineStatusBadge({ subaccountId }: { subaccountId: string }) {
  const [data, setData] = useState<BaselineStatus | null>(null);

  useEffect(() => {
    fetch(`/api/subaccounts/${subaccountId}/baseline`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
      },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [subaccountId]);

  if (!data) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className={`size-2 rounded-full ${colorMap[data.status] ?? 'bg-slate-300'}`} />
      {labelMap[data.status] ?? data.status}
    </span>
  );
}
