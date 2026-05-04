import Modal from '../Modal.js';

interface PromotePolicyConfirmationModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

/**
 * Confirmation modal for the shadow-to-live promotion flow.
 * Explains that all future charges on this policy will move real money.
 * Spec: tasks/builds/agentic-commerce/spec.md §12 (Shadow-to-live promotion)
 * Plan: tasks/builds/agentic-commerce/plan.md § Chunk 15
 */
export default function PromotePolicyConfirmationModal({
  onConfirm,
  onCancel,
  loading,
}: PromotePolicyConfirmationModalProps) {
  return (
    <Modal
      title="Promote policy to live"
      onClose={onCancel}
      maxWidth={480}
      disableBackdropClose
    >
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 mb-4">
        <p className="text-[12.5px] font-semibold text-amber-800 mb-1">
          All future charges will move real money
        </p>
        <p className="text-[12px] text-amber-700 leading-relaxed">
          Once approved, this policy switches from shadow mode to live mode.
          Agents will execute real charges against the connected Stripe account.
          Past shadow-settled charges are not affected.
        </p>
      </div>
      <p className="text-[13px] text-slate-600 mb-5 leading-relaxed">
        A promotion request will be sent to all approvers for this budget.
        The policy flips to live once an approver confirms.
        Are you sure you want to request promotion?
      </p>
      <div className="flex gap-2.5 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 [font-family:inherit] bg-slate-100 text-gray-700 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 [font-family:inherit] bg-gradient-to-br from-green-600 to-green-700 text-white shadow-[0_1px_4px_rgba(22,163,74,0.35)] hover:from-green-700 hover:to-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Requesting...' : 'Request promotion'}
        </button>
      </div>
    </Modal>
  );
}
