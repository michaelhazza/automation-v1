// client/src/lib/api/scorecards.ts
// API client for scorecard and agent-scorecard-attachment endpoints.
// Trust & Verification Layer spec §12.1, §12.2.

import api from '../api';

export interface QualityCheck {
  slug: string;
  name: string;
  description?: string;
  /**
   * Pass mark on the 0..1 scale. Verdict = observedScore >= passMark
   * (Trust & Verification Layer spec §6.3, §6.5). UI displays as a
   * percentage. Optional — service falls back to DEFAULT_PASS_MARK (0.7)
   * when undefined.
   */
  passMark?: number;
  /**
   * When false, the check is skipped — judge does not run, no judgement
   * row is written, no contribution to the scorecard rollup. Defaults to
   * true. Spec §6.3.
   */
  enabled?: boolean;
  /** Deterministic-validators spec §10.1. Only written by system_admin. */
  kind?: 'semantic' | 'deterministic' | 'hybrid';
  validatorSlug?: string;
  validatorParameters?: Record<string, unknown>;
  preconditionSlugs?: string[];
  preconditionParameters?: Array<Record<string, unknown>>;
  safetyClass?: boolean;
}

export interface Scorecard {
  id: string;
  organisationId: string | null;
  scopeType: 'system' | 'org' | 'subaccount';
  scopeId: string | null;
  name: string;
  description: string | null;
  qualityChecks: QualityCheck[];
  shareWithSubaccounts: boolean;
  judgeModelId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ScorecardWithPill = Scorecard & {
  sourcePill?: 'system' | 'organisation' | 'this_subaccount' | 'platform' | 'custom';
};

export interface AgentScorecardAttachment {
  id: string;
  agentId: string;
  scorecardId: string;
  attachAuthority: 'system_mandatory' | 'org_mandatory' | 'suggested';
  gradingFrequency: 'off' | 'q1' | 'q2' | 'q3';
  attachedAt: string;
  scorecard?: ScorecardWithPill;
}

export interface CreateScorecardBody {
  name: string;
  description?: string;
  qualityChecks?: Array<{
    slug: string;
    name: string;
    description?: string;
    passMark?: number;
    enabled?: boolean;
  }>;
  shareWithSubaccounts?: boolean;
  judgeModelId?: string;
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listScorecards(): Promise<ScorecardWithPill[]> {
  const { data } = await api.get<{ scorecards: ScorecardWithPill[] }>('/api/scorecards');
  return data.scorecards;
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createScorecard(body: CreateScorecardBody): Promise<ScorecardWithPill> {
  const { data } = await api.post<ScorecardWithPill>('/api/scorecards', body);
  return data;
}

// ── Get by ID ────────────────────────────────────────────────────────────────

export async function getScorecard(id: string): Promise<ScorecardWithPill> {
  const { data } = await api.get<ScorecardWithPill>(`/api/scorecards/${encodeURIComponent(id)}`);
  return data;
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateScorecard(
  id: string,
  body: Partial<CreateScorecardBody>,
): Promise<ScorecardWithPill> {
  const { data } = await api.patch<ScorecardWithPill>(`/api/scorecards/${encodeURIComponent(id)}`, body);
  return data;
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteScorecard(id: string): Promise<void> {
  await api.delete(`/api/scorecards/${encodeURIComponent(id)}`);
}

// ── Agent attachments ────────────────────────────────────────────────────────

export async function listAgentScorecards(agentId: string): Promise<AgentScorecardAttachment[]> {
  const { data } = await api.get<{ attachments: AgentScorecardAttachment[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/scorecards`,
  );
  return data.attachments;
}

export async function attachScorecard(
  agentId: string,
  scorecardId: string,
  gradingFrequency: 'off' | 'q1' | 'q2' | 'q3' = 'q2',
): Promise<AgentScorecardAttachment> {
  const { data } = await api.post<AgentScorecardAttachment>(
    `/api/agents/${encodeURIComponent(agentId)}/scorecards/attach`,
    { scorecardId, gradingFrequency },
  );
  return data;
}

export async function detachScorecard(agentId: string, scorecardId: string): Promise<void> {
  await api.delete(
    `/api/agents/${encodeURIComponent(agentId)}/scorecards/${encodeURIComponent(scorecardId)}`,
  );
}
