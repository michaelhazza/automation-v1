import { useState } from 'react';

export interface UserPickerUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
}

export interface UserPickerProps {
  users: UserPickerUser[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  maxSelected?: number;
}

export default function UserPicker({ users, selected, onChange, placeholder, maxSelected }: UserPickerProps) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()))
    : users;

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else {
      if (maxSelected !== undefined && selected.length >= maxSelected) return;
      onChange([...selected, id]);
    }
  };

  const selectedUsers = users.filter(u => selected.includes(u.id));

  return (
    <div>
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedUsers.map(u => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full"
            >
              {u.name}
              <button
                type="button"
                onClick={() => toggle(u.id)}
                className="ml-1 text-indigo-500 hover:text-indigo-700 leading-none"
                aria-label={`Remove ${u.name}`}
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
        placeholder={placeholder ?? 'Search users...'}
        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />
      <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-slate-400">No users found</div>
        )}
        {filtered.map(u => (
          <label key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(u.id)}
              onChange={() => toggle(u.id)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-800 truncate">{u.name}</div>
              {u.email && (
                <div className="text-xs text-slate-400 truncate">{u.email}</div>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
