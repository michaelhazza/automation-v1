import api from '../api';
import { isAxiosError } from 'axios';
import type {
  AgentListItem,
  AgentFull,
  AgentConfigurePatch,
  AgentBehaviourPatch,
  AgentPersonalityPatch,
  AgentBudgetPatch,
  SkillBindingPayload,
  DataSourceBindingPayload,
  TriggerBindingPayload,
  AgentTestRequest,
  AgentTestAccepted,
  AgentTestResult,
  RecurringTasksQuery,
  RecurringTasksResponse,
  ApiProject,
  ProjectPatch,
  EtagMismatchPayload,
} from '../../../../shared/types/build';

export class EtagMismatchError extends Error {
  constructor(public readonly payload: EtagMismatchPayload) {
    super(payload.message ?? 'Agent changed since last load');
  }
  get currentEtag(): string { return this.payload.currentEtag; }
}

// Helper: wrap a write call with ETag error surfacing
async function etagWrite<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 409) {
      const data = err.response.data as Record<string, unknown>;
      if (data?.error && (data.error as Record<string, unknown>)?.code === 'ETAG_MISMATCH') {
        throw new EtagMismatchError({
          errorCode: 'ETAG_MISMATCH',
          currentEtag: data.currentEtag as string,
          message: (data.error as Record<string, unknown>)?.message as string | undefined,
        });
      }
    }
    throw err;
  }
}

export const buildApi = {
  // ── Agents ─────────────────────────────────────────────────────────────
  async listAgents(params?: { scope?: string; q?: string }): Promise<AgentListItem[]> {
    const { data } = await api.get<AgentListItem[]>('/api/agents', { params });
    return data;
  },

  async getAgentFull(agentId: string): Promise<AgentFull> {
    const { data } = await api.get<AgentFull>(`/api/agents/${agentId}/full`);
    return data;
  },

  async patchAgentConfigure(agentId: string, body: AgentConfigurePatch, ifMatch: string): Promise<AgentFull> {
    return etagWrite(() =>
      api.patch<AgentFull>(`/api/agents/${agentId}/configure`, body, { headers: { 'If-Match': ifMatch } })
        .then(r => r.data)
    );
  },

  async patchAgentBehaviour(agentId: string, body: AgentBehaviourPatch, ifMatch: string): Promise<AgentFull> {
    return etagWrite(() =>
      api.patch<AgentFull>(`/api/agents/${agentId}/behaviour`, body, { headers: { 'If-Match': ifMatch } })
        .then(r => r.data)
    );
  },

  async patchAgentPersonality(agentId: string, body: AgentPersonalityPatch, ifMatch: string): Promise<AgentFull> {
    return etagWrite(() =>
      api.patch<AgentFull>(`/api/agents/${agentId}/personality`, body, { headers: { 'If-Match': ifMatch } })
        .then(r => r.data)
    );
  },

  async putAgentSkills(agentId: string, skills: SkillBindingPayload[], ifMatch: string, force = false): Promise<AgentFull> {
    return etagWrite(() =>
      api.put<AgentFull>(`/api/agents/${agentId}/skills`, skills, {
        headers: { 'If-Match': ifMatch },
        params: force ? { force: 'true' } : {},
      }).then(r => r.data)
    );
  },

  async putAgentDataSources(agentId: string, sources: DataSourceBindingPayload[], ifMatch: string, force = false): Promise<AgentFull> {
    return etagWrite(() =>
      api.put<AgentFull>(`/api/agents/${agentId}/data-sources`, sources, {
        headers: { 'If-Match': ifMatch },
        params: force ? { force: 'true' } : {},
      }).then(r => r.data)
    );
  },

  async putAgentTriggers(agentId: string, triggers: TriggerBindingPayload[], ifMatch: string, force = false): Promise<AgentFull> {
    return etagWrite(() =>
      api.put<AgentFull>(`/api/agents/${agentId}/triggers`, triggers, {
        headers: { 'If-Match': ifMatch },
        params: force ? { force: 'true' } : {},
      }).then(r => r.data)
    );
  },

  async patchAgentBudget(agentId: string, body: AgentBudgetPatch, ifMatch: string): Promise<AgentFull> {
    return etagWrite(() =>
      api.patch<AgentFull>(`/api/agents/${agentId}/budget`, body, { headers: { 'If-Match': ifMatch } })
        .then(r => r.data)
    );
  },

  // ── Test runs ──────────────────────────────────────────────────────────
  async testRun(agentId: string, body: AgentTestRequest): Promise<AgentTestAccepted> {
    const { data } = await api.post<AgentTestAccepted>(`/api/agents/${agentId}/test`, body);
    return data;
  },

  async getAgentRunForTest(runId: string): Promise<AgentTestResult> {
    const { data } = await api.get<AgentTestResult>(`/api/agent-runs/${runId}`, { params: { shape: 'test' } });
    return data;
  },

  // ── Recurring tasks ────────────────────────────────────────────────────
  async listRecurringTasks(query?: RecurringTasksQuery): Promise<RecurringTasksResponse> {
    const { data } = await api.get<RecurringTasksResponse>('/api/recurring-tasks', { params: query });
    return data;
  },

  // ── Projects ──────────────────────────────────────────────────────────
  async getProject(projectId: string): Promise<ApiProject> {
    const { data } = await api.get<ApiProject>(`/api/projects/${projectId}`);
    return data;
  },

  async patchProject(projectId: string, body: ProjectPatch): Promise<ApiProject> {
    const { data } = await api.patch<ApiProject>(`/api/projects/${projectId}`, body);
    return data;
  },
};
