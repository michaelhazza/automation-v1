import { useState } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import Modal from '../Modal';
import type { User } from '../../lib/auth';

export function AdminBaselineResetButton({
  subaccountId,
  user,
  onReset,
}: {
  subaccountId: string;
  user: User;
  onReset?: () => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (user.role !== 'system_admin') return null;

  const handleReset = async () => {
    if (!reason.trim()) {
      setError('A reset reason is required.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await api.post(`/api/admin/subaccounts/${subaccountId}/baseline/reset`, { reason: reason.trim() });
      toast.success('Baseline reset.');
      setShowModal(false);
      setReason('');
      onReset?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string | { code?: string; message?: string } } } };
      const errBody = e.response?.data?.error;
      const message =
        typeof errBody === 'string'
          ? errBody
          : errBody?.message ?? 'Failed to reset baseline';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setShowModal(true); setError(''); setReason(''); }}
        className="btn btn-sm btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700"
      >
        Reset baseline
      </button>

      {showModal && (
        <Modal title="Reset baseline" onClose={() => setShowModal(false)} maxWidth={420}>
          <p className="text-[13px] text-slate-600 mb-4">
            Resetting the baseline marks the current record as reset and allows a fresh capture. This action cannot be undone.
          </p>
          {error && <div className="text-[13px] text-red-600 mb-3">{error}</div>}
          <div className="mb-4">
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
              Reason (required)
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Explain why this baseline is being reset..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="btn btn-sm btn-primary bg-red-600 hover:bg-red-700 border-red-600"
            >
              {saving ? 'Resetting...' : 'Confirm reset'}
            </button>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="btn btn-sm btn-secondary"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
