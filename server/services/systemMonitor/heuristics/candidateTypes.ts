// Typed entity shapes for each EntityKind.
// The sweep handler enriches raw DB rows into these shapes before passing
// them to heuristics as Candidate.entity. Heuristics cast entity to the
// appropriate type based on candidate.entityKind.

/** Agent run entity — passed to agent_quality heuristics. */
export interface AgentRunEntity {
  runId: string;
  agentId: string;
  agentSlug: string;
  organisationId: string;
  status: string;
  runResultStatus: 'success' | 'partial' | 'failed' | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenBudget: number;
  errorMessage: string | null;
  summary: string | null;
  isTestRun: boolean;
  // Enriched by sweep handler:
  reachedMaxTurns: boolean;
  finalMessageRole: 'assistant' | 'user' | 'system' | null;
  finalMessageContent: string | null;
  finalMessageLengthChars: number;
  skillInvocationCounts: Record<string, number>;  // slug → count
  outputHash: string | null;
  recentRunOutputs: Array<{ runId: string; triggerHash: string; outputHash: string | null }>;
}

/** Skill execution entity — passed to skill_execution heuristics. */
export interface SkillExecutionEntity {
  executionId: string;
  agentRunId: string;
  skillSlug: string;
  durationMs: number | null;
  succeeded: boolean;
  errorMessage: string | null;
  outputPayload: unknown;
  declaredOutputSchema: Record<string, unknown> | null;
  assistantMessageAfterTool: string | null;
}

/** Job entity — passed to infrastructure heuristics for pg-boss jobs. */
export interface JobEntity {
  jobId: string;
  queueName: string;
  state: string;
  completedAt: Date | null;
  /** Pre-checked by sweep handler against the side-effect manifest. */
  expectedSideEffectPresent: boolean;
  data: Record<string, unknown>;
}

/** Connector poll entity — passed to infrastructure heuristics for connectors. */
export interface ConnectorPollEntity {
  connectorId: string;
  connectorType: string;
  /** Count of consecutive empty result polls in the last hour. */
  recentEmptyResultCount: number;
  /** Baseline median rows ingested per poll (null if no baseline yet). */
  baselineMedianRowsIngested: number | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
}
