export type ApprovalDispatchAction = 'complete_with_existing_output' | 'redispatch';

// Spec §1.3 names the decision type as 'approve' | 'reject'; codebase reality is
// 'approved' | 'rejected' | 'edited'. The 'edited' case is treated as non-approved:
// the operator already supplied final output, so re-dispatching would discard their edits.
export function resolveApprovalDispatchAction(
  stepRun: { stepType: string },
  decision: 'approved' | 'rejected' | 'edited',
): ApprovalDispatchAction {
  if (decision !== 'approved') return 'complete_with_existing_output';
  if (stepRun.stepType === 'invoke_automation') return 'redispatch';
  return 'complete_with_existing_output';
}
