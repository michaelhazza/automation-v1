export interface Subaccount {
  id: string;
  name: string;
  slug: string;
  status: string;
  includeInOrgInbox: boolean;
  runRetentionDays?: number | null;
  settings?: { timezone?: string };
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  colour: string | null;
}

export interface ProcessLink {
  linkId: string;
  processId: string;
  processName: string;
  processStatus: string;
  isActive: boolean;
  subaccountCategoryId: string | null;
}

export interface OrgProcess {
  id: string;
  name: string;
  status: string;
}

export type ActiveTab = 'onboarding' | 'engines' | 'workflows' | 'agents' | 'beliefs' | 'categories' | 'tags' | 'board' | 'operator' | 'usage' | 'admin' | 'workspace';

export const TAB_LABELS: Record<ActiveTab, string> = {
  onboarding: 'Onboarding', engines: 'Engines', workflows: 'Workflows', agents: 'Agents', beliefs: 'Beliefs',
  categories: 'Categories', tags: 'Tags', board: 'Board Config', operator: 'Operator', usage: 'Usage & Costs', admin: 'Admin', workspace: 'Workspace',
};

export interface SettingsForm {
  name: string;
  slug: string;
  status: string;
  timezone: string;
  includeInOrgInbox: boolean;
  runRetentionDays: string;
}

export interface OrgAgent {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  status: string;
  description: string | null;
}

export interface LinkedAgent {
  id: string;
  agentId: string;
  isActive: boolean;
  agent: { name: string; icon: string | null; status: string; description: string | null; };
  agentRole: string | null;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  sourceType: string;
  slotCount: number;
  version: number;
}

export interface AgentRunRecord {
  id: string;
  status: string;
  runType: string;
  executionMode: string;
  summary: string | null;
  totalToolCalls: number;
  totalTokens: number;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface Belief {
  id: string;
  beliefKey: string;
  category: string;
  subject: string | null;
  value: string;
  confidence: number;
  source: string;
  evidenceCount: number;
  updatedAt: string;
}

export interface OwedOnboardingRow {
  slug: string;
  moduleIds: string[];
  latestRun: {
    id: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
}
