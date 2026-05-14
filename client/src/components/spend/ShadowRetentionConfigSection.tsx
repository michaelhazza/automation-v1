import { useState } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';

interface ShadowRetentionConfigSectionProps {
  /** Current value from organisations.shadow_charge_retention_days */
  currentDays: number;
  /** Called with the saved value after a successful PATCH */
  onSaved: (days: number) => void;
}

/**
 * Admin-only section for editing the per-org shadow charge retention window.
 * Spec: tasks/builds/agentic-commerce/spec.md §14
 * Range: [1, 365]. Default: 90.
 */
export default function ShadowRetentionConfigSection({
  currentDays,
  onSaved,
}: ShadowRetentionConfigSectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(currentDays));
  const [saving, setSaving] = useState(false);

  const handleEdit = () => {
    setDraft(String(currentDays));
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setDraft(String(currentDays));
  };

  const handleSave = async () => {
    const parsed = parseInt(draft, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
      toast.error('Retention days must be between 1 and 365');
      return;
    }
    setSaving(true);
    try {
      await api.patch('/api/org/shadow-charge-retention-days', {
        shadowChargeRetentionDays: parsed,
      });
      toast.success('Shadow charge retention updated');
      setEditing(false);
      onSaved(parsed);
    } catch {
      toast.error('Failed to update shadow charge retention');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium text-slate-800">Shadow charge retention</p>
        <p className="text-xs text-slate-500 mt-0.5">
          How long shadow-settled charges are kept before automatic deletion (1-365 days).
        </p>
      </div>
      {editing ? (
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="number"
            min={1}
            max={365}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-20 px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            disabled={saving}
          />
          <span className="text-sm text-slate-500">days</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 text-xs font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="px-3 py-1 text-xs font-semibold rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-slate-700">{currentDays} days</span>
          <button
            onClick={handleEdit}
            className="px-3 py-1 text-xs font-semibold rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
