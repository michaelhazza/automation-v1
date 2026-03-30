/**
 * PortalExecutionHistoryPage — subaccount member's execution history.
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Execution {
  id: string;
  processId: string;
  status: string;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

const STATUS_CLS: Record<string, string> = {
  completed: 'text-green-600',
  failed: 'text-red-600',
  running: 'text-blue-600',
  pending: 'text-amber-600',
  timeout: 'text-orange-600',
  cancelled: 'text-slate-500',
};

export default function PortalExecutionHistoryPage({ user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!subaccountId) return;
    api.get(`/api/portal/${subaccountId}/executions`)
      .then(({ data }) => setExecutions(data))
      .finally(() => setLoading(false));
  }, [subaccountId]);

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">My Executions</h1>
          <p className="text-slate-500 mt-2 mb-0">Your process execution history in this subaccount</p>
        </div>
        <Link
          to={`/portal/${subaccountId}`}
          className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[14px] no-underline transition-colors"
        >
          ← Back to processes
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {executions.length === 0 ? (
          <div className="py-12 text-center text-slate-500">No executions yet.</div>
        ) : (
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Execution</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Duration</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {executions.map((exec) => (
                <tr key={exec.id}>
                  <td className="px-4 py-3 font-mono text-[12px] text-slate-500">{exec.id.slice(0, 8)}…</td>
                  <td className="px-4 py-3">
                    <span className={`font-medium ${STATUS_CLS[exec.status] ?? 'text-slate-500'}`}>{exec.status}</span>
                    {exec.errorMessage && (
                      <div className="text-[12px] text-red-600 mt-0.5">{exec.errorMessage}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {exec.durationMs != null ? `${(exec.durationMs / 1000).toFixed(1)}s` : '-'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(exec.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
