export type ApprovalDispatchAction = 'complete_with_existing_output' | 'redispatch';

// Canonical decision-input type for the approval-resume dispatch flow.
//
// Spec §1.3 names the decision type as 'approve' | 'reject'; codebase reality is
// 'approved' | 'rejected' | 'edited'. This file is the single source of truth for
// the runtime decision shape — production callers (workflowRunService.decideApproval)
// import this type rather than re-declaring the inline union, so future drift between
// spec wording and codebase reality stays surfaced in one place.
//
// The 'edited' case is treated as non-approved: the operator already supplied final
// output, so re-dispatching would discard their edits.
export type ApprovalDecision = 'approved' | 'rejected' | 'edited';

export function resolveApprovalDispatchAction(
  stepRun: { stepType: string },
  decision: ApprovalDecision,
): ApprovalDispatchAction {
  if (decision !== 'approved') return 'complete_with_existing_output';
  if (stepRun.stepType === 'invoke_automation') return 'redispatch';
  return 'complete_with_existing_output';
}
