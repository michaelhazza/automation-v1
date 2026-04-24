/**
 * detectorTypes.ts — Brain Tree OS adoption P4.
 *
 * Type definitions for workspace health audit detectors. Detectors are pure
 * functions: they take a normalised DetectorContext and return zero or more
 * WorkspaceHealthFinding records. Detectors do not query the DB themselves —
 * the impure runner pre-fetches everything.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P4
 */

export type WorkspaceHealthSeverity = 'info' | 'warning' | 'critical';

export type WorkspaceHealthResourceKind =
  | 'agent'
  | 'subaccount_agent'
  | 'automation'
  | 'subaccount'
  | 'org'
  | 'connection';

export interface WorkspaceHealthFinding {
  detector: string;
  severity: WorkspaceHealthSeverity;
  resourceKind: WorkspaceHealthResourceKind;
  resourceId: string;
  resourceLabel: string;
  message: string;
  recommendation: string;
}

export interface DetectorContextAgent {
  id: string;
  name: string;
  status: string;
  lastRunAt: Date | null;
  systemAgentId: string | null;
  defaultSkillSlugs: string[] | null;
}

export interface DetectorContextSubaccountAgent {
  id: string;
  agentId: string;
  subaccountId: string;
  subaccountName: string;
  agentName: string;
  skillSlugs: string[] | null;
  heartbeatEnabled: boolean;
  scheduleCron: string | null;
}

export interface DetectorContextAutomation {
  id: string;
  name: string;
  status: string;
  scope: string;
  automationEngineId: string | null;
  requiredConnections: Array<{ key: string; provider: string; required: boolean }> | null;
}

export interface DetectorContextAutomationConnectionMapping {
  processId: string;
  subaccountId: string;
  subaccountName: string;
  connectionKey: string;
}

export interface DetectorContextSystemAgentLink {
  orgAgentId: string;
  orgAgentName: string;
  systemAgentId: string;
  /**
   * Proxy for "last synced from upstream system agent". The schema has no
   * dedicated last-sync timestamp, so we use the org agent's updatedAt as
   * the heuristic — if a system-managed agent has not been touched in N days,
   * it has plausibly drifted from the upstream system definition.
   */
  updatedAt: Date | null;
}

export interface DetectorContext {
  organisationId: string;
  /** Cutoff for "no recent runs" detector. Defaults to 30 days. */
  noRecentRunsThresholdDays: number;
  /** Cutoff for "system agent link looks stale" detector. Defaults to 60 days. */
  systemAgentStaleThresholdDays: number;
  agents: DetectorContextAgent[];
  subaccountAgents: DetectorContextSubaccountAgent[];
  automations: DetectorContextAutomation[];
  automationConnectionMappings: DetectorContextAutomationConnectionMapping[];
  systemAgentLinks: DetectorContextSystemAgentLink[];
  /** Override for the "now" anchor; tests pin this to a fixed value. */
  nowMs?: number;
}

export type Detector = (ctx: DetectorContext) => WorkspaceHealthFinding[];
