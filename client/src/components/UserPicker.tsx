/**
 * UserPicker.tsx
 *
 * Generic search-and-select component for AssignableUser[].
 * Used by the TeamsAdminPage member selector and future Studio inspectors.
 */

import { useState, useRef, useEffect } from 'react';
import type { AssignableUser, AssignableUsersIntent } from '../../../shared/types/assignableUsers.js';

interface UserPickerProps {
  users: AssignableUser[];
  value: AssignableUser[];
  onChange: (next: AssignableUser[]) => void;
  intent?: AssignableUsersIntent;
  multiple?: boolean;
  placeholder?: string;
}

export default function UserPicker({
  users,
  value,
  onChange,
  multiple = false,
  placeholder = 'Search users...',
}: UserPickerProps) {
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

  const selectedIds = new Set(value.map((u) => u.id));

  const filtered = users.filter((u) => {
    if (selectedIds.has(u.id)) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  function select(user: AssignableUser) {
    if (multiple) {
      onChange([...value, user]);
    } else {
      onChange([user]);
      setOpen(false);
    }
    setQuery('');
  }

  function remove(userId: string) {
    onChange(value.filter((u) => u.id !== userId));
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {value.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[12px] font-medium"
            >
              {u.name}
              <button
                type="button"
                onClick={() => remove(u.id)}
                className="ml-0.5 hover:text-indigo-600 focus:outline-none"
                aria-label={`Remove ${u.name}`}
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
          {filtered.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-indigo-50 focus:outline-none"
                onClick={() => select(u)}
              >
                <span className="font-medium text-slate-800">{u.name}</span>
                <span className="ml-2 text-slate-400 text-[12px]">{u.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
