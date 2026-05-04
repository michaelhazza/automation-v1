export interface ChatMessageProjection {
  id: string;
  authorKind: 'user' | 'agent';
  authorId: string;
  body: string;
  timestamp: string;
}

export interface MilestoneProjection {
  id: string;
  agentId: string;
  summary: string;
  linkRef?: { kind: string; id: string; label: string };
  timestamp: string;
}

export interface ApprovalGateProjection {
  gateId: string;
  stepId: string;
  poolSize: number;
  poolFingerprint: string;
  seenPayload: unknown;
  seenConfidence: unknown;
  status: 'pending' | 'decided';
  decision?: 'approved' | 'rejected';
  decidedBy?: string;
  decisionReason?: string;
}

export interface AskGateProjection {
  gateId: string;
  stepId: string;
  poolSize: number;
  poolFingerprint: string;
  schema: unknown;
  prompt: string;
  status: 'pending' | 'submitted' | 'skipped';
  submittedBy?: string;
}

export interface StepProjection {
  stepId: string;
  stepType: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval' | 'awaiting_ask';
  errorMessage?: string;
  params?: Record<string, unknown>;
}

export interface ActivityEventProjection {
  id: string;
  kind: string;
  timestamp: string;
  summary: string;
}

export interface TaskProjection {
  chatMessages: ChatMessageProjection[];
  milestones: MilestoneProjection[];
  thinkingText: string | null;
  approvalGates: ApprovalGateProjection[];
  askGates: AskGateProjection[];
  steps: StepProjection[];
  activityEvents: ActivityEventProjection[];
  runStatus: 'running' | 'paused' | 'paused_cost' | 'paused_wall_clock' | 'stopped' | null;
  isDegraded: boolean;
  degradationReason: string | null;
  lastEventSeq: number;
  lastEventSubseq: number;
}

export const INITIAL_TASK_PROJECTION: TaskProjection = {
  chatMessages: [],
  milestones: [],
  thinkingText: null,
  approvalGates: [],
  askGates: [],
  steps: [],
  activityEvents: [],
  runStatus: null,
  isDegraded: false,
  degradationReason: null,
  lastEventSeq: 0,
  lastEventSubseq: 0,
};
