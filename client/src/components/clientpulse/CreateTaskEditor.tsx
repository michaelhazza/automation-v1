import { useState } from 'react';
import type { InterventionContext } from './types';
import LiveDataPicker from './pickers/LiveDataPicker';

interface Props {
  subaccountId: string;
  context: InterventionContext;
  onCancel: () => void;
  onSubmit: (
    payload: {
      assigneeUserId: string;
      relatedContactId: string | null;
      title: string;
      notes?: string;
      dueAt: string;
      priority: 'low' | 'med' | 'high';
    },
    rationale: string,
    extras?: { scheduleHint?: 'immediate' | 'delay_24h' | 'scheduled'; templateSlug?: string },
  ) => void;
}

type User = { id: string; firstName: string; lastName: string; email: string; role: string | null };
type Contact = { id: string; firstName: string; lastName: string; email: string | null };

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

export default function CreateTaskEditor({ subaccountId, onCancel, onSubmit }: Props) {
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [assigneeLabel, setAssigneeLabel] = useState('');
  const [relatedContactId, setRelatedContactId] = useState('');
  const [contactLabel, setContactLabel] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueAtLocal, setDueAtLocal] = useState<string>(tomorrowISO());
  const [priority, setPriority] = useState<'low' | 'med' | 'high'>('med');
  const [rationale, setRationale] = useState('');

  const canSubmit = assigneeUserId.trim() && title.trim() && dueAtLocal && rationale.trim();

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Assignee</label>
        <LiveDataPicker<User>
          endpoint={`/api/clientpulse/subaccounts/${subaccountId}/crm/users`}
          renderItem={(u) => (
            <div>
              <div className="font-semibold text-slate-900">{u.firstName} {u.lastName}</div>
              <div className="text-[11px] text-slate-500">{u.email}{u.role ? ` · ${u.role}` : ''}</div>
            </div>
          )}
          itemKey={(u) => u.id}
          itemLabel={(u) => `${u.firstName} ${u.lastName}`.trim()}
          onSelect={(u) => {
            setAssigneeUserId(u.id);
            setAssigneeLabel(`${u.firstName} ${u.lastName}`.trim());
          }}
          placeholder="Search users…"
          selectedLabel={assigneeLabel}
        />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Related contact (optional)</label>
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
            setRelatedContactId(c.id);
            setContactLabel(`${c.firstName} ${c.lastName}`.trim());
          }}
          placeholder="Search contacts…"
          selectedLabel={contactLabel}
        />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Due</label>
          <input type="datetime-local" value={dueAtLocal} onChange={(e) => setDueAtLocal(e.target.value)} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]" />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Priority</label>
          <div className="flex gap-2">
            {(['low', 'med', 'high'] as const).map((p) => (
              <button key={p} onClick={() => setPriority(p)} className={`px-3 py-1.5 rounded-md text-[12px] font-semibold border ${
                priority === p ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'
              }`}>{p}</button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Notes / call script</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]" />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Rationale</label>
        <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]" />
      </div>
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-[12px] font-semibold text-slate-600 hover:bg-slate-100">Back</button>
        <button
          disabled={!canSubmit}
          onClick={() => onSubmit(
            {
              assigneeUserId: assigneeUserId.trim(),
              relatedContactId: relatedContactId.trim() || null,
              title: title.trim(),
              notes: notes.trim() || undefined,
              dueAt: new Date(dueAtLocal).toISOString(),
              priority,
            },
            rationale.trim(),
          )}
          className="px-4 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          Queue for review
        </button>
      </div>
    </div>
  );
}
