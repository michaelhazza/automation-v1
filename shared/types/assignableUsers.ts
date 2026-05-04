export type AssignableUsersIntent = 'pick_approver' | 'pick_submitter';

export const ASSIGNABLE_USERS_INTENTS: readonly AssignableUsersIntent[] = ['pick_approver', 'pick_submitter'];

export interface AssignableUser {
  id: string;
  name: string;
  email: string | null;
  role: 'org_admin' | 'org_manager' | 'subaccount_admin' | 'subaccount_member';
  is_org_user: boolean;
  is_subaccount_member: boolean;
}

export interface AssignableTeam {
  id: string;
  name: string;
  member_count: number;
}
