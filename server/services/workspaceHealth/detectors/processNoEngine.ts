/**
 * processNoEngine.ts — Brain Tree OS adoption P4 detector.
 *
 * Triggers a critical finding when a non-system process has no
 * workflowEngineId set. Org and subaccount processes need an engine to
 * execute; without one the process is unrunnable.
 */

import type { Detector, WorkspaceHealthFinding } from '../detectorTypes';

export const processNoEngine: Detector = (ctx) => {
  const findings: WorkspaceHealthFinding[] = [];
  for (const p of ctx.processes) {
    if (p.scope === 'system') continue;
    if (p.workflowEngineId) continue;

    findings.push({
      detector: 'process.no_engine',
      severity: 'critical',
      resourceKind: 'process',
      resourceId: p.id,
      resourceLabel: p.name,
      message: 'Process has no workflow engine assigned and cannot execute.',
      recommendation: 'Open the process detail page and select an engine, or archive the process.',
    });
  }
  return findings;
};
