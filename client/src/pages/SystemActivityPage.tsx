import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Execution {
  id: string;
  processName: string | null;
  organisationName: string | null;
  userEmail: string | null;
  status: string;
  engineType: string | null;
  durationMs: number | null;
  createdAt: string;
}

const STATUS_CLS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  running: 'bg-blue-100 text-blue-700',
  pending: 'bg-amber-100 text-amber-700',
  timeout: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_CLS[status] ?? 'bg-slate-100 text-slate-600'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

const selectCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function SystemActivityPage({ user }: { user: User }) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterEngineType, setFilterEngineType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: String(limit), offset: String(offset) };
      if (filterStatus) params.status = filterStatus;
      if (filterEngineType) params.engineType = filterEngineType;
      if (from) params.from = from;
      if (to) params.to = to;
      const { data } = await api.get('/api/system/executions', { params });
      setExecutions(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [offset]);

  const handleClearFilters = () => {
    setFilterStatus(''); setFilterEngineType(''); setFrom(''); setTo('');
    setOffset(0);
  };

  const hasFilters = filterStatus || filterEngineType || from || to;
  const statuses = ['pending', 'running', 'completed', 'failed', 'timeout', 'cancelled'];
  const engineTypes = ['n8n', 'ghl', 'make', 'zapier', 'custom_webhook'];

  return (
    <div className="page-enter">
      <div className="mb-6">
        <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0 mb-1.5">Platform Activity</h1>
        <p className="text-slate-500 m-0 text-[14px]">Execution activity across all organisations and clients</p>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 mb-5">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={selectCls}>
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Engine</label>
            <select value={filterEngineType} onChange={(e) => setFilterEngineType(e.target.value)} className={selectCls}>
              <option value="">All engines</option>
              {engineTypes.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          <div className="flex-1 min-w-[130px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls} />
          </div>

          <div className="flex-1 min-w-[130px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectCls} />
          </div>

          <div className="flex gap-2 items-end">
            <button onClick={() => { setOffset(0); load(); }} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13.5px] font-medium cursor-pointer transition-colors">
              Apply
            </button>
            {hasFilters && (
              <button onClick={handleClearFilters} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[13px] cursor-pointer transition-colors">Clear</button>
            )}
          </div>
        </div>
      </div>

      {/* Results summary */}
      {!loading && (
        <div className="mb-3 text-[13px] text-slate-500">
          <strong className="text-slate-900">{executions.length}</strong> execution{executions.length !== 1 ? 's' : ''} shown
          {hasFilters && <span className="ml-2 text-[12px] text-indigo-600 font-medium">(filtered)</span>}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-[52px] rounded-lg" />
          ))}
        </div>
      ) : executions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-12 text-center">
          <p className="m-0 mb-1.5 font-bold text-[16px] text-slate-900">No executions found</p>
          <p className="m-0 text-[13.5px] text-slate-500">
            {hasFilters ? 'Try adjusting your filters.' : 'No automation activity recorded yet.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Created</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Organisation</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Automation</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">User</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Engine</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {executions.map((exec) => (
                <tr key={exec.id}>
                  <td className="px-4 py-3 text-slate-500 text-[13px] whitespace-nowrap">
                    {new Date(exec.createdAt).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-slate-700 text-[13.5px] font-medium">
                    {exec.organisationName ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700 text-[13.5px] font-medium">
                    {exec.processName ?? <span className="text-slate-400 italic">Unknown</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-[13px]">
                    {exec.userEmail ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {exec.engineType ? (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {exec.engineType}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={exec.status} /></td>
                  <td className="px-4 py-3 text-slate-500 text-[13px]">
                    {exec.durationMs != null ? (
                      <span className="font-medium">{(exec.durationMs / 1000).toFixed(1)}s</span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && executions.length > 0 && (
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 border-0 rounded-lg text-[13px] cursor-pointer transition-colors"
          >
            Previous
          </button>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={executions.length < limit}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 border-0 rounded-lg text-[13px] cursor-pointer transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
