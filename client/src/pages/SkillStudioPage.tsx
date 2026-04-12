import { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SkillListItem = {
  id: string;
  slug: string;
  name: string;
  scope: 'system' | 'org';
  lastVersionAt: string | null;
  openRegressionCount: number;
};

type SkillVersion = {
  id: string;
  versionNumber: number;
  name: string;
  changeSummary: string | null;
  simulationPassCount: number;
  simulationTotalCount: number;
  createdAt: string;
};

type SkillContext = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  definition: unknown;
  instructions: string | null;
  versions: SkillVersion[];
  regressions: unknown[];
};

type SimulationResult = {
  caseId: string;
  passed: boolean;
  notes: string;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SkillStudioPage({ user }: { user: User }) {
  const { pathname } = useLocation();
  const scope = pathname.startsWith('/system/') ? 'system' : 'org';
  const baseUrl = scope === 'system' ? '/api/system/skill-studio' : '/api/admin/skill-studio';

  // State
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [context, setContext] = useState<SkillContext | null>(null);
  const [definitionJson, setDefinitionJson] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simulationResults, setSimulationResults] = useState<SimulationResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'definition' | 'versions'>('definition');

  // Load skill list
  const loadSkills = useCallback(async () => {
    try {
      const { data } = await api.get(baseUrl);
      setSkills(data);
    } catch { setSkills([]); }
    finally { setLoading(false); }
  }, [baseUrl]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  // Load skill context when active skill changes
  useEffect(() => {
    if (!activeSkillId) { setContext(null); return; }
    (async () => {
      try {
        const { data } = await api.get(`${baseUrl}/${activeSkillId}`);
        setContext(data);
        setDefinitionJson(JSON.stringify(data.definition, null, 2));
        setInstructions(data.instructions ?? '');
        setSimulationResults(null);
        setError(null);
      } catch { setError('Failed to load skill context'); }
    })();
  }, [activeSkillId, baseUrl]);

  // Simulate
  const handleSimulate = async () => {
    if (!context) return;
    setSimulating(true);
    setError(null);
    try {
      const definition = JSON.parse(definitionJson);
      const caseIds = (context.regressions as Array<{ id: string }>).map((r) => r.id);
      const { data } = await api.post(`${baseUrl}/${context.id}/simulate`, {
        definition, instructions, regressionCaseIds: caseIds,
      });
      setSimulationResults(data);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Simulation failed');
    } finally { setSimulating(false); }
  };

  // Save
  const handleSave = async () => {
    if (!context) return;
    setSaving(true);
    setError(null);
    try {
      const definition = JSON.parse(definitionJson);
      await api.post(`${baseUrl}/${context.id}/save`, {
        name: context.name,
        definition,
        instructions,
        changeSummary: `Updated via Skill Studio`,
        simulationPassCount: simulationResults?.filter((r) => r.passed).length ?? 0,
        simulationTotalCount: simulationResults?.length ?? 0,
      });
      // Reload context to show new version
      const { data } = await api.get(`${baseUrl}/${context.id}`);
      setContext(data);
      setActiveTab('versions');
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Save failed');
    } finally { setSaving(false); }
  };

  // Rollback
  const handleRollback = async (versionId: string) => {
    if (!context) return;
    try {
      await api.post(`${baseUrl}/${context.id}/rollback`, { versionId });
      const { data } = await api.get(`${baseUrl}/${context.id}`);
      setContext(data);
      setDefinitionJson(JSON.stringify(data.definition, null, 2));
      setInstructions(data.instructions ?? '');
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Rollback failed');
    }
  };

  const scopeLabel = scope === 'system' ? 'System' : 'Org';

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left pane — skill list */}
      <div className="w-64 border-r border-slate-200 bg-slate-50 overflow-y-auto flex-shrink-0">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="text-[14px] font-bold text-slate-900">{scopeLabel} Skills</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{skills.length} skills</p>
        </div>
        {loading ? (
          <div className="p-4 text-[13px] text-slate-400">Loading...</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {skills.map((skill) => (
              <button
                key={skill.id}
                onClick={() => setActiveSkillId(skill.id)}
                className={`w-full text-left px-4 py-3 border-0 cursor-pointer transition-colors ${
                  activeSkillId === skill.id
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'bg-transparent text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="text-[13px] font-medium truncate">{skill.name}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-slate-400 font-mono">{skill.slug}</span>
                  {skill.openRegressionCount > 0 && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">
                      {skill.openRegressionCount} reg
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Center pane — studio context */}
      <div className="flex-1 overflow-y-auto">
        {!context ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-[14px]">
            Select a skill to begin editing
          </div>
        ) : (
          <div className="p-6 max-w-4xl">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-[20px] font-bold text-slate-900">{context.name}</h1>
              <p className="text-[13px] text-slate-500 mt-1 font-mono">{context.slug}</p>
              {context.description && (
                <p className="text-[13.5px] text-slate-600 mt-2">{context.description}</p>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 border-b border-slate-200">
              <button
                onClick={() => setActiveTab('definition')}
                className={`px-4 py-2 text-[13px] font-medium border-0 cursor-pointer transition-colors rounded-t-lg ${
                  activeTab === 'definition'
                    ? 'bg-white text-indigo-700 border-b-2 border-indigo-600'
                    : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Definition
              </button>
              <button
                onClick={() => setActiveTab('versions')}
                className={`px-4 py-2 text-[13px] font-medium border-0 cursor-pointer transition-colors rounded-t-lg ${
                  activeTab === 'versions'
                    ? 'bg-white text-indigo-700 border-b-2 border-indigo-600'
                    : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Versions ({context.versions.length})
              </button>
            </div>

            {activeTab === 'definition' ? (
              <div>
                {/* Definition editor */}
                <div className="mb-4">
                  <label className="block text-[12px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Tool Definition (JSON)</label>
                  <textarea
                    value={definitionJson}
                    onChange={(e) => setDefinitionJson(e.target.value)}
                    rows={16}
                    className="w-full px-4 py-3 border border-slate-200 rounded-lg text-[13px] font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                  />
                </div>

                {/* Instructions editor */}
                <div className="mb-4">
                  <label className="block text-[12px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Instructions</label>
                  <textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    rows={8}
                    className="w-full px-4 py-3 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                  />
                </div>

                {/* Action buttons */}
                <div className="flex gap-3 mb-6">
                  <button
                    onClick={handleSimulate}
                    disabled={simulating}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-semibold rounded-lg border border-slate-200 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {simulating ? 'Simulating...' : 'Simulate'}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : `Save ${scopeLabel}-wide`}
                  </button>
                </div>

                {/* Error display */}
                {error && (
                  <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
                    {error}
                  </div>
                )}

                {/* Simulation results */}
                {simulationResults && (
                  <div className="mb-6">
                    <h3 className="text-[14px] font-semibold text-slate-900 mb-2">Simulation Results</h3>
                    <div className="space-y-2">
                      {simulationResults.map((r) => (
                        <div key={r.caseId} className={`px-4 py-2 rounded-lg border text-[13px] ${
                          r.passed
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-red-50 border-red-200 text-red-700'
                        }`}>
                          <span className="font-semibold">{r.passed ? 'PASS' : 'FAIL'}</span>
                          <span className="ml-2 text-slate-500 font-mono text-[11px]">{r.caseId.slice(0, 8)}</span>
                          {r.notes && <span className="ml-2">{r.notes}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Regressions */}
                {(context.regressions as any[]).length > 0 && (
                  <div>
                    <h3 className="text-[14px] font-semibold text-slate-900 mb-2">
                      Active Regressions ({(context.regressions as any[]).length})
                    </h3>
                    <div className="space-y-2">
                      {(context.regressions as Array<{ id: string; rejection_reason?: string; rejected_call_json?: unknown }>).map((r) => (
                        <div key={r.id} className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-[13px]">
                          <div className="font-mono text-[11px] text-slate-400 mb-1">{r.id.slice(0, 8)}</div>
                          {r.rejection_reason && (
                            <div className="text-amber-800">{r.rejection_reason}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Versions tab */
              <div className="space-y-3">
                {context.versions.length === 0 ? (
                  <p className="text-[13px] text-slate-400">No versions yet. Save to create the first version.</p>
                ) : (
                  context.versions.map((v) => (
                    <div key={v.id} className="px-4 py-3 bg-white border border-slate-200 rounded-lg flex items-start justify-between">
                      <div>
                        <div className="text-[13px] font-semibold text-slate-900">
                          v{v.versionNumber} — {v.name}
                        </div>
                        {v.changeSummary && (
                          <div className="text-[12px] text-slate-500 mt-1">{v.changeSummary}</div>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
                          <span>{new Date(v.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          {v.simulationTotalCount > 0 && (
                            <span className={v.simulationPassCount === v.simulationTotalCount ? 'text-emerald-600' : 'text-amber-600'}>
                              {v.simulationPassCount}/{v.simulationTotalCount} pass
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRollback(v.id)}
                        className="px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        Rollback
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
