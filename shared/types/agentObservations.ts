export const OBSERVATION_TYPES = [
  'learned',
  'detected',
  'decided',
  'flagged',
  'produced',
] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export const OBSERVATION_SOURCE_KINDS = [
  'run_step',
  'retrieval_summary',
  'tool_result',
  'memory_block_insert',
] as const;
export type ObservationSourceKind = (typeof OBSERVATION_SOURCE_KINDS)[number];

export interface AgentObservation {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  runId: string | null;
  eventId: string;
  observationType: ObservationType;
  body: string;
  bodyTruncated: boolean;
  metadata: {
    source_kind: ObservationSourceKind;
    source_id: string;
    [key: string]: unknown;
  };
  supersedesObservationId: string | null;
  isPinned: boolean;
  pinnedBy: string | null;
  pinnedAt: string | null;
  createdAt: string;
  idempotencyKey: string;
}
