import axios from 'axios';

const api = axios.create({
  baseURL: '',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
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

// Handle 401 responses globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('userRole');
      localStorage.removeItem('activeOrgId');
      localStorage.removeItem('activeOrgName');
      localStorage.removeItem('activeSubaccountId');
      localStorage.removeItem('activeSubaccountName');
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
