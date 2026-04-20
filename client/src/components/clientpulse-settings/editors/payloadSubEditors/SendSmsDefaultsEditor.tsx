import MergeFieldPicker from '../MergeFieldPicker';

interface Props {
  payload: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export default function SendSmsDefaultsEditor({ payload, onChange }: Props) {
  const set = (key: string, value: unknown) => {
    const next = { ...payload };
    if (value === undefined || value === '' || value === null) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const messageTemplate = typeof payload.messageTemplate === 'string' ? payload.messageTemplate : '';
  const fromNumber = typeof payload.fromNumber === 'string' ? payload.fromNumber : '';

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Message template</label>
        <textarea
          value={messageTemplate}
          onChange={(e) => set('messageTemplate', e.target.value)}
          rows={3}
          maxLength={1600}
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] font-mono"
        />
        <div className="mt-1 flex items-center gap-2">
          <MergeFieldPicker onPick={(tok) => set('messageTemplate', messageTemplate + tok)} />
          <span className="text-[11px] text-slate-400">{messageTemplate.length} chars</span>
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Default from-number (optional)</label>
        <input
          value={fromNumber}
          onChange={(e) => set('fromNumber', e.target.value)}
          placeholder="+61400000000"
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
        />
      </div>
    </div>
  );
}
