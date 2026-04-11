/**
 * processBrokenConnectionMapping.ts — Brain Tree OS adoption P4 detector.
 *
 * For each (processId, subaccountId) pair where at least one row exists in
 * processConnectionMappings, the detector emits a critical finding if any
 * required key from processes[processId].requiredConnections has no row in
 * that pair's mapping set. One finding per (processId, subaccountId) pair.
 */

import type { Detector, WorkspaceHealthFinding } from '../detectorTypes';

export const processBrokenConnectionMapping: Detector = (ctx) => {
  const findings: WorkspaceHealthFinding[] = [];

  // Index processes by id for O(1) lookup of required connections
  const processById = new Map<string, typeof ctx.processes[number]>();
  for (const p of ctx.processes) processById.set(p.id, p);

  // Group mappings by (processId, subaccountId)
  type Pair = { processId: string; subaccountId: string; subaccountName: string; keys: Set<string> };
  const pairs = new Map<string, Pair>();
  for (const m of ctx.processConnectionMappings) {
    const key = `${m.processId}:${m.subaccountId}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { processId: m.processId, subaccountId: m.subaccountId, subaccountName: m.subaccountName, keys: new Set() };
      pairs.set(key, pair);
    }
    pair.keys.add(m.connectionKey);
  }

  for (const pair of pairs.values()) {
    const proc = processById.get(pair.processId);
    if (!proc || !proc.requiredConnections) continue;

    const missing = proc.requiredConnections
      .filter((slot) => slot.required && !pair.keys.has(slot.key))
      .map((slot) => slot.key);

    if (missing.length === 0) continue;

    findings.push({
      detector: 'process.broken_connection_mapping',
      severity: 'critical',
      resourceKind: 'process',
      resourceId: pair.processId,
      resourceLabel: `${proc.name} @ ${pair.subaccountName}`,
      message: `Process is partially configured for this subaccount — missing required connections: ${missing.join(', ')}.`,
      recommendation: 'Open the subaccount integration page and map a connection for each missing slot.',
    });
  }

  return findings;
};
