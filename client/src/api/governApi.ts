import api from '../lib/api';
import type {
  KnowledgeListQuery, KnowledgeListResponse, KnowledgeEntry,
  LedgerQuery, LedgerResponse,
  CapsResponse, SpendInsights, SpendTrends,
  ConnectionsQuery, ConnectionsResponse,
  ConnectionUsage, ConnectionTestResponse,
} from '../../../shared/types/govern.js';

function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) { for (const item of v) u.append(k, String(item)); }
    else { u.set(k, String(v)); }
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

// ── Knowledge ──────────────────────────────────────────────────────────────
export const listKnowledge = (q: KnowledgeListQuery): Promise<KnowledgeListResponse> =>
  api.get(`/api/knowledge${qs(q as Record<string, unknown>)}`).then(r => r.data);

export const approveKnowledge = (id: string): Promise<{ alreadyApplied: boolean }> =>
  api.post(`/api/knowledge/${encodeURIComponent(id)}/approve`).then(r => r.data);

export const rejectKnowledge = (id: string): Promise<{ alreadyApplied: boolean }> =>
  api.post(`/api/knowledge/${encodeURIComponent(id)}/reject`).then(r => r.data);

export const overrideKnowledge = (
  id: string,
  body: string,
  expectedEtag: string,
): Promise<
  | { status: 'in_use'; etag: string; created: boolean }
  | { error: 'invalid_state_transition'; currentStatus: KnowledgeEntry['status'] }
  | { error: 'etag_mismatch'; currentEtag: string }
> =>
  api.post(`/api/knowledge/${encodeURIComponent(id)}/override`, { body, expectedEtag }).then(r => r.data);

// ── Spending ───────────────────────────────────────────────────────────────
export const listLedger = (q: LedgerQuery): Promise<LedgerResponse> =>
  api.get(`/api/spend/ledger${qs(q as Record<string, unknown>)}`).then(r => r.data);

export const getCaps = (scope: 'workspace' | 'org', subaccountId?: string): Promise<CapsResponse> =>
  api.get(`/api/spend/caps?scope=${scope}${subaccountId ? `&subaccountId=${encodeURIComponent(subaccountId)}` : ''}`).then(r => r.data);

export const getSpendInsights = (): Promise<SpendInsights> =>
  api.get('/api/spend/insights').then(r => r.data);

export const getSpendTrends = (): Promise<SpendTrends> =>
  api.get('/api/spend/trends').then(r => r.data);

// ── Connections ────────────────────────────────────────────────────────────
export const listConnections = (q: ConnectionsQuery): Promise<ConnectionsResponse> =>
  api.get(`/api/connections${qs(q as Record<string, unknown>)}`).then(r => r.data);

export const getConnectionUsage = (id: string): Promise<ConnectionUsage> =>
  api.get(`/api/connections/${encodeURIComponent(id)}/usage`).then(r => r.data);

export const testConnection = (id: string): Promise<ConnectionTestResponse> =>
  api.post(`/api/connections/${encodeURIComponent(id)}/test`).then(r => r.data);

export const disconnectConnection = (
  id: string,
): Promise<{ success: true; alreadyDisconnected: boolean; kind: 'integration' | 'mcp' }> =>
  api.post(`/api/connections/${encodeURIComponent(id)}/disconnect`).then(r => r.data);
