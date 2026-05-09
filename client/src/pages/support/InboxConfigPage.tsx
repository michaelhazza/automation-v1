import { useState, useEffect } from 'react';
import api from '../../lib/api';

interface SupportInboxAgentConfig {
  mode: 'disabled' | 'draft_only' | 'auto_send';
  collisionDetectionEnabled?: boolean;
  draftExpiryHours?: number;
}

interface Inbox {
  id: string;
  name: string;
  connectorConfigId: string;
  agentConfig: SupportInboxAgentConfig | null;
}

const MODE_OPTIONS: { value: SupportInboxAgentConfig['mode']; label: string; description: string }[] = [
  { value: 'disabled', label: 'Disabled', description: 'Agent does not process this inbox' },
  { value: 'draft_only', label: 'Draft only', description: 'Agent creates drafts for human review before sending' },
  { value: 'auto_send', label: 'Auto send', description: 'Agent sends replies automatically (with collision detection)' },
];

function InboxForm({ inbox, onSaved }: { inbox: Inbox; onSaved: () => void }) {
  const config = inbox.agentConfig ?? { mode: 'disabled' as const };
  const [mode, setMode] = useState<SupportInboxAgentConfig['mode']>(config.mode);
  const [collisionDetection, setCollisionDetection] = useState(config.collisionDetectionEnabled ?? true);
  const [draftExpiryHours, setDraftExpiryHours] = useState(config.draftExpiryHours ?? 72);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const handleModeChange = (val: SupportInboxAgentConfig['mode']) => {
    setMode(val);
    setIsDirty(true);
  };

  const handleCollisionChange = (val: boolean) => {
    setCollisionDetection(val);
    setIsDirty(true);
  };

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 1) return;
    setDraftExpiryHours(v);
    setIsDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/support/inboxes/${inbox.id}`, {
        agentConfig: {
          mode,
          collisionDetectionEnabled: collisionDetection,
          draftExpiryHours,
        },
      });
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
        <h2 className="text-sm font-semibold text-slate-900">{inbox.name}</h2>
        {isDirty && (
          <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
        )}
      </div>

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
                onChange={() => handleModeChange(opt.value)}
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
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={collisionDetection}
                onChange={e => handleCollisionChange(e.target.checked)}
              />
              <span className="text-sm text-slate-700">Enable collision detection</span>
            </label>
            <p className="text-xs text-slate-400 mt-1 ml-5">Pauses sending if a human agent replies simultaneously</p>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-700 mb-1">Draft expiry (hours)</label>
            <input
              type="number"
              min={1}
              max={720}
              value={draftExpiryHours}
              onChange={handleExpiryChange}
              className="w-32 px-2.5 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
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
    </div>
  );
}

export default function InboxConfigPage() {
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.get<{ inboxes: Inbox[] }>('/api/support/inboxes')
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
