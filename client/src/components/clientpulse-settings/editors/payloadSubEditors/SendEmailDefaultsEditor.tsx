import MergeFieldPicker from '../MergeFieldPicker';

interface Props {
  payload: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export default function SendEmailDefaultsEditor({ payload, onChange }: Props) {
  const set = (key: string, value: unknown) => {
    const next = { ...payload };
    if (value === undefined || value === '' || value === null) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const subjectTemplate = typeof payload.subjectTemplate === 'string' ? payload.subjectTemplate : '';
  const bodyTemplate = typeof payload.bodyTemplate === 'string' ? payload.bodyTemplate : '';
  const fromAddress = typeof payload.fromAddress === 'string' ? payload.fromAddress : '';

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Subject template</label>
        <input
          value={subjectTemplate}
          onChange={(e) => set('subjectTemplate', e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] font-mono"
        />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Body template</label>
        <textarea
          value={bodyTemplate}
          onChange={(e) => set('bodyTemplate', e.target.value)}
          rows={5}
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] font-mono"
        />
        <div className="mt-1">
          <MergeFieldPicker onPick={(tok) => set('bodyTemplate', bodyTemplate + tok)} />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Default from-address (optional)</label>
        <input
          value={fromAddress}
          onChange={(e) => set('fromAddress', e.target.value)}
          placeholder="sender@agency.com"
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
        />
      </div>
    </div>
  );
}
