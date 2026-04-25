import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import type { InterventionContext } from './types';
import LiveDataPicker from './pickers/LiveDataPicker';

type Contact = { id: string; firstName: string; lastName: string; email: string | null; phone: string | null };
type FromNumber = { phoneE164: string; capabilities: Array<'sms' | 'voice'>; label: string | null };

interface Props {
  subaccountId: string;
  context: InterventionContext;
  onCancel: () => void;
  onSubmit: (
    payload: { fromNumber: string; toContactId: string; body: string },
    rationale: string,
    extras?: { scheduleHint?: 'immediate' | 'delay_24h' | 'scheduled'; templateSlug?: string },
  ) => void;
}

function segmentCount(body: string): number {
  if (body.length === 0) return 0;
  if (body.length <= 160) return 1;
  return Math.ceil(body.length / 153);
}

export default function SendSmsEditor({ subaccountId, onCancel, onSubmit }: Props) {
  const [fromNumber, setFromNumber] = useState('');
  const [fromLabel, setFromLabel] = useState('');
  const [toContactId, setToContactId] = useState('');
  const [contactLabel, setContactLabel] = useState('');
  const [body, setBody] = useState('');
  const [rationale, setRationale] = useState('');
  const [preview, setPreview] = useState<{ body?: string; unresolved: string[] } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!body) { setPreview(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.post('/api/clientpulse/merge-fields/preview', {
          subaccountId,
          template: { body },
        });
        setPreview(res.data);
      } catch { /* best-effort */ }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [body, subaccountId]);

  const canSubmit = fromNumber.trim() && toContactId.trim() && body.trim() && rationale.trim();
  const segs = segmentCount(preview?.body ?? body);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">From number</label>
          <LiveDataPicker<FromNumber>
            endpoint={`/api/clientpulse/subaccounts/${subaccountId}/crm/from-numbers`}
            preloadOnFocus
            renderItem={(n) => (
              <div>
                <div className="font-semibold text-slate-900">{n.phoneE164}</div>
                <div className="text-[11px] text-slate-500">{n.label ?? n.capabilities.join(', ')}</div>
              </div>
            )}
            itemKey={(n) => n.phoneE164}
            itemLabel={(n) => n.phoneE164}
            onSelect={(n) => { setFromNumber(n.phoneE164); setFromLabel(n.phoneE164); }}
            placeholder="Pick a from-number…"
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
                <div className="text-[11px] text-slate-500">{c.phone ?? c.email ?? c.id}</div>
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
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Message</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={1600} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] font-mono" />
        <div className={`text-[11px] mt-1 ${segs > 1 ? 'text-amber-600' : 'text-slate-500'}`}>
          {(preview?.body ?? body).length} chars · {segs} segment{segs !== 1 ? 's' : ''}
        </div>
      </div>
      {preview && (
        <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-[12px]">
          <div className="font-bold text-slate-500 uppercase text-[10px] mb-1">Preview</div>
          <div className="text-slate-700 whitespace-pre-wrap">{preview.body}</div>
          {preview.unresolved.length > 0 && (
            <div className="mt-1 text-[11px] text-amber-700">unresolved: {preview.unresolved.join(', ')}</div>
          )}
        </div>
      )}
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Rationale</label>
        <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]" />
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-[12px] font-semibold text-slate-600 hover:bg-slate-100">Back</button>
        <button
          disabled={!canSubmit}
          onClick={() => onSubmit({ fromNumber: fromNumber.trim(), toContactId: toContactId.trim(), body: body.trim() }, rationale.trim())}
          className="px-4 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          Queue for review
        </button>
      </div>
    </div>
  );
}
