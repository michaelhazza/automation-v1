/**
 * shared/types/assignableUsers.ts
 *
 * Shared types for the assignable-users picker pool endpoint (Chunk 10, §14).
 */

export type AssignableUsersIntent = 'pick_approver' | 'pick_submitter';

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  role: 'org_admin' | 'org_manager' | 'subaccount_admin' | 'subaccount_member';
  is_org_user: boolean;           // visible to all subaccounts in org
  is_subaccount_member: boolean;  // member of THIS subaccount
}

export interface AssignableTeam {
  id: string;
  name: string;
  member_count: number;
}

export interface AssignableUsersResponse {
  users: AssignableUser[];
  teams: AssignableTeam[];
}
