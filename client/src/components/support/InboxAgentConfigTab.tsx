import { useState } from 'react';
import api from '../../lib/api';
import type { SupportInboxAgentConfig } from '../../../../shared/types/supportInboxAgentConfig';

interface InboxAgentConfigTabProps {
  inboxId: string;
  initialConfig: SupportInboxAgentConfig;
  onSaved: () => void;
}

const ESCALATION_CATEGORY_OPTIONS = [
  { value: 'cancellation_request', label: 'Cancellation request' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'sales_inquiry', label: 'Sales inquiry' },
  { value: 'other', label: 'Other' },
] as const;

export function InboxAgentConfigTab({ inboxId, initialConfig, onSaved }: InboxAgentConfigTabProps) {
  const [mode, setMode] = useState<SupportInboxAgentConfig['mode']>(initialConfig.mode);
  const [minMinutes, setMinMinutes] = useState(initialConfig.collisionWindow.minMinutesSinceHumanActivity);
  const [respectHumanAssignee, setRespectHumanAssignee] = useState(initialConfig.collisionWindow.respectHumanAssignee);
  const [minConfidence, setMinConfidence] = useState(initialConfig.minConfidence ?? 0.8);
  const [voiceProfile, setVoiceProfile] = useState<SupportInboxAgentConfig['voiceProfile']>(initialConfig.voiceProfile ?? 'neutral');
  const [promptOverride, setPromptOverride] = useState(initialConfig.promptOverride ?? '');
  const [escalationCategories, setEscalationCategories] = useState<string[]>(initialConfig.escalationCategories ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCategory(value: string) {
    setEscalationCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/support/inboxes/${inboxId}/agent-config`, {
        mode,
        collisionWindow: {
          minMinutesSinceHumanActivity: minMinutes,
          respectHumanAssignee,
        },
        minConfidence,
        voiceProfile,
        promptOverride: promptOverride || undefined,
        escalationCategories,
      });
      onSaved();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } } };
      setError(axiosError.response?.data?.error ?? 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 py-4 max-w-lg">
      {/* Mode */}
      <fieldset>
        <legend className="text-[13px] font-medium text-slate-700 mb-2">Agent mode</legend>
        <div className="flex flex-col gap-1.5">
          {(['disabled', 'assisted', 'autonomous'] as const).map((m) => (
            <label key={m} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="accent-indigo-600"
              />
              <span className="text-[13px] text-slate-700 capitalize">{m}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Collision window */}
      <div>
        <label className="text-[13px] font-medium text-slate-700 block mb-1">
          Min minutes since human activity
        </label>
        <select
          value={minMinutes}
          onChange={(e) => setMinMinutes(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-[13px] text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {[5, 15, 30, 60].map((m) => (
            <option key={m} value={m}>{m} minutes</option>
          ))}
        </select>
      </div>

      {/* Respect human assignee */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={respectHumanAssignee}
          onChange={(e) => setRespectHumanAssignee(e.target.checked)}
          className="accent-indigo-600"
        />
        <span className="text-[13px] text-slate-700">Respect human assignee</span>
      </label>

      {/* Min confidence */}
      <div>
        <label className="text-[13px] font-medium text-slate-700 block mb-1">
          Min confidence threshold
        </label>
        <select
          value={minConfidence}
          onChange={(e) => setMinConfidence(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-[13px] text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value={0.7}>0.7 (permissive)</option>
          <option value={0.8}>0.8 (default)</option>
          <option value={0.9}>0.9 (conservative)</option>
        </select>
      </div>

      {/* Voice profile */}
      <div>
        <label className="text-[13px] font-medium text-slate-700 block mb-1">
          Voice profile
        </label>
        <select
          value={voiceProfile}
          onChange={(e) => setVoiceProfile(e.target.value as SupportInboxAgentConfig['voiceProfile'])}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-[13px] text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="casual">Casual</option>
          <option value="neutral">Neutral</option>
          <option value="formal">Formal</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* Prompt override */}
      <div>
        <label className="text-[13px] font-medium text-slate-700 block mb-1">
          Prompt override
          <span className="ml-2 text-[11px] font-normal text-slate-400">{promptOverride.length}/500</span>
        </label>
        <textarea
          value={promptOverride}
          onChange={(e) => setPromptOverride(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="Optional: customise the agent's reply style or instructions..."
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-[13px] text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      {/* Escalation categories */}
      <fieldset>
        <legend className="text-[13px] font-medium text-slate-700 mb-2">Escalation categories</legend>
        <div className="flex flex-col gap-1.5">
          {ESCALATION_CATEGORY_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={escalationCategories.includes(opt.value)}
                onChange={() => toggleCategory(opt.value)}
                className="accent-indigo-600"
              />
              <span className="text-[13px] text-slate-700">{opt.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save configuration'}
        </button>
      </div>
    </form>
  );
}
