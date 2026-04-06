import api from '../lib/api';

export interface Goal {
  id: string;
  organisationId: string;
  subaccountId: string;
  parentGoalId: string | null;
  title: string;
  description: string | null;
  status: 'planned' | 'active' | 'completed' | 'archived';
  level: 'mission' | 'objective' | 'key_result';
  ownerAgentId: string | null;
  targetDate: string | null;
  position: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalDetail extends Goal {
  childrenCount: number;
  linkedTasksCount: number;
  linkedProjectsCount: number;
}

export interface GoalAncestor {
  id: string;
  parentGoalId: string | null;
  title: string;
  description: string | null;
  status: string;
  level: string;
  position: number;
  depth: number;
}

export async function fetchGoals(subaccountId: string): Promise<Goal[]> {
  const { data } = await api.get(`/api/subaccounts/${subaccountId}/goals`);
  return data;
}

export async function fetchGoal(subaccountId: string, goalId: string): Promise<GoalDetail> {
  const { data } = await api.get(`/api/subaccounts/${subaccountId}/goals/${goalId}`);
  return data;
}

export async function createGoal(subaccountId: string, payload: {
  title: string;
  description?: string;
  parentGoalId?: string;
  status?: Goal['status'];
  level?: Goal['level'];
  ownerAgentId?: string;
  targetDate?: string;
  position?: number;
}): Promise<Goal> {
  const { data } = await api.post(`/api/subaccounts/${subaccountId}/goals`, payload);
  return data;
}

export async function updateGoal(subaccountId: string, goalId: string, payload: {
  title?: string;
  description?: string | null;
  parentGoalId?: string | null;
  status?: Goal['status'];
  level?: Goal['level'];
  ownerAgentId?: string | null;
  targetDate?: string | null;
  position?: number;
}): Promise<Goal> {
  const { data } = await api.patch(`/api/subaccounts/${subaccountId}/goals/${goalId}`, payload);
  return data;
}

export async function deleteGoal(subaccountId: string, goalId: string): Promise<void> {
  await api.delete(`/api/subaccounts/${subaccountId}/goals/${goalId}`);
}

export async function fetchGoalAncestry(subaccountId: string, goalId: string): Promise<GoalAncestor[]> {
  const { data } = await api.get(`/api/subaccounts/${subaccountId}/goals/${goalId}/ancestry`);
  return data;
}
