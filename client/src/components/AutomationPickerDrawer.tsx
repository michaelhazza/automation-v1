import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutomationListItem {
  id: string;
  name: string;
  engineType: string;
  readiness: 'ready' | 'needs_setup';
  requiredConnections?: Array<{ key: string; provider: string }>;
}

export interface AutomationPickerDrawerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (config: { automationId: string; inputMapping: Record<string, string> }) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Single uppercase letter used as avatar initial for the engine badge. */
function engineInitial(engineType: string): string {
  return (engineType ?? '?').charAt(0).toUpperCase();
}

/** Stable gradient per engine type so each provider has a consistent colour. */
const ENGINE_GRADIENTS: Record<string, string> = {
  make:    'linear-gradient(135deg, #6d28d9, #8b5cf6)',
  zapier:  'linear-gradient(135deg, #d97706, #f59e0b)',
  ghl:     'linear-gradient(135deg, #0891b2, #06b6d4)',
  n8n:     'linear-gradient(135deg, #059669, #10b981)',
};

function engineGradient(engineType: string): string {
  return ENGINE_GRADIENTS[engineType?.toLowerCase()] ?? 'linear-gradient(135deg, #475569, #64748b)';
}

/** Derive input field keys from requiredConnections, falling back to two generic fields. */
function inputFieldsFor(item: AutomationListItem): Array<{ key: string; label: string }> {
  if (item.requiredConnections && item.requiredConnections.length > 0) {
    return item.requiredConnections.map(c => ({
      key: c.key,
      label: c.key
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, s => s.toUpperCase()),
    }));
  }
  return [
    { key: 'email', label: 'Email address' },
    { key: 'listName', label: 'List name' },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AutomationPickerDrawer({ open, onClose, onConfirm }: AutomationPickerDrawerProps) {
  const [automations, setAutomations] = useState<AutomationListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inputMapping, setInputMapping] = useState<Record<string, string>>({});

  // Fetch automations when the drawer opens.
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setSelectedId(null);
    setInputMapping({});
    setFetchError(false);
    setLoading(true);
    api
      .get('/api/automations')
      .then(({ data }) => {
        setAutomations(data?.automations ?? []);
      })
      .catch(() => {
        setFetchError(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const filtered = search.trim()
    ? automations.filter(a =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.engineType.toLowerCase().includes(search.toLowerCase()),
      )
    : automations;

  const selectedItem = automations.find(a => a.id === selectedId) ?? null;

  function handleSelect(item: AutomationListItem) {
    if (selectedId === item.id) {
      // Toggle off.
      setSelectedId(null);
      setInputMapping({});
      return;
    }
    setSelectedId(item.id);
    // Seed mapping keys from required connections.
    const fields = inputFieldsFor(item);
    const seed: Record<string, string> = {};
    for (const f of fields) seed[f.key] = '';
    setInputMapping(seed);
  }

  function handleConfirm() {
    if (!selectedId) return;
    onConfirm({ automationId: selectedId, inputMapping });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      onClick={onClose}
    >
      <aside
        className="w-full max-w-[480px] h-full bg-white flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pick an automation"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Call an Automation</div>
            <div className="text-[14.5px] font-semibold text-slate-900 mt-0.5">Pick an automation</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-base leading-none border-0 cursor-pointer font-[inherit]"
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 text-slate-500">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search automations…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent outline-none text-[13px] text-slate-800 placeholder-slate-400"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loading && (
            <div className="text-[13px] text-slate-400 text-center py-10">Loading automations…</div>
          )}

          {fetchError && !loading && (
            <div className="text-[13px] text-red-600 text-center py-10">Failed to load automations.</div>
          )}

          {!loading && !fetchError && filtered.length === 0 && (
            <div className="text-[13px] text-slate-400 text-center py-10">
              {search ? `No automations match "${search}"` : 'No automations found.'}
            </div>
          )}

          {!loading && !fetchError && filtered.map(item => {
            const isSelected = item.id === selectedId;
            const fields = inputFieldsFor(item);

            return (
              <div
                key={item.id}
                className={`rounded-lg border transition-colors ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50/40'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                {/* Row */}
                <button
                  type="button"
                  onClick={() => handleSelect(item)}
                  className="w-full text-left p-3.5 flex items-center gap-3 cursor-pointer bg-transparent border-0 font-[inherit] rounded-lg"
                >
                  {/* Engine avatar */}
                  <div
                    className="w-9 h-9 rounded-md flex items-center justify-center text-white font-bold text-[12px] shrink-0"
                    style={{ background: engineGradient(item.engineType) }}
                    aria-hidden="true"
                  >
                    {engineInitial(item.engineType)}
                  </div>

                  {/* Name + engine */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold text-slate-900 truncate">{item.name}</div>
                    {item.readiness === 'needs_setup' && !isSelected ? (
                      /* Show needs-setup hint on collapsed rows too (per mockup). */
                      <div className="text-[11.5px] text-amber-700 mt-0.5">
                        Needs a {item.requiredConnections?.[0]?.provider ?? item.engineType} connection
                      </div>
                    ) : (
                      <div className="text-[11.5px] text-slate-500 mt-0.5">{item.engineType}</div>
                    )}
                  </div>

                  {/* Readiness dot */}
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      item.readiness === 'ready' ? 'bg-emerald-500' : 'bg-amber-400'
                    }`}
                    title={item.readiness === 'ready' ? 'Ready' : 'Needs setup'}
                  />

                  {/* Check when selected */}
                  {isSelected && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>

                {/* Expanded input mapping */}
                {isSelected && (
                  <div className="px-3.5 pb-3.5 pt-1 border-t border-indigo-200/60 space-y-3 mt-1">
                    {item.readiness === 'needs_setup' && (
                      <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                        Needs a {item.requiredConnections?.[0]?.provider ?? item.engineType} connection to run.
                      </div>
                    )}
                    {fields.map(field => (
                      <div key={field.key}>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">
                          {field.label}
                        </label>
                        <input
                          type="text"
                          value={inputMapping[field.key] ?? ''}
                          onChange={e =>
                            setInputMapping(prev => ({ ...prev, [field.key]: e.target.value }))
                          }
                          placeholder={`e.g. {{ steps.previous.output.${field.key} }}`}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-[13px] font-semibold rounded-lg border border-slate-300 cursor-pointer font-[inherit]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedId}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg border-0 cursor-pointer font-[inherit] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
