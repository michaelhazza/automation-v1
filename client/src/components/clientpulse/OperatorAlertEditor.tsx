import { useState } from 'react';
import type { InterventionContext } from './types';

interface Props {
  context: InterventionContext;
  onCancel: () => void;
  onSubmit: (
    payload: {
      title: string;
      message: string;
      severity: 'info' | 'warn' | 'urgent';
      recipients: { kind: 'preset' | 'custom'; value: string | string[] };
      channels: Array<'in_app' | 'email' | 'slack'>;
    },
    rationale: string,
  ) => void;
}

const PRESETS = [
  { value: 'agency_owners', label: 'Agency owners' },
  { value: 'on_call', label: 'On-call operator' },
  { value: 'account_manager', label: 'Account manager' },
];

export default function OperatorAlertEditor({ onCancel, onSubmit }: Props) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warn' | 'urgent'>('info');
  const [recipientPreset, setRecipientPreset] = useState<string>('agency_owners');
  const [channels, setChannels] = useState<Array<'in_app' | 'email' | 'slack'>>(['in_app']);
  const [rationale, setRationale] = useState('');

  const toggleChannel = (c: 'in_app' | 'email' | 'slack') => {
    setChannels((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  };

  const canSubmit = title.trim() && message.trim() && channels.length > 0 && rationale.trim();

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Alert title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]" />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Severity</label>
          <div className="flex gap-2">
            {(['info', 'warn', 'urgent'] as const).map((s) => (
              <button key={s} onClick={() => setSeverity(s)} className={`btn btn-sm ${
                severity === s ? 'btn-primary' : 'btn-secondary'
              }`}>{s}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Recipient preset</label>
          <select value={recipientPreset} onChange={(e) => setRecipientPreset(e.target.value)} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]">
            {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Channels</label>
        <div className="flex gap-3">
          {(['in_app', 'email', 'slack'] as const).map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-[12px] text-slate-700 cursor-pointer">
              <input type="checkbox" checked={channels.includes(c)} onChange={() => toggleChannel(c)} className="accent-indigo-600" />
              {c.replace('_', ' ')}
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Rationale</label>
        <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]" />
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onClick={onCancel} className="btn btn-sm btn-ghost">Back</button>
        <button
          disabled={!canSubmit}
          onClick={() => onSubmit(
            {
              title: title.trim(),
              message: message.trim(),
              severity,
              recipients: { kind: 'preset', value: recipientPreset },
              channels,
            },
            rationale.trim(),
          )}
          className="btn btn-sm btn-primary disabled:bg-slate-300"
        >
          Queue for review
        </button>
      </div>
    </div>
  );
}
