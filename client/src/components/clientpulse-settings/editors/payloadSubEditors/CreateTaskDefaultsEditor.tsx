interface Props {
  payload: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export default function CreateTaskDefaultsEditor({ payload, onChange }: Props) {
  const set = (key: string, value: unknown) => {
    const next = { ...payload };
    if (value === undefined || value === '' || value === null) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const titleTemplate = typeof payload.titleTemplate === 'string' ? payload.titleTemplate : '';
  const priority = typeof payload.priority === 'string' ? payload.priority : 'med';
  const dueInDays = typeof payload.dueInDays === 'number' ? payload.dueInDays : 1;

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Title template</label>
        <input
          value={titleTemplate}
          onChange={(e) => set('titleTemplate', e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] font-mono"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Priority</label>
          <select
            value={priority}
            onChange={(e) => set('priority', e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
          >
            <option value="low">Low</option>
            <option value="med">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Due in (days)</label>
          <input
            type="number"
            min={0}
            max={365}
            value={dueInDays}
            onChange={(e) => set('dueInDays', Number.parseInt(e.target.value, 10) || 0)}
            className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
          />
        </div>
      </div>
    </div>
  );
}
