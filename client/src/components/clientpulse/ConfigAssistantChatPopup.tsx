/**
 * ConfigAssistantChatPopup — global floating chat surface for ClientPulse
 * operational_config changes. Uses a confirm-before-write card pattern:
 * operator types a request, the popup proposes a patch via a diff card,
 * operator confirms → POST /api/clientpulse/config/apply.
 *
 * V1 pilot: the diff is operator-typed (path + value), not LLM-derived.
 * The chat column exists as the surface the Configuration Agent routes into
 * once the Orchestrator spec wires it up. The popup works standalone today
 * so operators can test the sensitive-path flow end-to-end.
 */

import { useState } from 'react';
import Modal from '../Modal';
import api from '../../lib/api';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ApplyResult {
  committed?: boolean;
  classification?: 'sensitive' | 'non_sensitive';
  configHistoryVersion?: number;
  actionId?: string;
  requiresApproval?: boolean;
  errorCode?: string;
  message?: string;
}

export default function ConfigAssistantChatPopup({ open, onClose }: Props) {
  const [path, setPath] = useState('alertLimits.notificationThreshold');
  const [rawValue, setRawValue] = useState('5');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  if (!open) return null;

  const parseValue = (): unknown => {
    const trimmed = rawValue.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    // Try JSON (for arrays / objects / quoted strings).
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed; // plain string fallback
    }
  };

  const handleApply = async () => {
    if (!path.trim() || !reason.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.post('/api/clientpulse/config/apply', {
        path: path.trim(),
        value: parseValue(),
        reason: reason.trim(),
      });
      setResult(res.data);
      if (res.data.committed) {
        toast.success(`Applied — history v${res.data.configHistoryVersion}`);
      } else if (res.data.requiresApproval) {
        toast.success(`Sent to review queue (#${String(res.data.actionId).slice(0, 8)})`);
      } else if (res.data.errorCode) {
        toast.error(`${res.data.errorCode}: ${res.data.message ?? 'failed'}`);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Apply failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Configuration Assistant" onClose={onClose} maxWidth={680}>
      <div className="space-y-4">
        <p className="text-[12.5px] text-slate-500">
          Propose a single-path change to the ClientPulse operational config.
          Sensitive paths route through the review queue for approval.
        </p>

        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Path</label>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="e.g. alertLimits.notificationThreshold"
            className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] font-mono focus:outline-none focus:border-indigo-400"
          />
          <p className="text-[11px] text-slate-400 mt-1">Dot-path into `operational_config`.</p>
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">New value</label>
          <textarea
            value={rawValue}
            onChange={(e) => setRawValue(e.target.value)}
            rows={3}
            placeholder={`A number, boolean, or JSON array/object.\nExample: 5  —or—  [{"metricSlug":"a","weight":0.5},{"metricSlug":"b","weight":0.5}]`}
            className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] font-mono focus:outline-none focus:border-indigo-400"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Why this change, in one sentence"
            className="w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] focus:outline-none focus:border-indigo-400"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[12px] font-semibold text-slate-600 hover:bg-slate-100">Close</button>
          <button
            disabled={submitting || !path.trim() || !reason.trim()}
            onClick={handleApply}
            className="px-4 py-1.5 rounded-md text-[12px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
          >
            {submitting ? 'Applying…' : 'Apply'}
          </button>
        </div>

        {result && (
          <div className={`p-3 rounded-lg text-[12px] ${
            result.committed ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
            : result.requiresApproval ? 'bg-amber-50 border border-amber-200 text-amber-800'
            : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            {result.committed && <>Applied. <span className="font-mono">config_history v{result.configHistoryVersion}</span> · refresh settings to see the new value.</>}
            {result.requiresApproval && <>Sensitive path — queued for review. Action <span className="font-mono">#{String(result.actionId).slice(0, 8)}</span>. Apply in the review queue to commit.</>}
            {result.errorCode && <><strong>{result.errorCode}:</strong> {result.message}</>}
          </div>
        )}
      </div>
    </Modal>
  );
}
