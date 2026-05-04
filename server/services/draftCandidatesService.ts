// draftCandidatesService — stub implementation for draft rule candidate management.
// No draft_candidates table exists in the schema at the time of this chunk.
// These stubs return empty arrays / no-ops so the routes are wired and the
// client can call them without receiving 404. A future chunk will add the
// persistent table and replace these implementations.

export interface DraftCandidate {
  id: string;
  text: string;
  category: string;
  organisationId: string;
  createdAt: string;
}

export async function listDraftCandidates(_organisationId: string): Promise<DraftCandidate[]> {
  return [];
}

export async function approveDraftCandidate(
  _id: string,
  _organisationId: string,
  _userId: string,
): Promise<{ id: string; status: 'approved' }> {
  return { id: _id, status: 'approved' };
}

export async function rejectDraftCandidate(
  _id: string,
  _organisationId: string,
  _userId: string,
): Promise<{ id: string; status: 'rejected' }> {
  return { id: _id, status: 'rejected' };
}
