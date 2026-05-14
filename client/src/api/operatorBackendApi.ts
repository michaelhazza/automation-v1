import api from '../lib/api';

// ── Shared discriminated result type ─────────────────────────────────────────

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; status: number; body?: unknown } };

function extractError(err: unknown): { code: string; status: number; body?: unknown } {
  const e = err as { response?: { status?: number; data?: unknown } };
  const status = e.response?.status ?? 0;
  const body = e.response?.data;
  const code =
    typeof body === 'object' && body !== null && 'errorCode' in body
      ? String((body as { errorCode: unknown }).errorCode)
      : 'REQUEST_FAILED';
  return { code, status, body };
}

// ── Progress ─────────────────────────────────────────────────────────────────

export interface OperatorRunProgress {
  operatorRunId: string;
  chainSeq: number;
  status: string;
  lastProgressAt: string | null;
  stepCount: number;
  summary?: string;
}

// R2-F1: subaccountId is required in the URL path so dual-GUC RLS is set
// before the server reads the operator_runs table.
export async function getOperatorRunProgress(
  subaccountId: string,
  operatorRunId: string,
): Promise<ApiResult<OperatorRunProgress>> {
  try {
    const r = await api.get<OperatorRunProgress>(
      `/api/subaccounts/${encodeURIComponent(subaccountId)}/operator-sessions/${encodeURIComponent(operatorRunId)}/progress`,
    );
    return { ok: true, data: r.data };
  } catch (err) {
    return { ok: false, error: extractError(err) };
  }
}

// ── Operator settings ─────────────────────────────────────────────────────────

export interface OperatorSettings {
  sessionSoftCapMinutes: number;
  autoExtendGraceMinutes: number;
  maxChainLength: number;
  maxWallClockPerTaskDays: number;
  perTaskBudgetCapMinutes: number;
  concurrentOperatorSessionsCap: number;
  settingsVersion: number;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

export interface OperatorSettingsWithEtag {
  settings: OperatorSettings;
  etag: string;
}

export async function getOperatorSettings(
  subaccountId: string,
): Promise<ApiResult<OperatorSettingsWithEtag>> {
  try {
    const r = await api.get<OperatorSettings>(
      `/api/subaccounts/${encodeURIComponent(subaccountId)}/operator-settings`,
    );
    const etag = String(r.headers['etag'] ?? '').replace(/^"|"$/g, '');
    return { ok: true, data: { settings: r.data, etag } };
  } catch (err) {
    return { ok: false, error: extractError(err) };
  }
}

export type OperatorSettingsPatch = Partial<{
  sessionSoftCapMinutes: number;
  autoExtendGraceMinutes: number;
  maxChainLength: number;
  maxWallClockPerTaskDays: number;
  perTaskBudgetCapMinutes: number;
  concurrentOperatorSessionsCap: number;
}>;

export async function updateOperatorSettings(
  subaccountId: string,
  body: OperatorSettingsPatch,
  etag: string,
): Promise<ApiResult<OperatorSettingsWithEtag>> {
  try {
    const r = await api.patch<OperatorSettings>(
      `/api/subaccounts/${encodeURIComponent(subaccountId)}/operator-settings`,
      body,
      { headers: { 'If-Match': `"${etag}"` } },
    );
    const newEtag = String(r.headers['etag'] ?? '').replace(/^"|"$/g, '');
    return { ok: true, data: { settings: r.data, etag: newEtag } };
  } catch (err) {
    return { ok: false, error: extractError(err) };
  }
}

// ── Task actions ──────────────────────────────────────────────────────────────

export async function retryChainFailure(agentRunId: string): Promise<ApiResult<{ ok: true }>> {
  try {
    const r = await api.post<{ ok: true }>(
      `/api/operator-tasks/${encodeURIComponent(agentRunId)}/retry-chain-failure`,
    );
    return { ok: true, data: r.data };
  } catch (err) {
    return { ok: false, error: extractError(err) };
  }
}

export async function extendBudget(
  agentRunId: string,
  extensionMinutes: number,
): Promise<ApiResult<{ ok: true }>> {
  try {
    const r = await api.post<{ ok: true }>(
      `/api/operator-tasks/${encodeURIComponent(agentRunId)}/extend-budget`,
      { extensionMinutes },
    );
    return { ok: true, data: r.data };
  } catch (err) {
    return { ok: false, error: extractError(err) };
  }
}

export async function freshProfileRestart(
  agentRunId: string,
): Promise<ApiResult<{ ok: true; priorAttemptNumber: number; newAttemptNumber: number }>> {
  try {
    const r = await api.post<{ ok: true; priorAttemptNumber: number; newAttemptNumber: number }>(
      `/api/operator-tasks/${encodeURIComponent(agentRunId)}/fresh-profile-restart`,
    );
    return { ok: true, data: r.data };
  } catch (err) {
    return { ok: false, error: extractError(err) };
  }
}

export async function refreshCredential(agentRunId: string): Promise<ApiResult<{ ok: true }>> {
  try {
    const r = await api.post<{ ok: true }>(
      `/api/operator-tasks/${encodeURIComponent(agentRunId)}/refresh-credential`,
    );
    return { ok: true, data: r.data };
  } catch (err) {
    return { ok: false, error: extractError(err) };
  }
}

export async function extendDebugRetention(agentRunId: string): Promise<ApiResult<{ ok: true }>> {
  try {
    const r = await api.post<{ ok: true }>(
      `/api/operator-tasks/${encodeURIComponent(agentRunId)}/extend-debug-retention`,
    );
    return { ok: true, data: r.data };
  } catch (err) {
    return { ok: false, error: extractError(err) };
  }
}
