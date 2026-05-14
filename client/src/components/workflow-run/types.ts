// ─── Types (mirror server shapes; avoid importing server code into client) ───

export type StepType =
  | 'prompt'
  | 'agent_call'
  | 'user_input'
  | 'approval'
  | 'conditional'
  | 'agent_decision'
  | 'action_call';

export type SideEffectType = 'none' | 'idempotent' | 'reversible' | 'irreversible';

export type StepRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'invalidated';

export type RunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'partial';

export interface StepRun {
  id: string;
  stepId: string;
  stepType: StepType;
  status: StepRunStatus;
  sideEffectType: SideEffectType;
  dependsOn: string[];
  inputJson: Record<string, unknown> | null;
  outputJson: Record<string, unknown> | null;
  error: string | null;
  attempt: number;
  version: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface StepDef {
  id: string;
  name: string;
  description?: string;
  type: StepType;
  sideEffectType: SideEffectType;
  dependsOn: string[];
  humanReviewRequired?: boolean;
  approvalPrompt?: string;
  actionSlug?: string;
}

export interface RunRow {
  id: string;
  status: RunStatus;
  runMode: string;
  contextJson: Record<string, unknown>;
  error: string | null;
  failedDueToStepId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  isPortalVisible: boolean;
  isOnboardingRun: boolean;
  WorkflowSlug: string | null;
}

export interface Envelope {
  run: RunRow;
  stepRuns: StepRun[];
  definition: {
    slug?: string;
    name?: string;
    version?: number;
    steps?: StepDef[];
  } | null;
  resolvedAgents: Record<string, string>;
  events: Array<unknown>;
}

// ─── Presentation constants ──────────────────────────────────────────────────

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
];

export const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  running: 'bg-blue-100 text-blue-800',
  awaiting_input: 'bg-amber-100 text-amber-800',
  awaiting_approval: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  completed_with_errors: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-slate-100 text-slate-500',
  invalidated: 'bg-slate-100 text-slate-400 line-through',
  cancelling: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-slate-200 text-slate-600',
  partial: 'bg-amber-100 text-amber-800',
};

export const STATUS_DOT_COLORS: Record<string, string> = {
  pending: 'bg-slate-300',
  running: 'bg-blue-500 animate-pulse',
  awaiting_input: 'bg-amber-500',
  awaiting_approval: 'bg-amber-500',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
  skipped: 'bg-slate-300',
  invalidated: 'bg-slate-300',
};

export const SIDE_EFFECT_COLORS: Record<string, string> = {
  none: 'text-slate-500',
  idempotent: 'text-blue-600',
  reversible: 'text-amber-600',
  irreversible: 'text-red-600',
};
