interface Props {
  payload: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export default function FireAutomationDefaultsEditor({ payload, onChange }: Props) {
  const set = (key: string, value: unknown) => {
    const next = { ...payload };
    if (value === undefined || value === '' || value === null) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const workflowId = typeof payload.workflowId === 'string' ? payload.workflowId : '';
  const scheduleHint = typeof payload.scheduleHint === 'string' ? payload.scheduleHint : 'immediate';

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Default workflow ID (optional)</label>
        <input
          value={workflowId}
          onChange={(e) => set('workflowId', e.target.value)}
          placeholder="leave blank to prompt per intervention"
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
        />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Schedule hint</label>
        <select
          value={scheduleHint}
          onChange={(e) => set('scheduleHint', e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]"
        >
          <option value="immediate">Immediate</option>
          <option value="delay_24h">Delay 24 h</option>
          <option value="scheduled">Scheduled (per-intervention)</option>
        </select>
      </div>
    </div>
  );
}
