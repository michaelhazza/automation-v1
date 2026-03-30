import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
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

export default function AdminSkillsPage({ user: _user }: { user: User }) {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/skills');
      setSkills(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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

  if (loading) return <div className="p-12 text-center text-sm text-slate-500">Loading...</div>;

  const custom = skills.filter((s) => s.skillType === 'custom');

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">Skills Library</h1>
          <p className="text-sm text-slate-500 mt-2 max-w-lg leading-relaxed">
            Create custom skills to encode your agency's proprietary workflows and methodologies.
            Core platform skills are automatically included with system agents.
          </p>
        </div>
        <button
          onClick={() => navigate('/admin/skills/new')}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
        >
          + New Skill
        </button>
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

      <div className="mb-8">
        <h2 className="text-[16px] font-semibold text-slate-800 mb-3">Custom Skills ({custom.length})</h2>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {custom.length === 0 ? (
            <div className="py-12 px-8 flex flex-col items-center text-center">
              <div className="text-4xl mb-3">🔧</div>
              <div className="text-[15px] font-semibold text-slate-800 mb-1.5">No custom skills yet</div>
              <div className="text-[13px] text-slate-500 mb-4">Create custom skills to encode your agency's proprietary workflows and methodologies.</div>
              <button
                onClick={() => navigate('/admin/skills/new')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors"
              >
                + Create Custom Skill
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Name</th>
                  <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Slug</th>
                  <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Methodology</th>
                  <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Status</th>
                  <th className="px-4 py-3 text-right text-[13px] font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {custom.map((skill) => (
                  <tr key={skill.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{skill.name}</div>
                      {skill.description && <div className="text-xs text-slate-500 mt-0.5">{skill.description}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{skill.slug}</code>
                    </td>
                    <td className="px-4 py-3">
                      {skill.methodology ? (
                        <span className="text-[12px] bg-green-100 text-green-700 px-2 py-0.5 rounded">Has methodology</span>
                      ) : (
                        <span className="text-[12px] bg-orange-50 text-orange-700 px-2 py-0.5 rounded">No methodology</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-medium ${skill.isActive ? 'bg-green-100 text-green-800' : 'bg-orange-50 text-orange-800'}`}>
                        {skill.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
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
                      {actionError[skill.id] && <div className="text-[11px] text-red-600 mt-1">{actionError[skill.id]}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
