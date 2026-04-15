import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import { SkillPickerSection } from '../components/SkillPickerSection';
import type { AvailableSkill } from '../components/SkillPickerSection';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LinkDetail {
  id: string;
  agentId: string;
  subaccountId: string;
  isActive: boolean;
  skillSlugs: string[] | null;
  customInstructions: string | null;
  tokenBudgetPerRun: number;
  maxToolCallsPerRun: number;
  timeoutSeconds: number;
  maxCostPerRunCents: number | null;
  maxLlmCallsPerRun: number | null;
  heartbeatEnabled: boolean;
  heartbeatIntervalHours: number | null;
  heartbeatOffsetMinutes: number;
  scheduleCron: string | null;
  scheduleEnabled: boolean;
  scheduleTimezone: string;
  concurrencyPolicy: 'skip_if_active' | 'coalesce_if_active' | 'always_enqueue';
  catchUpPolicy: 'skip_missed' | 'enqueue_missed_with_cap';
  catchUpCap: number;
  maxConcurrentRuns: number;
  agent: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    icon: string | null;
    status: string;
    modelProvider: string;
    modelId: string;
    defaultSkillSlugs: string[];
  };
}

type Tab = 'skills' | 'instructions' | 'budget' | 'scheduling' | 'beliefs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white';
const labelCls = 'block text-[13px] font-medium text-slate-700 mb-1.5';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[10px] border border-slate-200 mb-5">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="m-0 text-[15px] font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SubaccountAgentEditPage({ user: _user }: { user: User }) {
  const { subaccountId, linkId } = useParams<{ subaccountId: string; linkId: string }>();
  const navigate = useNavigate();

  const [link, setLink] = useState<LinkDetail | null>(null);
  const [availableSkills, setAvailableSkills] = useState<AvailableSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('skills');

  // Per-section form state
  const [skillSlugs, setSkillSlugs] = useState<string[]>([]);
  const [customInstructions, setCustomInstructions] = useState('');
  const [budget, setBudget] = useState({ tokenBudgetPerRun: 30000, maxToolCallsPerRun: 20, timeoutSeconds: 300, maxCostPerRunCents: '' as string | number });
  const [scheduling, setScheduling] = useState({ scheduleCron: '', scheduleEnabled: false, scheduleTimezone: 'UTC', concurrencyPolicy: 'skip_if_active' as LinkDetail['concurrencyPolicy'], catchUpPolicy: 'skip_missed' as LinkDetail['catchUpPolicy'], catchUpCap: 3, maxConcurrentRuns: 1 });

  // Save state per section
  const [saving, setSaving] = useState<Tab | null>(null);
  const [saved, setSaved] = useState<Tab | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [linkRes, skillsRes] = await Promise.all([
          api.get(`/api/subaccounts/${subaccountId}/agents/${linkId}/detail`),
          api.get(`/api/subaccounts/${subaccountId}/skills`),
        ]);
        const detail: LinkDetail = linkRes.data;
        setLink(detail);
        // Initialise form state from server data
        setSkillSlugs(detail.skillSlugs ?? detail.agent.defaultSkillSlugs);
        setCustomInstructions(detail.customInstructions ?? '');
        setBudget({
          tokenBudgetPerRun: detail.tokenBudgetPerRun,
          maxToolCallsPerRun: detail.maxToolCallsPerRun,
          timeoutSeconds: detail.timeoutSeconds,
          maxCostPerRunCents: detail.maxCostPerRunCents ?? '',
        });
        setScheduling({
          scheduleCron: detail.scheduleCron ?? '',
          scheduleEnabled: detail.scheduleEnabled,
          scheduleTimezone: detail.scheduleTimezone,
          concurrencyPolicy: detail.concurrencyPolicy,
          catchUpPolicy: detail.catchUpPolicy,
          catchUpCap: detail.catchUpCap,
          maxConcurrentRuns: detail.maxConcurrentRuns,
        });
        setAvailableSkills(skillsRes.data ?? []);
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
        const apiErr = err.response?.data?.error;
        const msg = typeof apiErr === 'string' ? apiErr : apiErr?.message;
        setError(msg ?? err.message ?? 'Failed to load agent configuration');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [subaccountId, linkId]);

  async function patch(tab: Tab, payload: Record<string, unknown>) {
    setSaving(tab);
    setSaved(null);
    setSaveError(null);
    try {
      await api.patch(`/api/subaccounts/${subaccountId}/agents/${linkId}`, payload);
      setSaved(tab);
      setTimeout(() => setSaved(null), 3000);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
      const apiErr = err.response?.data?.error;
      const msg = typeof apiErr === 'string' ? apiErr : apiErr?.message;
      setSaveError(msg ?? err.message ?? 'Save failed');
    } finally {
      setSaving(null);
    }
  }

  const saveSkills = () => patch('skills', { skillSlugs });
  const saveInstructions = () => patch('instructions', { customInstructions: customInstructions || null });
  const saveBudget = () => patch('budget', {
    tokenBudgetPerRun: Number(budget.tokenBudgetPerRun),
    maxToolCallsPerRun: Number(budget.maxToolCallsPerRun),
    timeoutSeconds: Number(budget.timeoutSeconds),
    maxCostPerRunCents: budget.maxCostPerRunCents === '' ? null : Number(budget.maxCostPerRunCents),
  });
  const saveScheduling = () => patch('scheduling', {
    scheduleCron: scheduling.scheduleCron || null,
    scheduleEnabled: scheduling.scheduleEnabled,
    scheduleTimezone: scheduling.scheduleTimezone,
    concurrencyPolicy: scheduling.concurrencyPolicy,
    catchUpPolicy: scheduling.catchUpPolicy,
    catchUpCap: Number(scheduling.catchUpCap),
    maxConcurrentRuns: Number(scheduling.maxConcurrentRuns),
  });

  if (loading) {
    return <div className="p-8 text-[13px] text-slate-400">Loading…</div>;
  }
  if (error || !link) {
    return (
      <div className="p-8">
        <div className="text-red-600 text-[13px] mb-4">{error ?? 'Agent link not found'}</div>
        <button onClick={() => navigate(-1)} className="text-indigo-600 text-[13px] hover:underline bg-transparent border-0 cursor-pointer p-0">← Back</button>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'skills', label: 'Skills' },
    { id: 'instructions', label: 'Instructions' },
    { id: 'budget', label: 'Budget' },
    { id: 'scheduling', label: 'Scheduling' },
    { id: 'beliefs', label: 'Beliefs' },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="text-[12px] text-slate-400 mb-5 flex items-center gap-1.5">
        <Link to="/admin/subaccounts" className="hover:text-slate-700 no-underline">Subaccounts</Link>
        <span>/</span>
        <Link to={`/admin/subaccounts/${subaccountId}`} className="hover:text-slate-700 no-underline">Subaccount</Link>
        <span>/</span>
        <span className="text-slate-600">Agent Config</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {link.agent.icon && <span className="text-3xl">{link.agent.icon}</span>}
        <div>
          <h1 className="text-[22px] font-semibold text-slate-900 m-0">{link.agent.name}</h1>
          <div className="text-[13px] text-slate-500 mt-0.5">Subaccount configuration</div>
        </div>
        <span className={`ml-auto text-[11px] font-semibold capitalize px-2.5 py-1 rounded-full ${link.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
          {link.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Org agent context (read-only) */}
      <div className="bg-slate-50 border border-slate-200 rounded-[10px] p-4 mb-6 text-[13px]">
        <div className="font-medium text-slate-600 mb-2 text-[11px] uppercase tracking-wide">Org-level agent (read-only)</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-slate-400 text-[11px]">Model</span>
            <div className="text-slate-800 font-medium">{link.agent.modelId}</div>
          </div>
          <div>
            <span className="text-slate-400 text-[11px]">Status</span>
            <div className="text-slate-800 font-medium capitalize">{link.agent.status}</div>
          </div>
        </div>
        {link.agent.description && (
          <div className="mt-2 text-slate-500">{link.agent.description}</div>
        )}
        <div className="mt-2">
          <Link to={`/admin/agents/${link.agentId}`} className="text-indigo-500 text-[12px] hover:underline no-underline">
            Edit org-level agent →
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6 gap-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors bg-transparent cursor-pointer font-[inherit] ${
              activeTab === t.id
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Save feedback */}
      {saveError && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{saveError}</div>
      )}

      {/* ── Skills tab ── */}
      {activeTab === 'skills' && (
        <div>
          <div className="text-[13px] text-slate-500 mb-4">
            Override which skills this agent can use in this subaccount.
            {link.agent.defaultSkillSlugs.length > 0 && (
              <span className="ml-1">
                Org defaults: <span className="font-medium text-slate-700">{link.agent.defaultSkillSlugs.join(', ')}</span>
              </span>
            )}
          </div>
          <SkillPickerSection
            selectedSlugs={skillSlugs}
            availableSkills={availableSkills}
            onChange={setSkillSlugs}
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={saveSkills}
              disabled={saving === 'skills'}
              className="px-5 py-2 text-[13px] font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 border-0 cursor-pointer font-[inherit]"
            >
              {saving === 'skills' ? 'Saving…' : 'Save Skills'}
            </button>
            {saved === 'skills' && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
          </div>
        </div>
      )}

      {/* ── Instructions tab ── */}
      {activeTab === 'instructions' && (
        <div>
          <Section title="Custom Instructions">
            <p className="text-[13px] text-slate-500 mt-0 mb-3">
              Additional instructions appended to the agent's master prompt for this subaccount only. Leave blank to use the org-level prompt without additions.
            </p>
            <label className={labelCls}>Additional instructions</label>
            <textarea
              value={customInstructions}
              onChange={e => setCustomInstructions(e.target.value)}
              rows={8}
              placeholder="e.g. Always sign off reports with the client's name…"
              className={`${inputCls} font-mono resize-y`}
            />
          </Section>
          <div className="flex items-center gap-3">
            <button
              onClick={saveInstructions}
              disabled={saving === 'instructions'}
              className="px-5 py-2 text-[13px] font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 border-0 cursor-pointer font-[inherit]"
            >
              {saving === 'instructions' ? 'Saving…' : 'Save Instructions'}
            </button>
            {saved === 'instructions' && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
          </div>
        </div>
      )}

      {/* ── Budget tab ── */}
      {activeTab === 'budget' && (
        <div>
          <Section title="Execution Budget">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Token budget per run</label>
                <input
                  type="number"
                  min={1000}
                  value={budget.tokenBudgetPerRun}
                  onChange={e => setBudget(b => ({ ...b, tokenBudgetPerRun: Number(e.target.value) }))}
                  className={inputCls}
                />
                <div className="text-[11px] text-slate-400 mt-1">Total input + output tokens allowed per run</div>
              </div>
              <div>
                <label className={labelCls}>Max tool calls per run</label>
                <input
                  type="number"
                  min={1}
                  value={budget.maxToolCallsPerRun}
                  onChange={e => setBudget(b => ({ ...b, maxToolCallsPerRun: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Timeout (seconds)</label>
                <input
                  type="number"
                  min={30}
                  value={budget.timeoutSeconds}
                  onChange={e => setBudget(b => ({ ...b, timeoutSeconds: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Max cost per run (cents)</label>
                <input
                  type="number"
                  min={0}
                  value={budget.maxCostPerRunCents}
                  onChange={e => setBudget(b => ({ ...b, maxCostPerRunCents: e.target.value }))}
                  placeholder="No limit"
                  className={inputCls}
                />
                <div className="text-[11px] text-slate-400 mt-1">Leave blank for no cost cap</div>
              </div>
            </div>
          </Section>
          <div className="flex items-center gap-3">
            <button
              onClick={saveBudget}
              disabled={saving === 'budget'}
              className="px-5 py-2 text-[13px] font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 border-0 cursor-pointer font-[inherit]"
            >
              {saving === 'budget' ? 'Saving…' : 'Save Budget'}
            </button>
            {saved === 'budget' && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
          </div>
        </div>
      )}

      {/* ── Scheduling tab ── */}
      {activeTab === 'scheduling' && (
        <div>
          <Section title="Schedule">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={labelCls}>Cron expression</label>
                <input
                  type="text"
                  value={scheduling.scheduleCron}
                  onChange={e => setScheduling(s => ({ ...s, scheduleCron: e.target.value }))}
                  placeholder="e.g. 0 9 * * 1  (Monday 9 AM)"
                  className={`${inputCls} font-mono`}
                />
                <div className="text-[11px] text-slate-400 mt-1">Standard cron syntax. Leave blank to disable scheduling.</div>
              </div>
              <div>
                <label className={labelCls}>Timezone</label>
                <input
                  type="text"
                  value={scheduling.scheduleTimezone}
                  onChange={e => setScheduling(s => ({ ...s, scheduleTimezone: e.target.value }))}
                  placeholder="UTC"
                  className={inputCls}
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="scheduleEnabled"
                  checked={scheduling.scheduleEnabled}
                  onChange={e => setScheduling(s => ({ ...s, scheduleEnabled: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="scheduleEnabled" className="text-[13px] text-slate-700 cursor-pointer">Enable schedule</label>
              </div>
            </div>
          </Section>

          <Section title="Concurrency">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Concurrency policy</label>
                <select
                  value={scheduling.concurrencyPolicy}
                  onChange={e => setScheduling(s => ({ ...s, concurrencyPolicy: e.target.value as LinkDetail['concurrencyPolicy'] }))}
                  className={inputCls}
                >
                  <option value="skip_if_active">Skip if active</option>
                  <option value="coalesce_if_active">Coalesce if active</option>
                  <option value="always_enqueue">Always enqueue</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Max concurrent runs</label>
                <input
                  type="number"
                  min={1}
                  value={scheduling.maxConcurrentRuns}
                  onChange={e => setScheduling(s => ({ ...s, maxConcurrentRuns: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Catch-up policy</label>
                <select
                  value={scheduling.catchUpPolicy}
                  onChange={e => setScheduling(s => ({ ...s, catchUpPolicy: e.target.value as LinkDetail['catchUpPolicy'] }))}
                  className={inputCls}
                >
                  <option value="skip_missed">Skip missed</option>
                  <option value="enqueue_missed_with_cap">Enqueue missed (with cap)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Catch-up cap</label>
                <input
                  type="number"
                  min={1}
                  value={scheduling.catchUpCap}
                  onChange={e => setScheduling(s => ({ ...s, catchUpCap: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
            </div>
          </Section>

          <div className="flex items-center gap-3">
            <button
              onClick={saveScheduling}
              disabled={saving === 'scheduling'}
              className="px-5 py-2 text-[13px] font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 border-0 cursor-pointer font-[inherit]"
            >
              {saving === 'scheduling' ? 'Saving…' : 'Save Scheduling'}
            </button>
            {saved === 'scheduling' && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
          </div>
        </div>
      )}

      {/* ── Beliefs tab ── */}
      {activeTab === 'beliefs' && subaccountId && linkId && (
        <BeliefsTab subaccountId={subaccountId} linkId={linkId} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Beliefs Tab — discrete facts formed by this agent for this subaccount
// ---------------------------------------------------------------------------

interface Belief {
  id: string;
  beliefKey: string;
  category: string;
  subject: string | null;
  value: string;
  confidence: number;
  source: string;
  evidenceCount: number;
  updatedAt: string;
}

function BeliefsTab({ subaccountId, linkId }: { subaccountId: string; linkId: string }) {
  const [beliefs, setBeliefs] = useState<Belief[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editBelief, setEditBelief] = useState<Belief | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    api.get(`/api/subaccounts/${subaccountId}/agents/${linkId}/beliefs`)
      .then(r => { setBeliefs(r.data as Belief[]); })
      .catch(() => { setFetchError('Failed to load beliefs'); })
      .finally(() => setLoading(false));
  }, [subaccountId, linkId]);

  const handleDelete = async (b: Belief) => {
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/agents/${linkId}/beliefs/${b.beliefKey}`);
      setBeliefs(prev => prev.filter(x => x.id !== b.id));
      toast.success('Belief deleted');
    } catch { toast.error('Failed to delete belief'); }
  };

  const handleEdit = async () => {
    if (!editBelief || !editValue.trim()) return;
    try {
      const { data } = await api.put(
        `/api/subaccounts/${subaccountId}/agents/${linkId}/beliefs/${editBelief.beliefKey}`,
        { value: editValue, category: editBelief.category, subject: editBelief.subject },
      );
      setBeliefs(prev => prev.map(b => b.beliefKey === editBelief.beliefKey ? { ...b, ...data as Belief } : b));
      setEditBelief(null);
      toast.success('Belief updated (user override)');
    } catch { toast.error('Failed to update belief'); }
  };

  if (loading) return <div className="text-[13px] text-slate-500">Loading beliefs…</div>;
  if (fetchError) return <div className="text-[13px] text-red-600">{fetchError}</div>;

  if (beliefs.length === 0) {
    return (
      <div className="text-[13px] text-slate-500">
        No beliefs formed yet. Beliefs are extracted automatically after agent runs.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-[13px] text-slate-500">
        Discrete facts this agent has learned about the workspace. Automatically extracted after each run.
        User overrides are protected from agent updates.
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Category</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Subject</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Belief</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Confidence</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Source</th>
              <th className="text-left px-4 py-2.5 font-medium text-slate-600">Updated</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {beliefs.map(b => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 capitalize text-slate-600">{b.category}</td>
                <td className="px-4 py-2.5 text-slate-500">{b.subject ?? '-'}</td>
                <td className="px-4 py-2.5 text-slate-800 max-w-[300px] truncate">{b.value}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded text-[12px] font-medium ${
                    b.confidence >= 0.8 ? 'bg-green-50 text-green-700' :
                    b.confidence >= 0.5 ? 'bg-amber-50 text-amber-700' :
                    'bg-red-50 text-red-700'
                  }`}>
                    {b.confidence.toFixed(2)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{b.source === 'user_override' ? 'User' : 'Agent'}</td>
                <td className="px-4 py-2.5 text-slate-400">{new Date(b.updatedAt).toLocaleDateString()}</td>
                <td className="px-4 py-2.5 text-right space-x-2">
                  <button
                    type="button"
                    onClick={() => { setEditBelief(b); setEditValue(b.value); }}
                    className="text-indigo-600 hover:text-indigo-800 text-[12px] font-medium"
                  >Edit</button>
                  <button
                    type="button"
                    onClick={() => handleDelete(b)}
                    className="text-red-500 hover:text-red-700 text-[12px] font-medium"
                  >Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editBelief && (
        <Modal title="Edit Belief" onClose={() => setEditBelief(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1">Key: {editBelief.beliefKey}</label>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1">Value</label>
              <textarea
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                rows={3}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
              />
            </div>
            <div className="text-[12px] text-slate-500">Saving sets source to "User Override" with confidence 1.0</div>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setEditBelief(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg">Cancel</button>
              <button type="button" onClick={handleEdit} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg">Save Override</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
