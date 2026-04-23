/**
 * Pure validation helpers for write delegation skills (spawn_sub_agents, reassign_task).
 * No DB / IO — every function takes inputs and returns outputs.
 *
 * Spec: tasks/builds/paperclip-hierarchy/plan.md §4 (INV-1–INV-4), Chunk 4a.
 * Tested in:
 *   server/services/__tests__/skillExecutor.spawnSubAgents.test.ts
 *   server/services/__tests__/skillExecutor.reassignTask.test.ts
 */

import type { HierarchyContext } from '../../shared/types/delegation.js';
import type { DelegationScope } from '../../shared/types/delegation.js';

// ---------------------------------------------------------------------------
// resolveWriteSkillScope
// ---------------------------------------------------------------------------

/**
 * Resolves the effective DelegationScope for write skills.
 *
 * Adaptive default: 'children' if the caller has direct reports, else 'subaccount'.
 *
 * Note: spawn_sub_agents rejects 'subaccount' after resolution (caller's responsibility).
 * reassign_task accepts all three values.
 */
export function resolveWriteSkillScope(input: {
  rawScope: unknown;
  hierarchy: Readonly<HierarchyContext>;
}): DelegationScope {
  const { rawScope, hierarchy } = input;
  if (rawScope === 'children' || rawScope === 'descendants' || rawScope === 'subaccount') {
    return rawScope;
  }
  return hierarchy.childIds.length > 0 ? 'children' : 'subaccount';
}

// ---------------------------------------------------------------------------
// classifySpawnTargets
// ---------------------------------------------------------------------------

/**
 * Classifies a list of proposed spawn target subaccountAgentIds as
 * accepted (in-scope) or rejected (out-of-scope) given the effective scope.
 *
 * Only called when effectiveScope is 'children' or 'descendants'.
 * If effectiveScope === 'subaccount', the caller rejects before reaching this.
 */
export function classifySpawnTargets(input: {
  proposedSubaccountAgentIds: string[];
  effectiveScope: 'children' | 'descendants';
  childIds: string[];
  descendantIds: string[];
}): { accepted: string[]; rejected: string[] } {
  const inScopeSet = new Set(
    input.effectiveScope === 'children' ? input.childIds : input.descendantIds
  );
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const id of input.proposedSubaccountAgentIds) {
    if (inScopeSet.has(id)) accepted.push(id);
    else rejected.push(id);
  }
  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// computeReassignDirection
// ---------------------------------------------------------------------------

/**
 * Computes the delegation direction for a reassign target.
 *
 * Direction rules (applied in order):
 * 1. Target's subaccountAgentId === hierarchy.parentId → 'up'
 * 2. Target's subaccountAgentId in childIds or descendantIds → 'down'
 * 3. Otherwise → 'lateral'
 */
export function computeReassignDirection(input: {
  targetSubaccountAgentId: string;
  parentId: string | null;
  childIds: string[];
  descendantIds: string[];
}): 'up' | 'down' | 'lateral' {
  if (input.parentId !== null && input.targetSubaccountAgentId === input.parentId) return 'up';
  if (input.childIds.includes(input.targetSubaccountAgentId)) return 'down';
  if (input.descendantIds.includes(input.targetSubaccountAgentId)) return 'down';
  return 'lateral';
}

// ---------------------------------------------------------------------------
// validateReassignScope
// ---------------------------------------------------------------------------

/**
 * Validates whether a reassign target is in-scope per effectiveScope.
 *
 * IMPORTANT: The upward-escalation special case (target === parentId → always valid)
 * MUST be checked by the caller BEFORE calling this function. This function
 * does NOT short-circuit for upward escalation — it treats the target as any
 * other candidate subject to the active scope.
 *
 * Returns { valid: true } or { valid: false, errorCode: ... }
 */
export function validateReassignScope(input: {
  targetSubaccountAgentId: string;
  effectiveScope: DelegationScope;
  childIds: string[];
  descendantIds: string[];
  isCallerRoot: boolean;
}): { valid: true } | { valid: false; errorCode: 'delegation_out_of_scope' | 'cross_subtree_not_permitted' } {
  if (input.effectiveScope === 'subaccount') {
    if (input.isCallerRoot) return { valid: true };
    return { valid: false, errorCode: 'cross_subtree_not_permitted' };
  }
  const inScope = input.effectiveScope === 'children'
    ? input.childIds.includes(input.targetSubaccountAgentId)
    : input.descendantIds.includes(input.targetSubaccountAgentId);
  if (!inScope) return { valid: false, errorCode: 'delegation_out_of_scope' };
  return { valid: true };
}

// ---------------------------------------------------------------------------
// evaluateSpawnPreconditions
// ---------------------------------------------------------------------------

export const MAX_HANDOFF_DEPTH_SPAWN = 5; // mirrors MAX_HANDOFF_DEPTH in skillExecutor.ts

/**
 * Validates pre-conditions for executeSpawnSubAgents before any DB work.
 * Pure — takes all inputs, returns a verdict.
 *
 * Covers: hierarchy missing, depth exceeded, subaccount-scope rejection.
 */
export function evaluateSpawnPreconditions(input: {
  hierarchy: Readonly<HierarchyContext> | undefined;
  currentHandoffDepth: number;
  maxHandoffDepth: number;
  effectiveScope: DelegationScope;
}):
  | { ok: true; effectiveScope: 'children' | 'descendants' }
  | { ok: false; errorCode: 'hierarchy_context_missing' | 'max_handoff_depth_exceeded' | 'cross_subtree_not_permitted' } {
  if (!input.hierarchy) {
    return { ok: false, errorCode: 'hierarchy_context_missing' };
  }
  if (input.currentHandoffDepth + 1 > input.maxHandoffDepth) {
    return { ok: false, errorCode: 'max_handoff_depth_exceeded' };
  }
  if (input.effectiveScope === 'subaccount') {
    return { ok: false, errorCode: 'cross_subtree_not_permitted' };
  }
  return { ok: true, effectiveScope: input.effectiveScope as 'children' | 'descendants' };
}

// ---------------------------------------------------------------------------
// evaluateReassignPreconditions
// ---------------------------------------------------------------------------

/**
 * Validates pre-conditions for executeReassignTask before any DB work.
 * Covers: hierarchy missing.
 */
export function evaluateReassignPreconditions(input: {
  hierarchy: Readonly<HierarchyContext> | undefined;
}):
  | { ok: true }
  | { ok: false; errorCode: 'hierarchy_context_missing' } {
  if (!input.hierarchy) {
    return { ok: false, errorCode: 'hierarchy_context_missing' };
  }
  return { ok: true };
}
