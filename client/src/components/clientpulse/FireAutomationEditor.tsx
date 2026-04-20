import { useState } from 'react';
import type { InterventionContext } from './ProposeInterventionModal';

interface Props {
  context: InterventionContext;
  onCancel: () => void;
  onSubmit: (
    payload: { automationId: string; contactId: string },
    rationale: string,
    extras?: { scheduleHint?: 'immediate' | 'delay_24h' | 'scheduled'; templateSlug?: string },
  ) => void;
}

export default function FireAutomationEditor({ onCancel, onSubmit }: Props) {
  const [automationId, setAutomationId] = useState('');
  const [contactId, setContactId] = useState('');
  const [rationale, setRationale] = useState('');
  const [schedule, setSchedule] = useState<'immediate' | 'delay_24h' | 'scheduled'>('immediate');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = automationId.trim().length > 0 && contactId.trim().length > 0 && rationale.trim().length > 0 && !submitting;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Automation ID</label>
        <input
          value={automationId}
          onChange={(e) => setAutomationId(e.target.value)}
          placeholder="e.g. a1b2c3…"
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] focus:outline-none focus:border-indigo-400"
        />
        <p className="text-[11px] text-slate-400 mt-1">Paste the CRM automation / workflow ID.</p>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Contact ID</label>
        <input
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          placeholder="e.g. ct_marcia…"
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] focus:outline-none focus:border-indigo-400"
        />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Schedule</label>
        <div className="flex gap-2">
          {(['immediate', 'delay_24h', 'scheduled'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setSchedule(opt)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-semibold border ${
                schedule === opt ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {opt === 'immediate' ? 'Immediately on approval' : opt === 'delay_24h' ? 'Delay 24h' : 'Scheduled'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Rationale</label>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={2}
          placeholder="Why this automation for this client now?"
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] focus:outline-none focus:border-indigo-400"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-[12px] font-semibold text-slate-600 hover:bg-slate-100">Back</button>
        <button
          disabled={!canSubmit}
          onClick={async () => {
            setSubmitting(true);
            onSubmit({ automationId: automationId.trim(), contactId: contactId.trim() }, rationale.trim(), { scheduleHint: schedule });
            setSubmitting(false);
          }}
          className="px-4 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          Queue for review
        </button>
      </div>
    </div>
  );
}
