import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import { getActiveClientId } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';

interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  skillType: 'built_in' | 'custom';
  isActive: boolean;
  methodology: string | null;
  instructions: string | null;
  createdAt: string;
}

interface AgentSkillInfo {
  agentId: string;
  agentName: string;
  agentIcon: string | null;
  skillSlugs: string[];
}

export default function AdminSkillsPage({ user: _user }: { user: User }) {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agentSkills, setAgentSkills] = useState<AgentSkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | 'built_in' | 'custom'>('all');

  const activeClientId = getActiveClientId();

  const load = async () => {
    setLoading(true);
    try {
      const [skillsRes, agentsRes] = await Promise.all([
        api.get('/api/skills/all'),
        activeClientId
          ? api.get(`/api/subaccounts/${activeClientId}/agents`).catch((err) => { console.error('[AdminSkills] Failed to fetch agents:', err); return { data: [] }; })
          : Promise.resolve({ data: [] }),
      ]);
      setSkills(skillsRes.data);

      // Build agent → skills mapping from subaccount agents
      const agents: AgentSkillInfo[] = (agentsRes.data as any[])
        .filter((a: any) => a.isActive && a.skillSlugs && a.skillSlugs.length > 0)
        .map((a: any) => ({
          agentId: a.agentId,
          agentName: a.agent?.name ?? 'Unknown',
          agentIcon: a.agent?.icon ?? null,
          skillSlugs: a.skillSlugs as string[],
        }));
      setAgentSkills(agents);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeClientId]);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/skills/${deleteId}`);
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [deleteId!]: e.response?.data?.error ?? 'Failed to delete' }));
      setDeleteId(null);
    }
  };

  // Which agents use a given skill slug?
  const getAgentsForSkill = (slug: string) =>
    agentSkills.filter((a) => a.skillSlugs.includes(slug));

  if (loading) return <div className="p-12 text-center text-sm text-slate-500">Loading...</div>;

  const filtered = filter === 'all' ? skills : skills.filter((s) => s.skillType === filter);
  const builtInCount = skills.filter((s) => s.skillType === 'built_in').length;
  const customCount = skills.filter((s) => s.skillType === 'custom').length;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">Skills</h1>
          <p className="text-sm text-slate-500 mt-2 max-w-lg leading-relaxed">
            All skills available to your AI agents. Built-in skills are provided by the platform.
            Create custom skills to encode your own workflows and methodologies.
          </p>
        </div>
        <button
          onClick={() => navigate('/admin/skills/new')}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
        >
          + New Skill
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-6 w-fit">
        {([['all', `All (${skills.length})`], ['built_in', `Built-in (${builtInCount})`], ['custom', `Custom (${customCount})`]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key as typeof filter)}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors border-0 cursor-pointer ${
              filter === key ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {deleteId && (
        <ConfirmDialog
          title="Delete skill"
          message="Are you sure you want to delete this custom skill? Agents using it will lose access."
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 px-8 flex flex-col items-center text-center">
            <div className="text-4xl mb-3">🔧</div>
            <div className="text-[15px] font-semibold text-slate-800 mb-1.5">
              {filter === 'custom' ? 'No custom skills yet' : 'No skills found'}
            </div>
            {filter === 'custom' && (
              <>
                <div className="text-[13px] text-slate-500 mb-4">Create custom skills to encode your proprietary workflows.</div>
                <button
                  onClick={() => navigate('/admin/skills/new')}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors"
                >
                  + Create Custom Skill
                </button>
              </>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Skill</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Type</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Used by</th>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-right text-[13px] font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((skill) => {
                const agents = getAgentsForSkill(skill.slug);
                return (
                  <tr key={skill.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{skill.name}</div>
                      {skill.description && <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{skill.description}</div>}
                      <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded text-slate-500 mt-0.5 inline-block">{skill.slug}</code>
                    </td>
                    <td className="px-4 py-3">
                      {skill.skillType === 'built_in' ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700">Built-in</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-100 text-purple-700">Custom</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {agents.length === 0 ? (
                        <span className="text-[12px] text-slate-400">No agents</span>
                      ) : (
                        <div className="flex items-center gap-1 flex-wrap">
                          {agents.slice(0, 4).map((a) => (
                            <span key={a.agentId} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 rounded text-[11px] text-slate-700 font-medium">
                              {a.agentIcon && <span className="text-[10px]">{a.agentIcon}</span>}
                              {a.agentName}
                            </span>
                          ))}
                          {agents.length > 4 && (
                            <span className="text-[11px] text-slate-400">+{agents.length - 4} more</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-medium ${skill.isActive ? 'bg-green-100 text-green-800' : 'bg-orange-50 text-orange-800'}`}>
                        {skill.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {skill.skillType === 'custom' ? (
                        <div className="flex gap-2 justify-end items-center">
                          <Link
                            to={`/admin/skills/${skill.id}`}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium no-underline transition-colors"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => setDeleteId(skill.id)}
                            className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-md text-xs font-medium transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <span className="text-[12px] text-slate-400">Platform managed</span>
                      )}
                      {actionError[skill.id] && <div className="text-[11px] text-red-600 mt-1">{actionError[skill.id]}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
