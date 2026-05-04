// client/src/components/dashboard/QueueHealthSummary.tsx
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';

interface TimestampedResponse<T> {
  data: T;
  serverTimestamp: string;
}

type QueueRow = { pending: number; dlqDepth: number; failed: number };
type QueueSummary = { pending: number; dlq: number; failed: number };

interface QueueHealthSummaryProps {
  refreshToken?: number;
}

export function QueueHealthSummary({ refreshToken }: QueueHealthSummaryProps) {
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const latestTs = useRef<string>('');

  useEffect(() => {
    api.get<TimestampedResponse<QueueRow[]>>('/api/system/job-queues')
      .then(res => {
        const incoming = res.data.serverTimestamp;
        if (incoming <= latestTs.current) return;
        latestTs.current = incoming;
        const queues = res.data.data;
        setSummary({
          pending: queues.reduce((s, q) => s + q.pending, 0),
          dlq:     queues.reduce((s, q) => s + q.dlqDepth, 0),
          failed:  queues.reduce((s, q) => s + q.failed, 0),
        });
      })
      .catch(() => {});
  }, [refreshToken]);

  if (!summary) return null;

  const color = summary.dlq > 0 || summary.failed > 10
    ? 'border-amber-200 bg-amber-50'
    : 'border-green-200 bg-green-50';

  return (
    <Link to="/system/job-queues" className="no-underline block mb-4">
      <div className={`border rounded-xl px-5 py-3 flex items-center gap-6 ${color}`}>
        <div className="text-[13px] font-semibold text-slate-700">Queue Health</div>
        <div className="flex gap-4 text-[12px]">
          <span className="text-slate-500">
            Pending: <span className="font-semibold text-slate-700">{summary.pending}</span>
          </span>
          <span className={summary.dlq > 0 ? 'text-amber-600' : 'text-slate-500'}>
            DLQ: <span className="font-semibold">{summary.dlq}</span>
          </span>
          <span className={summary.failed > 10 ? 'text-red-600' : 'text-slate-500'}>
            Failed (24h): <span className="font-semibold">{summary.failed}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
