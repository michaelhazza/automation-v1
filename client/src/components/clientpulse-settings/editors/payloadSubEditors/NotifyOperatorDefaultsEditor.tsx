interface Props {
  payload: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

const CHANNEL_OPTIONS: Array<'in_app' | 'email' | 'slack'> = ['in_app', 'email', 'slack'];

export default function NotifyOperatorDefaultsEditor({ payload, onChange }: Props) {
  const set = (key: string, value: unknown) => {
    const next = { ...payload };
    if (value === undefined || value === '' || value === null) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const title = typeof payload.title === 'string' ? payload.title : '';
  const message = typeof payload.message === 'string' ? payload.message : '';
  const severity = typeof payload.severity === 'string' ? payload.severity : 'info';
  const channels = Array.isArray(payload.channels) ? (payload.channels as string[]) : [];

  const toggleChannel = (ch: string) => {
    const nextChannels = channels.includes(ch) ? channels.filter((c) => c !== ch) : [...channels, ch];
    set('channels', nextChannels);
  };

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Alert title</label>
        <input value={title} onChange={(e) => set('title', e.target.value)} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]" />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Message</label>
        <textarea value={message} onChange={(e) => set('message', e.target.value)} rows={3} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Severity</label>
          <select value={severity} onChange={(e) => set('severity', e.target.value)} className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px]">
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Channels</label>
          <div className="flex flex-wrap gap-1">
            {CHANNEL_OPTIONS.map((ch) => (
              <button
                type="button"
                key={ch}
                onClick={() => toggleChannel(ch)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${
                  channels.includes(ch)
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
