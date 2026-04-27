// Pure helper: from a list of clusters, returns top-N by maxConfidence with
// a hard 200 KB JSON payload cap per spec §9.3.

import type { Cluster } from './clusterFires.js';

const CANDIDATE_CAP = 50;
const PAYLOAD_CAP_BYTES = 200 * 1024; // 200 KB

export interface SelectionResult {
  selected: Cluster[];
  capped: { excessCount: number; capKind: 'candidate' | 'payload' } | null;
}

export function selectTopForTriage(clusters: Cluster[]): SelectionResult {
  // Sort by maxConfidence desc, then totalFires desc as tiebreaker
  const sorted = [...clusters].sort((a, b) => {
    if (b.maxConfidence !== a.maxConfidence) return b.maxConfidence - a.maxConfidence;
    return b.totalFires - a.totalFires;
  });

  const selected: Cluster[] = [];
  let payloadBytes = 0;
  let capKind: 'candidate' | 'payload' | null = null;
  let excessCount = 0;

  for (const cluster of sorted) {
    if (selected.length >= CANDIDATE_CAP) {
      capKind = 'candidate';
      excessCount++;
      continue;
    }
    const clusterJson = JSON.stringify(cluster);
    const clusterBytes = Buffer.byteLength(clusterJson, 'utf8');
    if (payloadBytes + clusterBytes > PAYLOAD_CAP_BYTES) {
      capKind = 'payload';
      excessCount++;
      continue;
    }
    selected.push(cluster);
    payloadBytes += clusterBytes;
  }

  return {
    selected,
    capped: capKind ? { excessCount, capKind } : null,
  };
}
