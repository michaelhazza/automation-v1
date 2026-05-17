import { useEffect, useState } from 'react';
import api from '../../lib/api';

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export function DevContextConfig({ subaccountId }: { subaccountId: string }) {
  const [dec, setDec] = useState({
    projectRoot: '',
    testCommand: '',
    buildCommand: '',
    lintCommand: '',
    runtime: 'node@20',
    packageManager: 'npm',
    gitConfig: { defaultBranch: 'main', branchPrefix: 'agent/', remote: 'origin', repoOwner: '', repoName: '' },
    costLimits: { maxTestRunsPerTask: 5, maxCommandsPerRun: 10, maxPatchAttemptsPerTask: 10 },
    resourceLimits: { commandTimeoutMs: 60000, maxOutputBytes: 1048576 },
    safeMode: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/api/subaccounts/${subaccountId}/dev-context`)
      .then(({ data }) => {
        if (data.devContext) {
          setDec(prev => ({
            ...prev,
            ...data.devContext,
            gitConfig: { ...prev.gitConfig, ...(data.devContext.gitConfig ?? {}) },
            costLimits: { ...prev.costLimits, ...(data.devContext.costLimits ?? {}) },
            resourceLimits: { ...prev.resourceLimits, ...(data.devContext.resourceLimits ?? {}) },
          }));
        }
      })
      .catch(() => { /* no DEC yet — that's fine */ })
      .finally(() => setLoading(false));
  }, [subaccountId]);

  const handleSave = async () => {
    setSaving(true); setMsg(''); setError('');
    try {
      await api.put(`/api/subaccounts/${subaccountId}/dev-context`, { devContext: dec });
      setMsg('Dev Execution Context saved');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="py-4 text-sm text-slate-500">Loading dev context...</div>;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="text-[18px] font-semibold text-slate-800 mb-1">Dev Execution Context</h2>
      <p className="text-[13px] text-slate-500 mt-0 mb-5">Configure how agents interact with this project's codebase, run tests, and execute commands.</p>

      {msg && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-green-700">{msg}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-red-600">{error}</div>}

      <div className="space-y-5">
        {/* Project basics */}
        <div>
          <h3 className="text-[14px] font-semibold text-slate-700 mb-3">Project</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Project Root *</label>
              <input value={dec.projectRoot} onChange={(e) => setDec({ ...dec, projectRoot: e.target.value })} placeholder="/home/user/my-project" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Runtime</label>
              <input value={dec.runtime} onChange={(e) => setDec({ ...dec, runtime: e.target.value })} placeholder="node@20" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Package Manager</label>
              <select value={dec.packageManager} onChange={(e) => setDec({ ...dec, packageManager: e.target.value })} className={inputCls}>
                <option value="npm">npm</option>
                <option value="yarn">yarn</option>
                <option value="pnpm">pnpm</option>
                <option value="bun">bun</option>
              </select>
            </div>
          </div>
        </div>

        {/* Commands */}
        <div>
          <h3 className="text-[14px] font-semibold text-slate-700 mb-3">Commands</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Test Command *</label>
              <input value={dec.testCommand} onChange={(e) => setDec({ ...dec, testCommand: e.target.value })} placeholder="npm test" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Build Command</label>
              <input value={dec.buildCommand} onChange={(e) => setDec({ ...dec, buildCommand: e.target.value })} placeholder="npm run build" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Lint Command</label>
              <input value={dec.lintCommand} onChange={(e) => setDec({ ...dec, lintCommand: e.target.value })} placeholder="npm run lint" className={inputCls} />
            </div>
          </div>
        </div>

        {/* Git config */}
        <div>
          <h3 className="text-[14px] font-semibold text-slate-700 mb-3">Git</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Default Branch</label>
              <input value={dec.gitConfig.defaultBranch} onChange={(e) => setDec({ ...dec, gitConfig: { ...dec.gitConfig, defaultBranch: e.target.value } })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Repo Owner</label>
              <input value={dec.gitConfig.repoOwner} onChange={(e) => setDec({ ...dec, gitConfig: { ...dec.gitConfig, repoOwner: e.target.value } })} placeholder="github-username" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Repo Name</label>
              <input value={dec.gitConfig.repoName} onChange={(e) => setDec({ ...dec, gitConfig: { ...dec.gitConfig, repoName: e.target.value } })} placeholder="my-repo" className={inputCls} />
            </div>
          </div>
        </div>

        {/* Limits */}
        <div>
          <h3 className="text-[14px] font-semibold text-slate-700 mb-3">Limits</h3>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Max Test Runs / Task</label>
              <input type="number" value={dec.costLimits.maxTestRunsPerTask} onChange={(e) => setDec({ ...dec, costLimits: { ...dec.costLimits, maxTestRunsPerTask: Number(e.target.value) } })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Max Commands / Run</label>
              <input type="number" value={dec.costLimits.maxCommandsPerRun} onChange={(e) => setDec({ ...dec, costLimits: { ...dec.costLimits, maxCommandsPerRun: Number(e.target.value) } })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Command Timeout (ms)</label>
              <input type="number" value={dec.resourceLimits.commandTimeoutMs} onChange={(e) => setDec({ ...dec, resourceLimits: { ...dec.resourceLimits, commandTimeoutMs: Number(e.target.value) } })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Safe Mode</label>
              <select value={dec.safeMode ? 'true' : 'false'} onChange={(e) => setDec({ ...dec, safeMode: e.target.value === 'true' })} className={inputCls}>
                <option value="true">Enabled (read-only)</option>
                <option value="false">Disabled (can write)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <button onClick={handleSave} disabled={saving || !dec.projectRoot || !dec.testCommand} className="btn btn-primary">
          {saving ? 'Saving...' : 'Save Dev Context'}
        </button>
      </div>
    </div>
  );
}
