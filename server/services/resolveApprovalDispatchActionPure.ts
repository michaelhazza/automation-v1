export type ApprovalDispatchAction = 'complete_with_existing_output' | 'redispatch';

export function resolveApprovalDispatchAction(
  stepRun: { stepType: string },
  decision: 'approved' | 'rejected' | 'edited',
): ApprovalDispatchAction {
  if (decision !== 'approved') return 'complete_with_existing_output';
  if (stepRun.stepType === 'invoke_automation') return 'redispatch';
  return 'complete_with_existing_output';
}
