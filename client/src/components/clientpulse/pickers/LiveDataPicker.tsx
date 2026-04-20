import { useEffect, useRef, useState, useCallback } from 'react';
import api from '../../../lib/api';

// ---------------------------------------------------------------------------
// LiveDataPicker — reusable searchable dropdown backed by a ClientPulse
// live-data endpoint. Spec §3.4 (Session 2 Chunk 3).
// ---------------------------------------------------------------------------

interface LiveDataPickerProps<T> {
  endpoint: string;
  queryParam?: string;
  renderItem: (item: T) => React.ReactNode;
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  onSelect: (item: T) => void;
  placeholder?: string;
  preloadOnFocus?: boolean;
  debounceMs?: number;
  /** Pre-selected label displayed in the input (e.g. `First Last` once chosen). */
  selectedLabel?: string;
}

const DEFAULT_DEBOUNCE_MS = 200;

export default function LiveDataPicker<T>(props: LiveDataPickerProps<T>) {
  const {
    endpoint,
    queryParam = 'q',
    renderItem,
    itemKey,
    itemLabel,
    onSelect,
    placeholder,
    preloadOnFocus = false,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    selectedLabel,
  } = props;

  const [input, setInput] = useState<string>(selectedLabel ?? '');
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const fetchItems = useCallback(
    async (query: string | undefined) => {
      if (rateLimitedUntil !== null && rateLimitedUntil > Date.now()) return;
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<{ items: T[] }>(endpoint, {
          params: query ? { [queryParam]: query } : undefined,
        });
        setItems(res.data.items ?? []);
        setActiveIndex(0);
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: { retryAfterSeconds?: number; message?: string } } };
        if (e?.response?.status === 429) {
          const secs = e.response.data?.retryAfterSeconds ?? 30;
          setRateLimitedUntil(Date.now() + secs * 1000);
          setError(`Too many requests — retry in ${secs}s`);
          setItems([]);
        } else {
          setError(e?.response?.data?.message ?? 'Failed to load');
          setItems([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [endpoint, queryParam, rateLimitedUntil],
  );

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = input.trim();
    if (!trimmed && !preloadOnFocus) {
      setItems([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      fetchItems(trimmed || undefined);
    }, debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input, open, preloadOnFocus, debounceMs, fetchItems]);

  useEffect(() => {
    if (rateLimitedUntil === null) return;
    const ms = rateLimitedUntil - Date.now();
    if (ms <= 0) {
      setRateLimitedUntil(null);
      return;
    }
    const timer = setTimeout(() => setRateLimitedUntil(null), ms);
    return () => clearTimeout(timer);
  }, [rateLimitedUntil]);

  const disabled = rateLimitedUntil !== null && rateLimitedUntil > Date.now();

  const handleFocus = () => {
    setOpen(true);
    if (preloadOnFocus && items.length === 0 && !loading) fetchItems(undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) {
        onSelect(item);
        setInput(itemLabel(item));
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={input}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(true);
        }}
        onFocus={handleFocus}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] focus:outline-none focus:border-indigo-400 disabled:bg-slate-100 disabled:cursor-not-allowed"
      />
      {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {loading && <div className="px-3 py-2 text-[12px] text-slate-500">Loading…</div>}
          {!loading && items.length === 0 && input.trim().length > 0 && (
            <div className="px-3 py-2 text-[12px] text-slate-500">No matches</div>
          )}
          {!loading &&
            items.map((item, i) => (
              <button
                key={itemKey(item)}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(item);
                  setInput(itemLabel(item));
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-[13px] ${
                  i === activeIndex ? 'bg-indigo-50 text-indigo-900' : 'text-slate-800 hover:bg-slate-50'
                }`}
              >
                {renderItem(item)}
              </button>
            ))}
          {!loading && items.length === 50 && (
            <div className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100">
              Showing first 50 matches — refine search for more.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
