import { useEffect, useState } from 'react';
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

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  const selectClass =
    'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500';

  if (loadState === 'loading') {
    return (
      <select disabled className={selectClass}>
        <option>Loading...</option>
      </select>
    );
  }

  if (loadState === 'error') {
    return (
      <select disabled className={selectClass}>
        <option>Could not load templates</option>
      </select>
    );
  }

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      disabled={disabled}
      className={selectClass}
    >
      <option value="">None / configure later</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id} title={t.description ?? ''}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
