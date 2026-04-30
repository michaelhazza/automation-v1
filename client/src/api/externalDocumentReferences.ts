import api from '../lib/api';

export interface ExternalDocumentReference {
  id: string;
  name: string;
  state: 'active' | 'degraded' | 'broken';
  lastFetchedAt: string | null;
  failureReason: string | null;
  canRebind: boolean;
}

export async function attachExternalReference(subaccountId: string, taskId: string, body: {
  connectionId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
}): Promise<ExternalDocumentReference> {
  const res = await api.post(`/api/subaccounts/${subaccountId}/tasks/${taskId}/external-references`, body);
  return res.data;
}

export async function listExternalReferences(subaccountId: string, taskId: string): Promise<ExternalDocumentReference[]> {
  const res = await api.get(`/api/subaccounts/${subaccountId}/tasks/${taskId}/external-references`);
  return res.data;
}

export async function removeExternalReference(subaccountId: string, taskId: string, referenceId: string): Promise<void> {
  await api.delete(`/api/subaccounts/${subaccountId}/tasks/${taskId}/external-references/${referenceId}`);
}

export async function rebindExternalReference(subaccountId: string, taskId: string, referenceId: string, connectionId: string): Promise<ExternalDocumentReference> {
  const res = await api.patch(`/api/subaccounts/${subaccountId}/tasks/${taskId}/external-references/${referenceId}`, { connectionId });
  return res.data;
}

export async function setFailurePolicy(subaccountId: string, taskId: string, fetchFailurePolicy: 'tolerant' | 'strict' | 'best_effort'): Promise<void> {
  await api.patch(`/api/subaccounts/${subaccountId}/tasks/${taskId}/bundle-attachment`, { fetchFailurePolicy });
}

export async function fetchPickerToken(connectionId: string): Promise<{ accessToken: string; pickerApiKey: string; appId: string }> {
  const res = await api.get('/api/integrations/google-drive/picker-token', { params: { connectionId } });
  return res.data;
}

export async function verifyAccess(connectionId: string, fileId: string): Promise<{ ok: boolean; mimeType: string; name: string }> {
  const res = await api.get('/api/integrations/google-drive/verify-access', { params: { connectionId, fileId } });
  return res.data;
}
