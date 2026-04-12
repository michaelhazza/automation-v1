import { useState, useEffect } from 'react';
import { User } from '../lib/auth';
import api from '../lib/api';
import { TablePageSkeleton } from '../components/SkeletonLoader';

interface Props { user: User; }

interface Module {
  id: string;
  slug: string;
  displayName: string;
  allowAllAgents: boolean;
  allowedAgentSlugs: string[] | null;
  createdAt: string;
}

export default function SystemModulesPage({ user: _user }: Props) {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/system/modules')
      .then(({ data }) => setModules(data.modules ?? []))
      .catch(() => setModules([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <TablePageSkeleton rows={4} />;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[26px] font-extrabold text-slate-900 tracking-tight m-0">Modules</h1>
          <p className="text-sm text-slate-500 mt-1">Runtime entitlements that control which agents orgs can activate.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {modules.length === 0 ? (
          <div className="py-16 text-center text-[14px] text-slate-400">No modules configured.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Module</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Slug</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Agent access</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {modules.map((mod) => (
                <tr key={mod.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-900 text-[13.5px]">{mod.displayName}</p>
                  </td>
                  <td className="px-5 py-4">
                    <code className="text-[12px] bg-slate-100 px-2 py-0.5 rounded text-slate-600">{mod.slug}</code>
                  </td>
                  <td className="px-5 py-4 text-[13px] text-slate-500">
                    {mod.allowAllAgents
                      ? <span className="text-emerald-600 font-medium">All agents</span>
                      : mod.allowedAgentSlugs?.length
                        ? mod.allowedAgentSlugs.join(', ')
                        : <span className="text-slate-400 italic">None</span>}
                  </td>
                  <td className="px-5 py-4 text-[13px] text-slate-400">
                    {new Date(mod.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
