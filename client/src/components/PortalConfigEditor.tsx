/**
 * PortalConfigEditor — portal mode selector + features toggle grid (S16 + S17)
 *
 * Embedded in the subaccount settings page. Features grid only renders under
 * Collaborative mode. Server is authoritative — this is a UX convenience.
 *
 * Spec: docs/memory-and-briefings-spec.md §6.2, §6.3
 */

import { useEffect, useState } from 'react';
import api from '../lib/api';

type PortalMode = 'hidden' | 'transparency' | 'collaborative';

interface PortalConfig {
  subaccountId: string;
  portalMode: PortalMode;
  portalFeatures: Record<string, boolean>;
  effectiveFeatures: Record<string, boolean>;
}

const FEATURE_LABELS: Array<{ key: string; label: string; description: string }> = [
  { key: 'dropZone', label: 'Drop Zone', description: 'Upload documents for multi-destination filing' },
  { key: 'clarificationRouting', label: 'Clarification Routing', description: 'Route clarifications to client when domain-relevant' },
  { key: 'taskRequests', label: 'Task Requests', description: 'Client can submit new task requests' },
  { key: 'memoryInspector', label: 'Memory Inspector', description: 'Ask what the system knows' },
  { key: 'healthDigest', label: 'Health Digest', description: 'Include memory-health section in portal digests' },
];

interface PortalConfigEditorProps {
  subaccountId: string;
}

export default function PortalConfigEditor({ subaccountId }: PortalConfigEditorProps) {
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await api.get<PortalConfig>(`/api/subaccounts/${subaccountId}/portal`);
      setConfig(res.data);
    } catch {
      setError('Failed to load portal config.');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subaccountId]);

  async function updateMode(mode: PortalMode) {
    if (!config) return;
    setSaving(true);
    try {
      const res = await api.patch<PortalConfig>(`/api/subaccounts/${subaccountId}/portal`, {
        portalMode: mode,
      });
      setConfig(res.data);
    } catch {
      setError('Failed to update portal mode.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleFeature(key: string, next: boolean) {
    if (!config) return;
    setSaving(true);
    try {
      const res = await api.patch<PortalConfig>(`/api/subaccounts/${subaccountId}/portal`, {
        portalFeatures: { [key]: next },
      });
      setConfig(res.data);
    } catch {
      setError('Failed to toggle feature.');
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return <div className="text-sm text-slate-400">Loading portal config…</div>;
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">Client Portal</h3>

      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}

      <div className="mb-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Portal Mode
        </p>
        <div className="flex gap-2">
          {(['hidden', 'transparency', 'collaborative'] as PortalMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={saving}
              onClick={() => updateMode(mode)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                config.portalMode === mode
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              } disabled:opacity-50`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {config.portalMode === 'collaborative' && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Features
          </p>
          <div className="flex flex-col gap-2">
            {FEATURE_LABELS.map(({ key, label, description }) => {
              const enabled = config.effectiveFeatures[key] ?? true;
              const explicitlyDisabled = config.portalFeatures[key] === false;
              return (
                <label key={key} className="flex items-start gap-3 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={saving}
                    onChange={(e) => toggleFeature(key, e.target.checked)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium text-slate-700">{label}</div>
                    <div className="text-xs text-slate-500">{description}</div>
                    {explicitlyDisabled && (
                      <span className="text-[10px] text-amber-700">
                        Explicitly disabled by agency
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
