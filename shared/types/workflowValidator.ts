export type ValidatorRule =
  | 'four_as_vocabulary'
  | 'branching_target_exists'
  | 'parallel_depth'
  | 'loop_only_on_approval_reject'
  | 'no_workflow_to_workflow'
  | 'quorum_specific_users'
  | 'is_critical_only_on_agent_action'
  | 'ask_single_submit';

export interface ValidatorError {
  rule: ValidatorRule;
  stepId?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidatorResult {
  ok: boolean;
  errors: ValidatorError[];
}
