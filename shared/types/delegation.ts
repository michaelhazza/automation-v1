// Shared types for Hierarchical Agent Delegation (Paperclip Hierarchy spec §4).
// TypeScript-first: Drizzle schemas and service validators import from here.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Delegation Scope
// ---------------------------------------------------------------------------

export const DELEGATION_SCOPE_VALUES = ['children', 'descendants', 'subaccount'] as const;

export type DelegationScope = (typeof DELEGATION_SCOPE_VALUES)[number];

export const DelegationScopeSchema = z.enum(DELEGATION_SCOPE_VALUES);

// ---------------------------------------------------------------------------
// Delegation Direction
// ---------------------------------------------------------------------------

export const DELEGATION_DIRECTION_VALUES = ['down', 'up', 'lateral'] as const;

export type DelegationDirection = (typeof DELEGATION_DIRECTION_VALUES)[number];

export const DelegationDirectionSchema = z.enum(DELEGATION_DIRECTION_VALUES);

// ---------------------------------------------------------------------------
// Error-code string constants (INV-2)
// ---------------------------------------------------------------------------

export const DELEGATION_OUT_OF_SCOPE = 'delegation_out_of_scope' as const;
export const CROSS_SUBTREE_NOT_PERMITTED = 'cross_subtree_not_permitted' as const;
export const HIERARCHY_CONTEXT_MISSING = 'hierarchy_context_missing' as const;

// ---------------------------------------------------------------------------
// HierarchyContext — describes an agent's position in the hierarchy tree
// ---------------------------------------------------------------------------

export interface HierarchyContext {
  agentId: string;
  parentId: string | null;
  childIds: string[];
  rootId: string;
  depth: number;
}

// ---------------------------------------------------------------------------
// DelegationOutcome — mirrors the delegation_outcomes DB table shape
// ---------------------------------------------------------------------------

export interface DelegationOutcome {
  id: string;
  organisationId: string;
  subaccountId: string;
  runId: string;
  callerAgentId: string;
  targetAgentId: string;
  delegationScope: DelegationScope;
  outcome: 'accepted' | 'rejected';
  /** Required when outcome = 'rejected', null when outcome = 'accepted'. */
  reason: string | null;
  delegationDirection: DelegationDirection;
  createdAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Delegation Graph — spec §7.2
// ---------------------------------------------------------------------------

export interface DelegationGraphNode {
  runId: string;
  agentId: string;
  agentName: string;
  isSubAgent: boolean;
  delegationScope: 'children' | 'descendants' | 'subaccount' | null;
  hierarchyDepth: number | null;
  delegationDirection: 'down' | 'up' | 'lateral' | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}

export type DelegationEdgeKind = 'spawn' | 'handoff';

export interface DelegationGraphEdge {
  parentRunId: string;
  childRunId: string;
  kind: DelegationEdgeKind;
}

export interface DelegationGraphResponse {
  rootRunId: string;
  nodes: DelegationGraphNode[];
  edges: DelegationGraphEdge[];
  /** true if fan-out exceeded `depthLimit` levels */
  truncated: boolean;
  /**
   * The server-side depth bound applied when walking the graph (MAX_DEPTH_BOUND).
   * Surfaced to the client so the UI can render the limit without duplicating
   * the constant — if the backend bound changes, the UI tracks automatically.
   */
  depthLimit: number;
}
