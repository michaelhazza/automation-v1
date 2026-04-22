import { useState } from 'react';

// Static vocabulary — mirrors the Phase-4 mergeFieldResolver's known tokens.
// Session 2 Chunk 7 ships the static list; a future session can swap to the
// GET /api/clientpulse/subaccounts/:id/merge-field-vocabulary endpoint per spec §8.8.
const MERGE_TOKENS = [
  { token: '{{contact.firstName}}', description: 'Contact first name' },
  { token: '{{contact.lastName}}', description: 'Contact last name' },
  { token: '{{contact.email}}', description: 'Contact email' },
  { token: '{{contact.phone}}', description: 'Contact phone' },
  { token: '{{subaccount.name}}', description: 'Subaccount name' },
  { token: '{{signals.healthScore}}', description: 'Current health score' },
  { token: '{{signals.band}}', description: 'Current churn band' },
  { token: '{{signals.topSignal}}', description: 'Top contributing risk signal' },
];

interface Props {
  onPick: (token: string) => void;
}

export default function MergeFieldPicker({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="px-2 py-0.5 text-[10.5px] rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
      >
        Insert merge field…
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-72 rounded-md border border-slate-200 bg-white shadow-lg max-h-64 overflow-auto">
          {MERGE_TOKENS.map((t) => (
            <button
              key={t.token}
              type="button"
              onClick={() => {
                onPick(t.token);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-slate-50"
            >
              <div className="font-mono text-slate-800">{t.token}</div>
              <div className="text-[11px] text-slate-400">{t.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
