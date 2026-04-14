import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
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
  visibility: 'none' | 'basic' | 'full';
  subaccountId: string | null;
  organisationId: string | null;
  createdAt: string;
  updatedAt: string;
}

function tierLabel(skill: Skill): string {
  if (!skill.organisationId) return 'System';
  if (!skill.subaccountId) return 'Org';
  return 'Subaccount';
}

function tierBadgeClass(tier: string): string {
  switch (tier) {
    case 'System': return 'bg-purple-50 text-purple-700';
    case 'Org': return 'bg-blue-50 text-blue-700';
    default: return 'bg-green-50 text-green-700';
  }
}

export default function SubaccountSkillsPage({ user: _user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);

  const load = useCallback(async () => {
    if (!subaccountId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/subaccounts/${subaccountId}/skills`);
      setSkills(res.data);
    } catch (err) {
      console.error('[SubaccountSkills] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }, [subaccountId]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    if (!deleteTarget || !subaccountId) return;
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/skills/${deleteTarget.id}`);
      setDeleteTarget(null);
      load();
    } catch (err) {
      console.error('[SubaccountSkills] Delete failed:', err);
    }
  }

  return (
    <div className="px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Subaccount Skills</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage skills scoped to this workspace. Subaccount skills override org and system skills with the same slug.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : skills.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-200 rounded-xl">
          <p className="text-slate-500 text-sm">No skills available for this workspace.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider">Slug</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider">Tier</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider">Visibility</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider">Created</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => {
                const tier = tierLabel(skill);
                const isOwned = tier === 'Subaccount';
                return (
                  <tr key={skill.id} className="hover:bg-slate-50/50 transition-colors border-b border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-800">{skill.name}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{skill.slug}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${tierBadgeClass(tier)}`}>
                        {tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 capitalize">{skill.skillType.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-slate-500 capitalize">{skill.visibility}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {new Date(skill.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isOwned && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(skill); }}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Skill"
          message={`Are you sure you want to delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
