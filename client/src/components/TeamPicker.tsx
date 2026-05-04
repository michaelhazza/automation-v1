import { useState } from 'react';

export interface TeamPickerTeam {
  id: string;
  name: string;
  member_count: number;
}

export interface TeamPickerProps {
  teams: TeamPickerTeam[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}

export default function TeamPicker({ teams, selected, onChange, placeholder }: TeamPickerProps) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? teams.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : teams;

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const selectedTeams = teams.filter(t => selected.includes(t.id));

  return (
    <div>
      {selectedTeams.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedTeams.map(t => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full"
            >
              {t.name}
              <button
                type="button"
                onClick={() => toggle(t.id)}
                className="ml-1 text-indigo-500 hover:text-indigo-700 leading-none"
                aria-label={`Remove ${t.name}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={placeholder ?? 'Search teams...'}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />
      <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-slate-400">No teams found</div>
        )}
        {filtered.map(t => (
          <label key={t.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(t.id)}
              onChange={() => toggle(t.id)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-800 truncate">{t.name}</div>
              <div className="text-xs text-slate-400">{t.member_count} member{t.member_count !== 1 ? 's' : ''}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
