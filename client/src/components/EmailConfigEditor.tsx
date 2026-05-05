import React, { useState } from 'react';
import api from '../lib/api';

// TODO: implement PATCH /api/agents/:agentId/channels/email on the server
// when the email channel config route is added, this component will persist changes.

export interface AgentEmailConfig {
  fromName: string;
  replyTo: string | null;
  signature: string | null;
}

interface EmailConfigEditorProps {
  agentId: string;
  config: AgentEmailConfig;
}

export function EmailConfigEditor({ agentId, config }: EmailConfigEditorProps) {
  const [fromName, setFromName] = useState(config.fromName);
  const [replyTo, setReplyTo] = useState(config.replyTo ?? '');
  const [signature, setSignature] = useState(config.signature ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch(`/api/agents/${agentId}/channels/email`, {
        fromName,
        replyTo: replyTo || null,
        signature: signature || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
      const apiErr = err.response?.data?.error;
      setError(
        (typeof apiErr === 'string' ? apiErr : apiErr?.message) ?? err.message ?? 'Save failed',
      );
    } finally {
      setSaving(false);
    }
  }

  const labelCls = 'block text-[13px] font-medium text-slate-700 mb-1.5';
  const inputCls = 'w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white';

  return (
    <div className="bg-white rounded-[10px] border border-slate-200 p-5 space-y-4">
      <div>
        <label className={labelCls}>From name</label>
        <input
          className={inputCls}
          value={fromName}
          onChange={e => setFromName(e.target.value)}
          placeholder="Agent display name"
        />
      </div>
      <div>
        <label className={labelCls}>Reply-to address (optional)</label>
        <input
          className={inputCls}
          value={replyTo}
          onChange={e => setReplyTo(e.target.value)}
          placeholder="reply@example.com"
          type="email"
        />
      </div>
      <div>
        <label className={labelCls}>Signature (optional)</label>
        <textarea
          className={inputCls}
          value={signature}
          onChange={e => setSignature(e.target.value)}
          rows={3}
          placeholder="Email signature text"
        />
      </div>
      {error && (
        <div className="text-[13px] text-red-600">{error}</div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-[13px] font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {saved && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
      </div>
    </div>
  );
}
