import { useState } from 'react';

type Bands = {
  healthy: [number, number];
  watch: [number, number];
  atRisk: [number, number];
  critical: [number, number];
};

interface Props {
  value: unknown;
  onSave: (next: Bands) => Promise<void>;
}

function toRange(v: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
    return [v[0], v[1]];
  }
  return fallback;
}

export default function ChurnBandsEditor({ value, onSave }: Props) {
  const v = (value ?? {}) as Record<string, unknown>;
  const [bands, setBands] = useState<Bands>({
    healthy: toRange(v.healthy, [0, 25]),
    watch: toRange(v.watch, [26, 50]),
    atRisk: toRange(v.atRisk, [51, 75]),
    critical: toRange(v.critical, [76, 100]),
  });
  const [saving, setSaving] = useState(false);

  const update = (band: keyof Bands, index: 0 | 1, val: number) => {
    setBands((b) => ({ ...b, [band]: index === 0 ? [val, b[band][1]] : [b[band][0], val] }));
  };

  const error = (() => {
    const ordered: Array<[keyof Bands, [number, number]]> = [
      ['healthy', bands.healthy], ['watch', bands.watch], ['atRisk', bands.atRisk], ['critical', bands.critical],
    ];
    for (const [, [lo, hi]] of ordered) {
      if (lo > hi) return 'Band lower bound cannot exceed upper bound.';
    }
    for (let i = 1; i < ordered.length; i++) {
      const [, [, prevHi]] = ordered[i - 1];
      const [, [currLo]] = ordered[i];
      if (currLo !== prevHi + 1) return 'Bands must be contiguous with no gap or overlap.';
    }
    return null;
  })();

  return (
    <div className="space-y-3">
      {(['healthy', 'watch', 'atRisk', 'critical'] as Array<keyof Bands>).map((band) => (
        <div key={band} className="grid grid-cols-[140px_1fr_1fr] items-center gap-2">
          <span className="text-[12px] font-semibold text-slate-700">{band}</span>
          <input type="number" min={0} max={100} value={bands[band][0]} onChange={(e) => update(band, 0, Number.parseInt(e.target.value, 10) || 0)} className="px-2 py-1 rounded-md border border-slate-200 text-[12px]" />
          <input type="number" min={0} max={100} value={bands[band][1]} onChange={(e) => update(band, 1, Number.parseInt(e.target.value, 10) || 0)} className="px-2 py-1 rounded-md border border-slate-200 text-[12px]" />
        </div>
      ))}
      {error && <div className="text-[12px] text-red-600">{error}</div>}
      <div className="flex justify-end">
        <button
          disabled={saving || !!error}
          onClick={async () => { setSaving(true); try { await onSave(bands); } finally { setSaving(false); } }}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save bands'}
        </button>
      </div>
    </div>
  );
}
