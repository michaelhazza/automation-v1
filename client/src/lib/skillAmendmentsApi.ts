import api from './api.js';
import type {
  AmendmentListItem,
  AmendmentDetail,
  RejectReason,
  RetirementReason,
  IncidentSeverity,
} from '../../../shared/types/skillAmendments.js';

export async function listPendingAmendments(subaccountId: string): Promise<AmendmentListItem[]> {
  const res = await api.get<AmendmentListItem[]>(`/api/subaccounts/${subaccountId}/skill-amendments`);
  return res.data;
}

export async function getAmendment(subaccountId: string, id: string): Promise<AmendmentDetail> {
  const res = await api.get<AmendmentDetail>(`/api/subaccounts/${subaccountId}/skill-amendments/${id}`);
  return res.data;
}

export async function acceptAmendment(subaccountId: string, id: string): Promise<void> {
  await api.post(`/api/subaccounts/${subaccountId}/skill-amendments/${id}/accept`);
}

export async function acceptAfterEdit(subaccountId: string, id: string, body: string): Promise<void> {
  await api.post(`/api/subaccounts/${subaccountId}/skill-amendments/${id}/accept-after-edit`, { body });
}

export async function rejectAmendment(
  subaccountId: string,
  id: string,
  rejectReason: RejectReason,
): Promise<void> {
  await api.post(`/api/subaccounts/${subaccountId}/skill-amendments/${id}/reject`, { rejectReason });
}

export async function retireAmendment(
  subaccountId: string,
  id: string,
  retirementReason: RetirementReason,
  incidentSeverity?: IncidentSeverity,
): Promise<void> {
  await api.post(`/api/subaccounts/${subaccountId}/skill-amendments/${id}/retire`, {
    retirementReason,
    ...(incidentSeverity ? { incidentSeverity } : {}),
  });
}
