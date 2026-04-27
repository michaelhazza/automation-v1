// Pure helper: groups heuristic fire records by (entityKind, entityId).
// Per spec §9.3 clustering — each cluster represents one candidate entity
// with all its associated heuristic fires.

import type { EntityKind } from '../heuristics/types.js';
import type { Evidence } from '../heuristics/types.js';

export interface HeuristicFireRecord {
  fireRowId: string;
  heuristicId: string;
  entityKind: EntityKind;
  entityId: string;
  confidence: number;
  evidence: Evidence;
  firedAt: Date;
}

export interface Cluster {
  entityKind: EntityKind;
  entityId: string;
  fires: HeuristicFireRecord[];
  maxConfidence: number;
  totalFires: number;
}

export function clusterFires(fires: HeuristicFireRecord[]): Cluster[] {
  const map = new Map<string, Cluster>();

  for (const fire of fires) {
    const key = `${fire.entityKind}:${fire.entityId}`;
    let cluster = map.get(key);
    if (!cluster) {
      cluster = {
        entityKind: fire.entityKind,
        entityId: fire.entityId,
        fires: [],
        maxConfidence: 0,
        totalFires: 0,
      };
      map.set(key, cluster);
    }
    cluster.fires.push(fire);
    cluster.totalFires++;
    if (fire.confidence > cluster.maxConfidence) {
      cluster.maxConfidence = fire.confidence;
    }
  }

  return Array.from(map.values());
}
