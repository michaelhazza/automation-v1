import { OBSERVATION_TYPES, ObservationType, OBSERVATION_SOURCE_KINDS, ObservationSourceKind } from '../../shared/types/agentObservations';

export const OBSERVATION_BODY_MAX_BYTES = 8192;
export const SUPERSESSION_DEPTH_LIMIT = 32;

export interface ValidateObservationBodyResult {
  ok: boolean;
  byteLength: number;
}

/** Measures body using UTF-8 byte length (Buffer.byteLength), NOT string.length */
export function validateObservationBody(body: string): ValidateObservationBodyResult {
  const byteLength = Buffer.byteLength(body, 'utf8');
  return { ok: byteLength <= OBSERVATION_BODY_MAX_BYTES, byteLength };
}

export interface ClassifyObservationResult {
  type: ObservationType | null;
  sourceKind: ObservationSourceKind | null;
}

/** Classifies a raw event into an observation type and source kind */
export function classifyObservation(rawEventType: string, metadata?: Record<string, unknown>): ClassifyObservationResult {
  const sourceKind = (metadata?.source_kind as ObservationSourceKind | undefined) ?? null;
  // Map raw event types to observation types
  const typeMap: Record<string, ObservationType> = {
    'knowledge_learned': 'learned',
    'anomaly_detected': 'detected',
    'decision_made': 'decided',
    'issue_flagged': 'flagged',
    'artifact_produced': 'produced',
    'observation_emitted': 'learned', // default for explicit observation events
  };
  const type = typeMap[rawEventType] ?? null;
  const validSourceKind = sourceKind && (OBSERVATION_SOURCE_KINDS as ReadonlyArray<string>).includes(sourceKind)
    ? sourceKind as ObservationSourceKind
    : null;
  return { type, sourceKind: validSourceKind };
}

export interface ObservationRow {
  id: string;
  supersedesObservationId: string | null;
}

/**
 * In-memory DFS cycle guard for the supersession chain.
 * Real implementation in Chunk 3 reads rows with SELECT ... FOR UPDATE.
 * Returns true if inserting a row with supersedesObservationId would create a cycle.
 */
export function detectSupersessionCycle(
  rows: ObservationRow[],
  candidateParentId: string | null,
): boolean {
  if (!candidateParentId) return false;

  const rowMap = new Map(rows.map(r => [r.id, r]));
  const visited = new Set<string>();
  let current: string | null = candidateParentId;
  let depth = 0;

  while (current !== null) {
    if (depth >= SUPERSESSION_DEPTH_LIMIT) return true; // depth bound exceeded → treat as cycle
    if (visited.has(current)) return true; // back-edge → cycle
    visited.add(current);

    const row = rowMap.get(current);
    if (!row) break; // chain ended cleanly
    current = row.supersedesObservationId;
    depth++;
  }

  return false;
}
