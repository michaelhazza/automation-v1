import { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';

interface HierarchyTemplate {
  id: string;
  name: string;
  description?: string | null;
}

interface StartingTeamPickerProps {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}

type LoadState = 'loading' | 'error' | 'ready';

export default function StartingTeamPicker({ value, onChange, disabled }: StartingTeamPickerProps) {
  const [templates, setTemplates] = useState<HierarchyTemplate[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadTrigger, setLoadTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    api.get('/api/hierarchy-templates')
      .then(({ data }) => {
        if (!cancelled) {
          setTemplates(data);
          setLoadState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => { cancelled = true; };
  }, [loadTrigger]);

  const handleRetry = useCallback(() => {
    setLoadTrigger((n) => n + 1);
  }, []);

  const selectClass =
    'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

  if (loadState === 'loading') {
    return (
      <select disabled className={selectClass}>
        <option>Loading...</option>
      </select>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="flex items-center gap-2">
        <select disabled className={`${selectClass} flex-1`}>
          <option>Could not load templates</option>
        </select>
        <button
          type="button"
          onClick={handleRetry}
          className="text-[12px] text-indigo-500 hover:text-indigo-700 underline flex-shrink-0"
        >
          Retry
        </button>
      </div>
    );
  }

  const selectedDescription = value
    ? (templates.find((t) => t.id === value)?.description ?? null)
    : null;

  return (
    <div>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        disabled={disabled}
        className={selectClass}
      >
        <option value="">None / configure later</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {selectedDescription && (
        <p className="mt-1.5 text-[12px] text-slate-500">{selectedDescription}</p>
      )}
    </div>
  );
}
