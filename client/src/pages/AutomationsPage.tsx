import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Automation {
  id: string;
  name: string;
  description: string;
  engineType?: string;
  readiness?: 'ready' | 'needs_setup';
}

export default function AutomationsPage({ user: _user }: { user: User }) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/automations', { params: { status: 'active' } })
      .then((res) => setAutomations(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-8 w-40 rounded bg-slate-100 animate-pulse mb-4" />
        <div className="h-48 rounded-lg border border-slate-200 bg-slate-50 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900">Automations</h1>
          <p className="text-[13px] text-slate-500 mt-1">External tools your Workflows can call.</p>
        </div>
        <Link
          to="/automations/new"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-md inline-flex items-center gap-1.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          New Automation
        </Link>
      </div>

      {automations.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-slate-600 text-[13px]">
          No automations yet. Add one to let your Workflows call external tools.
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 grid grid-cols-12 gap-4 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
            <div className="col-span-6">Name</div>
            <div className="col-span-3">Tool</div>
            <div className="col-span-3">Readiness</div>
          </div>
          {automations.map((a) => {
            const isReady = a.readiness !== 'needs_setup';
            return (
              <Link
                key={a.id}
                to={`/automations/${a.id}`}
                className="px-4 py-3.5 border-b border-slate-100 last:border-0 grid grid-cols-12 gap-4 items-center hover:bg-slate-50 no-underline"
              >
                <div className="col-span-6">
                  <div className="text-[13.5px] font-medium text-slate-900">{a.name}</div>
                  {a.description && (
                    <div className="text-[12px] text-slate-500 mt-0.5 truncate">{a.description}</div>
                  )}
                </div>
                <div className="col-span-3">
                  {a.engineType ? (
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[11px] font-medium rounded capitalize">
                      {a.engineType}
                    </span>
                  ) : (
                    <span className="text-[12px] text-slate-400">—</span>
                  )}
                </div>
                <div className="col-span-3 flex items-center gap-1.5 text-[12.5px]">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isReady ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                  <span className={isReady ? 'text-slate-600' : 'text-amber-700'}>
                    {isReady ? 'Ready' : 'Needs setup'}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
