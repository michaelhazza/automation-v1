// Pure helper: from a list of clusters, returns top-N by maxConfidence with
// a hard 200 KB JSON payload cap per spec §9.3.
// Caps are env-configurable per spec §9.10 (SYSTEM_MONITOR_SWEEP_CANDIDATE_CAP,
// SYSTEM_MONITOR_SWEEP_PAYLOAD_CAP_KB) with defaults 50 / 200 KB.

import type { Cluster } from './clusterFires.js';

const DEFAULT_CANDIDATE_CAP = 50;
const DEFAULT_PAYLOAD_CAP_KB = 200;

function resolveCandidateCap(): number {
  const raw = process.env.SYSTEM_MONITOR_SWEEP_CANDIDATE_CAP;
  if (!raw) return DEFAULT_CANDIDATE_CAP;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CANDIDATE_CAP;
}

function resolvePayloadCapBytes(): number {
  const raw = process.env.SYSTEM_MONITOR_SWEEP_PAYLOAD_CAP_KB;
  if (!raw) return DEFAULT_PAYLOAD_CAP_KB * 1024;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n * 1024 : DEFAULT_PAYLOAD_CAP_KB * 1024;
}

export interface SelectionResult {
  selected: Cluster[];
  capped: { excessCount: number; capKind: 'candidate' | 'payload' } | null;
}

export function selectTopForTriage(clusters: Cluster[]): SelectionResult {
  const candidateCap = resolveCandidateCap();
  const payloadCapBytes = resolvePayloadCapBytes();

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
    if (selected.length >= candidateCap) {
      capKind = 'candidate';
      excessCount++;
      continue;
    }
    const clusterJson = JSON.stringify(cluster);
    const clusterBytes = Buffer.byteLength(clusterJson, 'utf8');
    if (payloadBytes + clusterBytes > payloadCapBytes) {
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
