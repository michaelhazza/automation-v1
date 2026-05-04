import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'sonner';
import Modal from '../components/Modal';

interface SpendingBudget {
  id: string;
  name: string;
  currency: string;
  disabledAt: string | null;
  createdAt: string;
  policies: Array<{
    id: string;
    mode: 'shadow' | 'live';
  }>;
}

interface SpendingBudgetsListPageProps {
  canCreate: boolean;
}

export default function SpendingBudgetsListPage({ canCreate }: SpendingBudgetsListPageProps) {
  const navigate = useNavigate();
  const [budgets, setBudgets] = useState<SpendingBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const retryCountRef = useRef(0);
  const [fatalError, setFatalError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', currency: 'USD' });
  const [creating, setCreating] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/spending-budgets');
      if (mountedRef.current) {
        setBudgets(data ?? []);
        setFatalError(false);
      }
    } catch {
      if (mountedRef.current) {
        toast.error('Failed to load spending budgets');
        retryCountRef.current += 1;
        if (retryCountRef.current >= 3) setFatalError(true);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const { data } = await api.post('/api/spending-budgets', {
        name: form.name.trim(),
        currency: form.currency,
      });
      toast.success('Spending Budget created');
      setShowCreate(false);
      setForm({ name: '', currency: 'USD' });
      navigate(`/admin/spending-budgets/${data.id}`);
    } catch {
      toast.error('Failed to create Spending Budget');
    } finally {
      setCreating(false);
    }
  };

  if (fatalError) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4">
          <p className="text-[13px] font-semibold text-red-700 mb-1">Unable to load Spending Budgets</p>
          <p className="text-[12.5px] text-red-600 mb-3">
            Multiple attempts failed. If this persists, contact{' '}
            <a href="mailto:support@synthetos.ai" className="underline">support</a>.
          </p>
          <button
            onClick={() => { retryCountRef.current = 0; setFatalError(false); load(); }}
            className="px-3 py-1.5 text-[12.5px] font-semibold rounded-md bg-red-100 text-red-700 hover:bg-red-200 border-0 cursor-pointer [font-family:inherit]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[18px] font-bold text-slate-900">Spending Budgets</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Configure policies, allowlists, and limits for agent spend.
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors duration-100 border-0 cursor-pointer [font-family:inherit] shadow-sm"
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Budget
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : budgets.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-slate-200 px-8 py-12 text-center">
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 mx-auto mb-3">
            <rect x="2" y="7" width="20" height="14" rx="2" />
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          </svg>
          <p className="text-[14px] font-semibold text-slate-600 mb-1">No Spending Budgets yet</p>
          <p className="text-[12.5px] text-slate-400 mb-4">
            Create your first Spending Budget to start configuring agent spend policies.
          </p>
          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors duration-100 border-0 cursor-pointer [font-family:inherit]"
            >
              Create your first Spending Budget
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Currency</th>
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Mode</th>
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map(b => {
                const mode = b.policies?.[0]?.mode ?? 'shadow';
                return (
                  <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors duration-75">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/spending-budgets/${b.id}`}
                        className="text-[13px] font-semibold text-indigo-600 hover:text-indigo-700 no-underline"
                      >
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-600">{b.currency}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${mode === 'live' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                        {mode}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {b.disabledAt ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700">disabled</span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">active</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal title="New Spending Budget" onClose={() => setShowCreate(false)} maxWidth={420}>
          <div className="space-y-3 mb-5">
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1">Budget name</label>
              <input
                autoFocus
                type="text"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Main Agent Spend"
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1">
                Currency <span className="text-slate-400 font-normal">(cannot be changed later)</span>
              </label>
              <select
                value={form.currency}
                onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CAD">CAD</option>
                <option value="AUD">AUD</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2.5 justify-end">
            <button
              onClick={() => setShowCreate(false)}
              className="inline-flex items-center px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 [font-family:inherit] bg-slate-100 text-gray-700 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !form.name.trim()}
              className="inline-flex items-center px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 [font-family:inherit] bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
