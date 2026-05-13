import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../lib/api';
import { useEADrafts, useApproveEADraft, useRejectEADraft } from '../../hooks/useEADrafts';
import { useVoiceProfile, useOptOutVoiceProfile, useRefreshVoiceProfile } from '../../hooks/useVoiceProfile';
import type { EADraft } from '../../hooks/useEADrafts';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface AgentRun {
  id: string;
  startedAt: string;
  status: string;
  summary: string | null;
}

type Tab = 'workspace' | 'activity' | 'settings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHIMMER_CLS =
  'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-md';

function Skeleton({ className }: { className?: string }) {
  return <div className={`${SHIMMER_CLS} ${className ?? ''}`} />;
}

const SEND_STATE_LABELS: Record<EADraft['sendState'], string> = {
  idle: 'Pending',
  sending: 'Sending',
  sent: 'Sent',
  send_failed: 'Failed',
};

const SEND_STATE_COLORS: Record<EADraft['sendState'], string> = {
  idle: 'bg-amber-50 text-amber-700 border-amber-200',
  sending: 'bg-blue-50 text-blue-700 border-blue-200',
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  send_failed: 'bg-rose-50 text-rose-700 border-rose-200',
};

function StatusChip({ state }: { state: EADraft['sendState'] }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border ${SEND_STATE_COLORS[state]}`}>
      {SEND_STATE_LABELS[state]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Draft card
// ---------------------------------------------------------------------------

function DraftCard({ draft, onAction }: { draft: EADraft; onAction: () => void }) {
  const { approve, isPending: approving } = useApproveEADraft(onAction);
  const { reject, isPending: rejecting } = useRejectEADraft(onAction);
  const isPending = draft.sendState === 'idle';

  const subject =
    typeof draft.body?.subject === 'string' ? draft.body.subject : draft.kind;
  const preview =
    typeof draft.body?.body === 'string'
      ? draft.body.body.slice(0, 120)
      : typeof draft.body?.text === 'string'
        ? draft.body.text.slice(0, 120)
        : null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">{subject}</div>
          {preview && (
            <div className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">
              {preview}
            </div>
          )}
        </div>
        <StatusChip state={draft.sendState} />
      </div>
      {isPending && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => approve(draft.id)}
            disabled={approving || rejecting}
            className="px-3 py-1.5 bg-indigo-700 text-white rounded-lg text-xs font-semibold hover:bg-indigo-800 transition-colors disabled:opacity-60"
          >
            {approving ? 'Approving…' : 'Approve'}
          </button>
          <button
            onClick={() => reject(draft.id)}
            disabled={approving || rejecting}
            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:border-slate-300 transition-colors disabled:opacity-60"
          >
            {rejecting ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Workspace
// ---------------------------------------------------------------------------

function WorkspaceTab({ agentId }: { agentId: string }) {
  const { data: drafts, isLoading, isError, refetch } = useEADrafts();

  const agentDrafts = drafts.filter((d) => d.agentId === agentId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-4">
        Failed to load drafts. Please refresh the page.
      </div>
    );
  }

  if (agentDrafts.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <div className="text-slate-400 text-sm">No drafts waiting for review.</div>
      </div>
    );
  }

  return (
    <div>
      {agentDrafts.map((draft) => (
        <DraftCard key={draft.id} draft={draft} onAction={refetch} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Activity
// ---------------------------------------------------------------------------

function ActivityTab({ agentId }: { agentId: string }) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    api.get<{ runs: AgentRun[] }>('/api/agent-runs', { params: { agentId, limit: 20 } })
      .then((res) => {
        if (!cancelled) {
          setRuns(res.data.runs ?? []);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsError(true);
          setIsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [agentId]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-4">
        Failed to load activity. Please refresh the page.
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <div className="text-slate-400 text-sm">No recent runs yet.</div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
      {runs.map((run) => (
        <div key={run.id} className="flex items-center gap-3 px-4 py-3">
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              run.status === 'completed'
                ? 'bg-emerald-400'
                : run.status === 'failed'
                  ? 'bg-rose-400'
                  : 'bg-slate-300'
            }`}
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-slate-500 truncate">{run.summary ?? 'Run completed'}</div>
          </div>
          <div className="text-[11px] text-slate-400 flex-shrink-0">
            {new Date(run.startedAt).toLocaleDateString()}
          </div>
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${
              run.status === 'completed'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : run.status === 'failed'
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
            }`}
          >
            {run.status}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Settings
// ---------------------------------------------------------------------------

function SettingsTab({ agentId }: { agentId: string }) {
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const { data: voiceProfile } = useVoiceProfile(profileId);
  const { optOut, isPending: isOptingOut } = useOptOutVoiceProfile();
  const { refresh, isPending: isRefreshing } = useRefreshVoiceProfile();

  const [displayName, setDisplayName] = useState('Personal Assistant');
  const [briefingDelivery, setBriefingDelivery] = useState<'slack_dm' | 'email'>('slack_dm');
  const [briefingTime, setBriefingTime] = useState('07:00');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load current settings from memory blocks
  useEffect(() => {
    let cancelled = false;
    api.get<{ blocks: { name: string; content: string }[] }>(
      '/api/memory-blocks',
      { params: { agentId } },
    ).then((res) => {
      if (cancelled) return;
      const blocks = res.data.blocks ?? [];
      for (const block of blocks) {
        if (block.name === 'ea.briefing_delivery_target') {
          if (block.content === 'slack_dm' || block.content === 'email') {
            setBriefingDelivery(block.content);
          }
        }
        if (block.name === 'ea.briefing_time') {
          setBriefingTime(block.content);
        }
        if (block.name === 'ea.voice_profile_id' && block.content) {
          setProfileId(block.content);
        }
      }
    }).catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [agentId]);

  async function handleSave() {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await api.patch(`/api/agents/${agentId}`, { name: displayName });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch {
      // non-fatal; user can retry
    } finally {
      setIsSaving(false);
    }
  }

  const voiceStateLabel: Record<string, string> = {
    pending: 'Pending',
    deriving: 'Analysing',
    ready: 'Ready',
    failed: 'Failed',
  };

  const voiceStateColor: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    deriving: 'bg-blue-50 text-blue-700 border-blue-200',
    ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed: 'bg-rose-50 text-rose-700 border-rose-200',
  };

  return (
    <div className="space-y-5">
      {/* Display name */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-slate-900 mb-3">General</h3>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            Assistant name
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm font-semibold hover:bg-indigo-800 transition-colors disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : saveSuccess ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Voice profile */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-slate-900 mb-3">Writing style</h3>
        {voiceProfile ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-slate-700">Status:</span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  voiceStateColor[voiceProfile.state] ?? 'bg-slate-100 text-slate-500 border-slate-200'
                }`}
              >
                {voiceStateLabel[voiceProfile.state] ?? voiceProfile.state}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => refresh(voiceProfile.id)}
                disabled={isRefreshing}
                className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:border-slate-300 transition-colors disabled:opacity-60"
              >
                {isRefreshing ? 'Refreshing…' : 'Refresh analysis'}
              </button>
              <button
                onClick={() => optOut(voiceProfile.id)}
                disabled={isOptingOut}
                className="px-3 py-1.5 bg-white border border-rose-200 text-rose-600 rounded-lg text-xs font-semibold hover:bg-rose-50 transition-colors disabled:opacity-60"
              >
                {isOptingOut ? 'Opting out…' : 'Opt out'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            Writing style analysis is not enabled. Set up your assistant again to enable it.
          </p>
        )}
      </div>

      {/* Briefing preferences */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-slate-900 mb-3">Briefing preferences</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Delivery
            </label>
            <select
              value={briefingDelivery}
              onChange={(e) => setBriefingDelivery(e.target.value as 'slack_dm' | 'email')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white"
            >
              <option value="slack_dm">Slack DM</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Time
            </label>
            <input
              type="time"
              value={briefingTime}
              onChange={(e) => setBriefingTime(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>
      </div>

      {/* Auto-send scope */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        <p className="text-xs text-slate-500 leading-relaxed">
          <strong className="text-slate-700">Auto-send scope:</strong> Slack DMs to you are sent automatically. All other sends require your approval.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PersonalAssistantPage
// ---------------------------------------------------------------------------

export default function PersonalAssistantPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('workspace');

  if (!agentId) {
    return (
      <div className="p-8 text-sm text-slate-400">Agent not found.</div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'workspace', label: 'Workspace' },
    { key: 'activity', label: 'Activity' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-6">
        <div className="text-[11px] font-bold tracking-widest uppercase text-indigo-600 mb-1">
          Personal Assistant
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Your Personal Assistant
        </h1>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-6 bg-slate-100 rounded-xl p-1 w-fit">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'workspace' && <WorkspaceTab agentId={agentId} />}
      {activeTab === 'activity' && <ActivityTab agentId={agentId} />}
      {activeTab === 'settings' && <SettingsTab agentId={agentId} />}
    </div>
  );
}
