/**
 * TeamPicker.tsx
 *
 * Generic search-and-select component for AssignableTeam[].
 * Mirror of UserPicker for teams.
 */

import { useState, useRef, useEffect } from 'react';
import type { AssignableTeam } from '../../../shared/types/assignableUsers.js';

interface TeamPickerProps {
  teams: AssignableTeam[];
  value: AssignableTeam[];
  onChange: (next: AssignableTeam[]) => void;
  multiple?: boolean;
  placeholder?: string;
}

export default function TeamPicker({
  teams,
  value,
  onChange,
  multiple = false,
  placeholder = 'Search teams...',
}: TeamPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedIds = new Set(value.map((t) => t.id));

  const filtered = teams.filter((t) => {
    if (selectedIds.has(t.id)) return false;
    if (!query) return true;
    return t.name.toLowerCase().includes(query.toLowerCase());
  });

  function select(team: AssignableTeam) {
    if (multiple) {
      onChange([...value, team]);
    } else {
      onChange([team]);
      setOpen(false);
    }
    setQuery('');
  }

  function remove(teamId: string) {
    onChange(value.filter((t) => t.id !== teamId));
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {value.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 text-[12px] font-medium"
            >
              {t.name}
              <span className="text-violet-400 text-[11px]">({t.member_count})</span>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="ml-0.5 hover:text-violet-600 focus:outline-none"
                aria-label={`Remove ${t.name}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      {(multiple || value.length === 0) && (
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      )}

      {/* Dropdown */}
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto border border-slate-200 rounded-lg bg-white shadow-md">
          {filtered.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-violet-50 focus:outline-none"
                onClick={() => select(t)}
              >
                <span className="font-medium text-slate-800">{t.name}</span>
                <span className="ml-2 text-slate-400 text-[12px]">{t.member_count} members</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
