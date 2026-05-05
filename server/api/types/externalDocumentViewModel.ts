import type { AttachmentState } from '../../db/schema/referenceDocuments.js';
import type { FetchFailureReason } from '../../db/schema/documentFetchEvents.js';
import { EXTERNAL_DOC_MAX_STALENESS_MINUTES } from '../../lib/constants.js';

export interface ExternalDocumentViewModel {
  id: string;
  name: string;
  state: AttachmentState;
  lastFetchedAt: string | null;
  failureReason: FetchFailureReason | null;
  canRebind: boolean;
}

export interface MapperInput {
  id: string;
  externalFileName: string | null;
  attachmentState: AttachmentState | null;
  lastFetchEvent: { fetchedAt: Date; failureReason: FetchFailureReason | null } | null;
  now?: Date;
}

export function toExternalDocumentViewModel(row: MapperInput): ExternalDocumentViewModel {
  const now = row.now ?? new Date();
  const state = deriveState(row, now);
  return {
    id: row.id,
    name: row.externalFileName ?? '(untitled)',
    state,
    lastFetchedAt: row.lastFetchEvent ? row.lastFetchEvent.fetchedAt.toISOString() : null,
    failureReason: row.lastFetchEvent?.failureReason ?? null,
    canRebind: state === 'broken',
  };
}

const STATE_SEVERITY: Record<AttachmentState, number> = { active: 0, degraded: 1, broken: 2 };

function maxState(a: AttachmentState, b: AttachmentState): AttachmentState {
  return STATE_SEVERITY[a] >= STATE_SEVERITY[b] ? a : b;
}

function deriveState(row: MapperInput, now: Date): AttachmentState {
  const evt = row.lastFetchEvent;
  const persisted: AttachmentState = row.attachmentState ?? 'active';
  if (!evt) return persisted;
  if (evt.failureReason === null) return 'active';
  const ageMs = now.getTime() - evt.fetchedAt.getTime();
  const computed: AttachmentState = ageMs <= EXTERNAL_DOC_MAX_STALENESS_MINUTES * 60_000 ? 'degraded' : 'broken';
  return maxState(persisted, computed);
}
