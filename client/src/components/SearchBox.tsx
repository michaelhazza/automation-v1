/**
 * SearchBox — controlled search input with debounced onChange.
 *
 * The caller owns `value` (controlled). Local state mirrors the input for
 * immediate display while the debounced onChange fires after `debounceMs`.
 * Clear (X button or Esc) calls onChange('') immediately, no debounce.
 *
 * Usage:
 *   const [q, setQ] = useState('');
 *   <SearchBox value={q} onChange={setQ} placeholder="Search agents..." />
 */

import { useEffect, useRef, useState } from 'react';

interface SearchBoxProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  debounceMs?: number;
  autoFocus?: boolean;
  'aria-label'?: string;
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'Search...',
  debounceMs = 200,
  autoFocus,
  'aria-label': ariaLabel,
}: SearchBoxProps) {
  // Local state for immediate display; syncs back when caller updates `value`.
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local in sync when the caller resets value externally (e.g. clear from outside).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Clear any pending debounce timer on unmount to prevent stale onChange calls.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleChange(next: string) {
    setLocal(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), debounceMs);
  }

  function handleClear() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLocal('');
    onChange('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') handleClear();
  }

  return (
    <div className="relative flex items-center border border-slate-200 rounded-lg bg-white focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-400 transition-colors">
      {/* Search icon */}
      <svg
        className="absolute left-2.5 h-4 w-4 text-slate-400 pointer-events-none shrink-0"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        aria-hidden="true"
      >
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path strokeLinecap="round" d="M14.5 14.5l3 3" />
      </svg>

      <input
        type="text"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? placeholder}
        className="pl-8 pr-8 py-2 w-full text-sm bg-transparent focus:outline-none text-slate-900 placeholder:text-slate-400"
      />

      {/* Clear button — only shown when there is input */}
      {local && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="absolute right-2 text-slate-400 hover:text-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
