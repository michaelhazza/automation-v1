import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Execution {
  id: string;
  processId: string;
  userId: string;
  status: string;
  isTestExecution: boolean;
  durationMs: number | null;
  createdAt: string;
}

interface Process {
  id: string;
  name: string;
}

const STATUS_STYLES: Record<string, string> = {
  running:   'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  failed:    'bg-red-50 text-red-700 border-red-200',
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  timeout:   'bg-orange-50 text-orange-700 border-orange-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

export default function ExecutionHistoryPage({ user }: { user: User }) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [filterProcessId, setFilterProcessId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const isAdmin = user.role === 'org_admin' || user.role === 'system_admin';

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: '50' };
      if (filterProcessId) params.processId = filterProcessId;
      if (filterStatus) params.status = filterStatus;
      if (from) params.from = from;
      if (to) params.to = to;
      const [execRes, processRes] = await Promise.all([
        api.get('/api/executions', { params }),
        api.get('/api/processes'),
      ]);
      setExecutions(execRes.data);
      setProcesses(processRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleExport = async () => {
    const params: Record<string, string> = {};
    if (filterProcessId) params.processId = filterProcessId;
    if (from) params.from = from;
    if (to) params.to = to;
    const res = await api.get('/api/executions/export', { params, responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url; a.download = 'executions.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearFilters = () => {
    setFilterProcessId(''); setFilterStatus(''); setFrom(''); setTo('');
  };

  const hasFilters = filterProcessId || filterStatus || from || to;
  const processMap = Object.fromEntries(processes.map((t) => [t.id, t.name]));
  const statuses = ['pending', 'running', 'completed', 'failed', 'timeout', 'cancelled'];

  return (
    <div className="page-enter">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0">Execution History</h1>
          <p className="text-sm text-slate-500 mt-1.5">Audit trail of all automation runs</p>
        </div>
        {isAdmin && (
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[13.5px] font-semibold rounded-lg transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 mb-5">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Automation</label>
            <select
              value={filterProcessId}
              onChange={(e) => setFilterProcessId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All processes</option>
              {processes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex-1 min-w-[130px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex-1 min-w-[130px]">
            <label className="block text-[11.5px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex gap-2 items-end">
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13.5px] font-semibold rounded-lg transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Apply
            </button>
            {hasFilters && (
              <button
                onClick={handleClearFilters}
                className="px-4 py-2 text-slate-600 hover:text-slate-800 text-[13px] font-medium rounded-lg hover:bg-slate-100 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results summary */}
      {!loading && (
        <div className="flex items-center justify-between mb-3">
          <div className="text-[13px] text-slate-500">
            <strong className="text-slate-900">{executions.length}</strong> execution{executions.length !== 1 ? 's' : ''} found
            {hasFilters && <span className="ml-2 text-[12px] text-indigo-600 font-medium">(filtered)</span>}
          </div>
        </div>
      )}

      {/* Table / States */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[1,2,3,4,5].map((i) => <div key={i} className="skeleton h-[52px] rounded-lg" />)}
        </div>
      ) : executions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <p className="font-bold text-[16px] text-slate-900 mb-1.5">No executions found</p>
          <p className="text-[13.5px] text-slate-500 mb-5">
            {hasFilters ? 'Try adjusting your filters.' : 'Run an automation to start your execution history.'}
          </p>
          {hasFilters ? (
            <button onClick={handleClearFilters} className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors">
              Clear filters
            </button>
          ) : (
            <Link to="/processes" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg no-underline transition-colors">
              Browse Automations
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Execution</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Automation</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Duration</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {executions.map((exec) => (
                <tr key={exec.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/executions/${exec.id}`}
                        className="text-indigo-600 hover:text-indigo-700 font-mono text-xs font-semibold no-underline"
                      >
                        {exec.id.substring(0, 8)}…
                      </Link>
                      {exec.isTestExecution && (
                        <span className="text-[10.5px] bg-sky-50 text-sky-600 border border-sky-200 px-1.5 py-0.5 rounded-full font-semibold">
                          TEST
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-[13.5px] font-medium text-slate-700">
                    {processMap[exec.processId] ?? (
                      <span className="text-slate-400 font-mono text-xs">{exec.processId.substring(0, 8)}…</span>
                    )}
                  </td>
                  <td className="px-5 py-3"><StatusBadge status={exec.status} /></td>
                  <td className="px-5 py-3 text-[13px] text-slate-500">
                    {exec.durationMs != null ? (
                      <span className="font-medium">{(exec.durationMs / 1000).toFixed(1)}s</span>
                    ) : '—'}
                  </td>
                  <td className="px-5 py-3 text-[13px] text-slate-500">
                    {new Date(exec.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
