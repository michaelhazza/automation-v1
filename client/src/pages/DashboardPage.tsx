import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Agent { id: string; name: string; description?: string; icon?: string; status: string; }
interface Execution { id: string; processId: string; status: string; createdAt: string; durationMs: number | null; isTestExecution: boolean; }

const DEFAULT_ICONS = ['\u{1F50D}','\u{1F4CA}','\u{1F4DD}','\u{1F4E3}','\u{1F916}','\u{2699}\uFE0F','\u{1F4AC}','\u{1F4C8}','\u{2728}','\u{1F3AF}'];
function getDefaultIcon(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return DEFAULT_ICONS[Math.abs(h) % DEFAULT_ICONS.length];
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

export default function DashboardPage({ user }: { user: User }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api.get('/api/agents'), api.get('/api/executions', { params: { limit: 5 } })])
      .then(([a, e]) => { setAgents(a.data); setExecutions(e.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const activeAgents = agents.filter(a => a.status === 'active');

  if (loading) {
    const skeletonCls = 'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-md';
    return (
      <div className="flex flex-col gap-5">
        <div className={`h-9 w-64 ${skeletonCls}`} />
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
          {[1,2,3,4].map(i => <div key={i} className={`h-24 rounded-xl ${skeletonCls}`} />)}
        </div>
        <div className={`h-48 rounded-xl ${skeletonCls}`} />
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0">
          {greeting}, {user.firstName}
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          {activeAgents.length > 0
            ? `You have ${activeAgents.length} AI team member${activeAgents.length === 1 ? '' : 's'} ready to help.`
            : "Let's get your AI team set up."}
        </p>
      </div>

      {/* Quick Chat agents */}
      {activeAgents.length > 0 && (
        <div className="mb-8">
          <div className="flex justify-between items-center mb-3.5">
            <h2 className="text-[17px] font-bold text-slate-900 tracking-tight m-0">Quick Chat</h2>
            <Link to="/agents" className="text-[13px] text-indigo-600 hover:text-indigo-700 font-semibold no-underline">
              View all agents →
            </Link>
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {activeAgents.slice(0, 6).map((agent) => (
              <div
                key={agent.id}
                onClick={() => navigate(`/agents/${agent.id}`)}
                className="bg-white border-2 border-slate-100 rounded-xl p-4 flex items-center gap-3 cursor-pointer hover:border-indigo-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"
              >
                <div className="w-11 h-11 rounded-xl shrink-0 flex items-center justify-center text-[22px]"
                  className="bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)]">
                  {agent.icon || getDefaultIcon(agent.id)}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 text-sm truncate">{agent.name}</div>
                  {agent.description && <div className="text-xs text-slate-400 truncate">{agent.description}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {agents.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 mb-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4"
            style={{ background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)' }}>
            🤖
          </div>
          <p className="font-bold text-[17px] text-slate-900 mb-2">Welcome to Automation OS</p>
          <p className="text-sm text-slate-500 max-w-sm leading-relaxed">
            Your AI team will appear here once they are set up.
            Ask your administrator to create agents and assign them to your account.
          </p>
        </div>
      )}

      {/* Recent activity */}
      {executions.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-3.5">
            <h2 className="text-[17px] font-bold text-slate-900 tracking-tight m-0">Recent Activity</h2>
            <Link to="/executions" className="text-[13px] text-indigo-600 hover:text-indigo-700 font-semibold no-underline">
              View all →
            </Link>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Run</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Duration</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {executions.map((exec) => (
                  <tr key={exec.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <Link to={`/executions/${exec.id}`} className="text-indigo-600 hover:text-indigo-700 text-xs font-semibold font-mono no-underline">
                        {exec.id.substring(0, 8)}
                      </Link>
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={exec.status} /></td>
                    <td className="px-5 py-3 text-slate-500 text-[13px]">
                      {exec.durationMs != null ? `${(exec.durationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-[13px]">
                      {new Date(exec.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
