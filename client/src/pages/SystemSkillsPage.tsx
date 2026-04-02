import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';

interface SystemSkill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  isVisible: boolean;
  methodology: string | null;
  instructions: string | null;
  createdAt: string;
}

export default function SystemSkillsPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<SystemSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/system/skills');
      setSkills(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleToggleVisible = async (skill: SystemSkill) => {
    setTogglingId(skill.id);
    try {
      await api.patch(`/api/system/skills/${skill.id}`, { isVisible: !skill.isVisible });
      setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, isVisible: !s.isVisible } : s));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError(prev => ({ ...prev, [skill.id]: e.response?.data?.error ?? 'Failed to update' }));
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/system/skills/${deleteId}`);
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError((prev) => ({ ...prev, [deleteId]: e.response?.data?.error ?? 'Failed to delete' }));
      setDeleteId(null);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-slate-500 text-[14px]">Loading...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">System Skills</h1>
          <p className="text-slate-500 mt-2 mb-0 text-[14px]">
            Platform-level skills that handle task board interactions and core agent capabilities. These are automatically attached to system agents and hidden from organisation admins.
          </p>
        </div>
        <button
          onClick={() => navigate('/system/skills/new')}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium whitespace-nowrap cursor-pointer transition-colors"
        >
          + New System Skill
        </button>
      </div>

      {deleteId && (
        <ConfirmDialog
          title="Delete system skill"
          message="Are you sure you want to delete this system skill? System agents using it will lose access."
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {skills.length === 0 ? (
          <div className="py-12 px-8 text-center">
            <div className="text-[36px] mb-3">🔧</div>
            <div className="text-[15px] font-semibold text-slate-800 mb-1.5">No system skills yet</div>
            <div className="text-[13px] text-slate-500 mb-4">Create system skills to define core capabilities.</div>
            <button
              onClick={() => navigate('/system/skills/new')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] font-medium cursor-pointer transition-colors"
            >
              + Create System Skill
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-700 text-[13px]">Name</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 text-[13px]">Slug</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 text-[13px]">Methodology</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 text-[13px]">Active</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 text-[13px]" title="When on, this skill is visible to org and subaccount admins">Visible to Orgs</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-700 text-[13px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {skills.map((skill) => (
                <tr key={skill.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{skill.name}</div>
                    {skill.description && <div className="text-[12px] text-slate-500 mt-0.5">{skill.description}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{skill.slug}</code>
                  </td>
                  <td className="px-4 py-3">
                    {skill.methodology ? (
                      <span className="text-[12px] text-green-800 bg-green-100 px-2 py-0.5 rounded">Has methodology</span>
                    ) : (
                      <span className="text-[12px] text-orange-800 bg-orange-50 px-2 py-0.5 rounded">No methodology</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-medium ${skill.isActive ? 'bg-green-100 text-green-800' : 'bg-orange-50 text-orange-800'}`}>
                      {skill.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      title={skill.isVisible ? 'Visible to org/subaccount admins — click to hide' : 'Hidden from org/subaccount admins — click to show'}
                      disabled={togglingId === skill.id}
                      onClick={() => handleToggleVisible(skill)}
                      className={`relative w-10 h-[22px] rounded-full border-0 cursor-pointer transition-colors disabled:opacity-50 ${skill.isVisible ? 'bg-indigo-600' : 'bg-slate-300'}`}
                    >
                      <div className={`absolute w-[16px] h-[16px] rounded-full bg-white top-[3px] transition-all shadow-sm ${skill.isVisible ? 'left-[21px]' : 'left-[3px]'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end items-center">
                      <Link to={`/system/skills/${skill.id}`} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[12px] font-medium no-underline transition-colors">Edit</Link>
                      <button onClick={() => setDeleteId(skill.id)} className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 border-0 rounded-md text-[12px] font-medium cursor-pointer transition-colors">Delete</button>
                    </div>
                    {actionError[skill.id] && <div className="text-[11px] text-red-600 mt-1">{actionError[skill.id]}</div>}
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
