// Approver group and pool snapshot types for workflow step gates.
// Spec: docs/workflows-dev-spec.md §5.1.

export interface ApproverGroup {
  kind: 'specific_users' | 'team' | 'task_requester' | 'org_admin';
  userIds?: string[];  // when kind === 'specific_users'
  teamId?: string;     // when kind === 'team'
  quorum?: number;     // defaults to 1
}

export type ApproverPoolSnapshot = string[]; // user IDs
