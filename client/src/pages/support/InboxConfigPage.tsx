import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { getActiveClientId } from '../../lib/auth';
import SyncHealthPill from '../../components/support/SyncHealthPill';
import { InboxAgentConfigTab } from '../../components/support/InboxAgentConfigTab';
import type { SupportInboxAgentConfig as PhaseOneInboxAgentConfig } from '../../../../shared/types/supportInboxAgentConfig';

interface SupportInboxAgentConfig {
  version: 1;
  mode: 'autonomous' | 'assisted' | 'disabled';
  collisionWindow: {
    minMinutesSinceHumanActivity: number;
    respectHumanAssignee: boolean;
  };
  draftExpiry: {
    awaitingReviewHours: number;
    draftHours: number;
  };
  optIns: {
    autonomousReplyOnWaitingOnCustomer: boolean;
    postResolutionFollowUp: boolean;
  };
  // Phase 1 Showcase fields — preserved on legacy PATCH to avoid clobbering values
  // set via the InboxAgentConfigTab below.
  minConfidence?: number;
  voiceProfile?: 'casual' | 'neutral' | 'formal' | 'custom';
  promptOverride?: string;
  escalationCategories?: string[];
}

interface Inbox {
  id: string;
  name: string;
  connectorConfigId: string;
  agentConfig: SupportInboxAgentConfig | null;
  syncHealth?: 'running' | 'degraded' | 'failed';
  lastSyncAt?: string | null;
  syncErrorMessage?: string | null;
}

const MODE_OPTIONS: { value: SupportInboxAgentConfig['mode']; label: string; description: string }[] = [
  { value: 'disabled', label: 'Disabled', description: 'Agent does not process this inbox' },
  { value: 'assisted', label: 'Assisted', description: 'Agent creates drafts for human review before sending' },
  { value: 'autonomous', label: 'Autonomous', description: 'Agent sends replies automatically with collision detection' },
];

const DEFAULT_CONFIG: SupportInboxAgentConfig = {
  version: 1,
  mode: 'disabled',
  collisionWindow: {
    minMinutesSinceHumanActivity: 30,
    respectHumanAssignee: true,
  },
  draftExpiry: {
    awaitingReviewHours: 24,
    draftHours: 72,
  },
  optIns: {
    autonomousReplyOnWaitingOnCustomer: false,
    postResolutionFollowUp: false,
  },
};

function InboxForm({ inbox, onSaved }: { inbox: Inbox; onSaved: () => void }) {
  const base = inbox.agentConfig ?? DEFAULT_CONFIG;
  const [mode, setMode] = useState<SupportInboxAgentConfig['mode']>(base.mode);
  const [minMinutesSinceHumanActivity, setMinMinutes] = useState(
    base.collisionWindow?.minMinutesSinceHumanActivity ?? 30,
  );
  const [respectHumanAssignee, setRespectHumanAssignee] = useState(
    base.collisionWindow?.respectHumanAssignee ?? true,
  );
  const [awaitingReviewHours, setAwaitingReviewHours] = useState(
    base.draftExpiry?.awaitingReviewHours ?? 24,
  );
  const [draftHours, setDraftHours] = useState(
    base.draftExpiry?.draftHours ?? 72,
  );
  const [autonomousReplyOnWaiting, setAutonomousReplyOnWaiting] = useState(
    base.optIns?.autonomousReplyOnWaitingOnCustomer ?? false,
  );
  const [postResolutionFollowUp, setPostResolutionFollowUp] = useState(
    base.optIns?.postResolutionFollowUp ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const markDirty = () => setIsDirty(true);

  const handleSave = async () => {
    setSaving(true);
    try {
      const agentConfig: SupportInboxAgentConfig = {
        version: 1,
        mode,
        collisionWindow: {
          minMinutesSinceHumanActivity,
          respectHumanAssignee,
        },
        draftExpiry: {
          awaitingReviewHours,
          draftHours,
        },
        optIns: {
          autonomousReplyOnWaitingOnCustomer: autonomousReplyOnWaiting,
          postResolutionFollowUp,
        },
        // Preserve Phase 1 Showcase fields set via InboxAgentConfigTab so a save here
        // does not clobber them.
        minConfidence: base.minConfidence,
        voiceProfile: base.voiceProfile,
        promptOverride: base.promptOverride,
        escalationCategories: base.escalationCategories,
      };
      const subaccountId = getActiveClientId();
      if (!subaccountId) throw new Error('No active client selected');
      await api.patch(`/api/subaccounts/${subaccountId}/support/inboxes/${inbox.id}`, { agentConfig });
      setSaved(true);
      setIsDirty(false);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{inbox.name}</h2>
          {inbox.syncHealth && (
            <div className="mt-1">
              <SyncHealthPill
                health={inbox.syncHealth}
                lastSyncAt={inbox.lastSyncAt}
                tooltip={inbox.syncErrorMessage}
              />
            </div>
          )}
        </div>
        {isDirty && (
          <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
        )}
      </div>

      {/* Mode */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-700 mb-2">Agent mode</label>
        <div className="space-y-2">
          {MODE_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="radio"
                name={`mode-${inbox.id}`}
                value={opt.value}
                checked={mode === opt.value}
                onChange={() => { setMode(opt.value); markDirty(); }}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm text-slate-800 font-medium">{opt.label}</span>
                <p className="text-xs text-slate-500">{opt.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {mode !== 'disabled' && (
        <>
          {/* Collision window */}
          <div className="mb-4 border-t border-slate-100 pt-4">
            <p className="text-xs font-medium text-slate-700 mb-2">Collision window</p>
            <div className="mb-2">
              <label className="block text-xs text-slate-600 mb-1">
                Min. minutes since human activity
              </label>
              <input
                type="number"
                min={0}
                max={1440}
                value={minMinutesSinceHumanActivity}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 0) { setMinMinutes(v); markDirty(); }
                }}
                className="w-28 px-2.5 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={respectHumanAssignee}
                onChange={e => { setRespectHumanAssignee(e.target.checked); markDirty(); }}
              />
              <span className="text-sm text-slate-700">Respect human assignee</span>
            </label>
            <p className="text-xs text-slate-400 mt-1 ml-5">Pauses sending when a human agent is assigned</p>
          </div>

          {/* Draft expiry */}
          <div className="mb-4 border-t border-slate-100 pt-4">
            <p className="text-xs font-medium text-slate-700 mb-2">Draft expiry</p>
            <div className="mb-2">
              <label className="block text-xs text-slate-600 mb-1">
                Awaiting review expiry (hours)
              </label>
              <input
                type="number"
                min={1}
                max={720}
                value={awaitingReviewHours}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 1) { setAwaitingReviewHours(v); markDirty(); }
                }}
                className="w-28 px-2.5 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                Draft expiry (hours)
              </label>
              <input
                type="number"
                min={1}
                max={720}
                value={draftHours}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 1) { setDraftHours(v); markDirty(); }
                }}
                className="w-28 px-2.5 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Opt-ins */}
          <div className="mb-4 border-t border-slate-100 pt-4">
            <p className="text-xs font-medium text-slate-700 mb-2">Opt-ins</p>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={autonomousReplyOnWaiting}
                onChange={e => { setAutonomousReplyOnWaiting(e.target.checked); markDirty(); }}
              />
              <span className="text-sm text-slate-700">Reply autonomously when waiting on customer</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={postResolutionFollowUp}
                onChange={e => { setPostResolutionFollowUp(e.target.checked); markDirty(); }}
              />
              <span className="text-sm text-slate-700">Post-resolution follow-up</span>
            </label>
          </div>
        </>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !isDirty}
        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save changes'}
      </button>

      {/* Phase 1 Showcase — agent config (mode, collision, confidence, voice, escalation) */}
      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="text-xs font-medium text-slate-700 mb-2">Agent config</p>
        <InboxAgentConfigTab
          inboxId={inbox.id}
          initialConfig={{
            version: 1,
            mode,
            collisionWindow: {
              minMinutesSinceHumanActivity,
              respectHumanAssignee,
            },
            draftExpiry: {
              awaitingReviewHours,
              draftHours,
            },
            optIns: {
              autonomousReplyOnWaitingOnCustomer: autonomousReplyOnWaiting,
              postResolutionFollowUp,
            },
            minConfidence: base.minConfidence ?? 0.8,
            voiceProfile: base.voiceProfile ?? 'neutral',
            promptOverride: base.promptOverride,
            escalationCategories: base.escalationCategories ?? [],
          } as PhaseOneInboxAgentConfig}
          onSaved={onSaved}
        />
      </div>
    </div>
  );
}

export default function InboxConfigPage() {
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    const subaccountId = getActiveClientId();
    if (!subaccountId) {
      setError('No active client selected.');
      setLoading(false);
      return;
    }
    api.get<{ inboxes: Inbox[] }>(`/api/subaccounts/${subaccountId}/support/inboxes`)
      .then(({ data }) => setInboxes(data.inboxes ?? []))
      .catch(() => setError('Failed to load inboxes.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <h1 className="text-lg font-semibold text-slate-900">Inboxes</h1>
        <p className="text-xs text-slate-500 mt-0.5">Configure agent behaviour per inbox</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-[3px] border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && !error && inboxes.length === 0 && (
          <p className="text-sm text-slate-500">No inboxes configured yet.</p>
        )}
        {inboxes.map(inbox => (
          <InboxForm key={inbox.id} inbox={inbox} onSaved={load} />
        ))}
      </div>
    </div>
  );
}
