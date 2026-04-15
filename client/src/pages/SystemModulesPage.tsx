import { useState, useEffect, useCallback } from 'react';
import { User } from '../lib/auth';
import api from '../lib/api';
import { TablePageSkeleton } from '../components/SkeletonLoader';
import HelpHint from '../components/ui/HelpHint';
import { toast } from 'sonner';

interface Props { user: User; }

interface Module {
  id: string;
  slug: string;
  displayName: string;
  allowAllAgents: boolean;
  allowedAgentSlugs: string[] | null;
  onboardingPlaybookSlugs: string[];
  createdAt: string;
}

interface SystemPlaybookTemplate {
  id: string;
  slug: string;
  name: string;
  latestVersion: number;
}

interface OrgPlaybookTemplate {
  id: string;
  slug: string;
  name: string;
  latestVersion: number;
}

export default function SystemModulesPage({ user: _user }: Props) {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableSlugs, setAvailableSlugs] = useState<{ slug: string; name: string; source: 'system' | 'org' }[]>([]);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [editSelection, setEditSelection] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const loadModules = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ modules: Module[] }>('/api/system/modules');
      setModules(data.modules ?? []);
    } catch {
      setModules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  useEffect(() => {
    // Union of system + org published templates is the option set for the
    // multi-select. §10.4 — admin picks from anything currently publishable.
    const load = async () => {
      const options: { slug: string; name: string; source: 'system' | 'org' }[] = [];
      try {
        const sys = await api.get<{ templates: SystemPlaybookTemplate[] }>('/api/system/playbook-templates');
        for (const t of sys.data.templates ?? []) {
          if (t.latestVersion > 0) options.push({ slug: t.slug, name: t.name, source: 'system' });
        }
      } catch {
        // silent — org admin may not have scope to list system templates on this env
      }
      try {
        const org = await api.get<{ templates: OrgPlaybookTemplate[] }>('/api/playbook-templates');
        for (const t of org.data.templates ?? []) {
          if (t.latestVersion > 0 && !options.some((o) => o.slug === t.slug)) {
            options.push({ slug: t.slug, name: t.name, source: 'org' });
          }
        }
      } catch {
        // silent — same reason
      }
      setAvailableSlugs(options);
    };
    void load();
  }, []);

  const beginEdit = (mod: Module) => {
    setEditingModuleId(mod.id);
    setEditSelection(new Set(mod.onboardingPlaybookSlugs ?? []));
  };

  const cancelEdit = () => {
    setEditingModuleId(null);
    setEditSelection(new Set());
  };

  const toggleSlug = (slug: string) => {
    const next = new Set(editSelection);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setEditSelection(next);
  };

  const saveSelection = async () => {
    if (!editingModuleId) return;
    setSaving(true);
    try {
      await api.patch(`/api/system/modules/${editingModuleId}`, {
        onboardingPlaybookSlugs: Array.from(editSelection),
      });
      toast.success('Onboarding playbooks updated');
      cancelEdit();
      await loadModules();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? e?.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

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
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <span className="inline-flex items-center gap-1.5">
                    Onboarding playbooks
                    <HelpHint text="Sub-accounts that enable this module will be prompted to run these playbooks during setup." />
                  </span>
                </th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Created</th>
                <th className="px-5 py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {modules.map((mod) => {
                const isEditing = editingModuleId === mod.id;
                return (
                  <tr key={mod.id} className="hover:bg-slate-50 transition-colors align-top">
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
                    <td className="px-5 py-4 text-[13px] text-slate-500">
                      {isEditing ? (
                        <div className="max-w-[320px] space-y-1.5">
                          {availableSlugs.length === 0 ? (
                            <div className="text-slate-400 italic text-[12px]">No published templates available.</div>
                          ) : (
                            availableSlugs.map((opt) => (
                              <label
                                key={opt.slug}
                                className="flex items-center gap-2 text-[12.5px] cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={editSelection.has(opt.slug)}
                                  onChange={() => toggleSlug(opt.slug)}
                                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="font-mono text-slate-700">{opt.slug}</span>
                                <span className="text-[11px] text-slate-400">{opt.source}</span>
                              </label>
                            ))
                          )}
                        </div>
                      ) : mod.onboardingPlaybookSlugs?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {mod.onboardingPlaybookSlugs.map((s) => (
                            <code
                              key={s}
                              className="text-[11px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded"
                            >
                              {s}
                            </code>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">None</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-[13px] text-slate-400">
                      {new Date(mod.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={saveSelection}
                            disabled={saving}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-[12.5px] font-semibold rounded-lg"
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={saving}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12.5px] font-medium rounded-lg"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => beginEdit(mod)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12.5px] font-medium rounded-lg"
                        >
                          Edit onboarding
                        </button>
                      )}
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
