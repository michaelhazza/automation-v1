import axios from 'axios';
import type { ActivityItem, ActivityQuery, FilterOptions, InboxItem, RunTraceEvent } from '../../../shared/types/operate';

const api = axios.create({
  baseURL: '',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Attach JWT token and org context to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // For system_admin users, pass the selected active organisation so the backend
  // scopes data to that org rather than the system_admin's own (system) org.
  const userRole = localStorage.getItem('userRole');
  const activeOrgId = localStorage.getItem('activeOrgId');
  if (userRole === 'system_admin' && activeOrgId && !config.headers['X-Organisation-Id']) {
    config.headers['X-Organisation-Id'] = activeOrgId;
  }

  return config;
});

// Handle 401 and 429 responses globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 429) {
      const retryAfterSec = Number(error.response.headers['retry-after'] ?? '60');
      error.retryAfterSec = Number.isFinite(retryAfterSec) ? retryAfterSec : 60;
    }
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('userRole');
      localStorage.removeItem('activeOrgId');
      localStorage.removeItem('activeOrgName');
      localStorage.removeItem('activeSubaccountId');
      localStorage.removeItem('activeSubaccountName');
      localStorage.removeItem('systemAdminOrgOverride');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

// ─── Workspace identity API wrappers (agents-as-employees) ────────────────────

export const getSubaccountWorkspaceConfig = (saId: string) =>
  api.get(`/api/subaccounts/${saId}/workspace`).then(r => r.data);

export const configureWorkspace = (saId: string, body: { backend: string; domain?: string }) =>
  api.post(`/api/subaccounts/${saId}/workspace/configure`, body).then(r => r.data);

export const onboardAgentToWorkspace = (saId: string, body: Record<string, unknown>) =>
  api.post(`/api/subaccounts/${saId}/workspace/onboard`, body).then(r => r.data);

export const suspendAgentIdentity = (agentId: string) =>
  api.post(`/api/agents/${agentId}/identity/suspend`).then(r => r.data);

export const resumeAgentIdentity = (agentId: string) =>
  api.post(`/api/agents/${agentId}/identity/resume`).then(r => r.data);

export const revokeAgentIdentity = (agentId: string, confirmName: string) =>
  api.post(`/api/agents/${agentId}/identity/revoke`, { confirmName }).then(r => r.data);

export const archiveAgentIdentity = (agentId: string) =>
  api.post(`/api/agents/${agentId}/identity/archive`).then(r => r.data);

export const toggleAgentEmailSending = (agentId: string, enabled: boolean) =>
  api.patch(`/api/agents/${agentId}/identity/email-sending`, { enabled }).then(r => r.data);

export const getAgentMailbox = (agentId: string, cursor?: string) =>
  api.get(`/api/agents/${agentId}/mailbox`, { params: cursor ? { cursor } : {} }).then(r => r.data);

export const sendAgentEmail = (agentId: string, body: Record<string, unknown>) =>
  api.post(`/api/agents/${agentId}/mailbox/send`, body).then(r => r.data);

export const getAgentMailboxThread = (agentId: string, threadId: string) =>
  api.get(`/api/agents/${agentId}/mailbox/threads/${threadId}`).then(r => r.data);

export const getAgentCalendar = (agentId: string, from: string, to: string) =>
  api.get(`/api/agents/${agentId}/calendar`, { params: { from, to } }).then(r => r.data);

export const createAgentCalendarEvent = (agentId: string, body: Record<string, unknown>) =>
  api.post(`/api/agents/${agentId}/calendar/events`, body).then(r => r.data);

export const respondToAgentCalendarEvent = (agentId: string, eventId: string, response: string) =>
  api.post(`/api/agents/${agentId}/calendar/events/${eventId}/respond`, { response }).then(r => r.data);

export const getAgentIdentity = (agentId: string) =>
  api.get(`/api/agents/${agentId}/identity`).then(r => r.data);

export const migrateWorkspace = (saId: string, body: {
  targetBackend: 'synthetos_native' | 'google_workspace';
  migrationRequestId: string;
}) => api.post(`/api/subaccounts/${saId}/workspace/migrate`, body).then(r => r.data);

export const getMigrationStatus = (saId: string, batchId: string) =>
  api.get(`/api/subaccounts/${saId}/workspace/migrate/${batchId}`).then(r => r.data);

// ─── Operate surface API wrappers (C3 — ui-consolidation-operate) ─────────────

/**
 * Fetch the org-level activity feed.
 * The server wraps the payload in { data: { items, nextCursor, filterOptions }, serverTimestamp }
 * so we unwrap to the inner data shape here.
 */
export const fetchActivity = (
  query: ActivityQuery,
): Promise<{ items: ActivityItem[]; nextCursor: string | null; filterOptions: FilterOptions }> => {
  const params: Record<string, unknown> = { ...query };
  // Collapse array-valued params to comma-separated strings (matches server parseFilters)
  for (const key of ['type', 'status', 'actor', 'subaccount', 'severity'] as const) {
    if (Array.isArray(params[key])) {
      params[key] = (params[key] as string[]).join(',');
    }
  }
  return api.get('/api/activity', { params }).then(r => r.data.data);
};

/**
 * Fetch the band-filtered inbox list.
 * Returns { band, items, nextCursor } directly.
 */
export const fetchInbox = ({
  band,
  q,
}: {
  band?: 'high' | 'needs_action' | 'previous';
  q?: string;
}): Promise<{ band: string | null; items: InboxItem[]; nextCursor: string | null }> =>
  api.get('/api/inbox', { params: { band, q } }).then(r => r.data);

/** Approve a review_item or approval-kind inbox item. */
export const inboxApprove = (
  id: string,
  kind: string,
): Promise<{ ok: boolean; alreadyApplied?: boolean }> =>
  api.post(`/api/inbox/${id}/approve`, { kind }).then(r => r.data);

/** Reject a review_item or approval-kind inbox item. */
export const inboxReject = (
  id: string,
  kind: string,
  reason?: string,
): Promise<{ ok: boolean; alreadyApplied?: boolean }> =>
  api.post(`/api/inbox/${id}/reject`, { kind, reason }).then(r => r.data);

/** Archive a single inbox item. */
export const inboxArchive = (
  id: string,
  kind: string,
): Promise<{ ok: boolean; alreadyApplied?: boolean }> =>
  api.post(`/api/inbox/${id}/archive`, { kind }).then(r => r.data);

/**
 * Fetch the run trace for a given agent run.
 * C5b will wire up the real role-aware projection endpoint.
 * toolCallsLog entries have a different shape from RunTraceEvent and must not be cast.
 */
export const fetchRunTrace = (
  _runId: string,
): Promise<{ events: RunTraceEvent[] }> =>
  Promise.resolve({ events: [] as RunTraceEvent[] });
