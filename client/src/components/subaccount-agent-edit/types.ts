export interface LinkDetail {
  id: string;
  agentId: string;
  subaccountId: string;
  isActive: boolean;
  skillSlugs: string[] | null;
  customInstructions: string | null;
  tokenBudgetPerRun: number;
  maxToolCallsPerRun: number;
  timeoutSeconds: number;
  maxCostPerRunCents: number | null;
  maxLlmCallsPerRun: number | null;
  heartbeatEnabled: boolean;
  heartbeatIntervalHours: number | null;
  heartbeatOffsetMinutes: number;
  scheduleCron: string | null;
  scheduleEnabled: boolean;
  scheduleTimezone: string;
  concurrencyPolicy: 'skip_if_active' | 'coalesce_if_active' | 'always_enqueue';
  catchUpPolicy: 'skip_missed' | 'enqueue_missed_with_cap';
  catchUpCap: number;
  maxConcurrentRuns: number;
  controllerStyleAllowed: 'native_only' | 'native_and_operator';
  allowedEnvironments: string[];
  maxRiskTier: number;
  requireApprovalAtTier: number;
  agent: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    icon: string | null;
    status: string;
    modelProvider: string;
    modelId: string;
    defaultSkillSlugs: string[];
    workspaceActorId: string | null;
  };
}

export type Tab = 'skills' | 'instructions' | 'budget' | 'scheduling' | 'beliefs' | 'identity' | 'activity' | 'execution' | 'governance' | 'models_identity' | 'integrations';

export interface AgentIdentity {
  identityId: string;
  emailAddress: string;
  emailSendingEnabled: boolean;
  status: string;
  displayName: string;
}
