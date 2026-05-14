// client/src/lib/api/benchRuns.ts
// API client for bench run endpoints.
// Trust & Verification Layer spec §12.4.

import api from '../api';

export interface BenchSummary {
  recommendedModelId: string | null;
  reason: string;
}

export interface BenchRun {
  id: string;
  organisationId: string;
  triggeredByUserId: string;
  targetAgentId: string | null;
  targetSkillSlug: string | null;
  state: 'pending' | 'awaiting_confirm' | 'running' | 'awaiting_approval' | 'completed' | 'partial' | 'failed' | 'cancelled';
  candidateModelIds: string[];
  sampleCount: number;
  estimatedCostCents: number | null;
  actualCostCents: number | null;
  approvedModelId: string | null;
  summary: BenchSummary | null;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BenchResult {
  id: string;
  organisationId: string;
  benchRunId: string;
  candidateModelId: string;
  sampleIndex: number;
  verdict: 'pass' | 'fail' | 'inconclusive' | 'error' | null;
  score: number | null;
  reasoning: string | null;
  latencyMs: number | null;
  costCents: number | null;
  rawOutput: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BenchEstimateResult {
  benchRunId: string;
  estimatedCostCents: number;
  judgeSwapNotice: string | null;
  status: 'awaiting_confirm';
}

// ── Estimate ──────────────────────────────────────────────────────────────────

export async function estimateBenchRun(body: {
  candidateModelIds: string[];
  judgeModelId: string;
  sampleCount: number;
  targetAgentId?: string | null;
  targetSkillSlug?: string | null;
}): Promise<BenchEstimateResult> {
  const { data } = await api.post<BenchEstimateResult>('/api/bench-runs/estimate', body);
  return data;
}

// ── Run ───────────────────────────────────────────────────────────────────────

export async function runBenchRun(benchRunId: string): Promise<void> {
  await api.post(`/api/bench-runs/${encodeURIComponent(benchRunId)}/run`);
}

// ── Get ───────────────────────────────────────────────────────────────────────

export async function getBenchRun(benchRunId: string): Promise<BenchRun> {
  const { data } = await api.get<BenchRun>(`/api/bench-runs/${encodeURIComponent(benchRunId)}`);
  return data;
}

// ── Results ───────────────────────────────────────────────────────────────────

export async function getBenchResults(benchRunId: string): Promise<BenchResult[]> {
  const { data } = await api.get<{ results: BenchResult[] }>(
    `/api/bench-runs/${encodeURIComponent(benchRunId)}/results`,
  );
  return data.results;
}

// ── Approve ───────────────────────────────────────────────────────────────────

export async function approveBenchRun(
  benchRunId: string,
  candidateModelId: string,
): Promise<{ approvedModelId: string }> {
  const { data } = await api.post<{ approvedModelId: string }>(
    `/api/bench-runs/${encodeURIComponent(benchRunId)}/approve`,
    { candidateModelId },
  );
  return data;
}

// ── Quality / agents drift ────────────────────────────────────────────────────

export interface AgentDriftRow {
  agentId: string;
  agentName: string;
  lastJudgedAt: string | null;
  avgScore: number | null;
  pendingCount: number;
}

export async function listAgentsDrift(): Promise<AgentDriftRow[]> {
  const { data } = await api.get<{ agents: AgentDriftRow[] }>('/api/quality/agents');
  return data.agents;
}

export async function listBenchHistory(): Promise<BenchRun[]> {
  const { data } = await api.get<{ benchRuns: BenchRun[] }>('/api/quality/bench-history');
  return data.benchRuns;
}
