import { useState, useEffect, useCallback, useRef } from 'react';
import type { RejectReason } from '../../../../shared/types/skillAmendments.js';
import { useAmendmentDetail, useAmendmentMutations } from '../../hooks/useSkillAmendments.js';

const REJECT_REASON_BUTTONS: ReadonlyArray<{ label: string; reason: RejectReason }> = [
  { label: 'Not the right fix',           reason: 'incorrect_root_cause' },
  { label: "Don't want this here",        reason: 'redundant' },
  { label: "Unsafe: don't suggest again", reason: 'unsafe' },
];

type ActionMode = 'default' | 'edit' | 'reject' | 'accepted' | 'rejected';

interface Props {
  subaccountId: string;
  amendmentId: string;
  onClose: () => void;
  onActioned: () => void;
}

export function AmendmentReviewDrawer({ subaccountId, amendmentId, onClose, onActioned }: Props) {
  const { detail, loading, error } = useAmendmentDetail(subaccountId, amendmentId);

  const [mode, setMode] = useState<ActionMode>('default');
  const [editBody, setEditBody] = useState('');
  const [selectedRejectReason, setSelectedRejectReason] = useState<RejectReason | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [techExpanded, setTechExpanded] = useState(false);
  const [optimisticActioned, setOptimisticActioned] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Populate edit textarea when detail loads
  useEffect(() => {
    if (detail && mode === 'edit') {
      setEditBody(detail.body);
    }
  }, [detail, mode]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const mutations = useAmendmentMutations(subaccountId, onActioned);

  const handleAccept = useCallback(async () => {
    setActionLoading(true);
    setOptimisticActioned(true);
    try {
      await mutations.accept(amendmentId);
      setMode('accepted');
    } catch (err: unknown) {
      setOptimisticActioned(false);
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        showToast('Already actioned by another reviewer');
        onActioned();
        onClose();
      } else {
        showToast('Something went wrong. Please try again.');
      }
    } finally {
      setActionLoading(false);
    }
  }, [amendmentId, mutations, showToast, onActioned, onClose]);

  const handleEditAndAccept = useCallback(() => {
    if (detail) setEditBody(detail.body);
    setEditError(null);
    setMode('edit');
  }, [detail]);

  const handleAcceptWithEdits = useCallback(async () => {
    if (!editBody.trim()) { setEditError('Body cannot be empty'); return; }
    setActionLoading(true);
    setOptimisticActioned(true);
    try {
      await mutations.acceptAfterEdit(amendmentId, editBody);
      setMode('accepted');
    } catch (err: unknown) {
      setOptimisticActioned(false);
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        showToast('Already actioned by another reviewer');
        onActioned();
        onClose();
      } else if (status === 422) {
        setEditError('The edited body is not valid. Please check the content.');
      } else {
        showToast('Something went wrong. Please try again.');
      }
    } finally {
      setActionLoading(false);
    }
  }, [amendmentId, editBody, mutations, showToast, onActioned, onClose]);

  const handleShowReject = useCallback(() => {
    setSelectedRejectReason(null);
    setMode('reject');
  }, []);

  const handleConfirmReject = useCallback(async () => {
    if (!selectedRejectReason) return;
    setActionLoading(true);
    setOptimisticActioned(true);
    try {
      await mutations.reject(amendmentId, selectedRejectReason);
      setMode('rejected');
    } catch (err: unknown) {
      setOptimisticActioned(false);
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        showToast('Already actioned by another reviewer');
        onActioned();
        onClose();
      } else {
        showToast('Something went wrong. Please try again.');
      }
    } finally {
      setActionLoading(false);
    }
  }, [amendmentId, selectedRejectReason, mutations, showToast, onActioned, onClose]);

  // Close on backdrop click (not on drawer panel itself)
  const handleBackdropClick = useCallback(() => {
    if (!optimisticActioned) onClose();
  }, [onClose, optimisticActioned]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={handleBackdropClick}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/35 backdrop-blur-[1px]" />

      {/* Drawer panel */}
      <div
        className="relative w-[520px] max-w-[95vw] bg-white flex flex-col shadow-[-8px_0_32px_rgba(0,0,0,0.14)] h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toast */}
        {toastMsg && (
          <div className="absolute top-4 left-4 right-4 z-10 px-4 py-2.5 bg-slate-800 text-white text-[13px] rounded-lg shadow-md">
            {toastMsg}
          </div>
        )}

        {/* Head */}
        <div className="px-6 py-5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-block px-2 py-0.5 rounded text-[11.5px] font-semibold bg-violet-100 text-violet-700">
                  Skill improvement
                </span>
              </div>
              <div className="text-[16px] font-bold text-slate-900 mb-1">
                {loading ? 'Loading...' : (detail?.skillSlug ?? 'Amendment')}
              </div>
              <div className="text-[12.5px] text-slate-500">
                Proposed amendment from a failed run
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-[20px] leading-none p-1 rounded-md mt-0.5"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 rounded-lg bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]"
                />
              ))}
            </div>
          )}

          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-[13px]">
              {error}
            </div>
          )}

          {!loading && detail && (
            <>
              {/* What triggered this */}
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 mb-2">
                What triggered this
              </div>
              <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-[10px] mb-4 text-[13px] text-red-800 leading-snug">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-red-700 mb-2">
                  Run that failed
                </div>
                {detail.failureMode ?? 'A failure was detected in a recent agent run.'}
                {detail.rcaJson && typeof detail.rcaJson.contributingFactors === 'string' && (
                  <p className="mt-2 mb-0 text-red-700">{detail.rcaJson.contributingFactors as string}</p>
                )}
              </div>

              {/* Before / After diff */}
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 mb-2">
                What would change
              </div>
              <div className="border border-slate-200 rounded-[10px] overflow-hidden mb-4">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-slate-400 px-3.5 py-2 bg-slate-50 border-b border-slate-100">
                  Instruction change to &ldquo;{detail.skillSlug}&rdquo; skill
                </div>
                <div className="px-3.5 py-3 bg-[#fef9f9] border-b border-red-200 text-[13px] text-red-900 leading-relaxed">
                  <span className="font-bold text-red-600 mr-1">-</span>
                  {detail.rcaJson && typeof detail.rcaJson.baseBody === 'string'
                    ? (detail.rcaJson.baseBody as string)
                    : '(current skill body)'}
                </div>
                <div className="px-3.5 py-3 bg-[#f0fdf4] text-[13px] text-green-900 leading-relaxed">
                  <span className="font-bold text-green-600 mr-1">+</span>
                  {detail.body}
                </div>
              </div>

              {/* Action mode: default */}
              {mode === 'default' && (
                <div className="flex items-center gap-2 flex-wrap mb-5">
                  <button
                    type="button"
                    onClick={handleAccept}
                    disabled={actionLoading}
                    className="btn btn-success"
                  >
                    {actionLoading ? 'Accepting...' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    onClick={handleEditAndAccept}
                    disabled={actionLoading}
                    className="btn btn-secondary"
                  >
                    Edit first
                  </button>
                  <button
                    type="button"
                    onClick={handleShowReject}
                    disabled={actionLoading}
                    className="btn btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    Reject
                  </button>
                </div>
              )}

              {/* Action mode: edit */}
              {mode === 'edit' && (
                <div className="mb-5">
                  <div className="text-[12px] font-semibold text-slate-600 mb-1.5">
                    Edit the suggested instruction
                  </div>
                  <textarea
                    value={editBody}
                    onChange={(e) => { setEditBody(e.target.value); setEditError(null); }}
                    className="w-full min-h-[120px] px-3 py-2.5 border border-slate-300 rounded-lg text-[13px] font-[inherit] leading-relaxed resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  {editError && (
                    <p className="text-[12px] text-red-600 mt-1 mb-0">{editError}</p>
                  )}
                  <div className="flex gap-2 mt-2.5">
                    <button
                      type="button"
                      onClick={handleAcceptWithEdits}
                      disabled={actionLoading || !editBody.trim()}
                      className="btn btn-success"
                    >
                      {actionLoading ? 'Saving...' : 'Accept with edits'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('default')}
                      disabled={actionLoading}
                      className="btn btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Action mode: reject */}
              {mode === 'reject' && (
                <div className="mb-5">
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-red-700 mb-2">
                    Why are you rejecting this?
                  </div>
                  <div className="flex flex-col gap-2">
                    {REJECT_REASON_BUTTONS.map(({ label, reason }) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => setSelectedRejectReason(reason)}
                        className={`w-full text-left px-3.5 py-2.5 rounded-lg border text-[13px] cursor-pointer transition-colors ${
                          selectedRejectReason === reason
                            ? 'border-red-400 bg-red-50 text-red-800 font-semibold'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={handleConfirmReject}
                      disabled={!selectedRejectReason || actionLoading}
                      className="btn btn-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {actionLoading ? 'Rejecting...' : 'Confirm reject'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMode('default'); setSelectedRejectReason(null); }}
                      disabled={actionLoading}
                      className="btn btn-sm btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Accepted confirmation */}
              {mode === 'accepted' && (
                <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-[10px] mb-5 text-[13.5px] text-green-800 font-semibold">
                  <span>&#10003;</span> Accepted. The improvement is now active.
                </div>
              )}

              {/* Rejected confirmation */}
              {mode === 'rejected' && (
                <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-[10px] mb-5 text-[13.5px] text-red-800 font-semibold">
                  <span>&#10005;</span> Rejected. The agent will not suggest this change again.
                </div>
              )}

              <hr className="border-none border-t border-slate-100 my-5" />

              {/* Technical detail (collapsed) */}
              <button
                type="button"
                onClick={() => setTechExpanded(!techExpanded)}
                className="flex items-center gap-1.5 bg-transparent border-0 cursor-pointer text-[12px] text-slate-400 font-medium hover:text-slate-600 p-0 font-[inherit]"
              >
                <span
                  className="text-[10px] inline-block transition-transform"
                  style={{ transform: techExpanded ? 'rotate(90deg)' : 'none' }}
                >
                  &#9654;
                </span>
                {techExpanded ? 'Hide technical detail' : 'Show technical detail'}
              </button>

              {techExpanded && (
                <div className="mt-3 px-4 py-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <TechDetailSection label="Provenance">
                    <TechRow k="Kind" v={detail.kind} />
                    <TechRow k="Blast radius" v={detail.blastRadiusEstimate} />
                    <TechRow k="Confidence" v={detail.confidence != null ? String(detail.confidence) : 'n/a'} />
                    <TechRow k="Version" v={String(detail.versionNumber)} />
                  </TechDetailSection>

                  {detail.peerReviewerVerdict != null && (
                    <TechDetailSection label="Peer review">
                      <TechRow k="Verdict" v={detail.peerReviewerVerdict ? 'approved' : 'rejected'} />
                      {detail.peerReviewerReasoning && (
                        <TechRow k="Note" v={detail.peerReviewerReasoning} />
                      )}
                    </TechDetailSection>
                  )}

                  {detail.rcaJson && (
                    <TechDetailSection label="Root-cause record">
                      {Object.entries(detail.rcaJson).map(([k, v]) => (
                        <TechRow key={k} k={k} v={typeof v === 'string' ? v : JSON.stringify(v)} />
                      ))}
                    </TechDetailSection>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Foot */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between flex-shrink-0">
          <span className="text-[12px] text-slate-400">
            {detail ? `${detail.skillSlug} · Subaccount skill` : ''}
          </span>
          <button type="button" onClick={onClose} className="btn btn-sm btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TechDetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-400 mb-2 mt-3 first:mt-0">
        {label}
      </div>
      {children}
    </>
  );
}

function TechRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-slate-100 last:border-0 text-[12px]">
      <span className="min-w-[130px] font-semibold text-slate-500 flex-shrink-0">{k}</span>
      <span className="text-slate-700 font-mono text-[11.5px] break-all">{v}</span>
    </div>
  );
}
