import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import type { InterventionContext } from './types';
import LiveDataPicker from './pickers/LiveDataPicker';

type Contact = { id: string; firstName: string; lastName: string; email: string | null };
type FromAddress = { address: string; displayName: string | null; verified: boolean };

interface Props {
  subaccountId: string;
  context: InterventionContext;
  onCancel: () => void;
  onSubmit: (
    payload: { from: string; toContactId: string; subject: string; body: string },
    rationale: string,
    extras?: { scheduleHint?: 'immediate' | 'delay_24h' | 'scheduled'; templateSlug?: string },
  ) => void;
}

const MERGE_PALETTE = [
  '{{contact.firstName}}',
  '{{contact.lastName}}',
  '{{subaccount.name}}',
  '{{signals.healthScore}}',
  '{{signals.band}}',
];

export default function EmailAuthoringEditor({ subaccountId, onCancel, onSubmit }: Props) {
  const [from, setFrom] = useState('');
  const [fromLabel, setFromLabel] = useState('');
  const [toContactId, setToContactId] = useState('');
  const [contactLabel, setContactLabel] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [rationale, setRationale] = useState('');
  const [preview, setPreview] = useState<{ subject?: string; body?: string; unresolved: string[] } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!subject && !body) { setPreview(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.post('/api/clientpulse/merge-fields/preview', {
          subaccountId,
          template: { subject, body },
        });
        setPreview(res.data);
      } catch {
        // preview is best-effort
      }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [subject, body, subaccountId]);

  const canSubmit = from.trim() && toContactId.trim() && subject.trim() && body.trim() && rationale.trim();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">From</label>
          <LiveDataPicker<FromAddress>
            endpoint={`/api/clientpulse/subaccounts/${subaccountId}/crm/from-addresses`}
            preloadOnFocus
            renderItem={(f) => (
              <div>
                <div className="font-semibold text-slate-900">{f.address}</div>
                <div className="text-[11px] text-slate-500">{f.displayName ?? (f.verified ? 'verified' : 'unverified')}</div>
              </div>
            )}
            itemKey={(f) => f.address}
            itemLabel={(f) => f.address}
            onSelect={(f) => { setFrom(f.address); setFromLabel(f.address); }}
            placeholder="Pick a from-address…"
            selectedLabel={fromLabel}
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">To (contact)</label>
          <LiveDataPicker<Contact>
            endpoint={`/api/clientpulse/subaccounts/${subaccountId}/crm/contacts`}
            renderItem={(c) => (
              <div>
                <div className="font-semibold text-slate-900">{c.firstName} {c.lastName}</div>
                <div className="text-[11px] text-slate-500">{c.email ?? c.id}</div>
              </div>
            )}
            itemKey={(c) => c.id}
            itemLabel={(c) => `${c.firstName} ${c.lastName}`.trim()}
            onSelect={(c) => {
              setToContactId(c.id);
              setContactLabel(`${c.firstName} ${c.lastName}`.trim());
            }}
            placeholder="Search contacts…"
            selectedLabel={contactLabel}
          />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] focus:outline-none focus:border-indigo-400" />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Body</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] font-mono focus:outline-none focus:border-indigo-400" />
        <div className="flex gap-1 flex-wrap mt-1.5">
          {MERGE_PALETTE.map((tok) => (
            <button key={tok} type="button" onClick={() => setBody((b) => b + tok)} className="px-2 py-0.5 text-[10.5px] rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono">{tok}</button>
          ))}
        </div>
      </div>
      {preview && (
        <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-[12px]">
          <div className="font-bold text-slate-500 uppercase text-[10px] mb-1">Preview</div>
          {preview.subject && <div className="text-slate-900 font-semibold mb-1">{preview.subject}</div>}
          {preview.body && <div className="text-slate-700 whitespace-pre-wrap">{preview.body}</div>}
          {preview.unresolved.length > 0 && (
            <div className="mt-2 text-[11px] text-amber-700">{preview.unresolved.length} unresolved: {preview.unresolved.join(', ')}</div>
          )}
        </div>
      )}
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Rationale</label>
        <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] focus:outline-none focus:border-indigo-400" />
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-[12px] font-semibold text-slate-600 hover:bg-slate-100">Back</button>
        <button
          disabled={!canSubmit}
          onClick={() => onSubmit({ from: from.trim(), toContactId: toContactId.trim(), subject: subject.trim(), body: body.trim() }, rationale.trim())}
          className="px-4 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          Queue for review
        </button>
      </div>
    </div>
  );
}
